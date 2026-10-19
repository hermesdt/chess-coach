import type { DatabaseSync } from 'node:sqlite';
import type { GameAnalysis, GameReview, MoveAnalysis, Tag } from '../../shared/types.js';
import { bySeverity, CLASSIFICATION_TEXT, TAG_TEXT } from '../../shared/tag-text.js';
import { winPct } from '../analysis/winpct.js';
import type { EnginePool } from '../engine/pool.js';
import type { EngineLine } from '../engine/uci.js';
import { latestReview } from '../ai/notes-repo.js';
import { listCardsByRef, positionKey, setRefs, setSolution, setSuspended, upsertCard } from './cards-repo.js';

const MULTIPV = 3;
const ACCEPT_WITHIN = 5;
/** Opening-habit tags are noise on a tactical card, so only these tags are explained. */
const MATERIAL_TAGS: Tag[] = ['allowed_mate', 'missed_mate', 'hung_piece', 'bad_trade', 'missed_capture'];

/** Moves whose win % is within 5 of the best line. The played move is never accepted. */
export function acceptedMoves(lines: EngineLine[], played: string): string[] {
  const first = lines[0];
  if (!first) return [];
  const best = winPct(first.score);
  const out: string[] = [];
  for (const l of lines) {
    const uci = l.pv[0];
    if (uci && uci !== played && best - winPct(l.score) <= ACCEPT_WITHIN) out.push(uci);
  }
  return out;
}

/** True when the played move is one of the lines and within 5 win % of the best one. */
function playedWithinMargin(lines: EngineLine[], played: string): boolean {
  const first = lines[0];
  if (!first) return false;
  const best = winPct(first.score);
  return lines.some((l) => l.pv[0] === played && best - winPct(l.score) <= ACCEPT_WITHIN);
}

function explanation(m: MoveAnalysis, why?: string): string {
  const label = CLASSIFICATION_TEXT[m.classification] ?? m.classification;
  const tags = bySeverity(m.tags.filter((t) => MATERIAL_TAGS.includes(t))).map((t) => TAG_TEXT[t]);
  const base = tags.length === 0 ? label : `${label} — ${tags.join('. ')}.`;
  if (!why) return base;
  return `${base}${base.endsWith('.') ? '' : '.'} ${why}`;
}

const whyByPly = (review: GameReview | null): Map<number, string> =>
  new Map((review?.moments ?? []).filter((m) => m.whyItMatters.trim() !== '').map((m) => [m.ply, m.whyItMatters.trim()]));

/** Adds the coach's "why it matters" to the mistake cards that point at a ply of this game. Other cards are not touched. */
export function applyCoachExplanations(db: DatabaseSync, analysis: GameAnalysis, review: GameReview): number {
  const why = whyByPly(review);
  const moves = new Map(analysis.moves.map((m) => [m.ply, m]));
  let updated = 0;
  for (const card of listCardsByRef(db, analysis.gameId)) {
    if (card.kind !== 'mistake') continue;
    for (const ref of card.refs) {
      const m = ref.gameId === analysis.gameId && ref.source !== 'chat' && ref.ply !== undefined ? moves.get(ref.ply) : undefined;
      const text = m ? why.get(m.ply) : undefined;
      if (!m || !text) continue;
      setSolution(db, card.id, { ...card.solution, explanation: explanation(m, text) });
      updated += 1;
      break;
    }
  }
  return updated;
}

const isMistake = (m: MoveAnalysis): boolean =>
  m.isUserMove && (m.classification === 'blunder' || m.classification === 'mistake');

function cardExists(db: DatabaseSync, key: string): boolean {
  return db.prepare('SELECT 1 FROM cards WHERE kind = ? AND position_key = ?').get('mistake', key) !== undefined;
}

/** Build review cards for the user's blunders and mistakes. Suspends cards that no longer apply. */
export async function buildMistakeCards(
  db: DatabaseSync,
  analysis: GameAnalysis,
  pool: Pick<EnginePool, 'analyse'>,
  opts: { nodes: number },
): Promise<{ created: number; updated: number; suspended: number }> {
  const result = { created: 0, updated: 0, suspended: 0 };
  const mistakes = analysis.moves.filter(isMistake);
  const why = whyByPly(latestReview(db, `game:${analysis.gameId}`, analysis.version));

  for (const m of mistakes) {
    const lines = await pool.analyse(m.fenBefore, { nodes: opts.nodes, multipv: MULTIPV });
    // The played move is within the accepted margin of the best line: not a real mistake at this depth.
    if (playedWithinMargin(lines, m.uci)) continue;
    const accepted = acceptedMoves(lines, m.uci);
    const first = lines[0]?.pv[0];
    const best = first && first !== m.uci ? first : accepted[0];
    if (!best) continue;
    const key = positionKey(m.fenBefore);
    const existed = cardExists(db, key);
    const color = m.color;
    upsertCard(db, {
      kind: 'mistake', positionKey: key, fen: m.fenBefore, sideToMove: color,
      prompt: `${color === 'white' ? 'White' : 'Black'} to move. You played ${m.san} here in a game. Find a better move.`,
      solution: { accepted, best, explanation: explanation(m, why.get(m.ply)) },
      refs: [{ gameId: analysis.gameId, ply: m.ply }], lastMove: null,
    });
    result[existed ? 'updated' : 'created'] += 1;
  }

  // Drop this game's refs that are no longer a blunder or mistake. An empty card is suspended.
  const current = new Set(mistakes.map((m) => m.ply));
  for (const card of listCardsByRef(db, analysis.gameId)) {
    if (card.kind !== 'mistake') continue;
    const refs = card.refs.filter((r) => r.gameId !== analysis.gameId || r.source === 'chat' || current.has(r.ply ?? -1));
    if (refs.length === card.refs.length) continue;
    setRefs(db, card.id, refs);
    if (refs.length === 0 && !card.suspended) {
      setSuspended(db, card.id, true);
      result.suspended += 1;
    }
  }
  return result;
}
