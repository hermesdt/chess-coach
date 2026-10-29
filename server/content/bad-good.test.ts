import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { checkBadGood, MAX_GOOD } from './bad-good.js';

function after(moves: string[]): Chess {
  const g = new Chess();
  for (const m of moves) g.move(m);
  return g;
}

function run(moves: string[], m: { bad?: string; good?: string[] }) {
  const reported: string[] = [];
  const good = checkBadGood(after(moves), { moves, ...m }, (rule) => reported.push(rule), 'test line');
  return { reported, good };
}

describe('checkBadGood', () => {
  it('does nothing when there is neither a bad nor a good move', () => {
    expect(run(['e4', 'e5'], {})).toEqual({ reported: [], good: [] });
  });

  it('returns the legal good moves with UCI and the position after', () => {
    const { reported, good } = run(['e4', 'e5'], { bad: 'Qh5', good: ['Nf3', 'Nc3'] });
    expect(reported).toEqual([]);
    expect(good.map((g) => [g.san, g.uci])).toEqual([['Nf3', 'g1f3'], ['Nc3', 'b1c3']]);
    expect(good[0]!.fenAfter).toContain(' b ');
  });

  it('bad-good-pair: a bad move without a good move', () => {
    expect(run(['e4', 'e5'], { bad: 'Qh5' }).reported).toContain('bad-good-pair');
  });

  it('good-count: more than MAX_GOOD good moves', () => {
    expect(MAX_GOOD).toBe(3);
    expect(run(['e4', 'e5'], { bad: 'Qh5', good: ['Nf3', 'Nc3', 'Bc4', 'd4'] }).reported).toContain('good-count');
  });

  it('illegal-bad: the bad move is not legal', () => {
    expect(run(['e4', 'e5'], { bad: 'Qh8', good: ['Nf3'] }).reported).toContain('illegal-bad');
  });

  it('illegal-good: a good move is not legal and is not returned', () => {
    const { reported, good } = run(['e4', 'e5'], { bad: 'Qh5', good: ['Nf3', 'Ke3'] });
    expect(reported).toContain('illegal-good');
    expect(good.map((g) => g.san)).toEqual(['Nf3']);
  });

  it('duplicate-good: the same good move twice', () => {
    expect(run(['e4', 'e5'], { bad: 'Qh5', good: ['Nf3', 'Nf3'] }).reported).toContain('duplicate-good');
  });

  it('bad-in-good: one move is both bad and good', () => {
    expect(run(['e4', 'e5'], { bad: 'Nf3', good: ['Nf3'] }).reported).toContain('bad-in-good');
  });
});
