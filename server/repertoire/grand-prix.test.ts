import { readFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { loadAllRepertoires, loadRepertoire } from './load.js';
import { findLeak, openingMoves, selectRepertoire } from './leaks.js';
const load = () => loadRepertoire(JSON.parse(readFileSync('content/repertoires/grand-prix.json', 'utf8')));
describe('Grand Prix repertoire', () => {
  it('provides a substantial legal, level-gated White tree', () => {
    const rep = load();
    expect(rep.color).toBe('white');
    expect(rep.byId.size).toBeGreaterThanOrEqual(250);
    expect(rep.byId.size).toBeLessThanOrEqual(350);
    expect([...new Set([...rep.byId.values()].map(n => n.level))].sort()).toEqual([1,2,3]);
    expect(rep.byId.get('e4 c5 Nc3')).toBeDefined();
    for (const n of rep.byId.values()) {
      expect(new Chess(n.fenBefore).move(n.san).after).toBe(n.fenAfter);
      if (n.mover === 'white') {
        expect(n.comment!.length).toBeGreaterThan(15);
        expect(n.comment!.length).toBeLessThanOrEqual(220);
      } else if (n.children.length) expect(n.children).toHaveLength(1);
      for (const child of n.children) expect(child.level).toBeGreaterThanOrEqual(n.level);
    }
  });
  it('covers six second replies and the immediate central counterstrike', () => {
    const rep = load();
    expect(rep.byId.get('e4 c5 Nc3')!.children.map(n => n.san)).toEqual(expect.arrayContaining(['Nc6','d6','e6','g6','a6','Nf6']));
    expect(rep.byId.get('e4 c5 Nc3 Nc6 f4')).toBeDefined();
    expect(rep.byId.get('e4 c5 Nc3 e6 f4 d5')).toBeDefined();
  });
  it('selects the real Sicilian tree instead of Vienna after a shared e4 root', () => {
    const reps = loadAllRepertoires();
    const sicilian = openingMoves('1. e4 c5 2. Nf3 *', 10)!;
    const vienna = openingMoves('1. e4 e5 2. Nf3 *', 10)!;
    expect(selectRepertoire(reps, sicilian, 'white')?.id).toBe('grand-prix');
    expect(selectRepertoire(reps, vienna, 'white')?.id).toBe('vienna');
    expect(findLeak(load(), sicilian, 'white')).toMatchObject({ kind: 'leak', ply: 3, expectedSan: 'Nc3' });
  });
});
