import type { DatabaseSync } from 'node:sqlite';
import type { PlanFile } from '../../shared/plans.js';
import type { CardKind, CardRef, CardWithState, Lesson, ReviewSession } from '../../shared/types.js';
import { getSettings } from '../config.js';
import { currentLevel, type Level } from '../level.js';
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

const KIND_ORDER: CardKind[] = ['mistake', 'opening', 'lesson', 'plan'];
/** Tie-break order for quotas and for handing out unused quota. */
const QUOTA_ORDER: CardKind[] = ['mistake', 'lesson', 'plan', 'opening'];

/** Share of the new-card cap per kind, by level. */
export const NEW_MIX: Record<Level, Record<CardKind, number>> = {
  1: { mistake: 0.4, mate: 0, lesson: 0.3, plan: 0.1, opening: 0.2 },
  2: { mistake: 0.35, mate: 0, lesson: 0.25, plan: 0.1, opening: 0.3 },
  3: { mistake: 0.3, mate: 0, lesson: 0.15, plan: 0.15, opening: 0.4 },
};

/** Split `newPerDay` by the level mix. Largest remainder; ties go to mistake, then lesson, then plan, then opening. The sum is `newPerDay`. */
export function newQuotas(level: Level, newPerDay: number): Record<CardKind, number> {
  const mix = NEW_MIX[level];
  // Work in hundredths of a card so the shares (multiples of 0.05) stay exact.
  const exact = QUOTA_ORDER.map((k) => ({ k, units: Math.round(mix[k] * 100) * newPerDay }));
  const quotas: Record<CardKind, number> = { mistake: 0, mate: 0, lesson: 0, plan: 0, opening: 0 };
  for (const e of exact) quotas[e.k] = Math.floor(e.units / 100);
  let left = newPerDay - QUOTA_ORDER.reduce((sum, k) => sum + quotas[k], 0);
  const byRemainder = [...exact].sort((a, b) => (b.units % 100) - (a.units % 100));
  for (const e of byRemainder) {
    if (left <= 0) break;
    quotas[e.k] += 1;
    left -= 1;
  }
  return quotas;
}

/** Round-robin over kinds (mistake, opening, lesson, plan), skipping a kind that ran out. Keeps order within a kind. */
function interleaveKinds(rows: { id: number; kind: string }[]): { id: number }[] {
  const queues = KIND_ORDER.map((k) => rows.filter((r) => r.kind === k));
  const out: { id: number }[] = [];
  for (let i = 0; queues.some((q) => i < q.length); i++) {
    for (const q of queues) if (i < q.length) out.push(q[i]!);
  }
  return out;
}

/** Take `slots` rows by the kind quotas. A kind with too few cards passes its quota on, in quota order. */
function pickByQuota<T extends { id: number; kind: string }>(rows: T[], slots: number, quotas: Record<CardKind, number>): T[] {
  const queues = new Map(QUOTA_ORDER.map((k) => [k, rows.filter((r) => r.kind === k)]));
  const taken = new Map<CardKind, number>(QUOTA_ORDER.map((k) => [k, Math.min(quotas[k], queues.get(k)!.length)]));
  let left = slots - [...taken.values()].reduce((a, b) => a + b, 0);
  while (left > 0) {
    const open = QUOTA_ORDER.filter((k) => taken.get(k)! < queues.get(k)!.length);
    if (open.length === 0) break;
    for (const k of open) {
      if (left <= 0) break;
      taken.set(k, taken.get(k)! + 1);
      left -= 1;
    }
  }
  const chosen = new Set(QUOTA_ORDER.flatMap((k) => queues.get(k)!.slice(0, taken.get(k)!).map((r) => r.id)));
  return rows.filter((r) => chosen.has(r.id));
}

/** Opening-leak cards allowed above the daily new-card cap. */
const PRIORITY_EXTRA = 3;

export interface SessionLimits {
  daily: number;
  newPerDay: number;
  /** Current level. Sets the mix of new cards. Default 1. */
  level?: Level;
  /** Level of each lesson. A lesson card above `level` is not served. Without it no lesson card is hidden. */
  lessonLevels?: ReadonlyMap<string, number>;
  /** Level of each plan. A plan card above `level` is not served. Without it no plan card is hidden. */
  planLevels?: ReadonlyMap<string, number>;
}

/**
 * Daily session: due cards first (oldest due first), then new cards (picked by the level quotas; kinds alternate; within a kind by sort_order, then id).
 * Total is capped by `daily`; new cards also by `newPerDay` minus cards first reviewed today.
 * `dueCount` and `newAvailable` are uncapped totals of non-suspended due / new cards.
 */
export function buildSession(
  db: DatabaseSync,
  now: number,
  limits: SessionLimits,
): ReviewSession {
  const level = limits.level ?? 1;
  const hidden = (r: { kind: string; refs_json: string }): boolean => {
    if (r.kind === 'lesson' && limits.lessonLevels) {
      const lessonId = (JSON.parse(r.refs_json) as CardRef[]).find((ref) => ref.lessonId !== undefined)?.lessonId;
      return lessonId !== undefined && (limits.lessonLevels.get(lessonId) ?? 1) > level;
    }
    if (r.kind === 'plan' && limits.planLevels) {
      const planId = (JSON.parse(r.refs_json) as CardRef[]).find((ref) => ref.planId !== undefined)?.planId;
      return planId !== undefined && (limits.planLevels.get(planId) ?? 1) > level;
    }
    return false;
  };
  const due = (db.prepare(`SELECT c.id AS id, c.kind AS kind, c.refs_json AS refs_json, s.due AS due FROM cards c JOIN card_state s ON s.card_id = c.id
    WHERE c.suspended = 0 AND s.due <= ? ORDER BY s.due, c.id`).all(now) as { id: number; kind: string; refs_json: string; due: number }[])
    .filter((r) => !hidden(r));
  const newRows = (db.prepare(`SELECT c.id AS id, c.kind AS kind, c.priority AS priority, c.refs_json AS refs_json FROM cards c
    WHERE c.suspended = 0 AND NOT EXISTS (SELECT 1 FROM card_state s WHERE s.card_id = c.id)
    ORDER BY c.sort_order IS NULL, c.sort_order, c.id`).all() as { id: number; kind: string; priority: number; refs_json: string }[])
    .filter((r) => !hidden(r));
  const priorityIds = newRows.filter((r) => r.priority > 0);
  const regular = newRows.filter((r) => r.priority === 0);
  const introducedToday = count(db, `SELECT COUNT(*) AS n FROM
    (SELECT card_id FROM reviews GROUP BY card_id HAVING MIN(reviewed_at) >= ?)`, startOfLocalDay(now));

  const dueCards = due.slice(0, limits.daily);
  const room = limits.daily - dueCards.length;
  const capLeft = Math.max(0, limits.newPerDay - introducedToday);
  // Priority cards (opening leaks) may go over the new-card cap by up to PRIORITY_EXTRA per day.
  const extra = Math.max(0, PRIORITY_EXTRA - Math.max(0, introducedToday - limits.newPerDay));
  const priorityTaken = Math.max(0, Math.min(priorityIds.length, capLeft + extra, room));
  const newSlots = Math.max(0, Math.min(room, Math.max(capLeft, priorityTaken)));
  const priorityPart = priorityIds.slice(0, newSlots);
  const regularPart = interleaveKinds(
    pickByQuota(regular, newSlots - priorityPart.length, newQuotas(level, newSlots - priorityPart.length)),
  );
  const cards = [
    ...dueCards.map((r) => withState(db, r.id, r.due)),
    ...[...priorityPart, ...regularPart].map((r) => withState(db, r.id, null)),
  ];
  return { cards, dueCount: due.length, newAvailable: newRows.length };
}

/** Number of cards in today's session. Shared by the session, stats and dashboard. */
export function sessionSize(db: DatabaseSync, now: number, limits: SessionLimits): number {
  return buildSession(db, now, limits).cards.length;
}

/** Limits from the settings, the current level and the level of each lesson and plan. */
export function sessionLimits(db: DatabaseSync, lessons: readonly Lesson[], plans: readonly PlanFile[] = []): SessionLimits {
  const { reviewDailyLimit, reviewNewPerDay } = getSettings(db);
  return {
    daily: reviewDailyLimit, newPerDay: reviewNewPerDay, level: currentLevel(db).level,
    lessonLevels: new Map(lessons.map((l) => [l.id, l.level])),
    planLevels: new Map(plans.map((p) => [p.id, p.level])),
  };
}
