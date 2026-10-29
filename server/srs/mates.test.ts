import { describe, expect, it } from 'vitest';
import { findMates } from './mates.js';

describe('findMates', () => {
  it('mate in 1', () => {
    expect(findMates('6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1')).toEqual({ mateIn: 1, moves: ['a1a8'] });
  });

  it('mate in 2', () => {
    const r = findMates('7k/8/8/8/8/8/1R6/R3K3 w - - 0 1');
    expect(r?.mateIn).toBe(2);
    expect(r?.moves).toContain('a1a7');
    expect(r?.moves).toContain('b2b7');
  });

  it('no mate in the start position', () => {
    expect(findMates('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toBeNull();
  });

  it('prefers the shortest mate and never lists a stalemate', () => {
    const r = findMates('7k/5Q2/6K1/8/8/8/8/8 w - - 0 1');
    expect(r?.mateIn).toBe(1);
    expect(r?.moves).toContain('f7g7');
    expect(r?.moves).toContain('f7f8');
    expect(r?.moves).not.toContain('g6f6');
  });

  it('black to move', () => {
    expect(findMates('r3k3/8/8/8/8/8/5PPP/6K1 b - - 0 1')).toEqual({ mateIn: 1, moves: ['a8a1'] });
  });

  it('keeps the promotion letter', () => {
    const r = findMates('7k/5P1P/6K1/8/8/8/8/8 w - - 0 1');
    expect(r?.mateIn).toBe(1);
    expect(r?.moves.some((m) => m.length === 5)).toBe(true);
  });
});
