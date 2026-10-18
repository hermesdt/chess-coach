import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../db/db.js';
import { positionKey, recordReview, setSuspended, upsertCard } from './cards-repo.js';
import { buildSession } from './session.js';

const NOW = new Date(2026, 9, 18, 12, 0, 0).getTime();
const MIDNIGHT = new Date(2026, 9, 18, 0, 0, 0).getTime();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const LIMITS = { daily: 20, newPerDay: 10 };

let db: DatabaseSync;
let n = 0;
beforeEach(() => {
  db = openDb(':memory:');
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

/** Make a card due by giving it a review in the past (state due is set by the scheduler, so patch it). */
function addDue(dueAt: number, reviewedAt = NOW - 10 * DAY): number {
  const id = addCard();
  recordReview(db, id, { rating: 'good', answerUci: null, durationMs: 1 }, reviewedAt);
  db.prepare('UPDATE card_state SET due = ? WHERE card_id = ?').run(dueAt, id);
  return id;
}

describe('buildSession', () => {
  it('returns no cards for an empty database', () => {
    expect(buildSession(db, NOW, LIMITS)).toEqual({ cards: [], dueCount: 0, newAvailable: 0 });
  });

  it('caps the session at the daily limit with due cards first', () => {
    for (let i = 0; i < 30; i++) addDue(NOW - 1000 - i);
    for (let i = 0; i < 15; i++) addCard();
    const s = buildSession(db, NOW, LIMITS);
    expect(s.cards).toHaveLength(20);
    expect(s.cards.every((c) => !c.isNew)).toBe(true);
    expect(s.dueCount).toBe(30);
    expect(s.newAvailable).toBe(15);
  });

  it('orders due cards oldest due first', () => {
    const late = addDue(NOW - 1000);
    const early = addDue(NOW - 5000);
    expect(buildSession(db, NOW, LIMITS).cards.map((c) => c.id)).toEqual([early, late]);
  });

  it('fills the rest with new cards up to the new-per-day cap, oldest first', () => {
    for (let i = 0; i < 5; i++) addDue(NOW - 1000);
    const newIds = Array.from({ length: 15 }, () => addCard());
    const s = buildSession(db, NOW, LIMITS);
    expect(s.cards).toHaveLength(15);
    expect(s.cards.slice(0, 5).every((c) => !c.isNew && c.due !== null)).toBe(true);
    expect(s.cards.slice(5).map((c) => c.id)).toEqual(newIds.slice(0, 10));
    expect(s.cards.slice(5).every((c) => c.isNew && c.due === null)).toBe(true);
  });

  it('subtracts new cards already introduced today', () => {
    for (let i = 0; i < 3; i++) {
      const id = addCard();
      recordReview(db, id, { rating: 'good', answerUci: null, durationMs: 1 }, MIDNIGHT + HOUR);
    }
    for (let i = 0; i < 15; i++) addCard();
    const s = buildSession(db, NOW, LIMITS);
    expect(s.cards.filter((c) => c.isNew)).toHaveLength(7);
  });

  it('counts a card as introduced today by its first review, not later reviews', () => {
    const id = addCard();
    recordReview(db, id, { rating: 'good', answerUci: null, durationMs: 1 }, MIDNIGHT - HOUR);
    recordReview(db, id, { rating: 'good', answerUci: null, durationMs: 1 }, MIDNIGHT + HOUR);
    for (let i = 0; i < 12; i++) addCard();
    expect(buildSession(db, NOW, LIMITS).cards.filter((c) => c.isNew)).toHaveLength(10);
  });

  it('offers no new cards when the new cap is 0', () => {
    addCard();
    expect(buildSession(db, NOW, { daily: 20, newPerDay: 0 }).cards).toEqual([]);
  });

  it('never offers suspended cards', () => {
    const due = addDue(NOW - 1000);
    const fresh = addCard();
    setSuspended(db, due, true);
    setSuspended(db, fresh, true);
    expect(buildSession(db, NOW, LIMITS)).toEqual({ cards: [], dueCount: 0, newAvailable: 0 });
  });

  it('skips cards that are not due yet', () => {
    addDue(NOW + HOUR);
    expect(buildSession(db, NOW, LIMITS).cards).toEqual([]);
  });
});

describe('priority cards', () => {
  const addPriority = (): number => {
    const id = addCard();
    db.prepare('UPDATE cards SET priority = 1, sort_order = 999 WHERE id = ?').run(id);
    return id;
  };

  it('offers a new priority card before cards with an earlier sort_order', () => {
    const first = addCard();
    db.prepare('UPDATE cards SET sort_order = 0 WHERE id = ?').run(first);
    const p = addPriority();
    expect(buildSession(db, NOW, LIMITS).cards.map((c) => c.id).slice(0, 2)).toEqual([p, first]);
  });

  it('lets priority cards exceed the new-card cap by up to 3', () => {
    const ids = Array.from({ length: 6 }, addPriority);
    for (let i = 0; i < 4; i++) addCard();
    const s = buildSession(db, NOW, { daily: 20, newPerDay: 2 });
    expect(s.cards.map((c) => c.id)).toEqual(ids.slice(0, 5));
  });

  it('clears priority on the first review', () => {
    const p = addPriority();
    recordReview(db, p, { rating: 'good', answerUci: null, durationMs: 1 }, NOW);
    expect(db.prepare('SELECT priority FROM cards WHERE id = ?').get(p)).toEqual({ priority: 0 });
  });
});
