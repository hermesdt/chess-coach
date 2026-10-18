import { describe, expect, it } from 'vitest';
import { classify, flip, meanAccuracy, moveAccuracy, moverWinAfter, winPct } from './winpct';

describe('winPct', () => {
  it('is 50 for an equal position', () => {
    expect(winPct({ cp: 0, mate: null })).toBe(50);
  });

  it('is about 59.1 for +100 cp', () => {
    expect(winPct({ cp: 100, mate: null })).toBeCloseTo(59.1, 1);
  });

  it('clamps cp to +-1000', () => {
    expect(winPct({ cp: 5000, mate: null })).toBe(winPct({ cp: 1000, mate: null }));
    expect(winPct({ cp: -5000, mate: null })).toBe(winPct({ cp: -1000, mate: null }));
  });

  it('is 100 when the side to move mates', () => {
    expect(winPct({ cp: null, mate: 3 })).toBe(100);
  });

  it('is 0 when the side to move is mated', () => {
    expect(winPct({ cp: null, mate: -1 })).toBe(0);
  });

  it('is 0 when the side to move is checkmated', () => {
    expect(winPct({ cp: null, mate: 0 })).toBe(0);
  });
});

describe('moverWinAfter', () => {
  it('is 100 when the opponent is checkmated', () => {
    expect(moverWinAfter({ cp: null, mate: 0 })).toBe(100);
  });
});

describe('flip', () => {
  it('negates cp', () => {
    expect(flip({ cp: 120, mate: null })).toEqual({ cp: -120, mate: null });
  });

  it('negates mate', () => {
    expect(flip({ cp: null, mate: 2 })).toEqual({ cp: null, mate: -2 });
  });

  it('keeps mate 0 as mate 0', () => {
    expect(flip({ cp: null, mate: 0 })).toEqual({ cp: null, mate: 0 });
  });
});

describe('classify', () => {
  it('returns blunder for a loss of 35', () => {
    expect(classify(60, 25, false)).toBe('blunder');
  });

  it('returns mistake for a loss of 21', () => {
    expect(classify(60, 39, false)).toBe('mistake');
  });

  it('returns inaccuracy for a loss of 11', () => {
    expect(classify(60, 49, false)).toBe('inaccuracy');
  });

  it('returns good for a loss of 5', () => {
    expect(classify(60, 55, false)).toBe('good');
  });

  it('returns best for the engine move', () => {
    expect(classify(60, 20, true)).toBe('best');
  });

  it('returns good when the position is already lost', () => {
    expect(classify(3, 0, false)).toBe('good');
  });

  it('returns good when the mover is still winning', () => {
    expect(classify(100, 96, false)).toBe('good');
  });
});

describe('moveAccuracy', () => {
  it('is about 100 for no loss', () => {
    expect(moveAccuracy(0)).toBeCloseTo(100, 3);
  });

  it('is 0 for a loss of 100', () => {
    expect(moveAccuracy(100)).toBe(0);
  });
});

describe('meanAccuracy', () => {
  it('is null for an empty list', () => {
    expect(meanAccuracy([])).toBeNull();
  });

  it('is the arithmetic mean', () => {
    expect(meanAccuracy([100, 50])).toBe(75);
  });
});
