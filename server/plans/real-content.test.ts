import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LESSON_IDS } from '../../shared/lessons.js';
import { loadGuides } from '../guides/load.js';
import { loadAllRepertoires } from '../repertoire/load.js';
import { replayBoard } from './board.js';
import { listPlanFiles, loadPlan, loadPlans, validatePlan } from './load.js';

const reps = loadAllRepertoires();
const files = listPlanFiles();

describe('real plans against the real repertoires, lessons and guides (no engine)', () => {
  it.each(files)('%s loads and has no validation error', async (file) => {
    const plan = loadPlan(JSON.parse(readFileSync(file, 'utf8')), reps, LESSON_IDS);
    expect(await validatePlan(plan, reps)).toEqual([]);
  });

  it('loads every plan file without skipping one, and every id is unique', () => {
    const skipped: string[] = [];
    const plans = loadPlans(undefined, reps, LESSON_IDS, (file, e) => skipped.push(`${file}: ${e.message}`));
    expect(skipped).toEqual([]);
    expect(plans).toHaveLength(files.length);
    expect(new Set(plans.map((p) => p.id)).size).toBe(plans.length);
  });

  it('links only guide variations that exist', () => {
    const guides = loadGuides(undefined, reps);
    for (const plan of loadPlans(undefined, reps, LESSON_IDS)) {
      for (const link of plan.guideLinks) {
        const guide = guides.find((g) => g.repertoireId === link.repertoireId);
        expect(guide, `${plan.id}: no guide for ${link.repertoireId}`).toBeDefined();
        expect(guide!.variations.map((v) => v.key), `${plan.id}: variation ${link.variation}`).toContain(link.variation);
      }
    }
  });

  it('has exactly the five M12a plans, in this order of the plans page groups', () => {
    expect(loadPlans(undefined, reps, LESSON_IDS).map((p) => p.id).sort()).toEqual([
      'caro-advance-d4', 'london-e4-break', 'london-h-file', 'london-kingside-attack', 'no-clear-plan',
    ]);
  });

  it('never shares an exercise position between two plans (one card per position)', () => {
    const seen = new Map<string, string>();
    for (const plan of loadPlans(undefined, reps, LESSON_IDS)) {
      for (const e of plan.exercises) {
        const key = replayBoard(e.board.moves)!.fen.split(' ').slice(0, 4).join(' ');
        expect(seen.get(key), `${plan.id}/${e.id} repeats ${seen.get(key)}`).toBeUndefined();
        seen.set(key, `${plan.id}/${e.id}`);
      }
    }
  });
});
