import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadAllRepertoires } from './load.js';
import { loadGuide, validateGuide } from '../guides/load.js';
import { loadPlan, validatePlan } from '../plans/load.js';
import { replayBoard } from '../plans/board.js';
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
describe('Other 1.e4 teaching', () => {
  it('has six valid sections covering all sixteen first replies', async () => {
    const reps = loadAllRepertoires(), g = loadGuide(read('content/guides/other-e4.json'), reps);
    expect(g.variations).toHaveLength(6);
    expect(g.variations.flatMap(v => v.roots)).toHaveLength(16);
    expect(await validateGuide(g, reps.find(r => r.id === 'other-e4')!)).toEqual([]);
  });
  it('has two valid White plans with six distinct exercise positions', async () => {
    const reps = loadAllRepertoires(), positions = new Set<string>();
    for (const id of ['other-e4-queen-tempi', 'other-e4-development']) {
      const p = loadPlan(read(`content/plans/${id}.json`), reps);
      expect(p.group).toBe('other-e4'); expect(p.side).toBe('white');
      expect(p.exercises).toHaveLength(3);
      expect(await validatePlan(p, reps)).toEqual([]);
      for (const e of p.exercises) positions.add(replayBoard(e.board.moves)!.fen.split(' ').slice(0, 4).join(' '));
    }
    expect(positions.size).toBe(6);
    expect(read('content/plans/other-e4-queen-tempi.json').exercises[0].accepted).toContain('Nc3');
  });
});
