import { readFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { loadAllRepertoires, loadRepertoire } from './load.js';
import { openingMoves, selectRepertoire } from './leaks.js';
const load = () => loadRepertoire(JSON.parse(readFileSync('content/repertoires/advance.json', 'utf8')));
describe('White Advance repertoire', () => {
  it('has a substantial legal, level-gated tree covering both defences', () => {
    const r=load();
    expect(r.color).toBe('white');
    expect(r.byId.size).toBeGreaterThanOrEqual(250);expect(r.byId.size).toBeLessThanOrEqual(350);
    expect([...new Set([...r.byId.values()].map(n=>n.level))].sort()).toEqual([1,2,3]);
    expect(r.byId.get('e4 e6 d4 d5 e5')!.children.map(n=>n.san)).toEqual(expect.arrayContaining(['c5','Nc6','f6']));
    expect(r.byId.get('e4 c6 d4 d5 e5')!.children.map(n=>n.san)).toEqual(expect.arrayContaining(['Bf5','c5','e6']));
    for(const n of r.byId.values()){
      expect(new Chess(n.fenBefore).move(n.san).after).toBe(n.fenAfter);
      if(n.mover==='white'){expect(n.comment!.length).toBeGreaterThan(15);expect(n.comment!.length).toBeLessThanOrEqual(220);}
      else if(n.children.length)expect(n.children).toHaveLength(1);
      for(const c of n.children)expect(c.level).toBeGreaterThanOrEqual(n.level);
    }
  });
  it('identifies White French/Caro games without taking Black Caro games',()=>{
    load();const reps=loadAllRepertoires();
    for(const line of ['e4 e6 d4 d5 e5','e4 c6 d4 d5 e5'])expect(selectRepertoire(reps,openingMoves(line+' *',10)!,'white')?.id).toBe('advance');
    expect(selectRepertoire(reps,openingMoves('1. e4 c6 2. d4 d5 3. e5 *',10)!,'black')?.id).toBe('caro-kann');
    expect(selectRepertoire(reps,openingMoves('1. e4 e5 *',10)!,'white')?.id).toBe('vienna');
    expect(selectRepertoire(reps,openingMoves('1. e4 c5 *',10)!,'white')?.id).toBe('grand-prix');
  });
});
