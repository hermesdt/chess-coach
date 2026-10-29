import { readFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import { describe, expect, it, vi } from 'vitest';
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

  it('duplicate-position: two exercises on one board would share one card', async () => {
    expect(await rules((p) => { p.exercises[1]!.board = { moves: [...p.exercises[0]!.board.moves] }; })).toContain('duplicate-position');
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

describe('validatePlan (engine rules)', () => {
  const A = ['d4', 'd5', 'Bf4', 'Nf6', 'e3', 'e6', 'Nf3', 'Bd6', 'Bg3', 'O-O', 'Nbd2', 'c5', 'c3', 'Nc6', 'Bd3', 'b6', 'O-O', 'Bb7'];
  const fenOf = (moves: string[]): string => {
    const g = new Chess();
    for (const m of moves) g.move(m);
    return g.fen();
  };
  const FEN_A = fenOf(A);
  type Script = Record<string, { cp: number; pv: string }[]>;

  /** Default: every position is equal and the engine move is a2a3. `script` maps a FEN to its lines (side-to-move view). */
  function fakeEngine(script: Script = {}) {
    return {
      analyse: vi.fn(async (fen: string, o: { multipv?: number }) => {
        const lines = script[fen] ?? [{ cp: 0, pv: 'a2a3' }];
        return lines.slice(0, o.multipv ?? 1).map((l, i) => ({ multipv: i + 1, score: { cp: l.cp, mate: null }, pv: [l.pv] }));
      }),
    };
  }
  const baseScript = (): Script => ({
    [FEN_A]: [{ cp: 10, pv: 'f1e1' }, { cp: 9, pv: 'd1e2' }],
    [fenOf([...A, 'Re1'])]: [{ cp: -10, pv: 'e7e6' }],
    [fenOf([...A, 'Qe2'])]: [{ cp: -9, pv: 'e7e6' }],
    [fenOf([...A, 'Bxh7+'])]: [{ cp: 640, pv: 'f6h7' }],
    [fenOf([...A, 'b4'])]: [{ cp: 150, pv: 'c5b4' }],
    [fenOf([...A, 'Re1', 'Bxg3', 'hxg3', 'Rc8'])]: [{ cp: 10, pv: 'd1a4' }],
    [fenOf([...A, 'Re1', 'Bxg3', 'hxg3', 'Rc8', 'Qa4'])]: [{ cp: -10, pv: 'g7g6' }],
    [fenOf([...A, 'Re1', 'Bxg3', 'hxg3', 'Rc8', 'Bxh7+'])]: [{ cp: 640, pv: 'f6h7' }],
    [fenOf([...A, 'Qe2', 'Ne7'])]: [{ cp: 10, pv: 'a1d1' }],
    [fenOf([...A, 'Qe2', 'Ne7', 'Rad1'])]: [{ cp: -10, pv: 'e7f5' }],
    [fenOf([...A, 'Qe2', 'Ne7', 'Bxh7+'])]: [{ cp: 640, pv: 'f6h7' }],
  });
  const run = async (script: Script, mutate: (p: PlanFile) => void = () => {}) => {
    const p = sample();
    mutate(p);
    const engine = fakeEngine(script);
    const issues = await validatePlan(p, reps, engine as never, { nodes: 1000 });
    return { issues, rules: issues.map((i) => i.rule), engine };
  };

  it('accepts the sample when the engine agrees, and every search starts a new game', async () => {
    const { issues, engine } = await run(baseScript());
    expect(issues).toEqual([]);
    expect(engine.analyse).toHaveBeenCalled();
    for (const call of engine.analyse.mock.calls) expect(call[1]).toMatchObject({ newGame: true, nodes: 1000 });
  });

  it('engine-loss: an own move in a board loses 15 win % or more', async () => {
    const script = baseScript();
    script[fenOf(['d4'])] = [{ cp: 400, pv: 'a7a6' }];
    expect((await run(script)).rules).toContain('engine-loss');
  });

  it('engine-loss-good: a good move of a mistake loses 15 win % or more', async () => {
    const script = baseScript();
    script[fenOf([...A, 'Re1'])] = [{ cp: 400, pv: 'e7e6' }];
    script[FEN_A] = [{ cp: 10, pv: 'd1e2' }, { cp: 9, pv: 'f1e1' }];
    const rules = (await run(script, (p) => { p.exercises[0]!.accepted = ['Qe2']; })).rules;
    expect(rules).toContain('engine-loss-good');
  });

  it('model: an opponent move of a plan model loses 15 or more (engine-loss-opp); a trap and a tree model are free', async () => {
    const script = baseScript();
    const bad = [...A, 'Re1', 'Bxg3', 'hxg3', 'Rc8'];
    script[fenOf(bad)] = [{ cp: 400, pv: 'd1a4' }];
    expect((await run(script)).rules).toContain('engine-loss-opp');
    expect((await run(script, (p) => { p.models[0]!.kind = 'trap'; })).rules).not.toContain('engine-loss-opp');
    expect((await run(script, (p) => { p.models[0]!.source = 'tree'; })).rules).not.toContain('engine-loss-opp');
  });

  it('accepted-loss: an accepted quiz move loses 10 or more', async () => {
    const script = baseScript();
    script[FEN_A] = [{ cp: 9, pv: 'd1e2' }, { cp: 8, pv: 'f1e1' }];
    script[fenOf([...A, 'Re1'])] = [{ cp: 150, pv: 'e7e6' }];
    expect((await run(script)).rules).toContain('accepted-loss');
  });

  it('weak-alternative: an accepted move that loses 5 to 10 is a warning', async () => {
    const script = baseScript();
    script[FEN_A] = [{ cp: 9, pv: 'd1e2' }, { cp: 8, pv: 'f1e1' }];
    script[fenOf([...A, 'Re1'])] = [{ cp: 62, pv: 'e7e6' }];
    const { issues } = await run(script);
    const w = issues.find((i) => i.rule === 'weak-alternative');
    expect(w?.severity).toBe('warning');
    expect(issues.some((i) => i.rule === 'accepted-loss')).toBe(false);
  });

  it('ambiguous-choice: a wrong choice that loses less than 10', async () => {
    const script = baseScript();
    script[fenOf([...A, 'b4'])] = [{ cp: 5, pv: 'c5b4' }];
    expect((await run(script)).rules).toContain('ambiguous-choice');
  });

  it('missed-good-move: a good engine move outside the choices is a warning', async () => {
    const script = baseScript();
    script[FEN_A] = [{ cp: 10, pv: 'f1e1' }, { cp: 9, pv: 'd1e2' }, { cp: 8, pv: 'd1c2' }];
    const { issues } = await run(script);
    const w = issues.find((i) => i.rule === 'missed-good-move');
    expect(w?.severity).toBe('warning');
    expect(w?.detail).toContain('Qc2');
  });
});
