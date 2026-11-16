import { readFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { loadRepertoire } from './load.js';
import { findLeak, openingMoves } from './leaks.js';

const load = () => loadRepertoire(JSON.parse(readFileSync('content/repertoires/vienna.json', 'utf8')));

describe('Vienna content', () => {
  it('provides a substantial, level-gated White repertoire with legal moves', () => {
    const rep = load();
    expect(rep.id).toBe('vienna');
    expect(rep.color).toBe('white');
    expect(rep.byId.size).toBeGreaterThanOrEqual(250);
    expect(rep.byId.size).toBeLessThanOrEqual(350);
    expect([...new Set([...rep.byId.values()].map(n => n.level))].sort()).toEqual([1, 2, 3]);
    expect(rep.roots.map(n => n.san)).toEqual(['e4']);
    expect(rep.byId.get('e4 e5 Nc3')).toBeDefined();
    for (const node of rep.byId.values()) {
      expect(new Chess(node.fenBefore).move(node.san).after).toBe(node.fenAfter);
      if (node.mover === 'white') {
        expect(node.comment?.trim().length).toBeGreaterThan(15);
        expect(node.comment!.length).toBeLessThanOrEqual(220);
      } else if (node.children.length) expect(node.children).toHaveLength(1);
      for (const child of node.children) expect(child.level).toBeGreaterThanOrEqual(node.level);
    }
  });

  it('covers the main defences and the gambit counterstrike, not just acceptance', () => {
    const rep = load();
    expect(rep.byId.get('e4 e5 Nc3')!.children.map(n => n.san)).toEqual(expect.arrayContaining(['Nf6', 'Nc6', 'Bc5', 'd6', 'Bb4', 'c6']));
    expect(rep.byId.get('e4 e5 Nc3 Nf6 f4')!.children.map(n => n.san)).toEqual(expect.arrayContaining(['d5', 'exf4', 'd6', 'Nc6']));
    expect(rep.byId.get('e4 e5 Nc3 Nc6 f4')).toBeDefined();
    expect(rep.byId.get('e4 e5 Nc3 Bc5 Bc4')).toBeDefined();
  });

  it('keeps London and Vienna games separate and unsupported first replies out of book', () => {
    const rep = load();
    const london = loadRepertoire(JSON.parse(readFileSync('content/repertoires/london.json', 'utf8')));
    const d4 = openingMoves('1. d4 d5 2. Bf4 *', 10)!;
    const e4 = openingMoves('1. e4 e5 2. Nc3 Nf6 3. f4 *', 10)!;
    expect(findLeak(rep, d4, 'white')).toEqual({ kind: 'not_this_opening' });
    expect(findLeak(london, e4, 'white')).toEqual({ kind: 'not_this_opening' });
    expect(findLeak(rep, e4, 'white').kind).toBe('end_of_book');
    expect(findLeak(rep, openingMoves('1. e4 c5 *', 10)!, 'white').kind).toBe('out_of_book');
  });
});
