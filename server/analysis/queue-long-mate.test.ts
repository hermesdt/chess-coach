import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { NewGame } from '../../shared/types.js';
import { openDb } from '../db/db.js';
import { insertGames } from '../db/games-repo.js';
import type { EngineLine } from '../engine/uci.js';
import { waitForJob } from '../jobs.js';
import { listCardsByKind } from '../srs/cards-repo.js';
import { enqueueAnalysis } from './queue.js';

// Black plays Kh7 and reaches L3 (White mates in 3). White plays Kf2 and misses it.
const START = '8/6k1/8/8/8/8/R7/1R4K1 b - - 0 1';
const pgn = `[Event "x"]\n[SetUp "1"]\n[FEN "${START}"]\n\n1... Kh7 2. Kf2 *`;
const game: NewGame = {
  source: 'chesscom', sourceId: 'g1', playedAt: 1000, timeClass: 'blitz', rated: true,
  white: 'Me', black: 'Opp', whiteElo: 1500, blackElo: 1500, userColor: 'white', result: 'win', termination: null,
  eco: null, openingName: null, pgn, url: null, plyCount: 2,
};

/** Key on the first four FEN fields: positions in the game carry other move counters than the fixture. */
const key = (fen: string): string => fen.split(' ').slice(0, 4).join(' ');
const recorded = JSON.parse(readFileSync(new URL('../srs/__fixtures__/long-mates-engine.json', import.meta.url), 'utf8')) as Record<string, EngineLine[]>;
const table: Record<string, EngineLine[]> = Object.fromEntries(Object.entries(recorded).map(([fen, lines]) => [key(fen), lines]));
table[key(START)] = [{ multipv: 1, score: { cp: null, mate: -3 }, pv: ['g7h7'] }];
// After Kf2 the mate is gone in the engine's view (Black to move).
table['8/7k/8/8/8/8/R4K2/1R6 b - -'] = [{ multipv: 1, score: { cp: -900, mate: null }, pv: ['h7g6'] }];
const pool = {
  analyse: async (fen: string): Promise<EngineLine[]> => {
    const lines = table[key(fen)];
    if (!lines) throw new Error(`unexpected FEN ${fen}`);
    return lines;
  },
};
const builtAt = (db: ReturnType<typeof openDb>) =>
  (db.prepare('SELECT long_mate_cards_built_at AS at FROM game_analysis WHERE game_id = 1').get() as { at: number | null }).at;

describe('analysis job and long mate cards', () => {
  it('builds a long mate card and no threat or mistake card at that ply', async () => {
    const db = openDb(':memory:');
    insertGames(db, [game]);
    const { jobId } = enqueueAnalysis(db, [1], { pool, nodes: 1 });
    const job = await waitForJob(db, jobId as number);
    expect(job.message).not.toContain('failed');
    const mates = listCardsByKind(db, 'mate').filter((c) => !c.suspended);
    expect(mates).toHaveLength(1);
    expect(mates[0]!.solution.mateIn).toBe(3);
    expect(mates[0]!.refs).toEqual([{ gameId: 1, ply: 2 }]);
    expect(listCardsByKind(db, 'mistake').filter((c) => !c.suspended)).toHaveLength(0);
    expect(listCardsByKind(db, 'threat').filter((c) => !c.suspended)).toHaveLength(0);
    expect(builtAt(db)).not.toBeNull();
  });

  it('a long mate failure does not stop the other cards', async () => {
    const db = openDb(':memory:');
    insertGames(db, [game]);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let analysed = false;
    const failing = {
      analyse: async (fen: string, o: { multipv?: number }) => {
        // The game analysis runs first; the proof asks for MultiPV 5.
        if (o.multipv === 5) throw new Error('boom');
        analysed = true;
        return pool.analyse(fen);
      },
    };
    const { jobId } = enqueueAnalysis(db, [1], { pool: failing, nodes: 1 });
    const job = await waitForJob(db, jobId as number);
    expect(analysed).toBe(true);
    expect(job.message).toContain('(long mate cards: failed)');
    expect(job.message).not.toContain('(cards: failed)');
    expect(listCardsByKind(db, 'mate')).toHaveLength(0);
    expect(builtAt(db)).toBeNull();
    log.mockRestore();
  });
});
