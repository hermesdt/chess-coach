import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadAllRepertoires } from './load.js';
import { loadGuide, validateGuide } from '../guides/load.js';
import { loadPlan, validatePlan } from '../plans/load.js';
import { replayBoard } from '../plans/board.js';
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
describe('Grand Prix teaching content',()=>{
  it('provides six valid guide sections with routes and concrete mistakes',async()=>{
    const reps=loadAllRepertoires();
    const g=loadGuide(read('content/guides/grand-prix.json'),reps);
    expect(g.variations).toHaveLength(6);
    for(const v of g.variations){expect(v.route.length).toBeGreaterThanOrEqual(4);expect(v.mistakes.length).toBeGreaterThanOrEqual(1);}
    expect(await validateGuide(g,reps.find(r=>r.id==='grand-prix')!)).toEqual([]);
  });
  it('provides two plans with six distinct exercise positions',async()=>{
    const reps=loadAllRepertoires(),positions=new Set<string>();
    for(const id of ['grand-prix-development','grand-prix-central-response']){
      const p=loadPlan(read(`content/plans/${id}.json`),reps);
      expect(p.group).toBe('grand-prix');expect(p.side).toBe('white');expect(p.exercises).toHaveLength(3);
      expect(await validatePlan(p,reps)).toEqual([]);
      for(const e of p.exercises)positions.add(replayBoard(e.board.moves)!.fen.split(' ').slice(0,4).join(' '));
    }
    expect(positions.size).toBe(6);
  });
});
