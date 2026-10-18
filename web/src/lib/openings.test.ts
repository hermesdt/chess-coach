import { describe, expect, it } from 'vitest';
import { formatLeak, tabRank } from './openings';

describe('formatLeak', () => {
  it('uses the singular and a black move number', () => {
    expect(formatLeak({ nodeId: 'e4 c6 d4 d5 e5 Bf5', expectedSan: 'Bf5', playedSan: 'Bg4', count: 1 }))
      .toBe('In 1 game you played 3…Bg4 instead of 3…Bf5');
  });

  it('uses the plural and a white move number', () => {
    expect(formatLeak({ nodeId: 'd4 d5 Bf4 Nf6 e3', expectedSan: 'e3', playedSan: 'Nc3', count: 3 }))
      .toBe('In 3 games you played 3.Nc3 instead of 3.e3');
  });

  it('counts the move number from the path length', () => {
    expect(formatLeak({ nodeId: 'a b c d e f g h', expectedSan: 'h', playedSan: 'x', count: 2 }))
      .toBe('In 2 games you played 4…x instead of 4…h');
  });
});

describe('tabRank', () => {
  it('puts unknown ids last', () => {
    const ids = ['mystery', 'slav', 'london', 'caro-kann'];
    expect([...ids].sort((a, b) => tabRank(a) - tabRank(b))).toEqual(['london', 'caro-kann', 'slav', 'mystery']);
  });
});
