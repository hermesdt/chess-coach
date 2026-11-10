import { describe, expect, it, vi } from 'vitest';
import type { NewGame } from '../../shared/types.js';
import { openDb } from '../db/db.js';
import { insertGames } from '../db/games-repo.js';
import type { EngineLine } from '../engine/uci.js';
import { waitForJob } from '../jobs.js';
import { listCardsByKind } from '../srs/cards-repo.js';
import { enqueueAnalysis } from './queue.js';

const START = '3k4/8/1b6/8/3Q4/8/8/4K3 b - - 0 1';
// Black plays Ke8. White plays Ke2 and ignores Bxd4, which takes the queen.
const pgn = `[Event "x"]\n[SetUp "1"]\n[FEN "${START}"]\n\n1... Ke8 2. Ke2 Bxd4 *`;
const game: NewGame = {
  source: 'chesscom', sourceId: 'g1', playedAt: 1000, timeClass: 'blitz', rated: true,
  white: 'Me', black: 'Opp', whiteElo: 1500, blackElo: 1500, userColor: 'white', result: 'loss', termination: null,
  eco: null, openingName: null, pgn, url: null, plyCount: 3,
};

const line = (pv: string[], cp: number, multipv = 1): EngineLine => ({ multipv, score: { cp, mate: null }, pv });
const A = '4k3/8/1b6/8/3Q4/8/8/4K3 w';
const A_NULL = '4k3/8/1b6/8/3Q4/8/8/4K3 b';
const table: Record<string, EngineLine[]> = {
  '3k4/8/1b6/8/3Q4/8/8/4K3 b': [line(['d8e8'], -600)],
  [A]: [line(['d4b6'], 600, 1), line(['d4d1'], 580, 2), line(['e1e2'], -900, 3)],
  [A_NULL]: [line(['b6d4'], 900, 1), line(['e8d8'], 880, 2)],
  '4k3/8/1b6/8/3Q4/8/4K3/8 b': [line(['b6d4'], 900)],
  '4k3/8/8/8/3b4/8/4K3/8 w': [line(['e2e3'], -300)],
};
const key = (fen: string): string => fen.split(' ').slice(0, 2).join(' ');
const pool = {
  analyse: async (fen: string): Promise<EngineLine[]> => {
    const lines = table[key(fen)];
    if (!lines) throw new Error(`unexpected FEN ${fen}`);
    return lines;
  },
};
const builtAt = (db: ReturnType<typeof openDb>) =>
  (db.prepare('SELECT threat_cards_built_at AS at FROM game_analysis WHERE game_id = 1').get() as { at: number | null }).at;

describe('analysis job and threat cards', () => {
  it('queue builds threat cards between mate and mistake cards', async () => {
    const db = openDb(':memory:');
    insertGames(db, [game]);
    const { jobId } = enqueueAnalysis(db, [1], { pool, nodes: 1 });
    const job = await waitForJob(db, jobId as number);
    expect(job.message).not.toContain('failed');
    const threats = listCardsByKind(db, 'threat').filter((c) => !c.suspended);
    expect(threats).toHaveLength(1);
    expect(threats[0]!.refs).toEqual([{ gameId: 1, ply: 2 }]);
    expect(listCardsByKind(db, 'mistake').filter((c) => !c.suspended)).toHaveLength(0);
    expect(builtAt(db)).not.toBeNull();
  });

  it('a threat card failure does not stop mistake cards', async () => {
    const db = openDb(':memory:');
    insertGames(db, [game]);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failing = {
      analyse: async (fen: string) => {
        if (key(fen) === key(A_NULL)) throw new Error('boom');
        return pool.analyse(fen);
      },
    };
    const { jobId } = enqueueAnalysis(db, [1], { pool: failing, nodes: 1 });
    const job = await waitForJob(db, jobId as number);
    expect(job.message).toContain('(threat cards: failed)');
    expect(job.message).not.toContain('(cards: failed)');
    expect(listCardsByKind(db, 'mistake').filter((c) => !c.suspended)).toHaveLength(1);
    expect(listCardsByKind(db, 'threat')).toHaveLength(0);
    expect(builtAt(db)).toBeNull();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
