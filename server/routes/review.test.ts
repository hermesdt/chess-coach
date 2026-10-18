import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CardFlag, ReviewResult, ReviewSession } from '../../shared/types.js';
import { createApp } from '../app.js';
import { openDb } from '../db/db.js';
import { positionKey, recordReview, setSuspended, upsertCard } from '../srs/cards-repo.js';

const NOW = new Date(2026, 9, 18, 12, 0, 0).getTime();
const HOUR = 3_600_000;
const JSON_HEADERS = { 'content-type': 'application/json' };

let db: DatabaseSync;
let app: ReturnType<typeof createApp>;
let n = 0;
beforeEach(() => {
  db = openDb(':memory:');
  app = createApp({ db, now: () => NOW });
  n = 0;
});

function addCard(): number {
  n += 1;
  const fen = `8/8/8/8/8/8/8/${n}K6 w - -`;
  return upsertCard(db, {
    kind: 'mistake', positionKey: positionKey(fen), fen, sideToMove: 'white', prompt: `p${n}`,
    solution: { accepted: ['a1a2'], best: 'a1a2', explanation: null }, refs: [], lastMove: null,
  }).id;
}

const post = (path: string, body: unknown) =>
  app.request(path, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });

describe('GET /api/review/session', () => {
  it('returns an empty session', async () => {
    const res = await app.request('/api/review/session');
    expect(await res.json()).toEqual({ cards: [], dueCount: 0, newAvailable: 0 });
  });

  it('uses the stored limits', async () => {
    for (let i = 0; i < 5; i++) addCard();
    await app.request('/api/settings', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ reviewNewPerDay: 2 }) });
    const s = (await (await app.request('/api/review/session')).json()) as ReviewSession;
    expect(s.cards).toHaveLength(2);
  });
});

describe('POST /api/review/:cardId', () => {
  it('records a review and returns the next due time', async () => {
    const id = addCard();
    const res = await post(`/api/review/${id}`, { rating: 'good', answerUci: 'a1a2', durationMs: 900 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReviewResult;
    expect(body.cardId).toBe(id);
    expect(body.nextDue).toBeGreaterThan(NOW);
    expect(Number((db.prepare('SELECT COUNT(*) AS n FROM reviews').get() as { n: number }).n)).toBe(1);
  });

  it('returns 404 for an unknown card', async () => {
    expect((await post('/api/review/999', { rating: 'good', answerUci: null, durationMs: 1 })).status).toBe(404);
  });

  it('returns 400 for a bad rating or body', async () => {
    const id = addCard();
    expect((await post(`/api/review/${id}`, { rating: 'perfect', answerUci: null, durationMs: 1 })).status).toBe(400);
    expect((await post(`/api/review/${id}`, { rating: 'good', answerUci: 5, durationMs: 1 })).status).toBe(400);
    expect((await post(`/api/review/${id}`, { rating: 'good', answerUci: null, durationMs: -1 })).status).toBe(400);
    expect((await post(`/api/review/${id}`, null)).status).toBe(400);
    expect((await post('/api/review/abc', { rating: 'good', answerUci: null, durationMs: 1 })).status).toBe(400);
  });

  it('returns 409 for a suspended card', async () => {
    const id = addCard();
    setSuspended(db, id, true);
    expect((await post(`/api/review/${id}`, { rating: 'good', answerUci: null, durationMs: 1 })).status).toBe(409);
    expect(Number((db.prepare('SELECT COUNT(*) AS n FROM reviews').get() as { n: number }).n)).toBe(0);
  });
});

describe('flags', () => {
  it('flags a card, suspends it and lists the flag', async () => {
    const id = addCard();
    const res = await post(`/api/cards/${id}/flag`, { note: 'wrong answer' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ cardId: id, note: 'wrong answer', createdAt: NOW });
    const list = (await (await app.request('/api/cards/flags')).json()) as CardFlag[];
    expect(list).toHaveLength(1);
    const s = (await (await app.request('/api/review/session')).json()) as ReviewSession;
    expect(s.cards).toEqual([]);
  });

  it('returns 404 for an unknown card and 400 for a bad note', async () => {
    expect((await post('/api/cards/999/flag', { note: 'x' })).status).toBe(404);
    const id = addCard();
    expect((await post(`/api/cards/${id}/flag`, { note: 5 })).status).toBe(400);
    expect((await post(`/api/cards/${id}/flag`, {})).status).toBe(400);
  });
});

describe('GET /api/review/stats', () => {
  it('counts due, due today, reviewed today and total cards', async () => {
    const a = addCard(); // due now
    const b = addCard(); // due later today
    const c = addCard(); // due tomorrow
    const d = addCard(); // suspended
    addCard(); // new
    recordReview(db, a, { rating: 'good', answerUci: null, durationMs: 1 }, new Date(2026, 9, 17, 23).getTime());
    for (const id of [a, b, c, d]) recordReview(db, id, { rating: 'good', answerUci: null, durationMs: 1 }, NOW - HOUR);
    const setDue = db.prepare('UPDATE card_state SET due = ? WHERE card_id = ?');
    setDue.run(NOW - 1000, a);
    setDue.run(NOW + HOUR, b);
    setDue.run(new Date(2026, 9, 19, 9).getTime(), c);
    setDue.run(NOW - 1000, d);
    setSuspended(db, d, true);
    const res = await app.request('/api/review/stats');
    expect(await res.json()).toEqual({ dueNow: 1, dueToday: 2, totalCards: 4, reviewedToday: 4 });
  });
});
