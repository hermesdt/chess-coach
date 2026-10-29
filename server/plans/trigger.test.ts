import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import type { Trigger } from '../../shared/plans.js';
import { matchTrigger, triggerLabels } from './trigger.js';

const START = new Chess().fen();
function after(moves: string): string {
  const g = new Chess();
  for (const m of moves.split(' ')) g.move(m);
  return g.fen();
}
const all = (...c: Trigger['all']): Trigger => ({ all: c });

describe('matchTrigger', () => {
  it('piece: own knight on f3 matches, on c3 does not', () => {
    const fen = after('Nf3');
    expect(matchTrigger(fen, 'white', all({ type: 'piece', side: 'own', piece: 'N', on: ['f3'] }))).toBe(true);
    expect(matchTrigger(fen, 'white', all({ type: 'piece', side: 'own', piece: 'N', on: ['c3', 'e4'] }))).toBe(false);
  });

  it('piece: opp king on g8 or h8', () => {
    const t = all({ type: 'piece', side: 'opp', piece: 'K', on: ['g8', 'h8'] });
    expect(matchTrigger(START, 'white', t)).toBe(false);
    expect(matchTrigger('6k1/8/8/8/8/8/8/4K3 w - - 0 1', 'white', t)).toBe(true);
  });

  it('pawns: needs a pawn on every listed square', () => {
    const fen = after('d4 d5 e3 Nf6 c3');
    expect(matchTrigger(fen, 'white', all({ type: 'pawns', side: 'own', on: ['c3', 'd4', 'e3'] }))).toBe(true);
    expect(matchTrigger(fen, 'white', all({ type: 'pawns', side: 'own', on: ['c3', 'd4', 'e4'] }))).toBe(false);
  });

  it('noPawn: no own pawn on the h-file', () => {
    const t = all({ type: 'noPawn', side: 'own', file: 'h' });
    expect(matchTrigger('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPP1/RNBQKBNR w KQkq - 0 1', 'white', t)).toBe(true);
    expect(matchTrigger(START, 'white', t)).toBe(false);
  });

  it('castled: short and long, own and opp', () => {
    const shortFen = after('e4 e5 Nf3 Nc6 Bc4 Bc5 O-O');
    expect(matchTrigger(shortFen, 'white', all({ type: 'castled', side: 'own', wing: 'short' }))).toBe(true);
    expect(matchTrigger(shortFen, 'white', all({ type: 'castled', side: 'own', wing: 'long' }))).toBe(false);
    expect(matchTrigger(START, 'white', all({ type: 'castled', side: 'own', wing: 'short' }))).toBe(false);
    const longFen = 'r3k2r/8/8/8/8/8/8/2KR3R w kq - 0 1';
    expect(matchTrigger(longFen, 'white', all({ type: 'castled', side: 'own', wing: 'long' }))).toBe(true);
    expect(matchTrigger(longFen, 'white', all({ type: 'castled', side: 'opp', wing: 'long' }))).toBe(false);
  });

  it('queensOn: both queens', () => {
    expect(matchTrigger(START, 'white', all({ type: 'queensOn' }))).toBe(true);
    expect(matchTrigger('rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'white', all({ type: 'queensOn' }))).toBe(false);
  });

  it('minPieces: each side has at least N rooks and minor pieces', () => {
    expect(matchTrigger(START, 'white', all({ type: 'minPieces', count: 6 }))).toBe(true);
    expect(matchTrigger(START, 'white', all({ type: 'minPieces', count: 7 }))).toBe(false);
    expect(matchTrigger('4k3/8/8/8/8/8/8/R3K3 w - - 0 1', 'white', all({ type: 'minPieces', count: 2 }))).toBe(false);
  });

  it('side: black owner swaps own and opp', () => {
    const fen = after('e4 e5 Nf3 Nc6');
    const t = all({ type: 'piece', side: 'own', piece: 'N', on: ['c6'] });
    expect(matchTrigger(fen, 'black', t)).toBe(true);
    expect(matchTrigger(fen, 'white', t)).toBe(false);
  });

  it('none: a matching `none` condition blocks the plan', () => {
    const t: Trigger = { all: [{ type: 'queensOn' }], none: [{ type: 'piece', side: 'opp', piece: 'N', on: ['f6'] }] };
    expect(matchTrigger(START, 'white', t)).toBe(true);
    expect(matchTrigger(after('d4 Nf6'), 'white', t)).toBe(false);
  });
});

describe('triggerLabels', () => {
  it('writes one label per condition', () => {
    expect(triggerLabels({
      all: [
        { type: 'piece', side: 'opp', piece: 'K', on: ['g8', 'h8'] },
        { type: 'pawns', side: 'own', on: ['c3', 'd4', 'e3'] },
        { type: 'noPawn', side: 'own', file: 'h' },
        { type: 'castled', side: 'opp', wing: 'short' },
        { type: 'queensOn' },
        { type: 'minPieces', count: 3 },
      ],
    })).toEqual([
      'Their king is on g8 or h8.',
      'You have pawns on c3, d4 and e3.',
      'You have no h-pawn.',
      'They castled short.',
      'Both queens are on the board.',
      'Each side has at least 3 rooks or minor pieces.',
    ]);
  });

  it('labels a single square, three squares and the none list', () => {
    expect(triggerLabels({
      all: [
        { type: 'piece', side: 'own', piece: 'B', on: ['d3'] },
        { type: 'piece', side: 'opp', piece: 'K', on: ['a8', 'b8', 'c8'] },
      ],
      none: [{ type: 'piece', side: 'opp', piece: 'N', on: ['f6'] }],
    })).toEqual([
      'Your bishop is on d3.',
      'Their king is on a8, b8 or c8.',
      'Not: Their knight is on f6.',
    ]);
  });
});
