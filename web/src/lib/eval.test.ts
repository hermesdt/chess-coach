import { describe, expect, it } from 'vitest';
import type { MoveAnalysis } from '../../../shared/types';
import { glyph, momentLine, momentText, reasonText, whiteWinSeries } from './eval';

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

describe('momentText', () => {
  const tagged = (classification: MoveAnalysis['classification'], tags: MoveAnalysis['tags']) =>
    ({ classification, tags }) as MoveAnalysis;

  it('uses the classification as the title and every tag as a reason', () => {
    expect(momentText(tagged('blunder', ['hung_piece', 'allowed_mate']))).toEqual({
      title: 'Blunder',
      reasons: ['This allowed a checkmate', 'You left a piece undefended'],
    });
    expect(momentText(tagged('blunder', ['allowed_mate', 'hung_piece']))).toEqual({
      title: 'Blunder',
      reasons: ['This allowed a checkmate', 'You left a piece undefended'],
    });
    expect(momentLine(tagged('blunder', ['hung_piece']))).toBe('Blunder \u2014 You left a piece undefended');
  });

  it('shows the classification text only when there is no tag', () => {
    expect(momentText(tagged('mistake', []))).toEqual({ title: 'Mistake', reasons: [] });
    expect(momentLine(tagged('inaccuracy', []))).toBe('Inaccuracy');
  });

  it('promotes the first tag when the classification has no label', () => {
    expect(momentText(tagged('good', ['missed_capture', 'missed_mate']))).toEqual({
      title: 'You missed a checkmate',
      reasons: ['You missed free material'],
    });
    expect(momentText(tagged('good', []))).toEqual({ title: 'Good', reasons: [] });
  });
});
