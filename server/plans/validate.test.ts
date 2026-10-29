import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PlanFile } from '../../shared/plans.js';
import { loadAllRepertoires } from '../repertoire/load.js';
import { loadPlan } from './load.js';
import { validatePlan } from './validate.js';

const reps = loadAllRepertoires();
const sample = (): PlanFile => loadPlan(JSON.parse(readFileSync('content/plans/__test__/sample.json', 'utf8')), reps);

async function rules(mutate: (p: PlanFile) => void): Promise<string[]> {
  const p = sample();
  mutate(p);
  return (await validatePlan(p, reps)).map((i) => i.rule);
}

describe('validatePlan (chess rules)', () => {
  it('accepts the valid sample', async () => {
    expect(await validatePlan(sample(), reps)).toEqual([]);
  });

  it('names the plan file in each issue', async () => {
    const p = sample();
    p.steps[0]!.board = { moves: ['e4', 'e4'] };
    expect((await validatePlan(p, reps))[0]!.file).toBe('sample.json');
  });

  it('illegal-san: in a step board, a mistake line, a model and a choice', async () => {
    expect(await rules((p) => { p.steps[0]!.board = { moves: ['e4', 'e4'] }; })).toContain('illegal-san');
    expect(await rules((p) => { p.mistakes[0]!.moves = ['e4', 'Qh8']; })).toContain('illegal-san');
    expect(await rules((p) => { p.models[0]!.moves = [...p.models[0]!.moves, 'Qh8']; })).toContain('illegal-san');
    expect(await rules((p) => { p.exercises[0]!.choices[0] = { san: 'Qh8', why: 'x' }; })).toContain('illegal-san');
  });

  it('bad-from-node: unknown node, and moves that do not start with the node path', async () => {
    expect(await rules((p) => { p.position.fromNode = { repertoireId: 'london', nodeId: 'd4 d5 Qh5' }; })).toContain('bad-from-node');
    expect(await rules((p) => { p.position.fromNode = { repertoireId: 'london', nodeId: 'd4 d5 Bf4' }; p.position.moves = ['e4']; })).toContain('bad-from-node');
    expect(await rules((p) => { p.position.fromNode = { repertoireId: 'london', nodeId: 'd4 d5 Bf4' }; })).not.toContain('bad-from-node');
  });

  it('job-square: a job on an empty square or on an enemy piece; duplicate-job', async () => {
    expect(await rules((p) => { p.jobs[0]!.square = 'a5'; })).toContain('job-square');
    expect(await rules((p) => { p.jobs[0]!.square = 'g8'; })).toContain('job-square');
    expect(await rules((p) => { p.jobs[1]!.square = p.jobs[0]!.square; })).toContain('duplicate-job');
  });

  it('arrow-move: a move arrow must be a legal move', async () => {
    expect(await rules((p) => { p.steps[1]!.board!.arrows = [{ from: 'f3', to: 'f8', kind: 'move' }]; })).toContain('arrow-move');
  });

  it('arrow-attack: the from piece must attack the to square', async () => {
    expect(await rules((p) => { p.position.arrows = [{ from: 'd3', to: 'a8', kind: 'attack' }]; })).toContain('arrow-attack');
  });

  it('arrow-route: the from square needs an own piece', async () => {
    expect(await rules((p) => { p.steps[0]!.board!.arrows = [{ from: 'a5', to: 'a6', kind: 'route' }]; })).toContain('arrow-route');
    expect(await rules((p) => { p.steps[0]!.board!.arrows = [{ from: 'f3', to: 'h4', kind: 'route' }]; })).not.toContain('arrow-route');
  });

  it('break-pawn and break-step', async () => {
    expect(await rules((p) => { p.breaks[0] = { from: 'e4', to: 'e5', text: 'x' }; })).toContain('break-pawn');
    expect(await rules((p) => { p.breaks[0] = { from: 'e3', to: 'e6', text: 'x' }; })).toContain('break-step');
    expect(await rules((p) => { p.breaks[0] = { from: 'c3', to: 'd4', text: 'x' }; })).not.toContain('break-step');
  });

  it('trigger-mismatch: position board and exercise board (Review Focus 2)', async () => {
    const issues = async (mutate: (p: PlanFile) => void) => {
      const p = sample();
      mutate(p);
      return (await validatePlan(p, reps)).filter((i) => i.rule === 'trigger-mismatch').map((i) => i.nodeId);
    };
    expect(await issues((p) => { p.trigger!.all.push({ type: 'piece', side: 'own', piece: 'N', on: ['h3'] }); })).toContain('(position)');
    expect(await issues((p) => { p.trigger!.all.push({ type: 'noPawn', side: 'own', file: 'e' }); })).toContain('exercise:start');
    expect(await issues(() => {})).toEqual([]);
  });

  it('trigger-mismatch is not checked for a null trigger (group general)', async () => {
    expect(await rules((p) => { p.group = 'general'; p.trigger = null; })).not.toContain('trigger-mismatch');
  });

  it('exercise-turn: not the owner, or a wrong prompt start', async () => {
    expect(await rules((p) => { p.exercises[0]!.board = { moves: [...p.exercises[0]!.board.moves, 'Re1'] }; })).toContain('exercise-turn');
    expect(await rules((p) => { p.exercises[0]!.prompt = 'Their king is on g8.'; })).toContain('exercise-turn');
  });

  it('accepted-subset: accepted must be among the choices', async () => {
    expect(await rules((p) => { p.exercises[0]!.accepted = ['Qd2']; })).toContain('accepted-subset');
  });

  it('duplicate-exercise: two exercises with one id', async () => {
    expect(await rules((p) => { p.exercises[1]!.id = p.exercises[0]!.id; })).toContain('duplicate-exercise');
  });

  it('text rules: engine line, percent sign, "the best plan"', async () => {
    expect(await rules((p) => { p.goal = 'The engine line is Re1.'; })).toContain('engine-line-text');
    expect(await rules((p) => { p.steps[0]!.text = 'You win 60% of the time.'; })).toContain('percent-text');
    expect(await rules((p) => { p.goal = 'This is the best plan here.'; })).toContain('the-best-plan-text');
  });

  it('mistake bad/good rules run through the shared check', async () => {
    expect(await rules((p) => { p.mistakes[0]!.good = ['Bxh7+']; })).toContain('bad-in-good');
  });
});
