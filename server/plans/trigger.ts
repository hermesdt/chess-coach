import { Chess, type Color, type PieceSymbol } from 'chess.js';
import type { Condition, PlanSide, Trigger } from '../../shared/plans.js';

type Who = 'own' | 'opp';

function colorOf(owner: PlanSide, who: Who): Color {
  const own: Color = owner === 'white' ? 'w' : 'b';
  if (who === 'own') return own;
  return own === 'w' ? 'b' : 'w';
}

/** True when `cond` holds on `chess` for the owner `side`. */
function holds(chess: Chess, owner: PlanSide, cond: Condition): boolean {
  const board = chess.board();
  const pieces = (color: Color) => board.flat().filter((p): p is NonNullable<typeof p> => p !== null && p.color === color);
  switch (cond.type) {
    case 'piece': {
      const color = colorOf(owner, cond.side);
      return pieces(color).some((p) => p.type === (cond.piece.toLowerCase() as PieceSymbol) && cond.on.includes(p.square));
    }
    case 'pawns': {
      const color = colorOf(owner, cond.side);
      const pawns = new Set(pieces(color).filter((p) => p.type === 'p').map((p) => p.square));
      return cond.on.every((sq) => pawns.has(sq as never));
    }
    case 'noPawn': {
      const color = colorOf(owner, cond.side);
      return !pieces(color).some((p) => p.type === 'p' && p.square[0] === cond.file);
    }
    case 'castled': {
      const color = colorOf(owner, cond.side);
      const king = pieces(color).find((p) => p.type === 'k');
      if (!king) return false;
      if (king.square[1] !== (color === 'w' ? '1' : '8')) return false;
      const file = king.square[0]!;
      return cond.wing === 'short' ? 'fgh'.includes(file) : 'abc'.includes(file);
    }
    case 'queensOn':
      return pieces('w').some((p) => p.type === 'q') && pieces('b').some((p) => p.type === 'q');
    case 'minPieces':
      return (['w', 'b'] as const).every((c) => pieces(c).filter((p) => 'rbn'.includes(p.type)).length >= cond.count);
  }
}

/** Every `all` condition holds and no `none` condition holds. `side` is the owner's colour. */
export function matchTrigger(fen: string, side: PlanSide, t: Trigger): boolean {
  const chess = new Chess(fen);
  return t.all.every((c) => holds(chess, side, c)) && !(t.none ?? []).some((c) => holds(chess, side, c));
}

const PIECE_NAME: Record<string, string> = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight', P: 'pawn' };

function orList(squares: string[]): string {
  if (squares.length <= 1) return squares.join('');
  return `${squares.slice(0, -1).join(', ')} or ${squares[squares.length - 1]}`;
}

function andList(squares: string[]): string {
  if (squares.length <= 1) return squares.join('');
  return `${squares.slice(0, -1).join(', ')} and ${squares[squares.length - 1]}`;
}

function label(c: Condition): string {
  switch (c.type) {
    case 'piece':
      return `${c.side === 'own' ? 'Your' : 'Their'} ${PIECE_NAME[c.piece]} is on ${orList(c.on)}.`;
    case 'pawns':
      return `${c.side === 'own' ? 'You have' : 'They have'} ${c.on.length === 1 ? 'a pawn' : 'pawns'} on ${andList(c.on)}.`;
    case 'noPawn':
      return `${c.side === 'own' ? 'You have' : 'They have'} no ${c.file}-pawn.`;
    case 'castled':
      return `${c.side === 'own' ? 'You' : 'They'} castled ${c.wing}.`;
    case 'queensOn':
      return 'Both queens are on the board.';
    case 'minPieces':
      return `Each side has at least ${c.count} rooks or minor pieces.`;
  }
}

/** One English label per condition, for the "When" list. The label comes from the data, so it never differs from the check. */
export function triggerLabels(t: Trigger): string[] {
  return [...t.all.map(label), ...(t.none ?? []).map((c) => `Not: ${label(c)}`)];
}
