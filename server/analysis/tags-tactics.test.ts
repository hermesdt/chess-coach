import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import type { Color } from '../../shared/types.js';
import { tacticTags, type TacticTagInput } from './tags-tactics.js';

/**
 * Every position below is reached by legal moves from the start position (chess.js throws on an illegal move).
 * The engine data (best move, PV, reply PV, win loss) is fixture data from Stockfish 19, 200000 nodes per search,
 * computed once in a throwaway script. Win loss = win % before - mover win % after, with the same formula as winpct.ts.
 */
function reach(sans: string): { fen: string; ply: number } {
  const chess = new Chess();
  const list = sans.split(' ');
  for (const san of list) chess.move(san);
  return { fen: chess.fen(), ply: list.length + 1 };
}

function legal(fen: string, uci: string): boolean {
  return new Chess(fen).moves({ verbose: true }).some((m) => m.from + m.to + (m.promotion ?? '') === uci);
}

function input(seq: string, userColor: Color, rest: Omit<TacticTagInput, 'fenBefore' | 'userColor' | 'ply'>): TacticTagInput {
  const { fen, ply } = reach(seq);
  expect(new Chess(fen).turn()).toBe(userColor === 'white' ? 'w' : 'b');
  expect(legal(fen, rest.played)).toBe(true);
  expect(legal(fen, rest.best)).toBe(true);
  return { fenBefore: fen, userColor, ply, ...rest };
}

// White to move; Nc7+ forks the king e8 and the rook a8 and wins the rook.
const FORK_SEQ = 'Nc3 d5 h4 c6 f3 Qd6 a3 Qh6 Nxd5 b6';
const fork = (over: Partial<TacticTagInput> = {}): TacticTagInput => input(FORK_SEQ, 'white', {
  played: 'd2d4', best: 'd5c7', bestPv: ['d5c7', 'e8d8', 'c7a8', 'h6d6', 'g1h3', 'c6c5'],
  replyPv: ['h6d6', 'd5f4', 'b8d7', 'e2e4'], winLoss: 25.0, ...over,
});

// Black to move; Bb4 pins the white queen on c3 to the king on e1 and wins the queen for a bishop.
const PIN_SEQ = 'd4 e6 Bf4 a6 e4 Ra7 Qf3 Nc6 Qc3';
const pin = (over: Partial<TacticTagInput> = {}): TacticTagInput => input(PIN_SEQ, 'black', {
  played: 'g8f6', best: 'f8b4', bestPv: ['f8b4', 'd4d5', 'b4c3', 'b2c3', 'g8e7', 'g1f3'],
  replyPv: ['c3d3', 'b7b5', 'b1d2', 'f8d6'], winLoss: 48.7, ...over,
});

// Quiet Ruy Lopez position: the best move creates no fork and no pin.
const QUIET_SEQ = 'e4 e5 Nf3 Nc6';
const quiet = (over: Partial<TacticTagInput> = {}): TacticTagInput => input(QUIET_SEQ, 'white', {
  played: 'f1c4', best: 'f1b5', bestPv: ['f1b5', 'a7a6'], replyPv: ['g8f6', 'f3g5'], winLoss: 1.7, ...over,
});

// Black to move; Kf8 leaves the back rank with no escape and Qxd8+ wins (mate in 3).
const BACK_SEQ = 'e4 c5 d4 cxd4 c3 dxc3 b3 Nc6 Nxc3 Nf6 Bb2 Qa5 Qd2 e5 Nf3 Bb4 Bd3 d5 a3 Bxc3 Bxc3 Qc5 Nxe5 dxe4 Nxc6 O-O Ne7+ Qxe7 Be2 Rd8 Bb4';
const back = (over: Partial<TacticTagInput> = {}): TacticTagInput => input(BACK_SEQ, 'black', {
  played: 'g8f8', best: 'e7e8', bestPv: ['e7e8', 'b4e7'], replyPv: ['d2d8', 'f6e8', 'b4e7', 'f8g8', 'd8e8'], winLoss: 62.8, ...over,
});

// French structure, Black has only the light-squared bishop. 10...b5 puts a fifth pawn on a light square.
const BISHOP_SEQ = 'e4 e6 d4 d5 Nc3 Bb4 e5 c5 a3 Bxc3+ bxc3 Ne7 Nf3 Nbc6 Bd3 Qc7 O-O Bd7 Re1';
const bishop = (played: string, seq = BISHOP_SEQ): TacticTagInput =>
  input(seq, 'black', { played, best: played, bestPv: [], replyPv: [], winLoss: 0 });

describe('position facts', () => {
  it('the fork position has the expected FEN and Nc7+ attacks the king and the rook', () => {
    const { fen } = reach(FORK_SEQ);
    expect(fen).toBe('rnb1kbnr/p3pppp/1pp4q/3N4/7P/P4P2/1PPPP1P1/R1BQKBNR w KQkq - 0 6');
    const after = new Chess(fen);
    after.move('Nc7+');
    expect(after.attackers('e8', 'w')).toContain('c7');
    expect(after.attackers('a8', 'w')).toContain('c7');
  });

  it('after Bb4 the black bishop pins the white queen to the king', () => {
    const after = new Chess(reach(PIN_SEQ).fen);
    after.move('Bb4');
    expect(after.get('c3')).toMatchObject({ type: 'q', color: 'w' });
    expect(after.get('d2')).toBeUndefined();
    expect(after.get('e1')).toMatchObject({ type: 'k', color: 'w' });
  });
});

describe('missed_fork', () => {
  it('tags a missed knight fork that wins a rook', () => {
    expect(tacticTags(fork())).toEqual(['missed_fork']);
  });

  it('does not tag a position with no fork', () => {
    expect(tacticTags(quiet())).toEqual([]);
  });

  it('does not tag when the user played the fork', () => {
    expect(tacticTags(fork({ played: 'd5c7', winLoss: 0 }))).toEqual([]);
  });

  it('does not tag when the loss is below 10 win %', () => {
    expect(tacticTags(fork({ winLoss: 9.9 }))).toEqual([]);
  });

  it('does not tag when the best line wins less than 2 pawns after the fork', () => {
    expect(tacticTags(fork({ bestPv: ['d5c7', 'e8d8'] }))).toEqual([]);
  });
});

describe('missed_pin', () => {
  it('tags a missed pin of the queen against the king', () => {
    expect(tacticTags(pin())).toEqual(['missed_pin']);
  });

  it('does not tag a knight move or a quiet position', () => {
    expect(tacticTags(fork())).not.toContain('missed_pin');
    expect(tacticTags(quiet())).toEqual([]);
  });

  it('does not tag when the user found the pin', () => {
    expect(tacticTags(pin({ played: 'f8b4', winLoss: 0.9 }))).toEqual([]);
  });

  it('does not tag when the loss is below 10 win %', () => {
    expect(tacticTags(pin({ winLoss: 5 }))).toEqual([]);
  });

  it('does not tag a pin that wins nothing', () => {
    expect(tacticTags(pin({ bestPv: ['f8b4', 'd4d5'] }))).toEqual([]);
  });
});

describe('weak_back_rank', () => {
  it('tags a king with no escape square that meets a back-rank check and mates', () => {
    expect(tacticTags(back())).toEqual(['weak_back_rank']);
  });

  it('does not tag when the same king gets no back-rank check (Qe8)', () => {
    expect(tacticTags(back({ played: 'e7e8', winLoss: 1.8, replyPv: ['d2g5', 'f6d5'] }))).toEqual([]);
  });

  it('does not tag when the king has a flight square', () => {
    expect(tacticTags(quiet({ played: 'd2d4', replyPv: ['e5d4', 'f3d4'], best: 'f1b5' }))).toEqual([]);
  });

  it('does not tag without an opponent line', () => {
    expect(tacticTags(back({ replyPv: [] }))).toEqual([]);
  });
});

describe('bad_bishop', () => {
  it('tags a pawn move that gives a lone light-squared bishop a fifth pawn on its colour (move 10)', () => {
    expect(tacticTags(bishop('b7b5'))).toEqual(['bad_bishop']);
  });

  it('does not tag a pawn move onto the other colour', () => {
    expect(tacticTags(bishop('h7h6'))).toEqual([]);
  });

  it('does not tag a piece move', () => {
    expect(tacticTags(bishop('e7f5'))).toEqual([]);
  });

  it('does not tag before move 10', () => {
    expect(tacticTags(bishop('b7b5', 'e4 e6 d4 d5 Nc3 Bb4 e5 c5 a3 Bxc3+ bxc3 Ne7 Nf3'))).toEqual([]);
  });

  it('does not tag when the user still has two bishops', () => {
    const seq = 'e4 e6 d4 d5 Nc3 Nf6 e5 Nfd7 f4 c5 Nf3 Nc6 Be3 a6 Qd2 Be7 O-O-O O-O Kb1';
    expect(tacticTags(bishop('b7b5', seq))).toEqual([]);
  });
});
