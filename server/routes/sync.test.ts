import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { openDb } from '../db/db.js';
import { setSetting } from '../db/settings-repo.js';
import { eligibleUnanalysed } from '../analysis/queue.js';
import { waitForJob } from '../jobs.js';
import { loadRepertoire } from '../repertoire/load.js';

const load = (name: string) => readFileSync(new URL(`../sync/__fixtures__/${name}`, import.meta.url), 'utf8');
const ARCHIVES = 'https://api.chess.com/pub/player/hikaru/games/archives';
const MONTH = 'https://api.chess.com/pub/player/hikaru/games/2024/01';
const NOW = Date.UTC(2024, 1, 15);

const fakeFetch = (async (input: string | URL | Request) => {
  const url = String(input);
  if (url === ARCHIVES) return new Response(load('chesscom-archives.json'));
  if (url === MONTH) return new Response(load('chesscom-2024-01.json'));
  if (url.startsWith('https://api.chess.com/')) return new Response(JSON.stringify({ games: [] }));
  return new Response('not found', { status: 404 });
}) as typeof fetch;

const pool = { analyse: async () => [{ multipv: 1, score: { cp: 0, mate: null }, pv: [] }] };

describe('sync queues analysis', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    delete process.env.CHESSCOM_USERNAME;
    delete process.env.LICHESS_USERNAME;
    db = openDb(':memory:');
    setSetting(db, 'sync_initial_months', '120');
    setSetting(db, 'chesscom_username', 'hikaru');
  });

  it('creates an analysis job and game_analysis rows for new eligible games', async () => {
    const app = createApp({ db, fetchFn: fakeFetch, now: () => NOW, pool });
    const res = await app.request('/api/sync', { method: 'POST', headers: { 'content-type': 'application/json' } });
    const { jobId } = (await res.json()) as { jobId: number };
    expect((await waitForJob(db, jobId)).status).toBe('done');

    const eligible = eligibleUnanalysed(db, 1000).length;
    const rows = db.prepare('SELECT status FROM game_analysis').all();
    const jobRow = db.prepare("SELECT id FROM jobs WHERE kind = 'analysis'").get();
    expect(jobRow).toBeDefined();
    expect(rows.length).toBeGreaterThan(0);
    await waitForJob(db, jobRow!.id as number);
    const statuses = db.prepare('SELECT DISTINCT status FROM game_analysis').all().map((r) => r.status);
    expect(statuses).toEqual(['done']);
    expect(eligible).toBe(0);
  });
});

describe('sync scans opening leaks', () => {
  it('records an opening event for a game where the user leaves the repertoire', async () => {
    delete process.env.CHESSCOM_USERNAME;
    delete process.env.LICHESS_USERNAME;
    const db = openDb(':memory:');
    setSetting(db, 'sync_initial_months', '120');
    setSetting(db, 'chesscom_username', 'hikaru');
    // Hikaru (White) plays 1.e4 c5 2.Nc3 in the first fixture game; this repertoire expects 2.Nf3.
    const rep = loadRepertoire({
      id: 'open-sicilian', name: 'Open Sicilian', color: 'white',
      moves: [{ san: 'e4', comment: 'Take the centre.', children: [{ san: 'c5', children: [{ san: 'Nf3', comment: 'Develop and hit d4.' }] }] }],
    });
    const app = createApp({ db, fetchFn: fakeFetch, now: () => NOW, pool, repertoires: [rep] });
    const res = await app.request('/api/sync', { method: 'POST', headers: { 'content-type': 'application/json' } });
    const { jobId } = (await res.json()) as { jobId: number };
    expect((await waitForJob(db, jobId)).status).toBe('done');
    const leak = db.prepare("SELECT repertoire_id, expected_san, played_san FROM opening_events WHERE kind = 'leak'").all();
    expect(leak).toContainEqual({ repertoire_id: 'open-sicilian', expected_san: 'Nf3', played_san: 'Nc3' });
  });
});
