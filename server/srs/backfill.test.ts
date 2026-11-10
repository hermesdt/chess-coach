import { describe, expect, it, vi } from 'vitest';
import type { GameAnalysis, MoveAnalysis } from '../../shared/types.js';
import { ANALYSIS_VERSION, saveAnalysis } from '../analysis/analysis-repo.js';
import { openDb } from '../db/db.js';
import type { EngineLine } from '../engine/uci.js';
import { waitForJob } from '../jobs.js';
import { backfillMistakeCards, backfillThreatCards } from './backfill.js';
import { listCardsByKind } from './cards-repo.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const blunder: MoveAnalysis = {
  ply: 1, san: 'a3', uci: 'a2a3', color: 'white', fenBefore: START,
  evalBefore: { cp: 0, mate: null }, evalAfter: { cp: 0, mate: null }, bestUci: 'e2e4', bestSan: 'e4', pvSan: [],
  winBefore: 80, winAfter: 40, winLoss: 40, classification: 'blunder', tags: [], isUserMove: true,
};
const analysis: GameAnalysis = {
  gameId: 1, version: ANALYSIS_VERSION, status: 'done', error: null, accuracyUser: null, accuracyOpp: null,
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

// Threat position: White (user) plays Ke2 at ply 2 and ignores Bxd4.
const A = '4k3/8/1b6/8/3Q4/8/8/4K3 w';
const A_NULL = '4k3/8/1b6/8/3Q4/8/8/4K3 b';
const line = (pv: string[], cp: number, multipv = 1): EngineLine => ({ multipv, score: { cp, mate: null }, pv });
const threatPool = {
  analyse: async (fen: string): Promise<EngineLine[]> => {
    const k = fen.split(' ').slice(0, 2).join(' ');
    if (k === A) return [line(['d4b6'], 600, 1), line(['d4d1'], 580, 2), line(['e1e2'], -900, 3)];
    if (k === A_NULL) return [line(['b6d4'], 900, 1), line(['e8d8'], 880, 2)];
    throw new Error(`unexpected FEN ${fen}`);
  },
};
const mv = (over: Partial<MoveAnalysis>): MoveAnalysis => ({ ...blunder, ...over });
const threatAnalysis: GameAnalysis = {
  ...analysis,
  moves: [
    mv({ ply: 1, san: 'Ke8', uci: 'd8e8', color: 'black', fenBefore: '3k4/8/1b6/8/3Q4/8/8/4K3 b - - 0 1', isUserMove: false, classification: 'good' }),
    mv({ ply: 2, san: 'Ke2', uci: 'e1e2', fenBefore: `${A} - - 0 1`, bestUci: 'd4b6', bestSan: 'Qxb6' }),
    mv({ ply: 3, san: 'Bxd4', uci: 'b6d4', color: 'black', fenBefore: '4k3/8/1b6/8/3Q4/8/4K3/8 b - - 0 1', isUserMove: false, bestUci: 'b6d4', classification: 'good' }),
  ],
};
function setupThreat() {
  const db = openDb(':memory:');
  db.exec(`INSERT INTO games (id, source, source_id, played_at, time_class, rated, white, black, pgn, ply_count, imported_at)
    VALUES (1, 'chesscom', 'a', 1, 'blitz', 1, 'Me', 'Opp', '*', 3, 1)`);
  saveAnalysis(db, threatAnalysis);
  return db;
}
const threatBuilt = (db: ReturnType<typeof openDb>) =>
  (db.prepare('SELECT threat_cards_built_at AS at FROM game_analysis WHERE game_id = 1').get() as { at: number | null }).at;

describe('backfillThreatCards', () => {
  it('builds once', async () => {
    const db = setupThreat();
    expect(threatBuilt(db)).toBeNull();
    const { jobId } = backfillThreatCards(db, threatPool, { nodes: 1 });
    expect(jobId).not.toBeNull();
    await waitForJob(db, jobId as number);
    expect(listCardsByKind(db, 'threat')).toHaveLength(1);
    expect(threatBuilt(db)).not.toBeNull();
    expect(backfillThreatCards(db, threatPool, { nodes: 1 })).toEqual({ jobId: null });
  });

  it('runs while the mistake backfill runs and leaves no shared ply', async () => {
    const db = setupThreat();
    const a = backfillMistakeCards(db, threatPool, { nodes: 1 });
    const b = backfillThreatCards(db, threatPool, { nodes: 1 });
    expect(a.jobId).not.toBeNull();
    expect(b.jobId).not.toBeNull();
    await waitForJob(db, a.jobId as number);
    await waitForJob(db, b.jobId as number);
    expect(listCardsByKind(db, 'threat').filter((c) => !c.suspended)).toHaveLength(1);
    expect(listCardsByKind(db, 'mistake').filter((c) => !c.suspended)).toHaveLength(0);
  });

  it('leaves the game unmarked when the build fails', async () => {
    const db = setupThreat();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { jobId } = backfillThreatCards(db, { analyse: async () => { throw new Error('boom'); } }, { nodes: 1 });
    await waitForJob(db, jobId as number);
    expect(threatBuilt(db)).toBeNull();
    log.mockRestore();
  });
});
