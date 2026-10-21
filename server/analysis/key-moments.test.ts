import { describe, expect, it } from 'vitest';
import type { Classification, MoveAnalysis, Tag } from '../../shared/types.js';
import { selectKeyMoments } from './key-moments.js';

function mv(ply: number, over: Partial<MoveAnalysis>): MoveAnalysis {
  return {
    ply, san: 'x', uci: 'a1a2', color: 'white', fenBefore: '', evalBefore: { cp: 0, mate: null }, evalAfter: { cp: 0, mate: null },
    bestUci: 'a1a2', bestSan: 'x', pvSan: [], winBefore: 50, winAfter: 50, winLoss: 0, classification: 'good', tags: [], isUserMove: true,
    ...over,
  };
}
const bad = (ply: number, winLoss: number, classification: Classification, tags: Tag[] = [], isUserMove = true): MoveAnalysis =>
  mv(ply, { winLoss, classification, tags, isUserMove });

describe('selectKeyMoments', () => {
  it('selects user blunders and mistakes sorted by win loss', () => {
    const out = selectKeyMoments([bad(1, 22, 'mistake'), bad(3, 45, 'blunder'), bad(5, 12, 'inaccuracy'), bad(7, 0, 'good')]);
    expect(out).toEqual([
      { ply: 3, reason: 'blunder', winLoss: 45 },
      { ply: 1, reason: 'mistake', winLoss: 22 },
    ]);
  });

  it('ignores opponent moves', () => {
    expect(selectKeyMoments([bad(2, 50, 'blunder', [], false)])).toEqual([]);
  });

  it('includes missed_capture and missed_mate user moves', () => {
    const out = selectKeyMoments([bad(1, 10, 'good', ['missed_capture']), bad(3, 14, 'good', ['missed_mate'])]);
    expect(out).toEqual([
      { ply: 3, reason: 'missed_mate', winLoss: 14 },
      { ply: 1, reason: 'missed_capture', winLoss: 10 },
    ]);
  });

  it('ignores missed_capture and missed_mate when less than 10% was lost', () => {
    expect(selectKeyMoments([bad(1, 9.9, 'good', ['missed_capture']), bad(3, 3, 'good', ['missed_mate'])])).toEqual([]);
  });

  it('dedupes by ply and keeps the most severe reason', () => {
    const out = selectKeyMoments([bad(1, 35, 'blunder', ['missed_capture']), bad(3, 12, 'good', ['missed_capture', 'missed_mate'])]);
    expect(out).toEqual([
      { ply: 1, reason: 'blunder', winLoss: 35 },
      { ply: 3, reason: 'missed_mate', winLoss: 12 },
    ]);
  });

  it('adds inaccuracies with winLoss >= 15 only at level 2 and above', () => {
    const moves = [bad(1, 16, 'inaccuracy'), bad(3, 14, 'inaccuracy')];
    expect(selectKeyMoments(moves, 1)).toEqual([]);
    expect(selectKeyMoments(moves)).toEqual([]);
    expect(selectKeyMoments(moves, 2)).toEqual([{ ply: 1, reason: 'inaccuracy', winLoss: 16 }]);
    expect(selectKeyMoments(moves, 3)).toEqual([{ ply: 1, reason: 'inaccuracy', winLoss: 16 }]);
  });

  it('caps at 6 keeping the largest losses', () => {
    const moves = Array.from({ length: 9 }, (_, i) => bad(i * 2 + 1, 30 + i, 'blunder'));
    const out = selectKeyMoments(moves);
    expect(out).toHaveLength(6);
    expect(out.map((m) => m.winLoss)).toEqual([38, 37, 36, 35, 34, 33]);
  });

  it('shows missed_fork, missed_pin and weak_back_rank only from level 2', () => {
    const moves = [bad(1, 14, 'good', ['missed_fork']), bad(3, 12, 'good', ['missed_pin']), bad(5, 20, 'good', ['weak_back_rank'])];
    expect(selectKeyMoments(moves, 1)).toEqual([]);
    expect(selectKeyMoments(moves)).toEqual([]);
    const expected = [
      { ply: 5, reason: 'weak_back_rank', winLoss: 20 },
      { ply: 1, reason: 'missed_fork', winLoss: 14 },
      { ply: 3, reason: 'missed_pin', winLoss: 12 },
    ];
    expect(selectKeyMoments(moves, 2)).toEqual(expected);
    expect(selectKeyMoments(moves, 3)).toEqual(expected);
  });

  it('keeps the classification reason of a blunder with a level-2 tag at level 1', () => {
    const moves = [bad(1, 40, 'blunder', ['missed_fork'])];
    expect(selectKeyMoments(moves, 1)).toEqual([{ ply: 1, reason: 'blunder', winLoss: 40 }]);
  });

  it('ignores missed_fork when less than 10% was lost, and never uses bad_bishop as a reason', () => {
    expect(selectKeyMoments([bad(1, 9.9, 'good', ['missed_fork']), bad(3, 30, 'good', ['bad_bishop'])], 3)).toEqual([]);
  });
});
