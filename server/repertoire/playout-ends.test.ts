import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import type { EngineScore } from '../../shared/types.js';
import { openDb } from '../db/db.js';
import type { EngineLines } from '../engine/uci.js';
import { waitForJob } from '../jobs.js';
import { listCardsByKind } from '../srs/cards-repo.js';
import { PLAYOUT_PROMPT } from '../srs/playout-cards.js';
import { loadRepertoire } from './load.js';
import { backfillRepertoirePlayoutCards, buildRepertoirePlayoutCards, repertoireEnds } from './playout-ends.js';

const rep = loadRepertoire({
  id: 'test-white', name: 'Test', color: 'white',
  moves: [{ san: 'e4', children: [
    { san: 'e5', children: [{ san: 'Nf3', children: [{ san: 'Nc6', level: 2, children: [{ san: 'Bb5', level: 2 }] }] }] },
    { san: 'c5' },
  ] }],
});
const fenOf = (...sans: string[]): string => {
  const chess = new Chess();
  for (const s of sans) chess.move(s);
  return chess.fen();
};
const AFTER_NF3 = fenOf('e4', 'e5', 'Nf3');
const AFTER_NF6 = fenOf('e4', 'e5', 'Nf3', 'Nf6');
const AFTER_C5 = fenOf('e4', 'c5');

function fakePool(table: Record<string, { score: EngineScore; pv: string[] }>) {
  const calls: string[] = [];
  return {
    calls,
    analyse: async (fen: string): Promise<EngineLines> => {
      calls.push(fen);
      const row = table[fen];
      if (!row) throw new Error(`no line for ${fen}`);
      return [{ multipv: 1, ...row }];
    },
  };
}
const cp = (n: number): EngineScore => ({ cp: n, mate: null });

describe('repertoireEnds', () => {
  it('returns leaves at the level and stops at locked children', () => {
    expect(repertoireEnds(rep, 1).map((n) => n.id)).toEqual(['e4 e5 Nf3', 'e4 c5']);
    expect(repertoireEnds(rep, 2).map((n) => n.id)).toEqual(['e4 e5 Nf3 Nc6 Bb5', 'e4 c5']);
  });
});

describe('buildRepertoirePlayoutCards', () => {
  it('owner-last end: Stockfish reply is played and stored as lastMove', async () => {
    const db = openDb(':memory:');
    // Black to move after Nf3: -20 for Black is +20 for the owner.
    const pool = fakePool({ [AFTER_NF3]: { score: cp(-20), pv: ['g8f6'] }, [AFTER_C5]: { score: cp(0), pv: ['g1f3'] } });
    expect(await buildRepertoirePlayoutCards(db, [rep], 1, pool)).toEqual({ created: 2, skipped: 0 });
    const card = listCardsByKind(db, 'playout').find((c) => c.fen === AFTER_NF6)!;
    expect(card).toMatchObject({
      sideToMove: 'white', prompt: PLAYOUT_PROMPT, lastMove: { uci: 'g8f6' },
      refs: [{ repertoire: 'test-white', nodeId: 'e4 e5 Nf3' }], solution: { accepted: [], best: '', explanation: null },
    });
  });

  it('opponent-last end: fenAfter is the start', async () => {
    const db = openDb(':memory:');
    const pool = fakePool({ [AFTER_NF3]: { score: cp(-20), pv: ['g8f6'] }, [AFTER_C5]: { score: cp(0), pv: ['g1f3'] } });
    await buildRepertoirePlayoutCards(db, [rep], 1, pool);
    expect(listCardsByKind(db, 'playout').find((c) => c.fen === AFTER_C5)).toMatchObject({
      lastMove: { uci: 'c7c5' }, refs: [{ repertoire: 'test-white', nodeId: 'e4 c5' }],
    });
  });

  it('skips starts outside 25–75 win %', async () => {
    const db = openDb(':memory:');
    const pool = fakePool({ [AFTER_NF3]: { score: cp(-900), pv: ['g8f6'] }, [AFTER_C5]: { score: cp(-900), pv: ['g1f3'] } });
    expect(await buildRepertoirePlayoutCards(db, [rep], 1, pool)).toEqual({ created: 0, skipped: 2 });
    expect(listCardsByKind(db, 'playout')).toEqual([]);
  });

  it('checks each end once: a second run makes no engine call', async () => {
    const db = openDb(':memory:');
    const pool = fakePool({ [AFTER_NF3]: { score: cp(-900), pv: ['g8f6'] }, [AFTER_C5]: { score: cp(0), pv: ['g1f3'] } });
    await buildRepertoirePlayoutCards(db, [rep], 1, pool);
    pool.calls.length = 0;
    expect(await buildRepertoirePlayoutCards(db, [rep], 1, pool)).toEqual({ created: 0, skipped: 0 });
    expect(pool.calls).toEqual([]);
  });
});

describe('backfillRepertoirePlayoutCards', () => {
  it('runs the build as a job, then has nothing left to do', async () => {
    const db = openDb(':memory:');
    const pool = fakePool({ [AFTER_NF3]: { score: cp(-20), pv: ['g8f6'] }, [AFTER_C5]: { score: cp(0), pv: ['g1f3'] } });
    const { jobId } = backfillRepertoirePlayoutCards(db, [rep], pool);
    expect(jobId).not.toBeNull();
    expect((await waitForJob(db, jobId as number)).status).toBe('done');
    expect(listCardsByKind(db, 'playout')).toHaveLength(2);
    expect(backfillRepertoirePlayoutCards(db, [rep], pool)).toEqual({ jobId: null });
  });
});
