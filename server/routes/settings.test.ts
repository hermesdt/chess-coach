import { beforeEach, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { openDb } from '../db/db.js';

let app: ReturnType<typeof createApp>;
beforeEach(() => {
  delete process.env.CHESSCOM_USERNAME;
  delete process.env.LICHESS_USERNAME;
  delete process.env.LICHESS_TOKEN;
  app = createApp({ db: openDb(':memory:') });
});

const put = (body: unknown) =>
  app.request('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

it('GET returns defaults', async () => {
  const res = await app.request('/api/settings');
  expect(await res.json()).toEqual({ chesscomUsername: null, lichessUsername: null, lichessTokenSet: false, syncInitialMonths: 12 });
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
