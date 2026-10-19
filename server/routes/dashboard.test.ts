import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { GameAnalysis, MoveAnalysis, Tag } from '../../shared/types.js';
import { saveAnalysis } from '../analysis/analysis-repo.js';
import { createApp } from '../app.js';
import { openDb } from '../db/db.js';
import { insertGames, listGames } from '../db/games-repo.js';
import { setSetting } from '../db/settings-repo.js';
import { positionKey, upsertCard } from '../srs/cards-repo.js';

const NOW = new Date(2026, 9, 18, 12, 0, 0).getTime();
const JSON_HEADERS = { 'content-type': 'application/json' };

let db: DatabaseSync;
let app: ReturnType<typeof createApp>;
let seq = 0;
beforeEach(() => {
  db = openDb(':memory:');
  app = createApp({ db, now: () => NOW });
  seq = 0;
});

const move = (ply: number, tags: Tag[], isUserMove: boolean): MoveAnalysis => ({
  ply, san: 'e4', uci: 'e2e4', color: 'white', fenBefore: 'f', evalBefore: { cp: 0, mate: null }, evalAfter: { cp: 0, mate: null },
  bestUci: 'e2e4', bestSan: 'e4', pvSan: [], winBefore: 50, winAfter: 50, winLoss: 0,
  classification: 'good', tags, isUserMove,
});

/** Adds a game with an analysis. Each entry of `moves` is [tags, isUserMove]. */
function addGame(moves: [Tag[], boolean][], status: GameAnalysis['status'] = 'done'): number {
  seq += 1;
  insertGames(db, [{
    source: 'chesscom', sourceId: `g${seq}`, playedAt: seq * 1000, timeClass: 'blitz', rated: true, white: 'Me', black: `Opp${seq}`,
    whiteElo: 1500, blackElo: 1500, userColor: 'white', result: 'win', termination: null, eco: null, openingName: null,
    pgn: '1. e4 e5 *', url: null, plyCount: 2,
  }]);
  const id = listGames(db, {}).items[0]!.id;
  saveAnalysis(db, {
    gameId: id, version: 1, status, error: null, accuracyUser: 90, accuracyOpp: null,
    counts: { blunder: 0, mistake: 0, inaccuracy: 0 }, moves: moves.map(([t, u], i) => move(i + 1, t, u)),
    keyMoments: [], analysedAt: 1,
  });
  return id;
}

const get = async () => (await app.request('/api/dashboard')).json() as Promise<{
  topTag: { tag: Tag; count: number; games: number } | null;
  recentGames: unknown[]; level: unknown; levelUp: unknown; review: unknown; sync: unknown;
}>;

describe('GET /api/dashboard', () => {
  it('returns empty data on an empty database', async () => {
    const body = await get();
    expect(body.topTag).toBeNull();
    expect(body.recentGames).toEqual([]);
    expect(body.review).toEqual({ dueNow: 0, dueToday: 0, totalCards: 0, reviewedToday: 0, sessionSize: 0 });
    expect(body.sync).toEqual({ chesscom: null, lichess: null });
    expect(body.level).toEqual({ level: 1, rating: null, source: 'default' });
    expect(body.levelUp).toBeNull();
  });

  it('counts games where the tag occurs, once per game, from user moves only', async () => {
    addGame([[['hung_piece', 'hung_piece'], true], [['early_queen'], true]]);
    addGame([[['hung_piece'], true]]);
    addGame([[['early_queen'], false], [['early_queen'], false], [['early_queen'], false]]); // opponent only
    addGame([[['no_castle'], true]]);
    const { topTag } = await get();
    expect(topTag).toEqual({ tag: 'hung_piece', count: 2, games: 4 });
  });

  it('ignores games that are not analysed and looks at the last 30 only', async () => {
    addGame([[['no_castle'], true]], 'error');
    for (let i = 0; i < 5; i++) addGame([[['early_queen'], true]]); // oldest, outside the window
    for (let i = 0; i < 30; i++) addGame([[['hung_piece'], true]]);
    const { topTag } = await get();
    expect(topTag).toEqual({ tag: 'hung_piece', count: 30, games: 30 });
  });

  it('breaks ties by tag severity', async () => {
    addGame([[['early_queen'], true], [['bad_trade'], true]]);
    expect((await get()).topTag).toEqual({ tag: 'bad_trade', count: 1, games: 1 });
  });

  it('reports sessionSize for a database with only new cards', async () => {
    for (let i = 1; i <= 3; i++) {
      const fen = `8/8/8/8/8/8/8/${i}K6 w - -`;
      upsertCard(db, { kind: 'mistake', positionKey: positionKey(fen), fen, sideToMove: 'white', prompt: 'p',
        solution: { accepted: ['a1a2'], best: 'a1a2', explanation: null }, refs: [], lastMove: null });
    }
    const { review } = (await get()) as unknown as { review: { dueNow: number; sessionSize: number } };
    expect(review.dueNow).toBe(0);
    expect(review.sessionSize).toBe(3);
  });

  it('returns null when no user move has a tag', async () => {
    addGame([[[], true]]);
    expect((await get()).topTag).toBeNull();
  });

  it('lists the 10 most recent games', async () => {
    for (let i = 0; i < 12; i++) addGame([[[], true]]);
    expect((await get()).recentGames).toHaveLength(10);
  });
});

describe('level-up banner', () => {
  const seed = (rating: number) => {
    for (let i = 0; i < 5; i++) {
      seq += 1;
      insertGames(db, [{
        source: 'chesscom', sourceId: `r${seq}`, playedAt: seq, timeClass: 'blitz', rated: true, white: 'Me', black: `Opp${seq}`,
        whiteElo: rating, blackElo: 1000, userColor: 'white', result: 'win', termination: null, eco: null, openingName: null,
        pgn: '*', url: null, plyCount: 0,
      }]);
    }
  };

  it('stores the level on first call and shows no banner', async () => {
    seed(1000);
    expect((await get()).levelUp).toBeNull();
    setSetting(db, 'level_override', '2');
    expect((await get()).levelUp).toBeNull();
  });

  it('shows the banner when the level rose, until it is marked as seen', async () => {
    seed(500);
    await get();
    setSetting(db, 'level_override', '2');
    expect((await get()).levelUp).toEqual({ from: 1, to: 2 });
    expect((await get()).levelUp).toEqual({ from: 1, to: 2 });
    const res = await app.request('/api/dashboard/level-seen', { method: 'POST', headers: JSON_HEADERS, body: '{}' });
    expect(res.status).toBe(200);
    expect((await get()).levelUp).toBeNull();
  });

  it('does not store the default level, so the first real level shows no banner', async () => {
    await get();
    setSetting(db, 'level_override', '3');
    expect((await get()).levelUp).toBeNull();
  });

  it('shows no banner when the level dropped', async () => {
    setSetting(db, 'level_override', '3');
    await get();
    setSetting(db, 'level_override', '1');
    expect((await get()).levelUp).toBeNull();
  });
});
