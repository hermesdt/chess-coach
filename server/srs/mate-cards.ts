import { Chess } from 'chess.js';
import type { Color, MoveAnalysis } from '../../shared/types.js';
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
