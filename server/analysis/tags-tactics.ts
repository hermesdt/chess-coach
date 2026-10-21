import { Chess, type Color as ChessColor, type PieceSymbol, type Square } from 'chess.js';
import type { Color, Tag } from '../../shared/types';
import { PIECE_VALUE, playUci } from './tags-material.js';

export interface TacticTagInput {
  /** Position before the user's move. The user is to move. */
  fenBefore: string;
  /** The user's move, UCI. */
  played: string;
  /** Engine best move at `fenBefore`, UCI. */
  best: string;
  /** Engine best line at `fenBefore`, UCI. Starts with `best`. */
  bestPv: string[];
  /** The opponent's best line after the played move, UCI. */
  replyPv: string[];
  /** Win % the user lost with the played move. */
  winLoss: number;
  userColor: Color;
  /** Ply of the played move, counted from 1. */
  ply: number;
}

/** Tactic tags need a real loss, the same bar as the tag-only key moments. */
const MIN_WIN_LOSS = 10;
/** Material the best line must win after its first move, in pawns (P1 N3 B3 R5 Q9). */
const MIN_BEST_GAIN = 2;
/** The reply line of a back-rank check must win at least this much, in pawns, when it does not mate. */
const MIN_BACK_RANK_GAIN = 3;
const GAIN_PLIES = 4;
const MAX_REPLY_PLIES = 8;
const BAD_BISHOP_FIRST_MOVE = 10;
const BAD_BISHOP_LAST_MOVE = 40;
const BAD_BISHOP_MIN_PAWNS = 5;

const DIRECTIONS: Partial<Record<PieceSymbol, [number, number][]>> = {
  b: [[1, 1], [1, -1], [-1, 1], [-1, -1]],
  r: [[1, 0], [-1, 0], [0, 1], [0, -1]],
  q: [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]],
};

const toChessColor = (c: Color): ChessColor => (c === 'white' ? 'w' : 'b');
const other = (c: ChessColor): ChessColor => (c === 'w' ? 'b' : 'w');
const squareAt = (file: number, rank: number): Square => `${String.fromCharCode(97 + file)}${rank}` as Square;
/** 0 for a light square, 1 for a dark square. */
const squareColour = (sq: Square): number => (sq.charCodeAt(0) - 97 + Number(sq[1])) % 2;

function material(chess: Chess, color: ChessColor): number {
  let sum = 0;
  for (const row of chess.board()) for (const cell of row) if (cell && cell.color === color) sum += PIECE_VALUE[cell.type]!;
  return sum;
}

/** Plays the line as far as it is legal. Returns the last position reached. */
function playLine(fen: string, line: string[], plies: number): Chess {
  const chess = new Chess(fen);
  for (const uci of line.slice(0, plies)) {
    try {
      playUci(chess, uci);
    } catch {
      break;
    }
  }
  return chess;
}

/**
 * Material the line wins for `color` after its first move, within 4 plies. The first move itself does not
 * count, so a plain recapture is not "winning" material.
 */
function gainAfterFirstMove(fen: string, line: string[], color: ChessColor): number {
  const balance = (chess: Chess): number => material(chess, color) - material(chess, other(color));
  return balance(playLine(fen, line, GAIN_PLIES)) - balance(playLine(fen, line, 1));
}

/** Pieces (not pawns) that `to` attacks and that are worth more than the mover or are undefended. The king counts. */
function forkTargets(chess: Chess, to: Square, color: ChessColor): number {
  const mover = chess.get(to);
  if (!mover) return 0;
  const enemy = other(color);
  let targets = 0;
  for (const row of chess.board()) {
    for (const cell of row) {
      if (!cell || cell.color !== enemy || cell.type === 'p' || !chess.attackers(cell.square, color).includes(to)) continue;
      if (cell.type === 'k' || PIECE_VALUE[cell.type]! > PIECE_VALUE[mover.type]! || chess.attackers(cell.square, enemy).length === 0) targets += 1;
    }
  }
  return targets;
}

interface Pin { pinner: Square; pinned: Square; behind: Square }

/** Pins by the sliders of `color`: an enemy piece (not a pawn) with the enemy king or a higher-value enemy piece behind it. */
function pinsBy(chess: Chess, color: ChessColor): Pin[] {
  const pins: Pin[] = [];
  for (const row of chess.board()) {
    for (const slider of row) {
      const directions = slider && slider.color === color ? DIRECTIONS[slider.type] : undefined;
      if (!slider || !directions) continue;
      for (const [df, dr] of directions) {
        let file = slider.square.charCodeAt(0) - 97 + df;
        let rank = Number(slider.square[1]) + dr;
        let front: { square: Square; value: number } | null = null;
        for (; file >= 0 && file <= 7 && rank >= 1 && rank <= 8; file += df, rank += dr) {
          const square = squareAt(file, rank);
          const piece = chess.get(square);
          if (!piece) continue;
          if (piece.color === color) break;
          if (!front) {
            if (piece.type === 'k' || piece.type === 'p') break;
            front = { square, value: PIECE_VALUE[piece.type]! };
            continue;
          }
          if (piece.type === 'k' || PIECE_VALUE[piece.type]! > front.value) pins.push({ pinner: slider.square, pinned: front.square, behind: square });
          break;
        }
      }
    }
  }
  return pins;
}

function missedFork(input: TacticTagInput, color: ChessColor): boolean {
  const chess = new Chess(input.fenBefore);
  const move = playUci(chess, input.best);
  return forkTargets(chess, move.to, color) >= 2 && gainAfterFirstMove(input.fenBefore, input.bestPv, color) >= MIN_BEST_GAIN;
}

function missedPin(input: TacticTagInput, color: ChessColor): boolean {
  const chess = new Chess(input.fenBefore);
  const before = pinsBy(chess, color);
  const move = playUci(chess, input.best);
  if (!DIRECTIONS[move.piece]) return false;
  const created = pinsBy(chess, color).filter((p) => p.pinner === move.to
    && !before.some((b) => b.pinned === p.pinned && b.behind === p.behind));
  return created.length > 0 && gainAfterFirstMove(input.fenBefore, input.bestPv, color) >= MIN_BEST_GAIN;
}

function weakBackRank(input: TacticTagInput, color: ChessColor): boolean {
  const chess = new Chess(input.fenBefore);
  playUci(chess, input.played);
  const king = chess.board().flat().find((cell) => cell && cell.type === 'k' && cell.color === color);
  const homeRank = color === 'w' ? 1 : 8;
  if (!king || Number(king.square[1]) !== homeRank) return false;
  // No flight square off the back rank: the three squares in front of the king hold own pieces.
  const kingFile = king.square.charCodeAt(0) - 97;
  for (const file of [kingFile - 1, kingFile, kingFile + 1]) {
    if (file < 0 || file > 7) continue;
    if (chess.get(squareAt(file, color === 'w' ? 2 : 7))?.color !== color) return false;
  }
  const first = input.replyPv[0];
  if (!first) return false;
  const reply = new Chess(chess.fen());
  let check;
  try {
    check = playUci(reply, first);
  } catch {
    return false;
  }
  if (!check.san.endsWith('+') && !check.san.endsWith('#')) return false;
  if (Number(check.to[1]) !== homeRank) return false;
  if (playLine(chess.fen(), input.replyPv, MAX_REPLY_PLIES).isCheckmate()) return true;
  const opponent = other(color);
  const balance = (c: Chess): number => material(c, opponent) - material(c, color);
  return balance(playLine(chess.fen(), input.replyPv, GAIN_PLIES)) - balance(chess) >= MIN_BACK_RANK_GAIN;
}

function badBishop(input: TacticTagInput, color: ChessColor): boolean {
  const moveNumber = Math.ceil(input.ply / 2);
  if (moveNumber < BAD_BISHOP_FIRST_MOVE || moveNumber > BAD_BISHOP_LAST_MOVE) return false;
  const chess = new Chess(input.fenBefore);
  const move = playUci(chess, input.played);
  if (move.piece !== 'p' || move.promotion) return false;
  const pieces = chess.board().flat().filter((cell) => cell && cell.color === color);
  const bishops = pieces.filter((cell) => cell!.type === 'b');
  if (bishops.length !== 1) return false;
  const colour = squareColour(bishops[0]!.square);
  if (squareColour(move.to) !== colour) return false;
  const pawns = pieces.filter((cell) => cell!.type === 'p' && squareColour(cell!.square) === colour);
  return pawns.length >= BAD_BISHOP_MIN_PAWNS;
}

/**
 * Level-2 tags for one user move. Rules in the spec §8 style: plain chess.js facts plus the engine lines.
 * Throws when a move of the input is illegal; the caller handles that.
 */
export function tacticTags(input: TacticTagInput): Tag[] {
  const color = toChessColor(input.userColor);
  const tags: Tag[] = [];
  const lostEnough = input.played !== input.best && input.winLoss >= MIN_WIN_LOSS && input.bestPv.length > 0;
  if (lostEnough && missedFork(input, color)) tags.push('missed_fork');
  if (lostEnough && missedPin(input, color)) tags.push('missed_pin');
  if (weakBackRank(input, color)) tags.push('weak_back_rank');
  if (badBishop(input, color)) tags.push('bad_bishop');
  return tags;
}
