import type { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import type { Tag } from '../../shared/types.js';
import { getAnalysis } from '../analysis/analysis-repo.js';
import { listGames } from '../db/games-repo.js';
import { getSetting, setSetting } from '../db/settings-repo.js';
import { currentLevel } from '../level.js';
import { getLastSyncedAt } from '../sync/sync-service.js';
import { reviewStats } from './review.js';

const RECENT_GAMES = 10;
const FOCUS_GAMES = 30;
const LAST_SEEN_LEVEL = 'last_seen_level';

/** Most common tag on the user's moves, counted as the number of games it occurs in. */
function topTag(db: DatabaseSync): { tag: Tag; count: number; games: number } | null {
  const rows = db
    .prepare(
      `SELECT g.id FROM games g JOIN game_analysis a ON a.game_id = g.id
       WHERE a.status = 'done' ORDER BY g.played_at DESC, g.id DESC LIMIT ?`,
    )
    .all(FOCUS_GAMES);
  const perTag = new Map<Tag, number>();
  let games = 0;
  for (const row of rows) {
    const analysis = getAnalysis(db, Number(row.id));
    if (!analysis) continue;
    games += 1;
    const seen = new Set<Tag>();
    for (const m of analysis.moves) if (m.isUserMove) for (const t of m.tags) seen.add(t);
    for (const t of seen) perTag.set(t, (perTag.get(t) ?? 0) + 1);
  }
  let best: { tag: Tag; count: number } | null = null;
  for (const [tag, count] of perTag) if (!best || count > best.count) best = { tag, count };
  return best && { ...best, games };
}

function levelUp(db: DatabaseSync, level: number): { from: number; to: number } | null {
  const stored = getSetting(db, LAST_SEEN_LEVEL);
  if (stored === null) {
    setSetting(db, LAST_SEEN_LEVEL, String(level));
    return null;
  }
  const from = Number(stored);
  return level > from ? { from, to: level } : null;
}

export function dashboardRoutes(db: DatabaseSync, now: () => number): Hono {
  return new Hono()
    .get('/dashboard', (c) => {
      const level = currentLevel(db);
      return c.json({
        review: reviewStats(db, now()),
        sync: { chesscom: getLastSyncedAt(db, 'chesscom'), lichess: getLastSyncedAt(db, 'lichess') },
        recentGames: listGames(db, { limit: RECENT_GAMES }).items,
        topTag: topTag(db),
        level: { level: level.level, rating: level.rating, source: level.source },
        levelUp: levelUp(db, level.level),
      });
    })
    .post('/dashboard/level-seen', (c) => {
      setSetting(db, LAST_SEEN_LEVEL, String(currentLevel(db).level));
      return c.json({ ok: true });
    });
}
