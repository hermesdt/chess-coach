import { describe, expect, it } from 'vitest';
import type { MoveAnalysis } from '../../shared/types.js';
import { findMateMisses } from './mate-cards.js';

const M1 = '6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1';
const M2W = '7k/8/8/8/8/8/1R6/R3K3 w - - 0 1';
const M2B = 'r3k3/1r6/8/8/8/8/8/7K b - - 0 1';
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function move(over: Partial<MoveAnalysis>): MoveAnalysis {
  return {
    ply: 1, san: 'Ra7', uci: 'a1a7', color: 'white', fenBefore: M1,
    evalBefore: { cp: null, mate: 1 }, evalAfter: { cp: 500, mate: null },
    bestUci: 'a1a8', bestSan: 'Ra8#', pvSan: ['Ra8#'],
    winBefore: 100, winAfter: 90, winLoss: 10, classification: 'good', tags: ['missed_mate'], isUserMove: true,
    ...over,
  };
}

describe('findMateMisses', () => {
  it('ignores a fastest mate that was played', () => {
    const r = findMateMisses([move({ san: 'Ra8#', uci: 'a1a8' })]);
    expect(r).toEqual({ misses: [], skipped: 0 });
  });

  it('finds a missed mate in 1 and keeps the played move', () => {
    const { misses, skipped } = findMateMisses([move({})]);
    expect(skipped).toBe(0);
    expect(misses).toHaveLength(1);
    expect(misses[0]).toMatchObject({ ply: 1, fen: M1, color: 'white', mateIn: 1, accepted: ['a1a8'], best: 'a1a8', playedSan: 'Ra7', line: ['Ra8#'] });
  });

  it('finds a missed mate in 2 as Black', () => {
    const { misses } = findMateMisses([move({
      color: 'black', fenBefore: M2B, evalBefore: { cp: null, mate: 2 }, san: 'Ra7', uci: 'a8a7',
      bestUci: 'a8a2', bestSan: 'Ra2', pvSan: [],
    })]);
    expect(misses).toHaveLength(1);
    expect(misses[0]!.mateIn).toBe(2);
    expect(misses[0]!.accepted).toEqual(expect.arrayContaining(['a8a2', 'b7b2']));
    expect(misses[0]!.color).toBe('black');
  });

  it('ignores a played move that mates faster than the stored mate', () => {
    const r = findMateMisses([move({ evalBefore: { cp: null, mate: 2 }, san: 'Ra8#', uci: 'a1a8' })]);
    expect(r).toEqual({ misses: [], skipped: 1 });
  });

  it('skips a stored mate that chess.js cannot confirm', () => {
    const r = findMateMisses([move({ fenBefore: START, san: 'e4', uci: 'e2e4' })]);
    expect(r).toEqual({ misses: [], skipped: 1 });
  });

  it('ignores other moves, no mate and long mates', () => {
    const rows = [
      move({ isUserMove: false }),
      move({ evalBefore: { cp: 100, mate: null } }),
      move({ evalBefore: { cp: null, mate: -1 } }),
      move({ evalBefore: { cp: null, mate: 3 } }),
    ];
    expect(findMateMisses(rows)).toEqual({ misses: [], skipped: 0 });
  });

  it('keeps the engine line when it replays to mate', () => {
    const { misses } = findMateMisses([move({
      fenBefore: M2W, evalBefore: { cp: null, mate: 2 }, san: 'Kd2', uci: 'e1d2',
      bestUci: 'a1a7', bestSan: 'Ra7', pvSan: ['Ra7', 'Kg8', 'Rb8#'],
    })]);
    expect(misses[0]!.best).toBe('a1a7');
    expect(misses[0]!.line).toEqual(['Ra7', 'Kg8', 'Rb8#']);
  });

  it('drops the line when it starts with another move than the best move', () => {
    const { misses } = findMateMisses([move({
      fenBefore: M2W, evalBefore: { cp: null, mate: 2 }, san: 'Kd2', uci: 'e1d2',
      bestUci: 'b2b7', bestSan: 'Rb7', pvSan: ['Ra7', 'Kg8', 'Rb8#'],
    })]);
    expect(misses[0]!.best).toBe('b2b7');
    expect(misses[0]!.line).toBeNull();
  });

  it('uses the first accepted move when the engine move is not a mate', () => {
    const { misses } = findMateMisses([move({ bestUci: 'a1a7', bestSan: 'Ra7', san: 'Kd2', uci: 'e1d2' })]);
    expect(misses[0]!.best).toBe('a1a8');
  });
});
