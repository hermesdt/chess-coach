import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { GameAnalysis } from '../../shared/types.js';
import { ANALYSIS_VERSION, saveAnalysis } from '../analysis/analysis-repo.js';
import { openDb } from '../db/db.js';
import { blunderTrend } from './blunder-trend.js';

// Wednesday 18 November 2026, 12:00 local time.
const NOW = new Date(2026, 10, 18, 12, 0, 0).getTime();
const at = (day: number, hour = 12, month = 10) => new Date(2026, month, day, hour, 0, 0).getTime();
const MON_16 = new Date(2026, 10, 16).getTime();
const MON_9 = new Date(2026, 10, 9).getTime();

let db: DatabaseSync;
let seq = 0;
beforeEach(() => {
  db = openDb(':memory:');
  seq = 0;
});

function addGame(playedAt: number, blunders: number, opts: { status?: GameAnalysis['status']; duplicateOf?: number } = {}): number {
  seq += 1;
  db.prepare(`INSERT INTO games (id, source, source_id, played_at, time_class, rated, white, black, pgn, ply_count, imported_at, duplicate_of)
    VALUES (?, 'chesscom', ?, ?, 'rapid', 1, 'Me', 'Opp', '*', 40, 1, ?)`).run(seq, `g${seq}`, playedAt, opts.duplicateOf ?? null);
  saveAnalysis(db, {
    gameId: seq, version: ANALYSIS_VERSION, status: opts.status ?? 'done', error: null, accuracyUser: null, accuracyOpp: null,
    counts: { blunder: blunders, mistake: 0, inaccuracy: 0 }, moves: [], keyMoments: [], analysedAt: 1,
  });
  return seq;
}

describe('blunderTrend', () => {
  it('is empty without analysed games', () => {
    expect(blunderTrend(db, NOW)).toEqual({ weeks: [], last4: null, prev4: null });
  });

  it('groups games by week, starting on Monday', () => {
    addGame(at(11), 3);
    addGame(at(15, 20), 1);
    addGame(at(16, 9), 2);
    expect(blunderTrend(db, NOW).weeks).toEqual([
      { weekStart: MON_9, games: 2, blunders: 4 },
      { weekStart: MON_16, games: 1, blunders: 2 },
    ]);
  });

  it('leaves out duplicates and unfinished analyses', () => {
    const first = addGame(at(16, 9), 2);
    addGame(at(16, 10), 5, { duplicateOf: first });
    addGame(at(16, 11), 7, { status: 'error' });
    expect(blunderTrend(db, NOW).weeks).toEqual([{ weekStart: MON_16, games: 1, blunders: 2 }]);
  });

  it('keeps only the last 12 weeks', () => {
    addGame(at(20, 12, 7), 9); // 20 August: more than 12 weeks before
    addGame(at(16, 9), 2);
    expect(blunderTrend(db, NOW).weeks).toHaveLength(1);
  });

  it('compares the last 4 weeks with the 4 weeks before', () => {
    addGame(at(11), 3);
    addGame(at(16, 9), 1);
    addGame(at(10, 12, 9), 4); // 10 October: 39 days before
    addGame(at(12, 12, 9), 2); // 12 October: 37 days before
    const t = blunderTrend(db, NOW);
    expect(t.last4).toBe(2);
    expect(t.prev4).toBe(3);
  });

  it('has no previous value when the 4 weeks before have no games', () => {
    addGame(at(16, 9), 1);
    expect(blunderTrend(db, NOW)).toMatchObject({ last4: 1, prev4: null });
  });
});
