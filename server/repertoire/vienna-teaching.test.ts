import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadAllRepertoires } from './load.js';
import { loadGuide, validateGuide } from '../guides/load.js';
import { loadPlan } from '../plans/load.js';
import { validatePlan } from '../plans/validate.js';
import { replayBoard } from '../plans/board.js';

const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
describe('Vienna teaching content', () => {
  it('has six guide sections with valid routes, piece jobs and concrete mistakes', async () => {
    const reps = loadAllRepertoires();
    const guide = loadGuide(read('content/guides/vienna.json'), reps);
    expect(guide.variations).toHaveLength(6);
    for (const v of guide.variations) {
      expect(v.route.length).toBeGreaterThanOrEqual(4);
      expect(v.mistakes.length).toBeGreaterThanOrEqual(1);
    }
    expect(await validateGuide(guide, reps.find(r => r.id === 'vienna')!)).toEqual([]);
  });
  it('has two Vienna-only plans with six distinct legal exercise positions', async () => {
    const reps = loadAllRepertoires();
    const positions = new Set<string>();
    for (const id of ['vienna-central-tempi', 'vienna-development']) {
      const p = loadPlan(read(`content/plans/${id}.json`), reps);
      expect(p.group).toBe('vienna');
      expect(p.side).toBe('white');
      expect(p.exercises).toHaveLength(3);
      expect((await validatePlan(p, reps)).filter(i => i.severity !== 'warning')).toEqual([]);
      for (const e of p.exercises) positions.add(replayBoard(e.board.moves)!.fen.split(' ').slice(0, 4).join(' '));
    }
    expect(positions.size).toBe(6);
  });
});
