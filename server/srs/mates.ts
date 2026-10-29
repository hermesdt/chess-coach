import { Chess, type Move } from 'chess.js';

export interface Mates { mateIn: 1 | 2; moves: string[] }

const uci = (m: Move): string => m.from + m.to + (m.promotion ?? '');

/** True when the side to move has a move that gives checkmate. */
function hasMateInOne(chess: Chess): boolean {
  for (const m of chess.moves({ verbose: true })) {
    chess.move(m);
    const mate = chess.isCheckmate();
    chess.undo();
    if (mate) return true;
  }
  return false;
}

/** The move mates in 2: the opponent has a legal reply (no stalemate) and every reply allows a mate in 1. */
function matesInTwo(chess: Chess, move: Move): boolean {
  chess.move(move);
  try {
    const replies = chess.moves({ verbose: true });
    if (replies.length === 0) return false;
    for (const reply of replies) {
      chess.move(reply);
      const ok = hasMateInOne(chess);
      chess.undo();
      if (!ok) return false;
    }
    return true;
  } finally {
    chess.undo();
  }
}

/**
 * The shortest forced mate (1 or 2 moves) for the side to move, with every move that starts it.
 * Exhaustive search with chess.js; no engine. Null when there is no mate in 1 or 2.
 */
export function findMates(fen: string): Mates | null {
  const chess = new Chess(fen);
  const legal = chess.moves({ verbose: true });
  const one: string[] = [];
  for (const m of legal) {
    chess.move(m);
    if (chess.isCheckmate()) one.push(uci(m));
    chess.undo();
  }
  if (one.length > 0) return { mateIn: 1, moves: one };
  const two = legal.filter((m) => matesInTwo(chess, m)).map(uci);
  return two.length > 0 ? { mateIn: 2, moves: two } : null;
}
