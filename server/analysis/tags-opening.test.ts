import { describe, expect, it } from 'vitest';
import { parsePgn } from '../chess/pgn.js';
import type { Color, Tag } from '../../shared/types.js';
import { openingTags } from './tags-opening.js';

const tagsOf = (movetext: string, color: Color): Record<number, Tag[]> => {
  const { moves } = parsePgn(movetext);
  return Object.fromEntries(openingTags(moves, color));
};
const plyOf = (movetext: string, color: Color, tag: Tag): number[] =>
  Object.entries(tagsOf(movetext, color))
    .filter(([, tags]) => tags.includes(tag))
    .map(([ply]) => Number(ply));

describe('early_queen', () => {
  it('tags a queen move before move 6 with two minors at home', () => {
    expect(plyOf('1. e4 e5 2. Qh5 Nc6 3. Bc4', 'white', 'early_queen')).toEqual([3]);
  });
  it('tags the Black side', () => {
    expect(plyOf('1. e4 e5 2. Nf3 Qh4 3. Nxh4', 'black', 'early_queen')).toEqual([4]);
  });
  it('does not tag a queen move at the 6th move', () => {
    const pgn = '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. d3 d6 5. O-O Nf6 6. Qe2 Qe7';
    expect(plyOf(pgn, 'white', 'early_queen')).toEqual([]);
  });
  it('does not tag when fewer than two minors are at home', () => {
    const pgn = '1. Nf3 Nf6 2. d3 Nc6 3. Bg5 e6 4. Nbd2 d6 5. Qc1 Qe7';
    expect(plyOf(pgn, 'white', 'early_queen')).toEqual([]);
  });
  it('does not tag the other colour', () => {
    expect(plyOf('1. e4 e5 2. Qh5 Nc6 3. Bc4', 'black', 'early_queen')).toEqual([]);
  });
});

const slowMoves = '1. e4 e5 2. d3 d6 3. a3 a6 4. h3 h6 5. a4 a5 6. h4 h5 7. c3 c6 8. b3 b6 9. g3 g6 10. f3 f5';

describe('slow_development', () => {
  it('tags the 10th move when two minors are still at home (White)', () => {
    expect(plyOf(slowMoves, 'white', 'slow_development')).toEqual([19]);
  });
  it('tags the 10th move for Black', () => {
    expect(plyOf(slowMoves, 'black', 'slow_development')).toEqual([20]);
  });
  it('does not tag a developed side', () => {
    const pgn =
      '1. e4 e5 2. Nf3 Nc6 3. Nc3 Nf6 4. Bc4 Bc5 5. d3 d6 6. Be3 Bb6 7. O-O O-O 8. h3 h6 9. a3 a6 10. b3 Ba5';
    expect(plyOf(pgn, 'white', 'slow_development')).toEqual([]);
    expect(plyOf(pgn, 'black', 'slow_development')).toEqual([]);
  });
  it('does not tag when exactly one minor is still at home', () => {
    const pgn =
      '1. e4 e5 2. Nf3 Nc6 3. Nc3 Nf6 4. d3 d6 5. Be3 Be7 6. h3 h6 7. a3 a6 8. b3 b6 9. h4 h5 10. a4 a5';
    expect(plyOf(pgn, 'white', 'slow_development')).toEqual([]);
    expect(plyOf(pgn, 'black', 'slow_development')).toEqual([]);
  });
  it('does not tag a game shorter than 10 moves', () => {
    expect(plyOf('1. e4 e5 2. d3 d6 3. a3 a6', 'white', 'slow_development')).toEqual([]);
  });
});

const NOT_CASTLED =
  '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. d3 d6 5. Nc3 Nf6 6. h3 h6 7. a3 a6 8. Be3 Bxe3 9. fxe3 Be6 10. Bxe6 fxe6 11. Qd2 Qd7 12. a4 a5';
const CASTLED_AT_12 =
  '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. d3 d6 5. Nc3 Nf6 6. h3 h6 7. a3 a6 8. Be3 Bxe3 9. fxe3 Be6 10. Bxe6 fxe6 11. Qd2 Qd7 12. O-O-O O-O-O';

describe('no_castle', () => {
  it('tags the 12th move when the king is uncastled on e1 / e8', () => {
    expect(plyOf(NOT_CASTLED, 'white', 'no_castle')).toEqual([23]);
    expect(plyOf(NOT_CASTLED, 'black', 'no_castle')).toEqual([24]);
  });
  it('does not tag a side that castled on move 12', () => {
    expect(plyOf(CASTLED_AT_12, 'white', 'no_castle')).toEqual([]);
    expect(plyOf(CASTLED_AT_12, 'black', 'no_castle')).toEqual([]);
  });
  it('tags a king on the e file that left its start square (Ke2)', () => {
    const pgn = NOT_CASTLED.replace('12. a4 a5', '12. Ke2 a5');
    expect(plyOf(pgn, 'white', 'no_castle')).toEqual([23]);
  });
  it('does not tag an uncastled king that walked to the g file', () => {
    const pgn =
      '1. e4 e5 2. Ke2 Nc6 3. Kf3 Nf6 4. Kg3 d6 5. a3 a6 6. a4 a5 7. h3 h6 8. h4 h5 9. b3 b6 10. c3 Rb8 11. d3 Bd7 12. Bd2 Qe7';
    expect(plyOf(pgn, 'white', 'no_castle')).toEqual([]);
  });
  it('does not tag a side that castled early', () => {
    const pgn = '1. e4 e5 2. Bc4 Nf6 3. Qf3 Nc6 4. Nc3 Be7 5. d3 O-O';
    expect(plyOf(pgn, 'black', 'no_castle')).toEqual([]);
  });
  it('does not tag a game shorter than 12 moves', () => {
    expect(plyOf('1. e4 e5 2. d3 d6', 'white', 'no_castle')).toEqual([]);
  });
});

describe('same_piece_twice', () => {
  it('tags the second quiet move of a knight (White)', () => {
    expect(plyOf('1. Nf3 d5 2. Ng5', 'white', 'same_piece_twice')).toEqual([3]);
  });
  it('tags the Black side', () => {
    expect(plyOf('1. e4 Nc6 2. d4 Nb4', 'black', 'same_piece_twice')).toEqual([4]);
  });
  it('does not tag when the second move is a capture', () => {
    expect(plyOf('1. Nf3 e5 2. Nxe5', 'white', 'same_piece_twice')).toEqual([]);
  });
  it('does not tag when the second move gives check', () => {
    expect(plyOf('1. e4 e6 2. Bc4 d6 3. Bb5+', 'white', 'same_piece_twice')).toEqual([]);
  });
  it('does not tag a repeat after the first 8 moves', () => {
    const pgn =
      '1. Nf3 Nf6 2. e3 e6 3. Be2 Be7 4. O-O O-O 5. d3 d6 6. Nc3 Nc6 7. a3 a6 8. h3 h6 9. Nd2';
    expect(plyOf(pgn, 'white', 'same_piece_twice')).toEqual([]);
  });
  it('does not tag moving different pieces or pawns twice', () => {
    expect(plyOf('1. e4 e5 2. Nf3 Nc6 3. Nc3', 'white', 'same_piece_twice')).toEqual([]);
  });
  it('treats a piece captured on its square as gone, and a recapturing piece as new', () => {
    const base = '1. Nf3 d5 2. e3 Bg4 3. h3 Bxf3 4. Qxf3 e6';
    expect(plyOf(`${base} 5. Be2`, 'white', 'same_piece_twice')).toEqual([]);
    expect(plyOf(`${base} 5. Qg3`, 'white', 'same_piece_twice')).toEqual([9]);
  });
  it('follows a piece by square: the g1 knight on f3 moved again', () => {
    expect(plyOf('1. Nf3 d5 2. e3 d4 3. Ne5', 'white', 'same_piece_twice')).toEqual([5]);
  });
});
