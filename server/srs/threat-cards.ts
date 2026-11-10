import type { DatabaseSync } from 'node:sqlite';
import { Chess } from 'chess.js';
import type { GameAnalysis } from '../../shared/types.js';
import { playUci } from '../analysis/tags-material.js';
import { flip } from '../analysis/winpct.js';
import type { EnginePool } from '../engine/pool.js';
import type { EngineLine } from '../engine/uci.js';
import { dropRefs, findMateMisses } from './mate-cards.js';
import { acceptedMoves, playedWithinMargin } from './mistake-cards.js';
import { listCardsByRef, positionKey, upsertCard } from './cards-repo.js';
import { confirmThreat, findThreatCandidates, threatText, type ThreatCandidate } from './threats.js';

const MULTIPV = 3;

/** Plies of this game that have an active threat card. */
export function threatPlies(db: DatabaseSync, gameId: number): Set<number> {
  const plies = new Set<number>();
  for (const card of listCardsByRef(db, gameId)) {
    if (card.kind !== 'threat' || card.suspended) continue;
    for (const r of card.refs) if (r.gameId === gameId && r.source !== 'chat' && r.ply !== undefined) plies.add(r.ply);
  }
  return plies;
}

/** Step 1: the moves that carry out the threat. Null when the engine does not confirm it. */
async function stepOne(
  c: ThreatCandidate, pool: Pick<EnginePool, 'analyse'>, nodes: number,
): Promise<{ accepted: string[]; best: string } | null> {
  const t = c.threat.toLowerCase();
  if (c.kind === 'mate') return { accepted: c.mateMoves, best: c.mateMoves.includes(t) ? t : c.mateMoves[0]! };
  const lines = await pool.analyse(c.nullFen, { nodes, multipv: MULTIPV });
  let threatLine: EngineLine | null = null;
  if (!lines.some((l) => l.pv[0]?.toLowerCase() === t)) {
    const chess = new Chess(c.nullFen);
    playUci(chess, t);
    const after = await pool.analyse(chess.fen(), { nodes, multipv: 1 });
    const top = after[0];
    if (top) threatLine = { multipv: 1, score: flip(top.score), pv: [t, ...top.pv] };
  }
  return confirmThreat(c.nullFen, t, lines, threatLine);
}

/**
 * Builds the threat cards of one game. A card whose threat is gone loses this game's ref; a card without refs is suspended.
 * A threat card replaces the mistake card at the same ply. A mate card wins over a threat card.
 */
export async function buildThreatCards(
  db: DatabaseSync,
  analysis: GameAnalysis,
  pool: Pick<EnginePool, 'analyse'>,
  opts: { nodes: number },
): Promise<{ created: number; updated: number; suspended: number; skipped: number }> {
  const result = { created: 0, updated: 0, suspended: 0, skipped: 0 };
  const mateMisses = new Set(findMateMisses(analysis.moves).misses.map((m) => m.ply));
  const built = new Set<number>();
  for (const c of findThreatCandidates(analysis.moves, mateMisses)) {
    const step1 = await stepOne(c, pool, opts.nodes);
    if (!step1) {
      result.skipped += 1;
      continue;
    }
    const lines = await pool.analyse(c.fenBefore, { nodes: opts.nodes, multipv: MULTIPV });
    if (playedWithinMargin(lines, c.playedUci)) {
      result.skipped += 1;
      continue;
    }
    const accepted = acceptedMoves(lines, c.playedUci);
    const first = lines[0]?.pv[0];
    const best = first && first !== c.playedUci ? first : accepted[0];
    if (!best) {
      result.skipped += 1;
      continue;
    }
    const key = positionKey(c.fenBefore);
    const existed = db.prepare('SELECT 1 FROM cards WHERE kind = ? AND position_key = ?').get('threat', key) !== undefined;
    const opponent = c.color === 'white' ? 'Black' : 'White';
    upsertCard(db, {
      kind: 'threat', positionKey: key, fen: c.fenBefore, sideToMove: c.color,
      prompt: `${c.color === 'white' ? 'White' : 'Black'} to move. Your opponent just played ${c.lastMove.san}. What does it threaten?`,
      solution: {
        accepted, best, played: c.playedSan,
        explanation: `In the game you played ${c.playedSan}. ${opponent} played ${c.replySan}.`,
        threat: { fen: c.nullFen, accepted: step1.accepted, best: step1.best, explanation: threatText(c.nullFen, step1.best, c.kind === 'mate') },
      },
      refs: [{ gameId: analysis.gameId, ply: c.ply }], lastMove: { uci: c.lastMove.uci },
    });
    built.add(c.ply);
    result[existed ? 'updated' : 'created'] += 1;
  }
  result.suspended += dropRefs(db, analysis.gameId, 'threat', built, true);
  result.suspended += dropRefs(db, analysis.gameId, 'mistake', built, false);
  return result;
}
