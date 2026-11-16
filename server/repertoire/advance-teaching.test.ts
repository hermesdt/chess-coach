import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadAllRepertoires } from './load.js';
import { loadGuide, validateGuide } from '../guides/load.js';
import { loadPlan, validatePlan } from '../plans/load.js';
import { replayBoard } from '../plans/board.js';
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
describe('White Advance teaching',()=>{
  it('teaches the developing move in the development quiz, not a different engine-preferred plan',()=>{
    const p=read('content/plans/advance-development.json');
    expect(p.exercises[0].accepted).toContain('Nf3');
    expect(p.exercises[0].explanation).toContain('knight');
  });
  it('has six valid guide sections across both first replies',async()=>{
    const reps=loadAllRepertoires(),g=loadGuide(read('content/guides/advance.json'),reps);
    expect(g.variations).toHaveLength(6);
    expect(g.variations.flatMap(v=>v.roots).some(r=>r.startsWith('e4 e6'))).toBe(true);
    expect(g.variations.flatMap(v=>v.roots).some(r=>r.startsWith('e4 c6'))).toBe(true);
    expect(await validateGuide(g,reps.find(r=>r.id==='advance')!)).toEqual([]);
  });
  it('has two White plans with six unique positions',async()=>{
    const reps=loadAllRepertoires(),positions=new Set<string>();
    for(const id of ['advance-pawn-chain','advance-development']){
      const p=loadPlan(read(`content/plans/${id}.json`),reps);
      expect(p.group).toBe('advance');expect(p.side).toBe('white');expect(p.exercises).toHaveLength(3);
      expect(await validatePlan(p,reps)).toEqual([]);
      for(const e of p.exercises)positions.add(replayBoard(e.board.moves)!.fen.split(' ').slice(0,4).join(' '));
    }
    expect(positions.size).toBe(6);
  });
});
