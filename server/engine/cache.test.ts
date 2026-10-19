import { describe, expect, it } from 'vitest';
import { EngineCache } from './cache.js';
import type { EngineLine } from './uci.js';

const lines = (cp: number): EngineLine[] => [{ multipv: 1, score: { cp, mate: null }, pv: ['e2e4'] }];
const A = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('EngineCache', () => {
  it('keys on the first four FEN fields and the multipv', () => {
    const cache = new EngineCache();
    cache.set(A, 3, lines(10), 500);
    expect(cache.get('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 7 9', 3, 500)).toEqual(lines(10));
    expect(cache.get(A, 1, 500)).toBeNull();
    expect(cache.get(A.replace(' w ', ' b '), 3, 500)).toBeNull();
  });

  it('returns an entry only when it searched at least the wanted nodes', () => {
    const cache = new EngineCache();
    cache.set(A, 3, lines(10), 500);
    expect(cache.get(A, 3, 501)).toBeNull();
    expect(cache.get(A, 3, 500)).toEqual(lines(10));
  });

  it('keeps the deeper entry when a shallower one is stored', () => {
    const cache = new EngineCache();
    cache.set(A, 3, lines(10), 900);
    cache.set(A, 3, lines(20), 400);
    expect(cache.get(A, 3, 900)).toEqual(lines(10));
    cache.set(A, 3, lines(30), 1000);
    expect(cache.get(A, 3, 1000)).toEqual(lines(30));
  });

  it('evicts the least recently used entry beyond the limit', () => {
    const cache = new EngineCache(2);
    cache.set('a 1 - -', 3, lines(1), 1);
    cache.set('b 1 - -', 3, lines(2), 1);
    cache.get('a 1 - -', 3, 1);
    cache.set('c 1 - -', 3, lines(3), 1);
    expect(cache.get('b 1 - -', 3, 1)).toBeNull();
    expect(cache.get('a 1 - -', 3, 1)).not.toBeNull();
    expect(cache.get('c 1 - -', 3, 1)).not.toBeNull();
  });
});
