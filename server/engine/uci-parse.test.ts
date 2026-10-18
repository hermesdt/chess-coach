import { describe, expect, it } from 'vitest';
import { parseBestMove, parseInfoLine, selectLines, type ParsedInfo } from './uci-parse.js';

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

describe('selectLines', () => {
  const info = (depth: number, multipv: number, pv: string): ParsedInfo => ({
    depth, multipv, score: { cp: 10 * multipv, mate: null }, pv: pv.split(' '),
  });

  it('uses the deepest complete depth when a deeper depth is partial', () => {
    const infos = [
      info(16, 1, 'd2d4 d7d5'), info(16, 2, 'e2e4 e7e5'), info(16, 3, 'g1f3 d7d5'),
      info(17, 1, 'e2e4 e7e5'), // multipv 2 was an upperbound (skipped), no multipv 3
    ];
    const lines = selectLines(infos, 3);
    expect(lines.map((l) => l.pv[0])).toEqual(['d2d4', 'e2e4', 'g1f3']);
    expect(lines.map((l) => l.multipv)).toEqual([1, 2, 3]);
  });

  it('returns fewer lines when the position has fewer legal moves', () => {
    const infos = [info(10, 1, 'a1a2'), info(10, 2, 'a1b1'), info(11, 1, 'a1a2'), info(11, 2, 'a1b1')];
    expect(selectLines(infos, 3)).toHaveLength(2);
  });

  it('falls back to the deepest line per index and drops repeated first moves', () => {
    const infos = [info(5, 1, 'e2e4'), info(5, 2, 'd2d4'), info(6, 1, 'd2d4'), info(6, 3, 'g1f3')];
    const lines = selectLines(infos, 3);
    expect(lines.map((l) => l.pv[0])).toEqual(['d2d4', 'g1f3']);
    expect(lines.map((l) => l.multipv)).toEqual([1, 3]);
  });

  it('returns the last uniform batch when a later batch mixes depths', () => {
    const infos = [
      info(16, 1, 'c8f5'), info(16, 2, 'e7e6'), info(16, 3, 'a7a6'),
      info(17, 1, 'e7e6'), info(16, 2, 'c8f5'), info(16, 3, 'a7a6'),
    ];
    const lines = selectLines(infos, 3);
    expect(lines.map((l) => l.pv[0])).toEqual(['c8f5', 'e7e6', 'a7a6']);
  });

  it('returns the last complete batch when no batch has a single depth', () => {
    const infos = [
      info(16, 1, 'c8f5'), info(16, 2, 'e7e6'), info(15, 3, 'a7a6'),
      info(17, 1, 'e7e6'), info(16, 2, 'c8f5'), info(16, 3, 'a7a6'),
    ];
    expect(selectLines(infos, 3).map((l) => l.pv[0])).toEqual(['e7e6', 'c8f5', 'a7a6']);
  });

  it('skips a batch with a dropped bound line', () => {
    const infos = [
      info(16, 1, 'c8f5'), info(16, 2, 'e7e6'), info(16, 3, 'a7a6'),
      info(17, 1, 'e7e6'), info(17, 3, 'a7a6'), // multipv 2 was a bound
    ];
    expect(selectLines(infos, 3).map((l) => l.pv[0])).toEqual(['c8f5', 'e7e6', 'a7a6']);
  });

  it('dedupes by first move as a safety net', () => {
    const infos = [info(16, 1, 'c8f5'), info(16, 2, 'c8f5 e7e6'), info(16, 3, 'a7a6')];
    const lines = selectLines(infos, 3);
    expect(lines.map((l) => l.pv[0])).toEqual(['c8f5', 'a7a6']);
  });

  it('returns an empty array without infos', () => {
    expect(selectLines([], 2)).toEqual([]);
  });
});
