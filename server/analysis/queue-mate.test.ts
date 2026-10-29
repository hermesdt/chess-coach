import { describe, expect, it, vi } from 'vitest';
import type { NewGame } from '../../shared/types.js';
import { openDb } from '../db/db.js';
import { insertGames } from '../db/games-repo.js';
import type { EngineLine } from '../engine/uci.js';
import { waitForJob } from '../jobs.js';
import { listCardsByKind } from '../srs/cards-repo.js';
import { getAnalysis } from './analysis-repo.js';
import { enqueueAnalysis } from './queue.js';

const FEN = '6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1';
// White has Ra8# and plays Ra7 instead.
const pgn = `[Event "x"]\n[SetUp "1"]\n[FEN "${FEN}"]\n\n1. Ra7 Kf8 *`;
const game: NewGame = {
  source: 'chesscom', sourceId: 'g1', playedAt: 1000, timeClass: 'blitz', rated: true,
  white: 'Me', black: 'Opp', whiteElo: 1500, blackElo: 1500, userColor: 'white', result: 'win', termination: null,
  eco: null, openingName: null, pgn, url: null, plyCount: 2,
};

const pool = {
  analyse: async (fen: string): Promise<EngineLine[]> => [
    fen.startsWith('6k1/5ppp/8/8/8/8/8/R3K3 w')
      ? { multipv: 1, score: { cp: null, mate: 1 }, pv: ['a1a8'] }
      : { multipv: 1, score: { cp: 0, mate: null }, pv: [] },
  ],
};

describe('analysis job and mate cards', () => {
  it('a finished analysis with a missed mate gives a mate card', async () => {
    const db = openDb(':memory:');
    insertGames(db, [game]);
    const { jobId } = enqueueAnalysis(db, [1], { pool, nodes: 1 });
    const job = await waitForJob(db, jobId as number);
    expect(job.status).toBe('done');
    expect(getAnalysis(db, 1)?.status).toBe('done');
    const cards = listCardsByKind(db, 'mate');
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ fen: FEN, refs: [{ gameId: 1, ply: 1 }] });
    expect(cards[0]!.solution.best).toBe('a1a8');
  });

  it('a failing mate build keeps the analysis done and notes it on the job', async () => {
    vi.resetModules();
    vi.doMock('../srs/mate-cards.js', () => ({ buildMateCards: () => { throw new Error('boom'); } }));
    const { enqueueAnalysis: enqueue } = await import('./queue.js');
    const db = openDb(':memory:');
    insertGames(db, [game]);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { jobId } = enqueue(db, [1], { pool, nodes: 1 });
    const job = await waitForJob(db, jobId as number);
    expect(job.message).toContain('(mate cards: failed)');
    expect(getAnalysis(db, 1)?.status).toBe('done');
    expect(log).toHaveBeenCalled();
    vi.doUnmock('../srs/mate-cards.js');
  });
});
