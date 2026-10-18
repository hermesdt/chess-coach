import { describe, expect, it } from 'vitest';
import type { GameDetail } from '../../../shared/types';
import { fenAt, navigate } from './navigator';

describe('navigate', () => {
  const s = { ply: 3, maxPly: 5 };
  it('moves first, prev, next, last', () => {
    expect(navigate(s, 'first').ply).toBe(0);
    expect(navigate(s, 'prev').ply).toBe(2);
    expect(navigate(s, 'next').ply).toBe(4);
    expect(navigate(s, 'last').ply).toBe(5);
  });
  it('clamps at both ends', () => {
    expect(navigate({ ply: 0, maxPly: 5 }, 'prev').ply).toBe(0);
    expect(navigate({ ply: 5, maxPly: 5 }, 'next').ply).toBe(5);
  });
  it('goto clamps and keeps maxPly', () => {
    expect(navigate(s, { goto: 2 })).toEqual({ ply: 2, maxPly: 5 });
    expect(navigate(s, { goto: 99 }).ply).toBe(5);
    expect(navigate(s, { goto: -4 }).ply).toBe(0);
  });
});

describe('fenAt', () => {
  const game = {
    startFen: 'start',
    moves: [
      { ply: 1, fenAfter: 'f1' },
      { ply: 2, fenAfter: 'f2' },
    ],
  } as unknown as GameDetail;
  it('returns startFen for ply 0 and fenAfter otherwise', () => {
    expect(fenAt(game, 0)).toBe('start');
    expect(fenAt(game, 2)).toBe('f2');
  });
});
