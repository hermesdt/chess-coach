import type { DatabaseSync } from 'node:sqlite';
import { Chess } from 'chess.js';
import type { CardRef, Color, GameAnalysis, MoveAnalysis } from '../../shared/types.js';
import { ANALYSIS_VERSION, getAnalysis } from '../analysis/analysis-repo.js';
import { listCardsByRef, positionKey, setRefs, setSuspended, upsertCard } from './cards-repo.js';
import { findMates } from './mates.js';

export interface MateMiss {
  ply: number; fen: string; color: Color; mateIn: 1 | 2;
  /** Every UCI move that mates in `mateIn`. */
  accepted: string[];
  best: string;
  playedSan: string;
  /** The engine line in SAN, only when chess.js replays it to checkmate. */
  line: string[] | null;
}

/** The engine line when it starts with `bestSan` and chess.js replays it to mate in `mateIn` own moves. */
function provenLine(fen: string, bestSan: string, pvSan: string[], mateIn: 1 | 2): string[] | null {
  const line = pvSan.slice(0, 2 * mateIn - 1);
  if (line.length !== 2 * mateIn - 1 || line[0] !== bestSan) return null;
  try {
    const chess = new Chess(fen);
    for (const san of line) chess.move(san);
    return chess.isCheckmate() ? line : null;
  } catch {
    return null;
  }
}

/**
 * The owner's moves where a mate in 1 or 2 existed and the move was not a fastest mate.
 * The stored engine mate is only a hint: chess.js must find the same mate. `skipped` counts disagreements.
 */
export function findMateMisses(moves: MoveAnalysis[]): { misses: MateMiss[]; skipped: number } {
  const misses: MateMiss[] = [];
  let skipped = 0;
  for (const m of moves) {
    const stored = m.evalBefore.mate;
    if (!m.isUserMove || (stored !== 1 && stored !== 2)) continue;
    const mates = findMates(m.fenBefore);
    if (!mates || mates.mateIn !== stored) {
      skipped += 1;
      continue;
    }
    if (mates.moves.includes(m.uci)) continue;
    const best = mates.moves.includes(m.bestUci) ? m.bestUci : mates.moves[0]!;
    misses.push({
      ply: m.ply, fen: m.fenBefore, color: m.color, mateIn: mates.mateIn, accepted: mates.moves, best,
      playedSan: m.san, line: best === m.bestUci ? provenLine(m.fenBefore, m.bestSan, m.pvSan, mates.mateIn) : null,
    });
  }
  return { misses, skipped };
}

function sanOf(fen: string, uci: string): string {
  return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined }).san;
}

function explanation(miss: MateMiss): string {
  if (miss.line) return `Mate in ${miss.mateIn}: ${miss.line.join(' ')}.`;
  const best = sanOf(miss.fen, miss.best);
  return miss.mateIn === 1 ? `Mate in 1: ${best}.` : `Mate in ${miss.mateIn} starts with ${best}.`;
}

/** Keeps this game's refs of `kind` cards that are (`keepIn`) or are not in `plies`. Cards left without refs are suspended. */
function dropRefs(db: DatabaseSync, gameId: number, kind: 'mate' | 'mistake', plies: Set<number>, keepIn: boolean): number {
  let suspended = 0;
  for (const card of listCardsByRef(db, gameId)) {
    if (card.kind !== kind) continue;
    const refs = card.refs.filter((r: CardRef) => r.gameId !== gameId || r.source === 'chat' || plies.has(r.ply ?? -1) === keepIn);
    if (refs.length === card.refs.length) continue;
    setRefs(db, card.id, refs);
    if (refs.length === 0 && !card.suspended) {
      setSuspended(db, card.id, true);
      suspended += 1;
    }
  }
  return suspended;
}

/**
 * Builds the mate cards of one game. A card whose miss is gone loses this game's ref; a card without refs is suspended.
 * A mate card replaces the mistake card at the same ply.
 */
export function buildMateCards(
  db: DatabaseSync,
  analysis: GameAnalysis,
): { created: number; updated: number; suspended: number; skipped: number } {
  const { misses, skipped } = findMateMisses(analysis.moves);
  const result = { created: 0, updated: 0, suspended: 0, skipped };
  for (const miss of misses) {
    const key = positionKey(miss.fen);
    const existed = db.prepare('SELECT 1 FROM cards WHERE kind = ? AND position_key = ?').get('mate', key) !== undefined;
    upsertCard(db, {
      kind: 'mate', positionKey: key, fen: miss.fen, sideToMove: miss.color,
      prompt: `${miss.color === 'white' ? 'White' : 'Black'} to move. You played ${miss.playedSan} in a game. Find the mate in ${miss.mateIn}.`,
      solution: { accepted: miss.accepted, best: miss.best, explanation: explanation(miss), mateIn: miss.mateIn, played: miss.playedSan },
      refs: [{ gameId: analysis.gameId, ply: miss.ply }], lastMove: null,
    });
    result[existed ? 'updated' : 'created'] += 1;
  }
  const plies = new Set(misses.map((m) => m.ply));
  result.suspended += dropRefs(db, analysis.gameId, 'mate', plies, true);
  result.suspended += dropRefs(db, analysis.gameId, 'mistake', plies, false);
  return result;
}

/** Builds the mate cards of every finished analysis at the current version. Safe to run again. */
export function syncMateCards(db: DatabaseSync): { games: number; created: number; skipped: number } {
  const ids = db.prepare("SELECT game_id FROM game_analysis WHERE status = 'done' AND version = ? ORDER BY game_id")
    .all(ANALYSIS_VERSION).map((r) => r.game_id as number);
  const total = { games: 0, created: 0, skipped: 0 };
  for (const id of ids) {
    const analysis = getAnalysis(db, id);
    if (analysis?.status !== 'done') continue;
    const r = buildMateCards(db, analysis);
    total.games += 1;
    total.created += r.created;
    total.skipped += r.skipped;
  }
  return total;
}
