import type { DatabaseSync } from 'node:sqlite';
import type { CardWithState, ReviewSession } from '../../shared/types.js';
import { getCard } from './cards-repo.js';

/** Local midnight (server time) at the start of the day containing `now`. */
export function startOfLocalDay(now: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** End of the local day containing `now` (exclusive: start of the next day). */
export function endOfLocalDay(now: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}

function count(db: DatabaseSync, sql: string, ...params: number[]): number {
  return Number((db.prepare(sql).get(...params) as { n: number }).n);
}

function withState(db: DatabaseSync, id: number, due: number | null): CardWithState {
  const card = getCard(db, id);
  if (!card) throw new Error(`card ${id} not found`);
  return { ...card, due, isNew: due === null };
}

export interface SessionLimits { daily: number; newPerDay: number }

/**
 * Daily session: due cards first (oldest due first), then new cards (oldest first).
 * Total is capped by `daily`; new cards also by `newPerDay` minus cards first reviewed today.
 * `dueCount` and `newAvailable` are uncapped totals of non-suspended due / new cards.
 */
export function buildSession(
  db: DatabaseSync,
  now: number,
  limits: SessionLimits,
): ReviewSession {
  const due = db.prepare(`SELECT c.id AS id, s.due AS due FROM cards c JOIN card_state s ON s.card_id = c.id
    WHERE c.suspended = 0 AND s.due <= ? ORDER BY s.due, c.id`).all(now) as { id: number; due: number }[];
  const newIds = db.prepare(`SELECT c.id AS id FROM cards c
    WHERE c.suspended = 0 AND NOT EXISTS (SELECT 1 FROM card_state s WHERE s.card_id = c.id)
    ORDER BY c.id`).all() as { id: number }[];
  const introducedToday = count(db, `SELECT COUNT(*) AS n FROM
    (SELECT card_id FROM reviews GROUP BY card_id HAVING MIN(reviewed_at) >= ?)`, startOfLocalDay(now));

  const dueCards = due.slice(0, limits.daily);
  const newSlots = Math.max(0, Math.min(limits.daily - dueCards.length, limits.newPerDay - introducedToday));
  const cards = [
    ...dueCards.map((r) => withState(db, r.id, r.due)),
    ...newIds.slice(0, newSlots).map((r) => withState(db, r.id, null)),
  ];
  return { cards, dueCount: due.length, newAvailable: newIds.length };
}

/** Number of cards in today's session. Shared by the session, stats and dashboard. */
export function sessionSize(db: DatabaseSync, now: number, limits: SessionLimits): number {
  return buildSession(db, now, limits).cards.length;
}
