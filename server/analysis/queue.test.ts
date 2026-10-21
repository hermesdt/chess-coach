import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { EngineScore, NewGame } from '../../shared/types.js';
import { openDb } from '../db/db.js';
import { insertGames, listGames } from '../db/games-repo.js';
import type { EngineLine } from '../engine/uci.js';
import { waitForJob } from '../jobs.js';
import { ANALYSIS_VERSION, getAnalysis, markAnalysis } from './analysis-repo.js';
import { eligibleUnanalysed, enqueueAnalysis, requeuePending } from './queue.js';
import { getCard } from '../srs/cards-repo.js';
import { recordReview } from '../srs/cards-repo.js';

const SANS = 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O O-O';
const pgn = `[Event "x"]\n\n${SANS.split(' ').map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${s}` : s)).join(' ')} *`;
const game = (id: string, over: Partial<NewGame> = {}): NewGame => ({
  source: 'chesscom', sourceId: id, playedAt: Number(id.slice(1)) * 1000, timeClass: 'blitz', rated: true,
  white: 'Me', black: `Opp${id}`, whiteElo: 1500, blackElo: 1500, userColor: 'white', result: 'win', termination: null,
  eco: null, openingName: null, pgn, url: null, plyCount: 12, ...over,
});

const score = (cp: number): EngineScore => ({ cp, mate: null });
function fakePool(failOn?: (fen: string) => boolean) {
  const gate = { release: (): void => undefined, wait: null as Promise<void> | null };
  return {
    gate,
    calls: 0,
    async analyse(fen: string): Promise<EngineLine[]> {
      this.calls += 1;
      if (gate.wait) await gate.wait;
      if (failOn?.(fen)) throw new Error('engine crashed');
      return [{ multipv: 1, score: score(0), pv: [] }];
    },
  };
}

let db: DatabaseSync;
const ids = (): number[] => listGames(db, {}).items.map((g) => g.id);
beforeEach(() => {
  db = openDb(':memory:');
});

describe('eligibleUnanalysed', () => {
  it('needs a user colour and at least 6 user moves, newest first', () => {
    insertGames(db, [
      game('g1'),
      game('g2', { userColor: null, result: null }),
      game('g3', { plyCount: 10 }),
      game('g4', { plyCount: 11 }),
      game('g5', { userColor: 'black', plyCount: 11 }),
      game('g6', { userColor: 'black', plyCount: 12 }),
    ]);
    const bySource = (list: number[]) => list.map((id) => listGames(db, {}).items.find((g) => g.id === id)!.sourceId);
    expect(bySource(eligibleUnanalysed(db, 10))).toEqual(['g6', 'g4', 'g1']);
    expect(eligibleUnanalysed(db, 2)).toHaveLength(2);
  });

  it('skips games done at the current version only', () => {
    insertGames(db, [game('g1'), game('g2'), game('g3')]);
    const [a, b, c] = ids().reverse() as [number, number, number];
    markAnalysis(db, a, 'done');
    markAnalysis(db, b, 'error', 'boom');
    markAnalysis(db, c, 'done');
    db.prepare('UPDATE game_analysis SET version = ? WHERE game_id = ?').run(ANALYSIS_VERSION - 1, c);
    // Errors at the current version are not retried automatically.
    expect(eligibleUnanalysed(db, 10)).toEqual([c]);
  });
});

describe('enqueueAnalysis', () => {
  it('analyses games, reports progress and continues after an error', async () => {
    insertGames(db, [game('g1'), game('g2')]);
    const [second, first] = ids() as [number, number];
    // The newest game is analysed first. Its 13 positions are all requested at once, so fail those.
    const pool = fakePool(() => pool.calls <= 13);
    const { jobId, queued } = enqueueAnalysis(db, [second, first], { pool, nodes: 1000 });
    expect(queued).toBe(2);
    const job = await waitForJob(db, jobId!);
    expect(job).toMatchObject({ status: 'done', message: 'Analysed 2 of 2', progress: 2, total: 2 });
    expect(getAnalysis(db, second)).toMatchObject({ status: 'error', error: 'engine crashed' });
    expect(getAnalysis(db, first)).toMatchObject({ status: 'done', error: null });
  });

  it('appends to the running job instead of starting a second one', async () => {
    insertGames(db, [game('g1'), game('g2'), game('g3')]);
    const [c, b, a] = ids() as [number, number, number];
    const pool = fakePool();
    pool.gate.wait = new Promise<void>((resolve) => { pool.gate.release = resolve; });
    const first = enqueueAnalysis(db, [a], { pool, nodes: 1000 });
    const second = enqueueAnalysis(db, [a, b, c], { pool, nodes: 1000 });
    expect(second).toEqual({ jobId: first.jobId, queued: 2 });
    pool.gate.release();
    const job = await waitForJob(db, first.jobId!);
    expect(job.message).toBe('Analysed 3 of 3');
    expect(getAnalysis(db, c)?.status).toBe('done');
    // After the job ends a new enqueue starts a new job.
    expect(enqueueAnalysis(db, [a], { pool, nodes: 1000 })).toEqual({ jobId: null, queued: 0 });
    markAnalysis(db, a, 'error', 'x');
    const third = enqueueAnalysis(db, [a], { pool, nodes: 1000 }, { priority: true });
    expect(third.jobId).not.toBe(first.jobId);
    await waitForJob(db, third.jobId!);
  });

  it('skips ids already done at the current version', async () => {
    insertGames(db, [game('g1'), game('g2')]);
    const [b, a] = ids() as [number, number];
    markAnalysis(db, a, 'done');
    const pool = fakePool();
    const res = enqueueAnalysis(db, [a, b], { pool, nodes: 1000 });
    expect(res.queued).toBe(1);
    expect((await waitForJob(db, res.jobId!)).message).toBe('Analysed 1 of 1');
    expect(getAnalysis(db, a)?.moves).toEqual([]);
  });

  it('creates no job when there is nothing to queue and nothing running', () => {
    expect(enqueueAnalysis(db, [], { pool: fakePool() })).toEqual({ jobId: null, queued: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE kind = 'analysis'").get()!.n).toBe(0);
  });

  it('returns the running job when nothing new is queued', async () => {
    insertGames(db, [game('g1')]);
    const [a] = ids() as [number];
    const pool = fakePool();
    pool.gate.wait = new Promise<void>((resolve) => { pool.gate.release = resolve; });
    const first = enqueueAnalysis(db, [a], { pool, nodes: 1000 });
    expect(enqueueAnalysis(db, [a], { pool, nodes: 1000 })).toEqual({ jobId: first.jobId, queued: 0 });
    pool.gate.release();
    await waitForJob(db, first.jobId!);
  });

  it('analyses priority ids before earlier queued ids, in the given order', async () => {
    insertGames(db, [game('g1'), game('g2'), game('g3'), game('g4')]);
    const [d, c, b, a] = ids() as [number, number, number, number];
    const order: number[] = [];
    const pool = fakePool();
    const inner = pool.analyse.bind(pool);
    pool.analyse = async (fen: string) => {
      const row = db.prepare("SELECT game_id FROM game_analysis WHERE status = 'running'").get()!;
      if (!order.includes(row.game_id as number)) order.push(row.game_id as number);
      return inner(fen);
    };
    pool.gate.wait = new Promise<void>((resolve) => { pool.gate.release = resolve; });
    const first = enqueueAnalysis(db, [a], { pool, nodes: 1000 });
    enqueueAnalysis(db, [b], { pool, nodes: 1000 });
    const res = enqueueAnalysis(db, [d, c], { pool, nodes: 1000 }, { priority: true });
    expect(res).toEqual({ jobId: first.jobId, queued: 2 });
    pool.gate.release();
    expect((await waitForJob(db, first.jobId!)).message).toBe('Analysed 4 of 4');
    expect(order).toEqual([a, d, c, b]);
  });

  it('moves an already pending id to the front on a priority request', async () => {
    insertGames(db, [game('g1'), game('g2'), game('g3')]);
    const [c, b, a] = ids() as [number, number, number];
    const order: number[] = [];
    const pool = fakePool();
    const inner = pool.analyse.bind(pool);
    pool.analyse = async (fen: string) => {
      const row = db.prepare("SELECT game_id FROM game_analysis WHERE status = 'running'").get()!;
      if (!order.includes(row.game_id as number)) order.push(row.game_id as number);
      return inner(fen);
    };
    pool.gate.wait = new Promise<void>((resolve) => { pool.gate.release = resolve; });
    const first = enqueueAnalysis(db, [a, b, c], { pool, nodes: 1000 });
    expect(enqueueAnalysis(db, [c], { pool, nodes: 1000 }, { priority: true }).queued).toBe(0);
    pool.gate.release();
    expect((await waitForJob(db, first.jobId!)).message).toBe('Analysed 3 of 3');
    expect(order).toEqual([a, c, b]);
  });

  it('keeps appended ids in newest-first order', async () => {
    insertGames(db, [game('g1'), game('g2'), game('g3'), game('g4')]);
    const [d, c, b, a] = ids() as [number, number, number, number];
    const order: number[] = [];
    const pool = fakePool();
    const inner = pool.analyse.bind(pool);
    pool.analyse = async (fen: string) => {
      const row = db.prepare("SELECT game_id FROM game_analysis WHERE status = 'running'").get()!;
      if (!order.includes(row.game_id as number)) order.push(row.game_id as number);
      return inner(fen);
    };
    pool.gate.wait = new Promise<void>((resolve) => { pool.gate.release = resolve; });
    const first = enqueueAnalysis(db, [a], { pool, nodes: 1000 });
    enqueueAnalysis(db, [b], { pool, nodes: 1000 });
    enqueueAnalysis(db, [d], { pool, nodes: 1000 });
    enqueueAnalysis(db, [c], { pool, nodes: 1000 });
    pool.gate.release();
    await waitForJob(db, first.jobId!);
    expect(order).toEqual([a, d, c, b]);
  });

  it('re-queues an errored game on an explicit priority request', async () => {
    insertGames(db, [game('g1')]);
    const [a] = ids() as [number];
    markAnalysis(db, a, 'error', 'boom');
    const res = enqueueAnalysis(db, [a], { pool: fakePool(), nodes: 1000 }, { priority: true });
    expect(res.queued).toBe(1);
    await waitForJob(db, res.jobId!);
    expect(getAnalysis(db, a)).toMatchObject({ status: 'done', error: null });
  });

  it('re-queues a game that already failed in the running job', async () => {
    insertGames(db, [game('g1'), game('g2')]);
    const [b, a] = ids() as [number, number];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    const pool = {
      async analyse(): Promise<EngineLine[]> {
        calls += 1;
        if (calls <= 13) throw new Error('engine crashed');
        if (calls === 14) await gate;
        return [{ multipv: 1, score: score(0), pv: [] }];
      },
    };
    const run = enqueueAnalysis(db, [b, a], { pool, nodes: 1000 });
    // b fails, then a blocks on the gate while b is already in the seen set.
    for (let i = 0; i < 100 && getAnalysis(db, b)?.status !== 'error'; i += 1) await new Promise((r) => setTimeout(r, 5));
    expect(getAnalysis(db, b)?.status).toBe('error');
    expect(enqueueAnalysis(db, [b], { pool, nodes: 1000 })).toEqual({ jobId: run.jobId, queued: 0 });
    const again = enqueueAnalysis(db, [b], { pool, nodes: 1000 }, { priority: true });
    expect(again).toEqual({ jobId: run.jobId, queued: 1 });
    release();
    expect((await waitForJob(db, run.jobId!)).message).toBe('Analysed 3 of 3');
    expect(getAnalysis(db, b)?.status).toBe('done');
  });
});

describe('requeuePending', () => {
  it('re-queues pending and running rows after a restart', async () => {
    insertGames(db, [game('g1'), game('g2'), game('g3')]);
    const [c, b, a] = ids() as [number, number, number];
    markAnalysis(db, a, 'running');
    markAnalysis(db, b, 'pending');
    markAnalysis(db, c, 'error', 'x');
    const res = requeuePending(db, { pool: fakePool(), nodes: 1000 });
    expect(res?.queued).toBe(2);
    await waitForJob(db, res!.jobId!);
    expect(getAnalysis(db, a)?.status).toBe('done');
    expect(getAnalysis(db, b)?.status).toBe('done');
    expect(getAnalysis(db, c)?.status).toBe('error');
    expect(requeuePending(db, { pool: fakePool() })).toBeNull();
  });

  it('re-queues newest games first', async () => {
    insertGames(db, [game('g1'), game('g2')]);
    const [b, a] = ids() as [number, number];
    markAnalysis(db, a, 'pending');
    markAnalysis(db, b, 'pending');
    const order: number[] = [];
    const pool = fakePool();
    const inner = pool.analyse.bind(pool);
    pool.analyse = async (fen: string) => {
      const row = db.prepare("SELECT game_id FROM game_analysis WHERE status = 'running'").get()!;
      if (!order.includes(row.game_id as number)) order.push(row.game_id as number);
      return inner(fen);
    };
    await waitForJob(db, requeuePending(db, { pool, nodes: 1000 })!.jobId!);
    expect(order).toEqual([b, a]);
  });
});

describe('analysis version bump', () => {
  /** Marks a game as analysed by the previous analysis version. */
  const makeOutdated = (id: number): void => {
    markAnalysis(db, id, 'done');
    db.prepare('UPDATE game_analysis SET version = ? WHERE game_id = ?').run(ANALYSIS_VERSION - 1, id);
  };
  const orderOf = (pool: ReturnType<typeof fakePool>): number[] => {
    const order: number[] = [];
    const inner = pool.analyse.bind(pool);
    pool.analyse = async (fen: string) => {
      const row = db.prepare("SELECT game_id FROM game_analysis WHERE status = 'running'").get()!;
      if (!order.includes(row.game_id as number)) order.push(row.game_id as number);
      return inner(fen);
    };
    return order;
  };

  it('lists never-analysed games before games with an older analysis, newest first inside each group', () => {
    insertGames(db, [game('g1'), game('g2'), game('g3'), game('g4')]);
    const [d, c, b, a] = ids() as [number, number, number, number];
    makeOutdated(d);
    makeOutdated(b);
    // a and c were never analysed. d and b have a version 1 analysis and are newer than a.
    expect(eligibleUnanalysed(db, 10)).toEqual([c, a, d, b]);
    expect(eligibleUnanalysed(db, 2)).toEqual([c, a]);
  });

  it('runs never-analysed games first, also when the outdated games are newer or queued first', async () => {
    insertGames(db, [game('g1'), game('g2'), game('g3'), game('g4')]);
    const [d, c, b, a] = ids() as [number, number, number, number];
    makeOutdated(d);
    makeOutdated(c);
    const pool = fakePool();
    const order = orderOf(pool);
    pool.gate.wait = new Promise<void>((resolve) => { pool.gate.release = resolve; });
    const first = enqueueAnalysis(db, [d, c, a], { pool, nodes: 1000 });
    // While the job runs, a second never-analysed game joins. It still goes before the outdated games.
    enqueueAnalysis(db, [b], { pool, nodes: 1000 });
    pool.gate.release();
    expect((await waitForJob(db, first.jobId!)).message).toBe('Analysed 4 of 4');
    expect(order).toEqual([a, b, d, c]);
    expect(eligibleUnanalysed(db, 10)).toEqual([]);
  });

  it('re-analysis keeps the card id, the FSRS state and the review history', async () => {
    insertGames(db, [game('g1')]);
    const [a] = ids() as [number];
    const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    // The start position is a +300 position where 1.e4 loses a lot, so ply 1 is a blunder and gets a mistake card.
    const pool = {
      async analyse(fen: string, opts: { multipv?: number }): Promise<EngineLine[]> {
        if (fen === START) {
          const lines = [{ multipv: 1, score: score(300), pv: ['d2d4'] }, { multipv: 2, score: score(296), pv: ['g1f3'] }, { multipv: 3, score: score(-200), pv: ['a2a3'] }];
          return lines.slice(0, opts.multipv ?? 1);
        }
        return [{ multipv: 1, score: score(fen.startsWith('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b ') ? 300 : 0), pv: [] }];
      },
    };
    await waitForJob(db, enqueueAnalysis(db, [a], { pool, nodes: 1000 }).jobId!);
    const cards = db.prepare("SELECT id FROM cards WHERE kind = 'mistake'").all();
    expect(cards).toHaveLength(1);
    const cardId = cards[0]!.id as number;
    recordReview(db, cardId, { rating: 'good', answerUci: 'd2d4', durationMs: 900 }, 5000);
    const fsrs = db.prepare('SELECT fsrs_json, due FROM card_state WHERE card_id = ?').get(cardId);
    const reviews = db.prepare('SELECT * FROM reviews WHERE card_id = ?').all(cardId);
    expect(reviews).toHaveLength(1);

    // Version 1 analysis: re-queued, rebuilt through the upsert.
    db.prepare('UPDATE game_analysis SET version = ?, cards_built_at = NULL WHERE game_id = ?').run(ANALYSIS_VERSION - 1, a);
    expect(eligibleUnanalysed(db, 10)).toEqual([a]);
    const res = enqueueAnalysis(db, eligibleUnanalysed(db, 10), { pool, nodes: 1000 });
    expect(res.queued).toBe(1);
    await waitForJob(db, res.jobId!);

    expect(getAnalysis(db, a)).toMatchObject({ status: 'done', version: ANALYSIS_VERSION });
    expect(db.prepare("SELECT id FROM cards WHERE kind = 'mistake'").all()).toEqual([{ id: cardId }]);
    expect(getCard(db, cardId)?.suspended).toBe(false);
    expect(db.prepare('SELECT fsrs_json, due FROM card_state WHERE card_id = ?').get(cardId)).toEqual(fsrs);
    expect(db.prepare('SELECT * FROM reviews WHERE card_id = ?').all(cardId)).toEqual(reviews);
    expect(db.prepare('SELECT COUNT(*) AS n FROM game_analysis').get()).toEqual({ n: 1 });
    expect(eligibleUnanalysed(db, 10)).toEqual([]);
  });
});
