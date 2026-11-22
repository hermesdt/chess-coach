import { describe, expect, it } from 'vitest';
import { playoutRating, playoutVerdict } from './playout';

describe('playoutRating', () => {
  it('is good with no rewind and at most 10 points lost', () => {
    expect(playoutRating({ rewinds: 0, startWin: 50, endWin: 40 })).toBe('good');
    expect(playoutRating({ rewinds: 0, startWin: 50, endWin: 80 })).toBe('good');
  });
  it('is hard with no rewind but more than 10 points lost', () => {
    expect(playoutRating({ rewinds: 0, startWin: 50, endWin: 39.9 })).toBe('hard');
  });
  it('is hard with one rewind', () => {
    expect(playoutRating({ rewinds: 1, startWin: 50, endWin: 90 })).toBe('hard');
  });
  it('is again with two or more rewinds', () => {
    expect(playoutRating({ rewinds: 2, startWin: 50, endWin: 90 })).toBe('again');
    expect(playoutRating({ rewinds: 5, startWin: 50, endWin: 50 })).toBe('again');
  });
});

describe('playoutVerdict', () => {
  it('uses a 10-point band', () => {
    expect(playoutVerdict(50, 60)).toBe('About the same');
    expect(playoutVerdict(50, 60.1)).toBe('Better');
    expect(playoutVerdict(50, 40)).toBe('About the same');
    expect(playoutVerdict(50, 39.9)).toBe('Worse');
  });
});
