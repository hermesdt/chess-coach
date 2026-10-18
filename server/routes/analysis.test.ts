import { beforeEach, describe, expect, it } from 'vitest';
import type { GameAnalysis, GameList, NewGame } from '../../shared/types.js';
import { createApp } from '../app.js';
import { markAnalysis } from '../analysis/analysis-repo.js';
import { openDb } from '../db/db.js';
import { insertGames } from '../db/games-repo.js';
import { waitForJob } from '../jobs.js';
import type { DatabaseSync } from 'node:sqlite';

const SANS = 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O O-O';
const pgn = `[Event "x"]\n\n${SANS.split(' ').map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${s}` : s)).join(' ')} *`;
const game = (id: string, over: Partial<NewGame> = {}): NewGame => ({
  source: 'chesscom', sourceId: id, playedAt: Number(id.slice(1)) * 1000, timeClass: 'blitz', rated: true,
  white: 'Me', black: 'Opp', whiteElo: 1500, blackElo: 1500, userColor: 'white', result: 'win', termination: null,
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
});
