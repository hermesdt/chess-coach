import { describe, expect, it } from 'vitest';
import { heatmapGrid, linearScale, niceTicks, paddedExtent, pinOpenings, stackShares } from './scales';

describe('linearScale', () => {
  it('maps the domain to the range and handles a flat domain', () => {
    const s = linearScale(0, 10, 100, 0);
    expect(s(0)).toBe(100);
    expect(s(5)).toBe(50);
    expect(linearScale(3, 3, 0, 80)(3)).toBe(40);
  });
});

describe('niceTicks', () => {
  it('rounds to clean numbers from zero', () => {
    expect(niceTicks(0, 87)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(niceTicks(0, 0.7)).toEqual([0, 0.2, 0.4, 0.6, 0.8]);
    expect(niceTicks(1000, 1260)).toEqual([1000, 1100, 1200, 1300]);
  });
});

describe('paddedExtent', () => {
  it('pads the range and never returns a flat one', () => {
    expect(paddedExtent([500, 600])).toEqual([480, 620]);
    const [lo, hi] = paddedExtent([700]);
    expect(hi).toBeGreaterThan(lo);
  });
});

describe('stackShares', () => {
  it('returns fractions that sum to one and zeros for no games', () => {
    expect(stackShares(2, 1, 1)).toEqual({ win: 0.5, draw: 0.25, loss: 0.25 });
    expect(stackShares(0, 0, 0)).toEqual({ win: 0, draw: 0, loss: 0 });
  });
});

describe('pinOpenings', () => {
  it('puts the repertoire groups first, then the rest by games', () => {
    const row = (group: string, color: 'white' | 'black', games: number) => ({
      group, color, games, win: 0, draw: 0, loss: 0, avgAccuracy: null,
    });
    const out = pinOpenings([
      row('Sicilian', 'black', 9),
      row('Caro-Kann (your repertoire)', 'black', 2),
      row('Italian', 'white', 5),
      row('London (your repertoire)', 'white', 1),
    ]);
    expect(out.map((r) => r.group)).toEqual([
      'London (your repertoire)',
      'Caro-Kann (your repertoire)',
      'Sicilian',
      'Italian',
    ]);
  });
});

describe('heatmapGrid', () => {
  it('zero-fills months with analysed games but no tag rows', () => {
    const grid = heatmapGrid(
      [{ month: '2026-08', avg: 60, games: 3 }, { month: '2026-09', avg: 62, games: 2 }],
      [{ month: '2026-08', tag: 'hung_piece', perGame: 1.5 }],
    );
    expect(grid.months).toEqual(['2026-08', '2026-09']);
    expect(grid.tags).toEqual(['hung_piece']);
    expect(grid.value('2026-08', 'hung_piece')).toBe(1.5);
    expect(grid.value('2026-09', 'hung_piece')).toBe(0);
    expect(grid.max).toBe(1.5);
  });
  it('is empty without analysed months', () => {
    expect(heatmapGrid([], []).months).toEqual([]);
  });
});
