import { Chess } from 'chess.js';

export interface ReplayedBoard {
  fen: string;
  /** The moves in normal SAN. */
  sans: string[];
  lastMove: { from: string; to: string } | null;
}

/** Replays SAN moves from the start position. Null when a move is illegal. */
export function replayBoard(moves: string[]): ReplayedBoard | null {
  const chess = new Chess();
  const sans: string[] = [];
  let lastMove: ReplayedBoard['lastMove'] = null;
  for (const san of moves) {
    try {
      const m = chess.move(san);
      sans.push(m.san);
      lastMove = { from: m.from, to: m.to };
    } catch {
      return null;
    }
  }
  return { fen: chess.fen(), sans, lastMove };
}
