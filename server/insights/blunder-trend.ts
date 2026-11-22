import type { DatabaseSync } from 'node:sqlite';
import type { BlunderTrend } from '../../shared/types.js';

const DAY = 86_400_000;
const WEEKS = 12;

/** Local Monday 00:00 of the week that contains `ms`. */
function weekStart(ms: number): number {
  const d = new Date(ms);
  const sinceMonday = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - sinceMonday).getTime();
}

/** Blunders per game from finished analyses of non-duplicate games: by week (last 12), and the last 4 weeks against the 4 before. */
export function blunderTrend(db: DatabaseSync, now: number): BlunderTrend {
  const rows = db.prepare(`SELECT g.played_at AS at, COALESCE(json_extract(a.counts_json, '$.blunder'), 0) AS blunders
    FROM games g JOIN game_analysis a ON a.game_id = g.id
    WHERE g.duplicate_of IS NULL AND a.status = 'done' AND g.played_at < ?`).all(now) as { at: number; blunders: number }[];

  const first = new Date(weekStart(now));
  const from = new Date(first.getFullYear(), first.getMonth(), first.getDate() - 7 * (WEEKS - 1)).getTime();
  const byWeek = new Map<number, { weekStart: number; games: number; blunders: number }>();
  for (const r of rows) {
    if (r.at < from) continue;
    const w = weekStart(r.at);
    const entry = byWeek.get(w) ?? { weekStart: w, games: 0, blunders: 0 };
    entry.games += 1;
    entry.blunders += r.blunders;
    byWeek.set(w, entry);
  }

  const rate = (lo: number, hi: number): number | null => {
    const inside = rows.filter((r) => r.at >= lo && r.at < hi);
    return inside.length === 0 ? null : inside.reduce((sum, r) => sum + r.blunders, 0) / inside.length;
  };
  return {
    weeks: [...byWeek.values()].sort((a, b) => a.weekStart - b.weekStart),
    last4: rate(now - 28 * DAY, now),
    prev4: rate(now - 56 * DAY, now - 28 * DAY),
  };
}
