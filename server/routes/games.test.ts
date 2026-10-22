import { beforeEach, describe, expect, it } from 'vitest';
import type { GameDetail, GameList, NewGame } from '../../shared/types.js';
import { createApp } from '../app.js';
import { openDb } from '../db/db.js';
import { insertGames } from '../db/games-repo.js';

const game = (i: number, over: Partial<NewGame> = {}): NewGame => ({
  source: 'chesscom', sourceId: `g${i}`, playedAt: 1000 + i, timeClass: 'blitz', rated: true,
  white: 'me', black: `opp${i}`, whiteElo: null, blackElo: null, userColor: 'white', result: 'win',
  termination: null, eco: null, openingName: null, pgn: '[Event "x"]\n\n1. e4 e5 *', url: null, plyCount: 2, ...over,
});

let app: ReturnType<typeof createApp>;
let db: ReturnType<typeof openDb>;
beforeEach(() => {
  db = openDb(':memory:');
  insertGames(db, [game(1), game(2, { source: 'lichess', result: 'loss' }), game(3)]);
  app = createApp({ db });
});

const list = async (qs: string) => (await (await app.request(`/api/games${qs}`)).json()) as GameList;

describe('GET /api/games', () => {
  it('hides duplicate copies unless includeDuplicates=1', async () => {
    const db = openDb(':memory:');
    insertGames(db, [game(1, { source: 'import', black: 'opp' }), game(2, { black: 'opp' })]);
    app = createApp({ db });
    expect((await list('')).items.map((g) => g.sourceId)).toEqual(['g2']);
    expect((await list('?includeDuplicates=1')).total).toBe(2);
  });

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

describe('GET /api/games/:id repertoire', () => {
  const addEvent = (gameId: number, kind: string, nodeId: string | null) =>
    db.prepare(`INSERT INTO opening_events (game_id, repertoire_id, kind, node_id, ply, level) VALUES (?, 'caro-kann', ?, ?, 3, 1)`)
      .run(gameId, kind, nodeId);
  const detail = async (id: number) => (await (await app.request(`/api/games/${id}`)).json()) as GameDetail;
  const idOf = (sourceId: string) => Number((db.prepare('SELECT id FROM games WHERE source_id = ?').get(sourceId) as { id: number }).id);

  it('gives the repertoire and node of a leak or an out-of-book event', async () => {
    addEvent(idOf('g1'), 'leak', 'e4 c6 d4');
    addEvent(idOf('g2'), 'out_of_book', 'e4 c6');
    expect((await detail(idOf('g1'))).repertoire).toEqual({ id: 'caro-kann', nodeId: 'e4 c6 d4', kind: 'leak' });
    expect((await detail(idOf('g2'))).repertoire).toEqual({ id: 'caro-kann', nodeId: 'e4 c6', kind: 'out_of_book' });
  });

  it('is null without an event, or when the event has no node to link', async () => {
    addEvent(idOf('g2'), 'end_of_book', null);
    expect((await detail(idOf('g1'))).repertoire).toBeNull();
    expect((await detail(idOf('g2'))).repertoire).toBeNull();
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
