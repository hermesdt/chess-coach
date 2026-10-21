import type { DatabaseSync } from 'node:sqlite';
import type { Lesson } from '../../shared/types.js';
import { endOfLocalDay, sessionLimits, sessionSize, startOfLocalDay } from './session.js';

function count(db: DatabaseSync, sql: string, ...params: number[]): number {
  return Number((db.prepare(sql).get(...params) as { n: number }).n);
}

export function reviewStats(db: DatabaseSync, t: number, lessons: readonly Lesson[] = []) {
  return {
    dueNow: count(db, `SELECT COUNT(*) AS n FROM cards c JOIN card_state s ON s.card_id = c.id
      WHERE c.suspended = 0 AND s.due <= ?`, t),
    dueToday: count(db, `SELECT COUNT(*) AS n FROM cards c JOIN card_state s ON s.card_id = c.id
      WHERE c.suspended = 0 AND s.due < ?`, endOfLocalDay(t)),
    totalCards: count(db, 'SELECT COUNT(*) AS n FROM cards WHERE suspended = 0'),
    reviewedToday: count(db, 'SELECT COUNT(*) AS n FROM reviews WHERE reviewed_at >= ? AND reviewed_at <= ?', startOfLocalDay(t), t),
    sessionSize: sessionSize(db, t, sessionLimits(db, lessons)),
  };
}
