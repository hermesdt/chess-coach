import { afterAll, describe, expect, it } from 'vitest';
import { closeEnginePool, lazyEnginePool } from '../server/engine/pool.js';
import { isStockfishAvailable } from '../server/engine/stockfish-path.js';
import type { EngineLine } from '../server/engine/uci.js';
import { loadLessons, validateLesson } from '../server/course/load.js';
import { parseValidateArgs } from './validate-args.js';
import type { Lesson } from '../shared/types.js';
import { loadRepertoire } from '../server/repertoire/load.js';
import { validateRepertoire } from '../server/repertoire/validate.js';

type Node = { san: string; comment?: string | null; level?: number; children?: Node[] };
const rep = (moves: Node[], color: 'white' | 'black' = 'black') => loadRepertoire({ id: 'r', name: 'R', color, moves });
const cp = (n: number): EngineLine['score'] => ({ cp: n, mate: null });

/** Fake engine: every position is equal (cp 0), best move is the first legal-looking uci given by `best`. */
function fakeEngine(scores: Record<string, number> = {}, best: Record<string, string> = {}) {
  const calls: string[] = [];
  return {
    calls,
    analyse: async (fen: string): Promise<EngineLine[]> => {
      calls.push(fen);
      return [{ multipv: 1, score: cp(scores[fen] ?? 0), pv: [best[fen] ?? 'e2e4'] }];
    },
  };
}

const ok = { nodes: 1000 };

describe('validateRepertoire (static rules)', () => {
  it('passes a clean tree', async () => {
    const r = rep([{ san: 'e4', children: [{ san: 'c6', comment: 'Solid.' }] }]);
    expect(await validateRepertoire(r, fakeEngine(), ok)).toEqual([]);
  });

  it('flags two repertoire moves at one position', async () => {
    const r = rep([{ san: 'e4', children: [{ san: 'c6', comment: 'a' }, { san: 'e5', comment: 'b' }] }], 'black');
    const issues = await validateRepertoire(r, fakeEngine(), ok);
    expect(issues.filter((i) => i.rule === 'multiple-children').map((i) => i.nodeId)).toEqual(['e4']);
  });

  it('allows many opponent replies', async () => {
    const r = rep([{ san: 'e4', children: [{ san: 'c6', comment: 'a', children: [{ san: 'd4' }, { san: 'Nc3' }] }] }], 'black');
    expect(await validateRepertoire(r, fakeEngine(), ok)).toEqual([]);
  });

  it('flags two root moves for a white repertoire', async () => {
    const r = rep([{ san: 'd4', comment: 'a' }, { san: 'e4', comment: 'b' }], 'white');
    const issues = await validateRepertoire(r, fakeEngine(), ok);
    expect(issues.filter((i) => i.rule === 'multiple-children').map((i) => i.nodeId)).toEqual(['(root)']);
  });

  it('flags a missing comment on a repertoire-side move only', async () => {
    const r = rep([{ san: 'e4', children: [{ san: 'c6' }] }]);
    const issues = await validateRepertoire(r, fakeEngine(), ok);
    expect(issues.filter((i) => i.rule === 'missing-comment').map((i) => i.nodeId)).toEqual(['e4 c6']);
  });

  it('flags a 221-character comment and accepts 220', async () => {
    const long = await validateRepertoire(rep([{ san: 'e4', children: [{ san: 'c6', comment: 'x'.repeat(221) }] }]), fakeEngine(), ok);
    expect(long.map((i) => i.rule)).toEqual(['comment-too-long']);
    const fine = await validateRepertoire(rep([{ san: 'e4', children: [{ san: 'c6', comment: 'x'.repeat(220) }] }]), fakeEngine(), ok);
    expect(fine).toEqual([]);
  });

  it('flags duplicate sibling SAN', async () => {
    const r = rep([{ san: 'e4', children: [{ san: 'c6', comment: 'a' }] }, { san: 'e4' }]);
    const issues = await validateRepertoire(r, fakeEngine(), ok);
    expect(issues.some((i) => i.rule === 'duplicate-sibling')).toBe(true);
  });

  it('flags a child with a lower level than its parent', async () => {
    const r = rep([{ san: 'e4', level: 2, children: [{ san: 'c6', level: 1, comment: 'a' }] }]);
    const issues = await validateRepertoire(r, fakeEngine(), ok);
    expect(issues.filter((i) => i.rule === 'level-order').map((i) => i.nodeId)).toEqual(['e4 c6']);
  });
});

describe('validateRepertoire (engine rule)', () => {
  const r = rep([{ san: 'e4', children: [{ san: 'c6', comment: 'Solid.' }] }]);
  const c6 = r.byId.get('e4 c6')!;

  it('flags a move losing 20 win % and names the engine best move', async () => {
    // Best from fenBefore is +0 for Black; after c6 White is at about +100cp-ish, we want a ~20% loss.
    // winPct(cp 0)=50. After the move, the opponent view cp 200 is about 68 for white, so Black has about 32.
    const engine = fakeEngine({ [c6.fenAfter]: 200 }, { [c6.fenBefore]: 'e7e5' });
    const issues = await validateRepertoire(r, engine, ok);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ file: 'r.json', nodeId: 'e4 c6', rule: 'engine-loss' });
    expect(issues[0]!.detail).toContain('e5');
  });

  it('accepts a loss under 15 win %', async () => {
    const engine = fakeEngine({ [c6.fenAfter]: 60 }, { [c6.fenBefore]: 'e7e5' });
    expect(await validateRepertoire(r, engine, ok)).toEqual([]);
  });

  it('skips the second search when the repertoire move is the engine best', async () => {
    const engine = fakeEngine({}, { [c6.fenBefore]: 'c7c6' });
    await validateRepertoire(r, engine, ok);
    expect(engine.calls).toEqual([c6.fenBefore]);
  });

  it('caches engine results per FEN within one run', async () => {
    const engine = fakeEngine({}, { [c6.fenBefore]: 'e7e5' });
    await validateRepertoire(r, engine, ok);
    await validateRepertoire(r, engine, ok, new Map());
    const first = engine.calls.length;
    const cache = new Map();
    await validateRepertoire(r, engine, ok, cache);
    await validateRepertoire(r, engine, ok, cache);
    expect(engine.calls.length - first).toBe(2);
  });

  it('reports progress', async () => {
    const seen: number[] = [];
    await validateRepertoire(r, fakeEngine(), { nodes: 1, onProgress: (n) => seen.push(n) });
    expect(seen).toEqual([1]);
  });
});

describe.skipIf(!isStockfishAvailable())('validateRepertoire (Stockfish)', () => {
  afterAll(closeEnginePool);

  it('accepts a sound 2-move tree and flags a blunder', async () => {
    const good = rep([{ san: 'e4', children: [{ san: 'e5', comment: 'Take the centre too.' }] }]);
    expect(await validateRepertoire(good, lazyEnginePool, { nodes: 20000 })).toEqual([]);
    const bad = rep([{ san: 'f3', comment: 'Hmm.', children: [{ san: 'e5', children: [{ san: 'g4', comment: 'Attack.' }] }] }], 'white');
    const issues = await validateRepertoire(bad, lazyEnginePool, { nodes: 20000 });
    expect(issues.filter((i) => i.rule === 'engine-loss').map((i) => i.nodeId)).toContain('f3 e5 g4');
  }, 60000);
});

describe('validateLesson', () => {
  const sample = () => loadLessons('content/lessons/__test__')[0]!;
  const withEx = (patch: Partial<Lesson['exercises'][number]>, i = 1): Lesson => {
    const l = sample();
    return { ...l, exercises: l.exercises.map((e, j) => (j === i ? { ...e, ...patch } : e)) };
  };
  const rules = (issues: { rule: string; severity?: string }[], severity = 'error') =>
    issues.filter((i) => (i.severity ?? 'error') === severity).map((i) => i.rule);

  /** Fake engine: `lines[fen]` is a list of [uci, cp] (side-to-move view); unknown FENs are one equal line. */
  function lessonEngine(lines: Record<string, [string, number][]> = {}) {
    const calls: { fen: string; multipv: number | undefined }[] = [];
    return {
      calls,
      analyse: async (fen: string, o: { nodes?: number; multipv?: number }): Promise<EngineLine[]> => {
        calls.push({ fen, multipv: o.multipv });
        const l = lines[fen] ?? [['e2e4', 0]];
        return l.slice(0, o.multipv ?? 1).map(([uci, c], i) => ({ multipv: i + 1, score: cp(c), pv: [uci] }));
      },
    };
  }
  const [mate, queen] = sample().exercises;
  // Clear best move: best +400, second -400 -> big gain; solution in best.
  const clear = () => lessonEngine({
    [mate!.fen]: [['h5f7', 900], ['d2d3', 0]],
    [queen!.fen]: [['d1d5', 900], ['e1e2', 0]],
    [sample().exercises[2]!.fen]: [['d8h4', 900], ['a7a6', 0]],
  });

  it('passes the sample lesson with a clear engine', async () => {
    expect(await validateLesson(sample(), clear(), ok)).toEqual([]);
  });

  it('flags an invalid FEN and skips the engine for it', async () => {
    const eng = clear();
    const issues = await validateLesson(withEx({ fen: 'not a fen' }), eng, ok);
    expect(rules(issues)).toEqual(['invalid-fen']);
    expect(eng.calls.some((c) => c.fen === 'not a fen')).toBe(false);
  });

  it('flags a prompt side that differs from the FEN side', async () => {
    const issues = await validateLesson(withEx({ prompt: 'Black to move. Win material.' }), clear(), ok);
    expect(rules(issues)).toEqual(['prompt-side']);
  });

  it('flags an illegal solution move', async () => {
    const issues = await validateLesson(withEx({ solution: ['a1a8'] }), clear(), ok);
    expect(rules(issues)).toContain('illegal-solution');
  });

  it('flags a solution move that loses 10 win % or more against the engine best', async () => {
    // Rook takes a different piece? Use e1e2 (legal king move): engine says it is 0 cp vs +900 best.
    const issues = await validateLesson(withEx({ solution: ['e1e2'] }), clear(), ok);
    expect(rules(issues)).toEqual(['engine-loss']);
  });

  it('measures a move outside the top 2 by the position after it', async () => {
    const eng = lessonEngine({
      [queen!.fen]: [['d1d5', 900], ['e1e2', 0]],
    });
    const issues = await validateLesson(withEx({ solution: ['d1d2'] }, 1), eng, ok);
    expect(rules(issues)).toContain('engine-loss');
    expect(eng.calls.length).toBeGreaterThan(1);
  });

  it('warns, without failing, when the best move gains under 5 win % over the second best', async () => {
    const eng = lessonEngine({
      [mate!.fen]: [['h5f7', 900], ['d2d3', 890]],
      [queen!.fen]: [['d1d5', 900], ['e1e2', 0]],
      [sample().exercises[2]!.fen]: [['d8h4', 900], ['a7a6', 0]],
    });
    const issues = await validateLesson(sample(), eng, ok);
    expect(rules(issues)).toEqual([]);
    expect(rules(issues, 'warning')).toEqual(['trivial-exercise']);
    expect(issues.find((i) => i.rule === 'trivial-exercise')!.nodeId).toBe('mate-in-one');
  });

  it('asks the engine for 2 lines and caches per FEN', async () => {
    const eng = clear();
    const cache = new Map();
    await validateLesson(sample(), eng, ok, cache);
    const first = eng.calls.length;
    expect(eng.calls.every((c) => c.multipv === 2)).toBe(true);
    await validateLesson(sample(), eng, ok, cache);
    expect(eng.calls.length).toBe(first);
  });

  it('flags duplicate exercise ids', async () => {
    const l = sample();
    const dup: Lesson = { ...l, exercises: [...l.exercises, { ...l.exercises[0]! }] };
    expect(rules(await validateLesson(dup, clear(), ok))).toContain('duplicate-exercise');
  });

  it('flags a body outside 150-400 words and a missing "Rule of thumb:" line', async () => {
    const l = sample();
    const short = await validateLesson({ ...l, body: 'Rule of thumb: be short.' }, clear(), ok);
    expect(rules(short)).toEqual(['body-length']);
    const long = await validateLesson({ ...l, body: `Rule of thumb: x\n\n${'word '.repeat(400)}` }, clear(), ok);
    expect(rules(long)).toEqual(['body-length']);
    const noRule = await validateLesson({ ...l, body: l.body.replace('Rule of thumb:', 'Tip:') }, clear(), ok);
    expect(rules(noRule)).toEqual(['rule-of-thumb']);
  });

  it('flags a long summary, a wrong exercise count and an order that does not match the id', async () => {
    const l = sample();
    expect(rules(await validateLesson({ ...l, summary: 'x'.repeat(141) }, clear(), ok))).toEqual(['summary-length']);
    expect(rules(await validateLesson({ ...l, exercises: l.exercises.slice(0, 2) }, clear(), ok))).toEqual(['exercise-count']);
    expect(rules(await validateLesson({ ...l, order: 5 }, clear(), ok))).toEqual(['order']);
  });

  it('warns when the engine best is in the solution but not listed first', async () => {
    const l = withEx({ solution: ['e1e2', 'd1d5'] });
    const issues = await validateLesson(l, clear(), ok);
    expect(rules(issues, 'warning')).toContain('best-not-first');
  });

  it('accepts an alternative solution within 10 win % of the engine best', async () => {
    const eng = lessonEngine({
      [mate!.fen]: [['h5f7', 900], ['d2d3', 0]],
      [queen!.fen]: [['d1d5', 900], ['d1d4', 895]],
      [sample().exercises[2]!.fen]: [['d8h4', 900], ['a7a6', 0]],
    });
    const issues = await validateLesson(withEx({ solution: ['d1d4'] }), eng, ok);
    expect(rules(issues)).toEqual([]);
  });
});

describe('validateLesson (fix round 1)', () => {
  const sample = () => loadLessons('content/lessons/__test__')[0]!;
  const eng = {
    analyse: async (_fen: string, o: { multipv?: number }): Promise<EngineLine[]> =>
      [{ multipv: 1, score: cp(900), pv: ['e2e4'] }, { multipv: 2, score: cp(0), pv: ['d2d4'] }].slice(0, o.multipv ?? 1),
  };

  it('flags the same FEN twice within a lesson', async () => {
    const l = sample();
    const dup: Lesson = { ...l, exercises: l.exercises.map((e, i) => (i === 2 ? { ...e, fen: l.exercises[0]!.fen } : e)) };
    const issues = await validateLesson(dup, eng, { nodes: 1 });
    expect(issues.filter((i) => i.rule === 'duplicate-fen').map((i) => i.nodeId)).toEqual([l.exercises[2]!.id]);
  });

  it('flags the same FEN across lessons through a shared map', async () => {
    const l = sample();
    const seenFens = new Map<string, string>();
    await validateLesson(l, eng, { nodes: 1, seenFens });
    const other: Lesson = { ...l, id: 'free-material', order: 2 };
    const issues = await validateLesson(other, eng, { nodes: 1, seenFens });
    expect(issues.filter((i) => i.rule === 'duplicate-fen')).toHaveLength(3);
  });

  it('needs "Rule of thumb:" at the start of a line', async () => {
    const l = sample();
    const body = l.body.replace('Rule of thumb:', 'Our Rule of thumb:');
    const issues = await validateLesson({ ...l, body }, eng, { nodes: 1 });
    expect(issues.map((i) => i.rule)).toContain('rule-of-thumb');
  });
});

describe('parseValidateArgs', () => {
  it('defaults to everything', () => {
    expect(parseValidateArgs([])).toEqual({ lessons: true, repertoires: true, file: null });
  });
  it('--lessons and --repertoires select one side', () => {
    expect(parseValidateArgs(['--lessons'])).toEqual({ lessons: true, repertoires: false, file: null });
    expect(parseValidateArgs(['--repertoires'])).toEqual({ lessons: false, repertoires: true, file: null });
  });
  it('a file path validates just that file', () => {
    expect(parseValidateArgs(['content/lessons/01-blunder-check.json']))
      .toEqual({ lessons: false, repertoires: false, file: 'content/lessons/01-blunder-check.json' });
  });
  it('rejects unknown flags', () => {
    expect(() => parseValidateArgs(['--nope'])).toThrow(/Unknown option/);
  });
});
