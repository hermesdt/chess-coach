import { afterAll, describe, expect, it } from 'vitest';
import { closeEnginePool, lazyEnginePool } from '../server/engine/pool.js';
import { isStockfishAvailable } from '../server/engine/stockfish-path.js';
import type { EngineLine } from '../server/engine/uci.js';
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
