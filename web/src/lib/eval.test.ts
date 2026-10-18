import { describe, expect, it } from 'vitest';
import type { MoveAnalysis } from '../../../shared/types';
import { glyph, whiteWinSeries } from './eval';

const move = (ply: number, winBefore: number, winAfter: number): MoveAnalysis =>
  ({ ply, color: ply % 2 === 1 ? 'white' : 'black', winBefore, winAfter }) as MoveAnalysis;

describe('whiteWinSeries', () => {
  it('returns an empty series for no moves', () => {
    expect(whiteWinSeries([])).toEqual([]);
  });

  it('starts with the white view of the first move and flips black moves', () => {
    const series = whiteWinSeries([move(1, 52, 55), move(2, 45, 30), move(3, 70, 65)]);
    expect(series).toEqual([52, 55, 70, 65]);
  });
});

describe('glyph', () => {
  it('maps classifications to glyphs', () => {
    expect(glyph('blunder')).toBe('??');
    expect(glyph('mistake')).toBe('?');
    expect(glyph('inaccuracy')).toBe('?!');
    expect(glyph('good')).toBe('');
    expect(glyph('best')).toBe('');
  });
});
