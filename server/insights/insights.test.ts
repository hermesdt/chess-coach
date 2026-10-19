import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { GameAnalysis, MoveAnalysis, NewGame, Tag } from '../../shared/types.js';
import { saveAnalysis } from '../analysis/analysis-repo.js';
import { openDb } from '../db/db.js';
import { insertGames } from '../db/games-repo.js';
import { getInsights, openingGroup } from './insights.js';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 18, 12);

function game(over: Partial<NewGame>): NewGame {
  return {
    source: 'chesscom', sourceId: 'a', playedAt: NOW - DAY, timeClass: 'blitz', rated: true,
    white: 'Me', black: `Opp-${over.sourceId ?? 'a'}`, whiteElo: 550, blackElo: 600, userColor: 'white', result: 'win',
    termination: 'resigned', eco: 'B12', openingName: 'Caro-Kann Defense: Advance Variation', pgn: '1. e4 c6 *',
    url: null, plyCount: 2, ...over,
  };
}

function move(ply: number, tags: Tag[], isUserMove = true): MoveAnalysis {
  return {
    ply, san: 'e4', uci: 'e2e4', color: 'white', fenBefore: '', evalBefore: { cp: 0, mate: null }, evalAfter: { cp: 0, mate: null },
    bestUci: 'e2e4', bestSan: 'e4', pvSan: [], winBefore: 50, winAfter: 50, winLoss: 0, classification: 'good', tags, isUserMove,
  };
}

function analyse(db: DatabaseSync, gameId: number, accuracy: number | null, moves: MoveAnalysis[] = [], status: GameAnalysis['status'] = 'done'): void {
  saveAnalysis(db, {
    gameId, version: 1, status, error: null, accuracyUser: accuracy, accuracyOpp: null,
    counts: { blunder: 0, mistake: 0, inaccuracy: 0 }, moves, keyMoments: [], analysedAt: NOW,
  });
}

const idOf = (db: DatabaseSync, sourceId: string) => Number(db.prepare('SELECT id FROM games WHERE source_id = ?').get(sourceId)!.id);

let db: DatabaseSync;
beforeEach(() => {
  db = openDb(':memory:');
});

describe('getInsights', () => {
  it('returns empty arrays for a user with no games', () => {
    expect(getInsights(db, '90d', NOW)).toEqual({
      byOpening: [], tagsByMonth: [], accuracyByMonth: [], rating: [], summary: { games: 0, analysed: 0, winRate: null },
    });
  });

  it('keeps games but empty accuracy and tags when nothing is analysed', () => {
    insertGames(db, [game({ sourceId: 'a' }), game({ sourceId: 'b', result: 'loss' })]);
    const r = getInsights(db, '90d', NOW);
    expect(r.summary).toEqual({ games: 2, analysed: 0, winRate: 0.5 });
    expect(r.accuracyByMonth).toEqual([]);
    expect(r.tagsByMonth).toEqual([]);
    expect(r.byOpening).toEqual([{ group: 'Caro-Kann Defense', color: 'white', games: 2, win: 1, draw: 0, loss: 1, avgAccuracy: null }]);
  });

  it('applies the window and ignores games without a user colour', () => {
    insertGames(db, [
      game({ sourceId: 'new', playedAt: NOW - 10 * DAY }),
      game({ sourceId: 'mid', playedAt: NOW - 60 * DAY }),
      game({ sourceId: 'old', playedAt: NOW - 200 * DAY }),
      game({ sourceId: 'nocolor', userColor: null, result: null }),
    ]);
    expect(getInsights(db, '30d', NOW).summary.games).toBe(1);
    expect(getInsights(db, '90d', NOW).summary.games).toBe(2);
    expect(getInsights(db, '365d', NOW).summary.games).toBe(3);
    expect(getInsights(db, 'all', NOW).summary.games).toBe(3);
  });

  it('averages accuracy per month (UTC, ascending) and counts only done analyses', () => {
    insertGames(db, [
      game({ sourceId: 'a', playedAt: Date.UTC(2026, 8, 30, 23, 59) }),
      game({ sourceId: 'b', playedAt: Date.UTC(2026, 9, 1, 0, 1) }),
      game({ sourceId: 'c', playedAt: Date.UTC(2026, 9, 2) }),
      game({ sourceId: 'd', playedAt: Date.UTC(2026, 9, 3) }),
    ]);
    analyse(db, idOf(db, 'a'), 60);
    analyse(db, idOf(db, 'b'), 70);
    analyse(db, idOf(db, 'c'), 80);
    analyse(db, idOf(db, 'd'), 10, [], 'error');
    const r = getInsights(db, '90d', NOW);
    expect(r.accuracyByMonth).toEqual([{ month: '2026-09', avg: 60, games: 1 }, { month: '2026-10', avg: 75, games: 2 }]);
    expect(r.summary).toEqual({ games: 4, analysed: 3, winRate: 1 });
  });

  it('counts tags on the user own moves per analysed game', () => {
    insertGames(db, [
      game({ sourceId: 'a', playedAt: Date.UTC(2026, 9, 1) }),
      game({ sourceId: 'b', playedAt: Date.UTC(2026, 9, 2) }),
    ]);
    analyse(db, idOf(db, 'a'), 50, [move(1, ['hung_piece']), move(3, ['hung_piece', 'bad_trade']), move(2, ['hung_piece'], false)]);
    analyse(db, idOf(db, 'b'), 50, [move(1, [])]);
    const r = getInsights(db, '90d', NOW);
    expect(r.tagsByMonth).toEqual(expect.arrayContaining([
      { month: '2026-10', tag: 'hung_piece', perGame: 1 },
      { month: '2026-10', tag: 'bad_trade', perGame: 0.5 },
    ]));
    expect(r.tagsByMonth).toHaveLength(2);
  });

  it('makes one rating series per platform and time class, own rating only', () => {
    insertGames(db, [
      game({ sourceId: 'a', playedAt: NOW - 3 * DAY, whiteElo: 560, timeClass: 'blitz' }),
      game({ sourceId: 'b', playedAt: NOW - 5 * DAY, userColor: 'black', blackElo: 540, whiteElo: 900, timeClass: 'blitz' }),
      game({ sourceId: 'c', playedAt: NOW - 4 * DAY, whiteElo: 700, timeClass: 'rapid' }),
      game({ source: 'lichess', sourceId: 'd', playedAt: NOW - 2 * DAY, whiteElo: 1200, timeClass: 'rapid' }),
      game({ source: 'import', sourceId: 'e', whiteElo: 1000 }),
      game({ sourceId: 'f', whiteElo: null }),
    ]);
    const r = getInsights(db, '90d', NOW);
    expect(r.rating).toEqual([
      { series: 'chess.com blitz', points: [{ t: NOW - 5 * DAY, elo: 540 }, { t: NOW - 3 * DAY, elo: 560 }] },
      { series: 'chess.com rapid', points: [{ t: NOW - 4 * DAY, elo: 700 }] },
      { series: 'lichess rapid', points: [{ t: NOW - 2 * DAY, elo: 1200 }] },
    ]);
  });

  it('groups by repertoire first, then opening name, then ECO family, then Unknown', () => {
    insertGames(db, [
      game({ sourceId: 'rep1', openingName: 'Caro-Kann Defense: Advance Variation' }),
      game({ sourceId: 'rep2', result: 'loss', openingName: 'Caro-Kann Defense: Exchange Variation' }),
      game({ sourceId: 'lon', openingName: 'London System' }),
      game({ sourceId: 'sic', openingName: 'Sicilian Defense: Najdorf', eco: 'B90' }),
      game({ sourceId: 'eco', openingName: null, eco: 'C20' }),
      game({ sourceId: 'unk', openingName: null, eco: null }),
    ]);
    const ev = db.prepare('INSERT INTO opening_events (game_id, repertoire_id, kind) VALUES (?, ?, ?)');
    ev.run(idOf(db, 'rep1'), 'caro-kann', 'end_of_book');
    ev.run(idOf(db, 'rep2'), 'caro-kann', 'leak');
    ev.run(idOf(db, 'lon'), 'london', 'end_of_book');
    ev.run(idOf(db, 'sic'), null, 'not_this_opening');
    analyse(db, idOf(db, 'rep1'), 80);
    analyse(db, idOf(db, 'rep2'), 60);
    const groups = getInsights(db, '90d', NOW).byOpening;
    expect(groups[0]).toEqual({ group: 'Caro-Kann (your repertoire)', color: 'white', games: 2, win: 1, draw: 0, loss: 1, avgAccuracy: 70 });
    expect(groups.map((g) => g.group).sort()).toEqual(
      ['C2', 'Caro-Kann (your repertoire)', 'London (your repertoire)', 'Sicilian Defense', 'Unknown'].sort(),
    );
  });

  it('separates the same opening by colour', () => {
    insertGames(db, [game({ sourceId: 'a' }), game({ sourceId: 'b', userColor: 'black' })]);
    expect(getInsights(db, '90d', NOW).byOpening.map((g) => g.color).sort()).toEqual(['black', 'white']);
  });

  it('runs in under 200 ms on 5 000 games', () => {
    const insertGame = db.prepare(`INSERT INTO games (source, source_id, played_at, time_class, rated, white, black, white_elo, black_elo,
      user_color, result, termination, eco, opening_name, pgn, url, ply_count, imported_at)
      VALUES (?, ?, ?, ?, 1, 'Me', 'Opp', ?, 600, 'white', ?, NULL, 'B12', ?, '1. e4 *', NULL, 40, 0)`);
    const insertAnalysis = db.prepare(`INSERT INTO game_analysis (game_id, version, status, accuracy_user, counts_json, key_moments_json, analysed_at, user_tags_json)
      VALUES (?, 1, 'done', ?, '{}', '[]', 0, '{"hung_piece":3}')`);
    const results = ['win', 'loss', 'draw'];
    const classes = ['blitz', 'rapid', 'bullet'];
    db.exec('BEGIN');
    for (let i = 0; i < 5000; i++) {
      const id = Number(insertGame.run(i % 2 ? 'chesscom' : 'lichess', `g${i}`, NOW - (i % 400) * DAY, classes[i % 3]!, 500 + (i % 50), results[i % 3]!, `Opening ${i % 40}: Line`).lastInsertRowid);
      insertAnalysis.run(id, 40 + (i % 50));
    }
    db.exec('COMMIT');
    const start = performance.now();
    const r = getInsights(db, 'all', NOW);
    const ms = performance.now() - start;
    expect(r.summary.games).toBe(5000);
    expect(r.tagsByMonth.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(200);
  });
});

describe('migration 012', () => {
  it('backfills user tag counts of analyses saved before the column existed', () => {
    insertGames(db, [game({ sourceId: 'a' })]);
    const id = idOf(db, 'a');
    analyse(db, id, 50, [move(1, ['hung_piece']), move(3, ['hung_piece']), move(2, ['bad_trade'], false)]);
    const sql = readFileSync(new URL('../db/migrations/012_user_tags.sql', import.meta.url), 'utf8');
    db.prepare('UPDATE game_analysis SET user_tags_json = NULL').run();
    db.exec(sql.slice(sql.indexOf('UPDATE')));
    expect(db.prepare('SELECT user_tags_json AS t FROM game_analysis').get()!.t).toBe('{"hung_piece":2}');
  });
});

describe('openingGroup', () => {
  it('cuts at the colon, and trims chess.com names that have no colon', () => {
    expect(openingGroup('Semi-Slav Defense: Marshall Gambit', 'D31')).toBe('Semi-Slav Defense');
    expect(openingGroup('Closed Sicilian Defense Grand Prix Attack 3...g6 4.Bc4 Bg7 5.Nf3', 'B23')).toBe('Closed Sicilian Defense');
    expect(openingGroup('English Opening Great Snake Variation...3.Bg2 d6 4.Nc3', 'A20')).toBe('English Opening');
    expect(openingGroup('Ruy Lopez', 'C60')).toBe('Ruy Lopez');
    expect(openingGroup(null, 'C60')).toBe('C6');
    expect(openingGroup(null, null)).toBe('Unknown');
  });
});
