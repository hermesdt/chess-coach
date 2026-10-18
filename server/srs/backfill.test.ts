import { describe, expect, it, vi } from 'vitest';
import type { GameAnalysis, MoveAnalysis } from '../../shared/types.js';
import { saveAnalysis } from '../analysis/analysis-repo.js';
import { openDb } from '../db/db.js';
import type { EngineLine } from '../engine/uci.js';
import { waitForJob } from '../jobs.js';
import { backfillMistakeCards } from './backfill.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const blunder: MoveAnalysis = {
  ply: 1, san: 'a3', uci: 'a2a3', color: 'white', fenBefore: START,
  evalBefore: { cp: 0, mate: null }, evalAfter: { cp: 0, mate: null }, bestUci: 'e2e4', bestSan: 'e4', pvSan: [],
  winBefore: 80, winAfter: 40, winLoss: 40, classification: 'blunder', tags: [], isUserMove: true,
};
const analysis: GameAnalysis = {
  gameId: 1, version: 1, status: 'done', error: null, accuracyUser: null, accuracyOpp: null,
  counts: { blunder: 1, mistake: 0, inaccuracy: 0 }, moves: [blunder], keyMoments: [], analysedAt: 1,
};
const lines: EngineLine[] = [
  { multipv: 1, score: { cp: 300, mate: null }, pv: ['e2e4'] },
  { multipv: 2, score: { cp: -300, mate: null }, pv: ['a2a4'] },
];

function setup() {
  const db = openDb(':memory:');
  db.exec(`INSERT INTO games (id, source, source_id, played_at, time_class, rated, white, black, pgn, ply_count, imported_at)
    VALUES (1, 'chesscom', 'a', 1, 'blitz', 1, 'Me', 'Opp', '*', 2, 1)`);
  saveAnalysis(db, analysis);
  return db;
}
const built = (db: ReturnType<typeof openDb>) =>
  (db.prepare('SELECT cards_built_at AS at FROM game_analysis WHERE game_id = 1').get() as { at: number | null }).at;
const cardCount = (db: ReturnType<typeof openDb>) => Number((db.prepare('SELECT COUNT(*) AS n FROM cards').get() as { n: number }).n);

describe('backfillMistakeCards', () => {
  it('builds cards for an analysis saved without cards and marks it', async () => {
    const db = setup();
    expect(built(db)).toBeNull();
    const { jobId } = backfillMistakeCards(db, { analyse: async () => lines }, { nodes: 1 });
    expect(jobId).not.toBeNull();
    await waitForJob(db, jobId as number);
    expect(cardCount(db)).toBe(1);
    expect(built(db)).not.toBeNull();
    expect(backfillMistakeCards(db, { analyse: async () => lines }, { nodes: 1 })).toEqual({ jobId: null });
  });

  it('leaves the analysis unmarked when the build fails', async () => {
    const db = setup();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { jobId } = backfillMistakeCards(db, { analyse: async () => { throw new Error('boom'); } }, { nodes: 1 });
    const job = await waitForJob(db, jobId as number);
    expect(job.status).toBe('done');
    expect(built(db)).toBeNull();
    expect(cardCount(db)).toBe(0);
    log.mockRestore();
  });
});
