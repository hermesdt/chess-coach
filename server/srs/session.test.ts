import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../db/db.js';
import { positionKey, recordReview, setSuspended, upsertCard } from './cards-repo.js';
import type { CardKind } from '../../shared/types.js';
import { buildSession, NEW_MIX, newQuotas } from './session.js';

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

describe('newQuotas', () => {
  it('splits a daily cap by the level mix', () => {
    expect(newQuotas(1, 10)).toEqual({ mistake: 4, mate: 1, lesson: 3, plan: 1, opening: 1 });
    expect(newQuotas(2, 10)).toEqual({ mistake: 3, mate: 1, lesson: 3, plan: 1, opening: 2 });
    expect(newQuotas(3, 10)).toEqual({ mistake: 3, mate: 1, lesson: 2, plan: 1, opening: 3 });
    expect(newQuotas(1, 20)).toEqual({ mistake: 7, mate: 2, lesson: 6, plan: 2, opening: 3 });
  });

  it('gives mate cards 10 % at every level', () => {
    for (const level of [1, 2, 3] as const) expect(NEW_MIX[level].mate).toBe(0.1);
  });

  it('keeps the sum equal to the cap, with ties going to mistake, then lesson, then opening', () => {
    expect(newQuotas(3, 2)).toEqual({ mistake: 1, mate: 0, lesson: 0, plan: 0, opening: 1 });
    for (const level of [1, 2, 3] as const) {
      for (let cap = 0; cap <= 40; cap++) {
        const q = newQuotas(level, cap);
        expect(q.mistake + q.mate + q.lesson + q.plan + q.opening).toBe(cap);
      }
    }
    expect(newQuotas(2, 1)).toEqual({ mistake: 1, mate: 0, lesson: 0, plan: 0, opening: 0 });
  });

  it('has shares that add up to 1 at every level', () => {
    for (const level of [1, 2, 3] as const) {
      const m = NEW_MIX[level];
      expect(m.mistake + m.mate + m.lesson + m.plan + m.opening).toBeCloseTo(1);
    }
  });
});

describe('level mix in the session', () => {
  const addKind = (kind: CardKind, lessonId?: string): number => {
    n += 1;
    const fen = `8/8/8/8/8/8/8/${n}K6 w - -`;
    return upsertCard(db, {
      kind, positionKey: positionKey(fen), fen, sideToMove: 'white', prompt: `${kind}${n}`,
      solution: { accepted: ['a1a2'], best: 'a1a2', explanation: null },
      refs: lessonId ? [{ lessonId, exerciseId: 'e' }] : [], lastMove: null,
    }).id;
  };
  const kinds = (ids: number[]) => ids.map((id) => (db.prepare('SELECT kind FROM cards WHERE id = ?').get(id) as { kind: string }).kind);
  const count = (s: ReturnType<typeof buildSession>, kind: string) => kinds(s.cards.map((c) => c.id)).filter((k) => k === kind).length;

  it('serves new cards by the level-3 quotas', () => {
    for (let i = 0; i < 10; i++) { addKind('mistake'); addKind('lesson', 'a'); addKind('opening'); }
    const s = buildSession(db, NOW, { daily: 20, newPerDay: 10, level: 3 });
    expect([count(s, 'mistake'), count(s, 'lesson'), count(s, 'opening')]).toEqual([4, 3, 3]);
  });

  it('keeps the interleaving of kinds inside the session', () => {
    for (let i = 0; i < 10; i++) { addKind('mistake'); addKind('lesson', 'a'); addKind('opening'); }
    const s = buildSession(db, NOW, { daily: 20, newPerDay: 10, level: 1 });
    expect(kinds(s.cards.map((c) => c.id)).slice(0, 3)).toEqual(['mistake', 'opening', 'lesson']);
  });

  it('serves mate cards by their quota', () => {
    for (let i = 0; i < 10; i++) { addKind('mistake'); addKind('mate'); addKind('lesson', 'a'); addKind('opening'); }
    const s = buildSession(db, NOW, { daily: 20, newPerDay: 10, level: 3 });
    expect([count(s, 'mistake'), count(s, 'mate'), count(s, 'lesson'), count(s, 'opening')]).toEqual([4, 1, 2, 3]);
  });

  it('gives the unused quota of a kind to the other kinds', () => {
    for (let i = 0; i < 10; i++) addKind('mistake');
    addKind('opening');
    const s = buildSession(db, NOW, { daily: 20, newPerDay: 10, level: 3 });
    expect([count(s, 'mistake'), count(s, 'opening')]).toEqual([9, 1]);
  });

  it('shows a lesson card at a zero lesson quota when no other kind has a new card', () => {
    expect(newQuotas(3, 2).lesson).toBe(0);
    addKind('lesson', 'a');
    addKind('lesson', 'a');
    const s = buildSession(db, NOW, { daily: 20, newPerDay: 2, level: 3 });
    expect(count(s, 'lesson')).toBe(2);
  });

  const addPlan = (planId: string): number => {
    n += 1;
    const fen = `8/8/8/8/8/8/8/${n}K6 w - -`;
    return upsertCard(db, {
      kind: 'plan', positionKey: positionKey(fen), fen, sideToMove: 'white', prompt: `plan${n}`,
      solution: { accepted: ['a1a2'], best: 'a1a2', explanation: null }, refs: [{ planId, exerciseId: 'e' }], lastMove: null,
    }).id;
  };

  it('serves plan cards by the level-1 quota (two of twenty) and interleaves them last', () => {
    for (let i = 0; i < 10; i++) { addKind('mistake'); addKind('lesson', 'a'); addPlan('p'); addKind('opening'); }
    const s = buildSession(db, NOW, { daily: 40, newPerDay: 20, level: 1 });
    expect([count(s, 'mistake'), count(s, 'lesson'), count(s, 'plan'), count(s, 'opening')]).toEqual([8, 7, 2, 3]);
    expect(kinds(s.cards.map((c) => c.id)).slice(0, 4)).toEqual(['mistake', 'opening', 'lesson', 'plan']);
  });

  it('does not serve a plan card above the level, and serves it at the level', () => {
    addPlan('hard');
    const planLevels = new Map([['hard', 2]]);
    expect(buildSession(db, NOW, { daily: 20, newPerDay: 10, level: 1, planLevels }).cards).toHaveLength(0);
    expect(buildSession(db, NOW, { daily: 20, newPerDay: 10, level: 2, planLevels }).cards).toHaveLength(1);
  });

  it('passes an unused plan quota on in the order mistake, lesson, opening', () => {
    for (let i = 0; i < 10; i++) { addKind('mistake'); addKind('lesson', 'a'); addKind('opening'); }
    const s = buildSession(db, NOW, { daily: 40, newPerDay: 20, level: 1 });
    expect([count(s, 'mistake'), count(s, 'lesson'), count(s, 'plan'), count(s, 'opening')]).toEqual([9, 7, 0, 4]);
  });

  it('keeps the priority extra cards outside the quotas', () => {
    const ids = Array.from({ length: 4 }, () => addKind('opening'));
    for (const id of ids) db.prepare('UPDATE cards SET priority = 1 WHERE id = ?').run(id);
    for (let i = 0; i < 5; i++) addKind('mistake');
    const s = buildSession(db, NOW, { daily: 20, newPerDay: 2, level: 1 });
    expect(s.cards.map((c) => c.id).slice(0, 4)).toEqual(ids);
  });

  it('hides lesson cards above the level without deleting rows, and serves them again at that level', () => {
    const low = addKind('lesson', 'tactics');
    const high = addKind('lesson', 'pawn-structures');
    const levels = new Map([['tactics', 1], ['pawn-structures', 2]]);
    const limits = { daily: 20, newPerDay: 10, lessonLevels: levels };
    expect(buildSession(db, NOW, { ...limits, level: 1 }).cards.map((c) => c.id)).toEqual([low]);
    expect(buildSession(db, NOW, { ...limits, level: 1 }).newAvailable).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM cards WHERE kind = 'lesson'").get()).toEqual({ n: 2 });
    expect(buildSession(db, NOW, { ...limits, level: 2 }).cards.map((c) => c.id).sort()).toEqual([low, high].sort());
  });

  it('hides a due lesson card above the level and keeps its review state', () => {
    const high = addKind('lesson', 'pawn-structures');
    recordReview(db, high, { rating: 'good', answerUci: null, durationMs: 1 }, NOW - 10 * DAY);
    db.prepare('UPDATE card_state SET due = ? WHERE card_id = ?').run(NOW - 1000, high);
    const limits = { daily: 20, newPerDay: 10, lessonLevels: new Map([['pawn-structures', 2]]) };
    expect(buildSession(db, NOW, { ...limits, level: 1 })).toEqual({ cards: [], dueCount: 0, newAvailable: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM card_state WHERE card_id = ?').get(high)).toEqual({ n: 1 });
    expect(buildSession(db, NOW, { ...limits, level: 2 }).dueCount).toBe(1);
  });
});
