import { readFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { LESSON_IDS } from '../../shared/lessons.js';
import { loadGuides } from '../guides/load.js';
import { loadAllRepertoires } from '../repertoire/load.js';
import { replayBoard } from './board.js';
import { listPlanFiles, loadPlan, loadPlans, validatePlan } from './load.js';
import { matchTrigger } from './trigger.js';

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

  it('includes the M12a plans and the level-2 and level-3 M12c plans', () => {
    expect(loadPlans(undefined, reps, LESSON_IDS).map((p) => p.id).sort()).toEqual([
      'carlsbad-minority', 'caro-advance-d4', 'caro-opposite-castling', 'london-e4-break', 'london-h-file', 'london-kingside-attack', 'no-clear-plan', 'slav-a-file',
    ]);
    expect(loadPlans(undefined, reps, LESSON_IDS).find((p) => p.id === 'slav-a-file')?.level).toBe(2);
    expect(loadPlans(undefined, reps, LESSON_IDS).find((p) => p.id === 'carlsbad-minority')?.level).toBe(3);
    expect(loadPlans(undefined, reps, LESSON_IDS).find((p) => p.id === 'caro-opposite-castling')?.level).toBe(3);
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

  it('does not suggest the minority attack when the b-pawn is gone', () => {
    const plan = loadPlans(undefined, reps, LESSON_IDS).find((p) => p.id === 'carlsbad-minority')!;
    const chess = new Chess(replayBoard(plan.position.moves)!.fen);
    for (const move of ['b4', 'a5', 'bxa5', 'Rxa5', 'h3', 'Bf5']) chess.move(move);
    expect(matchTrigger(chess.fen(), plan.side, plan.trigger!)).toBe(false);
  });

  it('does not suggest the two-pawn minority attack after the a-pawn is lost', () => {
    const plan = loadPlans(undefined, reps, LESSON_IDS).find((p) => p.id === 'carlsbad-minority')!;
    const chess = new Chess(replayBoard(plan.position.moves)!.fen);
    for (const move of ['h3', 'b5', 'a4', 'bxa4']) chess.move(move);
    expect(matchTrigger(chess.fen(), plan.side, plan.trigger!)).toBe(false);
  });

  it('does not suggest a-file pressure when a piece blocks the rook', () => {
    const plan = loadPlans(undefined, reps, LESSON_IDS).find((p) => p.id === 'slav-a-file')!;
    const chess = new Chess(replayBoard(plan.position.moves)!.fen);
    for (const move of ['Na5', 'Be2']) chess.move(move);
    expect(matchTrigger(chess.fen(), plan.side, plan.trigger!)).toBe(false);
  });

  it('does not suggest the a-pawn race when the pawn is blocked on a6', () => {
    const plan = loadPlans(undefined, reps, LESSON_IDS).find((p) => p.id === 'caro-opposite-castling')!;
    const chess = new Chess(replayBoard(plan.position.moves)!.fen);
    for (const move of ['Qa5', 'Rhg1', 'Qa6', 'g4']) chess.move(move);
    expect(matchTrigger(chess.fen(), plan.side, plan.trigger!)).toBe(false);
  });

  it('marks example-specific advice as belonging to the illustrated position', () => {
    const plans = loadPlans(undefined, reps, LESSON_IDS);
    for (const id of ['slav-a-file', 'carlsbad-minority']) {
      expect(plans.find((p) => p.id === id)!.steps.slice(0, 3).every((s) => s.text.startsWith('In the example,'))).toBe(true);
    }
  });
});
