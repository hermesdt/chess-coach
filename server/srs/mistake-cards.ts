import type { DatabaseSync } from 'node:sqlite';
import type { GameAnalysis, MoveAnalysis } from '../../shared/types.js';
import { CLASSIFICATION_TEXT, TAG_TEXT } from '../../shared/tag-text.js';
import { winPct } from '../analysis/winpct.js';
import type { EnginePool } from '../engine/pool.js';
import type { EngineLine } from '../engine/uci.js';
import { listCardsByRef, positionKey, setSuspended, upsertCard } from './cards-repo.js';

const MULTIPV = 3;
const ACCEPT_WITHIN = 5;

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

function explanation(m: MoveAnalysis): string {
  const label = CLASSIFICATION_TEXT[m.classification] ?? m.classification;
  const tags = m.tags.map((t) => TAG_TEXT[t]);
  return tags.length === 0 ? label : `${label} — ${tags.join('. ')}.`;
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

  for (const m of mistakes) {
    const lines = await pool.analyse(m.fenBefore, { nodes: opts.nodes, multipv: MULTIPV });
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
      solution: { accepted, best, explanation: explanation(m) },
      refs: [{ gameId: analysis.gameId, ply: m.ply }], lastMove: null,
    });
    result[existed ? 'updated' : 'created'] += 1;
  }

  const current = new Set(mistakes.map((m) => m.ply));
  for (const card of listCardsByRef(db, analysis.gameId)) {
    if (card.kind !== 'mistake' || card.suspended) continue;
    const stale = card.refs.every((r) => r.gameId === analysis.gameId && !current.has(r.ply ?? -1));
    if (stale) {
      setSuspended(db, card.id, true);
      result.suspended += 1;
    }
  }
  return result;
}
