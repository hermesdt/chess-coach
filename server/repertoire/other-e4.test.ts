import { readFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { loadAllRepertoires, loadRepertoire } from './load.js';
import { openingMoves, selectRepertoire } from './leaks.js';

const load = () => loadRepertoire(JSON.parse(readFileSync('content/repertoires/other-e4.json', 'utf8')));
describe('Other White 1.e4 replies', () => {
  it('has a substantial legal tree with sixteen first replies and level gates', () => {
    const r = load();
    expect(r.color).toBe('white');
    expect(r.byId.size).toBeGreaterThanOrEqual(250);
    expect(r.byId.size).toBeLessThanOrEqual(350);
    expect(r.byId.get('e4')!.children).toHaveLength(16);
    expect([...new Set([...r.byId.values()].map(n => n.level))].sort()).toEqual([1, 2, 3]);
    for (const n of r.byId.values()) {
      expect(new Chess(n.fenBefore).move(n.san).after).toBe(n.fenAfter);
      if (n.mover === 'white') {
        expect(n.comment!.length).toBeGreaterThan(15);
        expect(n.comment!.length).toBeLessThanOrEqual(220);
      } else if (n.children.length) expect(n.children).toHaveLength(1);
      for (const child of n.children) expect(child.level).toBeGreaterThanOrEqual(n.level);
    }
    for (const root of r.byId.get('e4')!.children) {
      expect(root.level).toBe(1);
      expect(root.children[0].level).toBe(1);
    }
  });

  it('completes unique coverage of every legal first reply without taking Black games', () => {
    load();
    const reps = loadAllRepertoires();
    const c = new Chess(); c.move('e4');
    const covered = reps.filter(r => r.color === 'white').flatMap(r => r.byId.get('e4')?.children.map(n => n.san) ?? []);
    expect(covered.sort()).toEqual(c.moves().sort());
    for (const reply of c.moves()) {
      const expected = reply === 'e5' ? 'vienna' : reply === 'c5' ? 'grand-prix' : ['c6', 'e6'].includes(reply) ? 'advance' : 'other-e4';
      expect(selectRepertoire(reps, openingMoves(`1. e4 ${reply} *`, 10)!, 'white')?.id).toBe(expected);
    }
    expect(selectRepertoire(reps, openingMoves('1. e4 c6 2. d4 d5 *', 10)!, 'black')?.id).toBe('caro-kann');
    expect(selectRepertoire(reps, openingMoves('1. d4 d5 2. Bf4 *', 10)!, 'white')?.id).toBe('london');
  });
});
