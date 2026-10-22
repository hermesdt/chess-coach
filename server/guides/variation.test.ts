import { describe, expect, it } from 'vitest';
import type { GuideFile, GuideVariation } from './types.js';
import { variationOf } from './variation.js';

const variation = (key: string, roots: string[]): GuideVariation => ({
  key, name: key, roots, finalForm: { nodeId: roots[0]!, jobs: [] }, route: [], deviations: [], middlegame: '', mistakes: [],
});
const guide: GuideFile = {
  repertoireId: 'caro-kann',
  why: '',
  variations: [
    variation('advance', ['e4 c6 d4 d5 e5']),
    variation('advance-g4', ['e4 c6 d4 d5 e5 Bf5 g4']),
    variation('exchange', ['e4 c6 d4 d5 exd5', 'e4 c6 Nc3']),
  ],
};

describe('variationOf', () => {
  it('returns the variation whose root is the longest prefix of the node path', () => {
    expect(variationOf(guide, 'e4 c6 d4 d5 e5 Bf5 Nf3')?.key).toBe('advance');
    expect(variationOf(guide, 'e4 c6 d4 d5 e5 Bf5 g4 Bg6')?.key).toBe('advance-g4');
  });

  it('matches a node that is a root itself, and any of several roots', () => {
    expect(variationOf(guide, 'e4 c6 d4 d5 e5')?.key).toBe('advance');
    expect(variationOf(guide, 'e4 c6 Nc3 d5')?.key).toBe('exchange');
  });

  it('returns null outside every root', () => {
    expect(variationOf(guide, 'e4 c6')).toBeNull();
    expect(variationOf(guide, 'd4 d5')).toBeNull();
  });

  it('does not match a root that only shares the leading characters of a move', () => {
    expect(variationOf(guide, 'e4 c6 d4 d5 e5x')).toBeNull();
  });
});
