import { beforeEach, describe, expect, it } from 'vitest';
import type { GameAnalysis, GameList, NewGame } from '../../shared/types.js';
import { createApp } from '../app.js';
import { ANALYSIS_VERSION, markAnalysis, saveAnalysis } from '../analysis/analysis-repo.js';
import { setSetting } from '../db/settings-repo.js';
import { openDb } from '../db/db.js';
import { insertGames } from '../db/games-repo.js';
import { waitForJob } from '../jobs.js';
import type { DatabaseSync } from 'node:sqlite';

const SANS = 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O O-O';
const pgn = `[Event "x"]\n\n${SANS.split(' ').map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${s}` : s)).join(' ')} *`;
const game = (id: string, over: Partial<NewGame> = {}): NewGame => ({
  source: 'chesscom', sourceId: id, playedAt: Number(id.slice(1)) * 1000, timeClass: 'blitz', rated: true,
  white: 'Me', black: `Opp${id}`, whiteElo: 1500, blackElo: 1500, userColor: 'white', result: 'win', termination: null,
  eco: null, openingName: null, pgn, url: null, plyCount: 12, ...over,
});

const pool = { analyse: async () => [{ multipv: 1, score: { cp: 0, mate: null }, pv: [] }] };
let db: DatabaseSync;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDb(':memory:');
  insertGames(db, [game('g1'), game('g2', { userColor: null, result: null }), game('g3', { plyCount: 4 })]);
  app = createApp({ db, pool });
});

const post = (path: string, body: unknown = {}) =>
  app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const idOf = (sourceId: string): number => Number(db.prepare('SELECT id FROM games WHERE source_id = ?').get(sourceId)!.id);

describe('analysis routes', () => {
  it('returns none before analysis', async () => {
    expect(await (await app.request(`/api/games/${idOf('g1')}/analysis`)).json()).toEqual({ status: 'none' });
  });

  it('rejects games without a user colour or too short', async () => {
    const noColor = await post(`/api/games/${idOf('g2')}/analyse`);
    expect(noColor.status).toBe(400);
    expect(await noColor.json()).toEqual({ error: 'You did not play in this game.' });
    const short = await post(`/api/games/${idOf('g3')}/analyse`);
    expect(short.status).toBe(400);
    expect(await short.json()).toEqual({ error: 'Game too short to analyse.' });
    expect((await post('/api/games/999/analyse')).status).toBe(404);
  });

  it('analyses a game and shows the badge in the list', async () => {
    const id = idOf('g1');
    const { jobId } = (await (await post(`/api/games/${id}/analyse`)).json()) as { jobId: number };
    await waitForJob(db, jobId);
    const analysis = (await (await app.request(`/api/games/${id}/analysis`)).json()) as GameAnalysis;
    expect(analysis.status).toBe('done');
    expect(analysis.moves).toHaveLength(12);
    const list = (await (await app.request('/api/games')).json()) as GameList;
    const item = list.items.find((g) => g.id === id)!;
    expect(item.analysis).toMatchObject({ status: 'done', blunders: 0, mistakes: 0 });
    expect(item.analysis?.accuracyUser).toBeGreaterThan(90);
    expect(list.items.find((g) => g.id === idOf('g2'))?.analysis).toBeUndefined();
  });

  it('hides stale data when the latest analysis failed', async () => {
    const id = idOf('g1');
    await waitForJob(db, ((await (await post(`/api/games/${id}/analyse`)).json()) as { jobId: number }).jobId);
    markAnalysis(db, id, 'error', 'engine crashed');
    expect(await (await app.request(`/api/games/${id}/analysis`)).json()).toEqual({ status: 'error', error: 'engine crashed' });
    const list = (await (await app.request('/api/games')).json()) as GameList;
    expect(list.items.find((g) => g.id === id)?.analysis).toEqual({ accuracyUser: null, blunders: 0, mistakes: 0, status: 'error' });
  });

  it('re-queues a failed game through the single-game route', async () => {
    const id = idOf('g1');
    markAnalysis(db, id, 'error', 'engine crashed');
    const { jobId } = (await (await post(`/api/games/${id}/analyse`)).json()) as { jobId: number };
    await waitForJob(db, jobId);
    const analysis = (await (await app.request(`/api/games/${id}/analysis`)).json()) as GameAnalysis;
    expect(analysis.status).toBe('done');
  });

  it('returns a null job when the game is already analysed', async () => {
    const id = idOf('g1');
    await waitForJob(db, ((await (await post(`/api/games/${id}/analyse`)).json()) as { jobId: number }).jobId);
    expect(await (await post(`/api/games/${id}/analyse`)).json()).toEqual({ jobId: null });
  });

  it('does not queue failed games from the queue route', async () => {
    markAnalysis(db, idOf('g1'), 'error', 'engine crashed');
    expect(await (await post('/api/analysis/queue', {})).json()).toEqual({ jobId: null, queued: 0 });
  });

  it('recomputes key moments from the current level on read', async () => {
    const id = idOf('g1');
    const move = {
      ply: 1, san: 'e4', uci: 'e2e4', color: 'white', fenBefore: '', evalBefore: { cp: 0, mate: null }, evalAfter: { cp: 0, mate: null },
      bestUci: 'd2d4', bestSan: 'd4', pvSan: [], winBefore: 50, winAfter: 33, winLoss: 17, classification: 'inaccuracy', tags: [], isUserMove: true,
    };
    saveAnalysis(db, {
      gameId: id, version: ANALYSIS_VERSION, status: 'done', error: null, accuracyUser: 80, accuracyOpp: 80,
      counts: { blunder: 0, mistake: 0, inaccuracy: 1 } as GameAnalysis['counts'], moves: [move] as GameAnalysis['moves'],
      keyMoments: [], analysedAt: 1,
    });
    const read = async () => ((await (await app.request(`/api/games/${id}/analysis`)).json()) as GameAnalysis).keyMoments;
    setSetting(db, 'level_override', '1');
    expect(await read()).toEqual([]);
    setSetting(db, 'level_override', '2');
    expect(await read()).toEqual([{ ply: 1, reason: 'inaccuracy', winLoss: 17 }]);
  });

  it('queues eligible games with a clamped limit', async () => {
    insertGames(db, [game('g4'), game('g5')]);
    const res = (await (await post('/api/analysis/queue', { limit: 0 })).json()) as { jobId: number; queued: number };
    expect(res.queued).toBe(1);
    await waitForJob(db, res.jobId);
    const all = (await (await post('/api/analysis/queue', {})).json()) as { jobId: number; queued: number };
    expect(all.queued).toBe(2);
    await waitForJob(db, all.jobId);
  });

  it('GET /api/level returns the current level', async () => {
    expect(await (await app.request('/api/level')).json()).toMatchObject({ level: expect.any(Number), source: expect.any(String) });
  });

  it('GET /api/level keeps the level computed from games when an override is set', async () => {
    setSetting(db, 'level_override', '1');
    expect(await (await app.request('/api/level')).json()).toMatchObject({ level: 1, source: 'override', computedLevel: 3 });
  });
});
