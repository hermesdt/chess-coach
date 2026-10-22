import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { loadAllRepertoires } from '../repertoire/load.js';
import type { GuideFile } from './types.js';
import { loadGuide } from './load.js';
import { validateGuide } from './validate.js';

const reps = loadAllRepertoires();
const rep = reps.find((r) => r.id === 'caro-kann')!;
const sample = () => loadGuide(JSON.parse(readFileSync('content/guides/__test__/sample.json', 'utf8')), reps);

async function rules(mutate: (g: GuideFile) => void): Promise<string[]> {
  const g = sample();
  mutate(g);
  return (await validateGuide(g, rep)).map((i) => i.rule);
}

describe('validateGuide', () => {
  it('accepts the valid sample', async () => {
    expect(await validateGuide(sample(), rep)).toEqual([]);
  });

  it('reports an unknown node id with the id in the message (tree changed)', async () => {
    const g = sample();
    g.variations[0]!.route[1]!.nodeId = 'e4 c6 d4 d5 e5 Bf5 Nf3 e6 Qh5';
    const issues = await validateGuide(g, rep);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ file: 'caro-kann.json', rule: 'unknown-node', nodeId: 'e4 c6 d4 d5 e5 Bf5 Nf3 e6 Qh5' });
    expect(issues[0]!.detail).toContain('e4 c6 d4 d5 e5 Bf5 Nf3 e6 Qh5');
  });

  it('reports a node outside every root of its variation', async () => {
    expect(await rules((g) => { g.variations[0]!.deviations[0]!.nodeId = 'e4 c6 d4 d5 exd5 cxd5'; })).toContain('node-outside-roots');
  });

  it('does not treat a longer move name as inside a root', async () => {
    expect(await rules((g) => { g.variations[0]!.roots = ['e4 c6 d4 d5 e']; })).toContain('unknown-root');
  });

  it('reports a route node off the final-form line', async () => {
    expect(await rules((g) => { g.variations[0]!.route[2]!.nodeId = 'e4 c6 d4 d5 e5 Bf5 Nc3'; })).toContain('route-off-line');
  });

  it('reports a route node that is not an own move', async () => {
    expect(await rules((g) => { g.variations[0]!.route[0]!.nodeId = 'e4'; })).toContain('route-not-own');
  });

  it('reports a route in the wrong order', async () => {
    expect(await rules((g) => { g.variations[0]!.route.reverse(); })).toContain('route-order');
  });

  it('reports a deviation that is an own move', async () => {
    expect(await rules((g) => { g.variations[0]!.deviations[0]!.nodeId = 'e4 c6 d4 d5 e5 Bf5'; })).toContain('deviation-not-opponent');
  });

  it('reports a root that is not a node', async () => {
    expect(await rules((g) => { g.variations[0]!.roots.push('e4 c6 d4 d5 a4'); })).toContain('unknown-root');
  });

  it('reports a final form that is not a node', async () => {
    expect(await rules((g) => { g.variations[0]!.finalForm.nodeId = 'e4 c6 d4 d5 e5 Bf5 Nf3 e6 Qh5'; })).toContain('unknown-node');
  });

  it('reports a job square without an own piece', async () => {
    const r = await rules((g) => { g.variations[0]!.finalForm.jobs[0]!.square = 'e4'; });
    expect(r).toEqual(['job-square']);
    expect(await rules((g) => { g.variations[0]!.finalForm.jobs[0]!.square = 'z9'; })).toEqual(['job-square']);
    expect(await rules((g) => { g.variations[0]!.finalForm.jobs[0]!.square = 'f3'; })).toEqual(['job-square']);
  });

  it('reports a job count outside 3 to 6', async () => {
    expect(await rules((g) => { g.variations[0]!.finalForm.jobs.length = 2; })).toEqual(['job-count']);
    expect(
      await rules((g) => {
        const j = g.variations[0]!.finalForm.jobs;
        j.push({ square: 'g8', text: 'a' }, { square: 'b8', text: 'b' }, { square: 'a7', text: 'c' });
      }),
    ).toEqual(['job-count']);
  });

  it('reports illegal SAN in a mistake line', async () => {
    expect(await rules((g) => { g.variations[0]!.mistakes[0]!.moves = ['e4', 'c6', 'Qh6']; })).toContain('illegal-san');
  });

  it('reports duplicate variation keys', async () => {
    expect(await rules((g) => { g.variations.push(structuredClone(g.variations[0]!)); })).toContain('duplicate-variation');
  });

  it('reports "engine line" text and "%" signs', async () => {
    expect(await rules((g) => { g.variations[0]!.middlegame = 'The Engine Line is ...c5.'; })).toEqual(['engine-line-text']);
    expect(await rules((g) => { g.why = 'Black wins 60% of games.'; })).toEqual(['percent-text']);
    expect(await rules((g) => { g.variations[0]!.route[0]!.why = '55 %'; })).toEqual(['percent-text']);
  });
});

describe('validateGuide engine rule', () => {
  const lineFor = (cp: number, pv: string[]) => ({ multipv: 1, depth: 10, score: { cp, mate: null }, pv, nodes: 1 });
  // Black to move after 1.e4 c6 2.d4 d5 3.e5 Bf5 4.Nf3: the line leaves the tree with 4...h6.
  const offTree = ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'Nf3', 'h6'];
  const withLine = (moves: string[]) => {
    const g = sample();
    g.variations[0]!.mistakes = [{ moves, text: 'x' }];
    return g;
  };
  /** Side to move is black before the move (best e7e6, even) and white after it (cp for white given). */
  const engineWith = (whiteCpAfter: number) =>
    vi.fn(async (...args: [fen: string, opts?: unknown]) => [args[0].split(' ')[1] === 'b' ? lineFor(0, ['e7e6']) : lineFor(whiteCpAfter, ['d4d5'])]);

  it('flags an own off-tree move that loses 15 win % or more, and uses newGame', async () => {
    const analyse = engineWith(600);
    const issues = await validateGuide(withLine(offTree), rep, { analyse } as never);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ rule: 'engine-loss' });
    expect(issues[0]!.detail).toContain('h6');
    expect(analyse).toHaveBeenCalled();
    for (const call of analyse.mock.calls) expect(call[1]).toMatchObject({ newGame: true });
  });

  it('accepts an off-tree own move with a small loss', async () => {
    expect(await validateGuide(withLine(offTree), rep, { analyse: engineWith(20) } as never)).toEqual([]);
  });

  it('does not check opponent moves or run the engine when every own move is a tree node', async () => {
    const analyse = engineWith(600);
    // White leaves the tree with 4.a3; black has no off-tree move.
    const g = withLine(['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'a3']);
    expect(await validateGuide(g, rep, { analyse } as never)).toEqual([]);
    expect(analyse).not.toHaveBeenCalled();
  });
});
