import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { openDb } from '../db/db.js';
import { loadRepertoire } from '../repertoire/load.js';

let app: ReturnType<typeof createApp>;
beforeEach(() => {
  delete process.env.CHESSCOM_USERNAME;
  delete process.env.LICHESS_USERNAME;
  delete process.env.LICHESS_TOKEN;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  app = createApp({ db: openDb(':memory:') });
});

const put = (body: unknown) =>
  app.request('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const none = { 'claude-cli': null, 'codex-cli': null, 'opencode-cli': null, openrouter: null, 'anthropic-api': null };

it('GET returns defaults', async () => {
  const res = await app.request('/api/settings');
  expect(await res.json()).toEqual({ chesscomUsername: null, lichessUsername: null, lichessTokenSet: false, syncInitialMonths: 12, engineNodes: 400000, reviewDailyLimit: 20, reviewNewPerDay: 10, aiProvider: 'auto', aiModels: none, aiChatModels: none, aiDeepModels: none, openrouterKeySet: false, anthropicKeySet: false, levelOverride: null });
});

it('PUT stores values and never leaks the token', async () => {
  const res = await put({ lichessToken: 'abc', chesscomUsername: 'Me' });
  const text = await res.text();
  expect(text).not.toContain('abc');
  expect(JSON.parse(text)).toMatchObject({ lichessTokenSet: true, chesscomUsername: 'Me' });
  expect(await (await app.request('/api/settings')).text()).not.toContain('abc');
});

it('empty string clears a value', async () => {
  await put({ chesscomUsername: 'Me' });
  const res = await put({ chesscomUsername: '' });
  expect((await res.json()).chesscomUsername).toBeNull();
});

it('rejects invalid syncInitialMonths', async () => {
  expect((await put({ syncInitialMonths: 0 })).status).toBe(400);
  expect((await put({ syncInitialMonths: 121 })).status).toBe(400);
  expect((await put({ syncInitialMonths: 1.5 })).status).toBe(400);
  expect((await put({ syncInitialMonths: 24 })).status).toBe(200);
});

it('DB value wins over env', async () => {
  process.env.CHESSCOM_USERNAME = 'EnvUser';
  expect((await (await app.request('/api/settings')).json()).chesscomUsername).toBe('EnvUser');
  await put({ chesscomUsername: 'DbUser' });
  expect((await (await app.request('/api/settings')).json()).chesscomUsername).toBe('DbUser');
  delete process.env.CHESSCOM_USERNAME;
});

it('validates engineNodes', async () => {
  expect((await put({ engineNodes: 9999 })).status).toBe(400);
  expect((await put({ engineNodes: 5_000_001 })).status).toBe(400);
  expect((await put({ engineNodes: 1000.5 })).status).toBe(400);
  const res = await put({ engineNodes: 50_000 });
  expect(res.status).toBe(200);
  expect((await res.json()).engineNodes).toBe(50_000);
});

it('engineNodes falls back to ENGINE_NODES env, then ignores invalid env', async () => {
  process.env.ENGINE_NODES = '123456';
  expect((await (await app.request('/api/settings')).json()).engineNodes).toBe(123456);
  process.env.ENGINE_NODES = 'abc';
  expect((await (await app.request('/api/settings')).json()).engineNodes).toBe(400000);
  delete process.env.ENGINE_NODES;
});

it('validates and stores review limits', async () => {
  expect((await put({ reviewDailyLimit: 0 })).status).toBe(400);
  expect((await put({ reviewDailyLimit: 201 })).status).toBe(400);
  expect((await put({ reviewNewPerDay: -1 })).status).toBe(400);
  expect((await put({ reviewNewPerDay: 101 })).status).toBe(400);
  expect((await put({ reviewNewPerDay: 1.5 })).status).toBe(400);
  const res = await put({ reviewDailyLimit: 50, reviewNewPerDay: 0 });
  expect(await res.json()).toMatchObject({ reviewDailyLimit: 50, reviewNewPerDay: 0 });
});

it('GET /settings/data reports db path, counts and hidden duplicates', async () => {
  const db = openDb(':memory:');
  const a = createApp({ db });
  const ins = db.prepare(
    "INSERT INTO games (source, source_id, played_at, time_class, rated, white, black, result, pgn, ply_count, imported_at, duplicate_of) VALUES ('chesscom', ?, 1, 'blitz', 1, 'a', 'b', 'win', '', 0, 1, ?)",
  );
  ins.run('1', null);
  ins.run('2', null);
  ins.run('3', 1);
  process.env.CHESS_DB_PATH = '/tmp/x/chess.db';
  delete process.env.BACKUP_DIR;
  const body = await (await a.request('/api/settings/data')).json();
  delete process.env.CHESS_DB_PATH;
  expect(body).toEqual({ dbPath: '/tmp/x/chess.db', games: 3, duplicateGames: 1, cards: 0, backupsDir: null });
});

it('stores chat and deep models, and clears one with an empty string', async () => {
  let body = await (await put({ aiChatModels: { 'codex-cli': ' fast ' }, aiDeepModels: { 'claude-cli': 'big' } })).json();
  expect(body).toMatchObject({ aiChatModels: { 'codex-cli': 'fast', 'claude-cli': null }, aiDeepModels: { 'claude-cli': 'big' } });
  body = await (await put({ aiChatModels: { 'codex-cli': '' } })).json();
  expect(body).toMatchObject({ aiChatModels: { 'codex-cli': null }, aiDeepModels: { 'claude-cli': 'big' } });
  expect((await put({ aiDeepModels: { nope: 'x' } })).status).toBe(400);
  expect((await put({ aiChatModels: { 'codex-cli': 5 } })).status).toBe(400);
});

describe('levelOverride', () => {
  const rep = loadRepertoire({
    id: 'l', name: 'L', color: 'black',
    moves: [{ san: 'e4', children: [{ san: 'e5', children: [{ san: 'Nf3', children: [{ san: 'Nc6', level: 3 }] }] }] }],
  });
  let db: ReturnType<typeof openDb>;
  const cards = () => db.prepare("SELECT suspended FROM cards WHERE kind = 'opening' ORDER BY sort_order, id").all().map((r) => r.suspended);
  beforeEach(() => {
    db = openDb(':memory:');
    app = createApp({ db, repertoires: [rep] });
  });

  it('creates and suspends level-3 opening cards at once, without a restart', async () => {
    expect((await put({ levelOverride: 1 })).status).toBe(200);
    expect(cards()).toEqual([0]);
    await put({ levelOverride: 3 });
    expect(cards()).toEqual([0, 0]);
    await put({ levelOverride: 1 });
    expect(cards()).toEqual([0, 1]);
  });

  it('GET returns the override, and null when none is set', async () => {
    expect(((await (await app.request('/api/settings')).json()) as { levelOverride: unknown }).levelOverride).toBeNull();
    await put({ levelOverride: 2 });
    expect(((await (await app.request('/api/settings')).json()) as { levelOverride: unknown }).levelOverride).toBe(2);
  });

  it('clears the override with null and rejects other values', async () => {
    await put({ levelOverride: 2 });
    expect(db.prepare("SELECT value FROM settings WHERE key = 'level_override'").get()).toEqual({ value: '2' });
    await put({ levelOverride: null });
    expect(db.prepare("SELECT value FROM settings WHERE key = 'level_override'").get()).toBeUndefined();
    expect((await put({ levelOverride: 4 })).status).toBe(400);
    expect((await put({ levelOverride: '2' })).status).toBe(400);
  });
});
