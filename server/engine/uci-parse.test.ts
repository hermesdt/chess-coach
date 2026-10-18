import { describe, expect, it } from 'vitest';
import { parseBestMove, parseInfoLine } from './uci-parse.js';

describe('parseInfoLine', () => {
  it('parses a centipawn score', () => {
    expect(
      parseInfoLine('info depth 20 seldepth 28 multipv 1 score cp 34 nodes 1 nps 1 pv e2e4 e7e5'),
    ).toEqual({ multipv: 1, depth: 20, score: { cp: 34, mate: null }, pv: ['e2e4', 'e7e5'] });
  });
  it('parses a mate score', () => {
    expect(parseInfoLine('info depth 5 multipv 2 score mate -3 pv a1a2 b8b7')).toEqual({
      multipv: 2, depth: 5, score: { cp: null, mate: -3 }, pv: ['a1a2', 'b8b7'],
    });
  });
  it('defaults multipv to 1', () => {
    expect(parseInfoLine('info depth 1 score cp -5 pv e2e4')?.multipv).toBe(1);
  });
  it('returns null for lines without score or pv', () => {
    expect(parseInfoLine('info string NNUE evaluation using nn.nnue')).toBeNull();
    expect(parseInfoLine('info depth 3 score cp 10')).toBeNull();
    expect(parseInfoLine('info depth 3 pv e2e4')).toBeNull();
  });
  it('ignores bound lines', () => {
    expect(parseInfoLine('info depth 9 multipv 1 score cp 10 lowerbound pv e2e4')).toBeNull();
    expect(parseInfoLine('info depth 9 multipv 1 score cp 10 upperbound pv e2e4')).toBeNull();
  });
});

describe('parseBestMove', () => {
  it('parses a move with ponder', () => {
    expect(parseBestMove('bestmove e7e8q ponder a1a2')).toBe('e7e8q');
  });
  it('returns null for none', () => {
    expect(parseBestMove('bestmove (none)')).toBeNull();
  });
  it('returns null for other lines', () => {
    expect(parseBestMove('info depth 1')).toBeNull();
  });
});
