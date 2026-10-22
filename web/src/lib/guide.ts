import { Chess } from 'chess.js';

/** Position after the first `count` moves of a SAN list, played from the start. */
export function fenAfterMoves(moves: string[], count: number): string {
  const chess = new Chess();
  for (const san of moves.slice(0, count)) chess.move(san);
  return chess.fen();
}

/** Last move of the first `count` moves as "e2e4", or null at the start. */
export function lastMoveAfter(moves: string[], count: number): string | null {
  const chess = new Chess();
  let last: string | null = null;
  for (const san of moves.slice(0, count)) {
    const m = chess.move(san);
    last = m.from + m.to;
  }
  return last;
}

/** "5.e5" for a white move and "5…e6" for a black move, from the length of a node id path. */
export function moveLabel(nodeId: string, san: string): string {
  const ply = nodeId.split(' ').length;
  return `${Math.ceil(ply / 2)}${ply % 2 === 1 ? '.' : '…'}${san}`;
}

/** Splits a guide text on blank lines. */
export function paragraphs(text: string): string[] {
  return text.split('\n\n').map((p) => p.trim()).filter(Boolean);
}
