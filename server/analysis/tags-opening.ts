import { Chess } from 'chess.js';
import type { Color, MoveInfo, Tag } from '../../shared/types.js';

const MINOR_HOMES: Record<Color, { square: string; type: 'n' | 'b' }[]> = {
  white: [
    { square: 'b1', type: 'n' },
    { square: 'g1', type: 'n' },
    { square: 'c1', type: 'b' },
    { square: 'f1', type: 'b' },
  ],
  black: [
    { square: 'b8', type: 'n' },
    { square: 'g8', type: 'n' },
    { square: 'c8', type: 'b' },
    { square: 'f8', type: 'b' },
  ],
};
const KING_HOME: Record<Color, string> = { white: 'e1', black: 'e8' };

const minorsAtHome = (fen: string, color: Color): number => {
  const chess = new Chess(fen);
  const letter = color === 'white' ? 'w' : 'b';
  return MINOR_HOMES[color].filter(({ square, type }) => {
    const piece = chess.get(square as Parameters<Chess['get']>[0]);
    return piece?.type === type && piece.color === letter;
  }).length;
};

const kingSquare = (fen: string, color: Color): string | null => {
  const chess = new Chess(fen);
  const letter = color === 'white' ? 'w' : 'b';
  for (const row of chess.board())
    for (const piece of row) if (piece?.type === 'k' && piece.color === letter) return piece.square;
  return null;
};

export function openingTags(moves: MoveInfo[], userColor: Color): Map<number, Tag[]> {
  const result = new Map<number, Tag[]>();
  const add = (ply: number, tag: Tag) => result.set(ply, [...(result.get(ply) ?? []), tag]);
  const letter = userColor === 'white' ? 'w' : 'b';
  const userParity = userColor === 'white' ? 1 : 0;

  let userMoveNo = 0;
  let castled = false;
  let queenTagged = false;
  let twiceTagged = false;
  const movedPieces = new Set<string>(); // squares of user's non-pawn, non-king pieces that have moved

  for (const move of moves) {
    const to = move.uci.slice(2, 4);
    if (move.ply % 2 !== userParity) {
      movedPieces.delete(to); // opponent captured a tracked piece
      continue;
    }
    userMoveNo += 1;
    const from = move.uci.slice(0, 2);
    const piece = new Chess(move.fenBefore).get(from as Parameters<Chess['get']>[0]);
    if (move.san.startsWith('O-O')) castled = true;

    if (
      !queenTagged &&
      userMoveNo < 6 &&
      piece?.type === 'q' &&
      piece.color === letter &&
      minorsAtHome(move.fenBefore, userColor) >= 2
    ) {
      queenTagged = true;
      add(move.ply, 'early_queen');
    }

    if (piece && piece.type !== 'p' && piece.type !== 'k') {
      const repeat = movedPieces.has(from);
      movedPieces.delete(from);
      movedPieces.add(to);
      if (
        !twiceTagged &&
        userMoveNo <= 8 &&
        repeat &&
        !move.san.includes('x') &&
        !/[+#]$/.test(move.san)
      ) {
        twiceTagged = true;
        add(move.ply, 'same_piece_twice');
      }
    }

    if (userMoveNo === 10 && minorsAtHome(move.fenAfter, userColor) >= 2) add(move.ply, 'slow_development');

    if (userMoveNo === 12 && !castled) {
      const king = kingSquare(move.fenAfter, userColor);
      if (king && (king === KING_HOME[userColor] || king[0] === 'd' || king[0] === 'e')) add(move.ply, 'no_castle');
    }
  }
  return result;
}
