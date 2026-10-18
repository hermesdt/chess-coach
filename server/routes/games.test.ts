import { beforeEach, describe, expect, it } from 'vitest';
import type { GameList, NewGame } from '../../shared/types.js';
import { createApp } from '../app.js';
import { openDb } from '../db/db.js';
import { insertGames } from '../db/games-repo.js';

const game = (i: number, over: Partial<NewGame> = {}): NewGame => ({
  source: 'chesscom', sourceId: `g${i}`, playedAt: 1000 + i, timeClass: 'blitz', rated: true,
  white: 'me', black: `opp${i}`, whiteElo: null, blackElo: null, userColor: 'white', result: 'win',
  termination: null, eco: null, openingName: null, pgn: '[Event "x"]\n\n1. e4 e5 *', url: null, plyCount: 2, ...over,
});

let app: ReturnType<typeof createApp>;
beforeEach(() => {
  const db = openDb(':memory:');
  insertGames(db, [game(1), game(2, { source: 'lichess', result: 'loss' }), game(3)]);
  app = createApp({ db });
});

const list = async (qs: string) => (await (await app.request(`/api/games${qs}`)).json()) as GameList;

describe('GET /api/games', () => {
  it('lists newest first with total', async () => {
    const res = await list('');
    expect(res.total).toBe(3);
    expect(res.items.map((g) => g.sourceId)).toEqual(['g3', 'g2', 'g1']);
  });

  it('filters by source and result', async () => {
    expect((await list('?source=lichess')).total).toBe(1);
    expect((await list('?result=win')).total).toBe(2);
  });

  it('clamps limit and offset and falls back on invalid values', async () => {
    expect((await list('?limit=1')).items).toHaveLength(1);
    expect((await list('?limit=0')).items).toHaveLength(1);
    expect((await list('?limit=9999')).items).toHaveLength(3);
    expect((await list('?limit=abc')).items).toHaveLength(3);
    expect((await list('?offset=2')).items.map((g) => g.sourceId)).toEqual(['g1']);
    expect((await list('?offset=-5')).items).toHaveLength(3);
    expect((await list('?offset=abc')).items).toHaveLength(3);
  });
});

describe('GET /api/games/:id', () => {
  it('returns 404 for unknown or malformed ids', async () => {
    expect((await app.request('/api/games/9999')).status).toBe(404);
    expect((await app.request('/api/games/abc')).status).toBe(404);
  });
});

describe('unknown API paths', () => {
  it('return 404 JSON', async () => {
    const res = await app.request('/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not found' });
  });
});

describe('GET /api/jobs/:id', () => {
  it('returns 404 for an unknown job', async () => {
    expect((await app.request('/api/jobs/42')).status).toBe(404);
  });
});
