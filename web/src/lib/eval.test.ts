import { describe, expect, it } from 'vitest';
import type { MoveAnalysis } from '../../../shared/types';
import { glyph, reasonText, whiteWinSeries } from './eval';

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

describe('whiteWinSeries from a Black-to-move start', () => {
  it('flips the start value when the first mover is Black', () => {
    const black = (ply: number, winBefore: number, winAfter: number) =>
      ({ ply, color: ply % 2 === 1 ? 'black' : 'white', winBefore, winAfter }) as MoveAnalysis;
    expect(whiteWinSeries([black(1, 40, 45), black(2, 55, 60)])).toEqual([60, 55, 60]);
  });
});

describe('reasonText', () => {
  it('explains tags and classifications in plain words', () => {
    expect(reasonText('hung_piece')).toBe('You left a piece undefended');
    expect(reasonText('blunder')).toBe('Blunder');
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
