import { describe, expect, it, vi } from 'vitest';
import type { NewGame } from '../../shared/types.js';
import { openDb } from '../db/db.js';
import { insertGames } from '../db/games-repo.js';
import type { EngineLine } from '../engine/uci.js';
import { waitForJob } from '../jobs.js';
import { getAnalysis } from './analysis-repo.js';
import { enqueueAnalysis } from './queue.js';

vi.mock('../srs/mistake-cards.js', () => ({
  buildMistakeCards: vi.fn(async () => { throw new Error('boom'); }),
}));

const SANS = 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O O-O';
const pgn = `[Event "x"]\n\n${SANS.split(' ').map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${s}` : s)).join(' ')} *`;
const game: NewGame = {
  source: 'chesscom', sourceId: 'g1', playedAt: 1000, timeClass: 'blitz', rated: true,
  white: 'Me', black: 'Opp', whiteElo: 1500, blackElo: 1500, userColor: 'white', result: 'win', termination: null,
  eco: null, openingName: null, pgn, url: null, plyCount: 12,
};

describe('analysis job with failing card builder', () => {
  it('keeps the analysis done and notes the failure on the job', async () => {
    const db = openDb(':memory:');
    insertGames(db, [game]);
    const pool = { analyse: async (): Promise<EngineLine[]> => [{ multipv: 1, score: { cp: 0, mate: null }, pv: [] }] };
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { jobId } = enqueueAnalysis(db, [1], { pool, nodes: 1 });
    const job = await waitForJob(db, jobId as number);
    expect(job.status).toBe('done');
    expect(job.message).toBe('Analysed 1 of 1 (cards: failed)');
    expect(getAnalysis(db, 1)?.status).toBe('done');
    expect(log).toHaveBeenCalled();
  });
});
