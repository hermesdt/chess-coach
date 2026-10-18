import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { openDb } from '../db/db.js';
import { latestPlayedAt, listGames } from '../db/games-repo.js';
import { setSetting } from '../db/settings-repo.js';
import { waitForJob } from '../jobs.js';
import type { Job } from '../../shared/types.js';

const load = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');
const ARCHIVES = 'https://api.chess.com/pub/player/hikaru/games/archives';
const MONTH_2023 = 'https://api.chess.com/pub/player/hikaru/games/2023/12';
const MONTH_2024 = 'https://api.chess.com/pub/player/hikaru/games/2024/01';
const JSON_HEADERS = { 'content-type': 'application/json' };
const NOW = Date.UTC(2024, 1, 15);

let db: ReturnType<typeof openDb>;
let calls: string[];
let routes: Record<string, () => Response>;

const fakeFetch = (async (input: string | URL | Request) => {
  const url = String(input);
  calls.push(url);
  if (url.startsWith('https://lichess.org/')) return routes.lichess!();
  const route = routes[url];
  return route ? route() : new Response('not found', { status: 404 });
}) as typeof fetch;

const DAY = 24 * 60 * 60 * 1000;
const emptyMonth = () => new Response(JSON.stringify({ games: [] }));

beforeEach(() => {
  delete process.env.CHESSCOM_USERNAME;
  delete process.env.LICHESS_USERNAME;
  delete process.env.LICHESS_TOKEN;
  db = openDb(':memory:');
  calls = [];
  routes = {
    [ARCHIVES]: () => new Response(load('chesscom-archives.json')),
    [MONTH_2023]: emptyMonth,
    [MONTH_2024]: () => new Response(load('chesscom-2024-01.json')),
    'https://api.chess.com/pub/player/hikaru/games/2024/02': emptyMonth,
    lichess: () => new Response(load('lichess-games.ndjson')),
  };
  setSetting(db, 'sync_initial_months', '120');
});

const app = () => createApp({ db, fetchFn: fakeFetch, now: () => NOW });

async function runSync(): Promise<Job> {
  const res = await app().request('/api/sync', { method: 'POST', headers: JSON_HEADERS });
  const { jobId } = (await res.json()) as { jobId: number };
  return waitForJob(db, jobId, 5000);
}

describe('sync', () => {
  it('stores chess.com games and reports the missing lichess token', async () => {
    setSetting(db, 'chesscom_username', 'hikaru');
    setSetting(db, 'lichess_username', 'lance5500');
    routes.lichess = () => new Response('', { status: 404 });
    const job = await runSync();
    expect(job.status).toBe('done');
    expect(job.message).toContain('chess.com:');
    expect(job.message).toContain('token needed');
    expect(listGames(db, { source: 'chesscom' }).total).toBeGreaterThan(0);
    const status = await (await app().request('/api/sync/status')).json();
    expect(status).toEqual({ chesscom: NOW, lichess: null, runningJobId: null });
  });

  it('ends in error when every configured source fails', async () => {
    setSetting(db, 'chesscom_username', 'hikaru');
    setSetting(db, 'lichess_username', 'lance5500');
    routes[ARCHIVES] = () => new Response('boom', { status: 500 });
    routes.lichess = () => new Response('', { status: 404 });
    const job = await runSync();
    expect(job.status).toBe('error');
    expect(job.error).toContain('chess.com');
    expect(job.error).toContain('lichess');
  });

  it('ends in error when no usernames are configured', async () => {
    const job = await runSync();
    expect(job.status).toBe('error');
    expect(job.error).toBe('No usernames configured');
  });

  it('records a thrown network rejection and continues with the other source', async () => {
    setSetting(db, 'chesscom_username', 'hikaru');
    setSetting(db, 'lichess_username', 'lance5500');
    routes[ARCHIVES] = () => {
      throw new TypeError('fetch failed');
    };
    const job = await runSync();
    expect(job.status).toBe('done');
    expect(job.message).toContain('chess.com: failed');
    expect(listGames(db, { source: 'lichess' }).total).toBeGreaterThan(0);
  });

  it('keeps months already inserted when a later month fails', async () => {
    setSetting(db, 'chesscom_username', 'hikaru');
    routes[MONTH_2023] = () => new Response(load('chesscom-2024-01.json'));
    routes[MONTH_2024] = () => new Response('boom', { status: 500 });
    const job = await runSync();
    expect(job.status).toBe('error');
    expect(listGames(db, { source: 'chesscom' }).total).toBeGreaterThan(0);
  });

  it('inserts nothing on the second run and sends since = latest - 14 days to lichess', async () => {
    setSetting(db, 'chesscom_username', 'hikaru');
    setSetting(db, 'lichess_username', 'lance5500');
    const first = await runSync();
    expect(first.status).toBe('done');
    const total = listGames(db, {}).total;
    expect(total).toBeGreaterThan(0);
    const latest = latestPlayedAt(db, 'lichess')!;
    calls = [];
    const second = await runSync();
    expect(second.message).toContain('chess.com: 0 new');
    expect(second.message).toContain('lichess: 0 new');
    expect(listGames(db, {}).total).toBe(total);
    const lichessUrl = calls.find((u) => u.startsWith('https://lichess.org/'))!;
    expect(new URL(lichessUrl).searchParams.get('since')).toBe(String(latest - 14 * DAY));
    // chess.com: since = latest + 1 ms, so only months from the newest game on are fetched
    expect(calls).not.toContain(MONTH_2023);
    expect(calls).toContain(MONTH_2024);
  });

  it('starts from now - syncInitialMonths on the first sync', async () => {
    setSetting(db, 'sync_initial_months', '1');
    setSetting(db, 'chesscom_username', 'hikaru');
    setSetting(db, 'lichess_username', 'lance5500');
    await runSync();
    const lichessUrl = calls.find((u) => u.startsWith('https://lichess.org/'))!;
    expect(new URL(lichessUrl).searchParams.get('since')).toBe(String(NOW - 30 * DAY));
    // 2024-01-16 is in 2024/01, so 2023/12 is not fetched
    expect(calls).not.toContain(MONTH_2023);
    expect(calls).toContain(MONTH_2024);
  });

  it('starts from the initial window again when the username changes', async () => {
    setSetting(db, 'lichess_username', 'lance5500');
    await runSync();
    setSetting(db, 'lichess_username', 'someone-else');
    calls = [];
    await runSync();
    const lichessUrl = calls.find((u) => u.startsWith('https://lichess.org/'))!;
    expect(new URL(lichessUrl).searchParams.get('since')).toBe(String(NOW - 120 * 30 * DAY));
  });

  it('returns the running sync job instead of starting a second one', async () => {
    setSetting(db, 'chesscom_username', 'hikaru');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    routes[ARCHIVES] = () => new Response(load('chesscom-archives.json'));
    const slowFetch = (async (input: string | URL | Request) => {
      await gate;
      return fakeFetch(input);
    }) as typeof fetch;
    const slowApp = createApp({ db, fetchFn: slowFetch, now: () => NOW });
    const post = async () =>
      (await (await slowApp.request('/api/sync', { method: 'POST', headers: JSON_HEADERS })).json()) as {
        jobId: number;
        alreadyRunning?: boolean;
      };
    const first = await post();
    expect(first.alreadyRunning).toBeUndefined();
    const second = await post();
    expect(second).toEqual({ jobId: first.jobId, alreadyRunning: true });
    const status = (await (await slowApp.request('/api/sync/status')).json()) as { runningJobId: number | null };
    expect(status.runningJobId).toBe(first.jobId);
    release();
    await waitForJob(db, first.jobId, 5000);
    const after = (await (await slowApp.request('/api/sync/status')).json()) as { runningJobId: number | null };
    expect(after.runningJobId).toBeNull();
    const third = await post();
    expect(third.jobId).not.toBe(first.jobId);
    await waitForJob(db, third.jobId, 5000);
  });
});
