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

const KIND_ORDER = ['mistake', 'opening', 'lesson'];

/** Round-robin over kinds (mistake, opening, lesson), skipping a kind that ran out. Keeps order within a kind. */
function interleaveKinds(rows: { id: number; kind: string }[]): { id: number }[] {
  const queues = KIND_ORDER.map((k) => rows.filter((r) => r.kind === k));
  const out: { id: number }[] = [];
  for (let i = 0; queues.some((q) => i < q.length); i++) {
    for (const q of queues) if (i < q.length) out.push(q[i]!);
  }
  return out;
}

/** Opening-leak cards allowed above the daily new-card cap. */
const PRIORITY_EXTRA = 3;

export interface SessionLimits { daily: number; newPerDay: number }

/**
 * Daily session: due cards first (oldest due first), then new cards (kinds alternate; within a kind by sort_order, then id).
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
  const newRows = db.prepare(`SELECT c.id AS id, c.kind AS kind, c.priority AS priority FROM cards c
    WHERE c.suspended = 0 AND NOT EXISTS (SELECT 1 FROM card_state s WHERE s.card_id = c.id)
    ORDER BY c.sort_order IS NULL, c.sort_order, c.id`).all() as { id: number; kind: string; priority: number }[];
  const priorityIds = newRows.filter((r) => r.priority > 0);
  const newIds = [...priorityIds, ...interleaveKinds(newRows.filter((r) => r.priority === 0))];
  const introducedToday = count(db, `SELECT COUNT(*) AS n FROM
    (SELECT card_id FROM reviews GROUP BY card_id HAVING MIN(reviewed_at) >= ?)`, startOfLocalDay(now));

  const dueCards = due.slice(0, limits.daily);
  const room = limits.daily - dueCards.length;
  const capLeft = Math.max(0, limits.newPerDay - introducedToday);
  // Priority cards (opening leaks) may go over the new-card cap by up to PRIORITY_EXTRA per day.
  const extra = Math.max(0, PRIORITY_EXTRA - Math.max(0, introducedToday - limits.newPerDay));
  const priorityTaken = Math.max(0, Math.min(priorityIds.length, capLeft + extra, room));
  const newSlots = Math.max(0, Math.min(room, Math.max(capLeft, priorityTaken)));
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
