import type { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import type { Lesson } from '../../shared/types.js';
import { TAG_SEVERITY } from '../../shared/tag-text.js';
import type { Tag } from '../../shared/types.js';
import { getAnalysis, userMoveTags } from '../analysis/analysis-repo.js';
import { listGames } from '../db/games-repo.js';
import { getSetting, setSetting } from '../db/settings-repo.js';
import { type CurrentLevel, currentLevel, type Level } from '../level.js';
import { getLastSyncedAt } from '../sync/sync-service.js';
import type { RepNode, Repertoire } from '../repertoire/types.js';
import { reviewStats } from '../srs/stats.js';

const RECENT_GAMES = 10;
const FOCUS_GAMES = 30;
const LAST_SEEN_LEVEL = 'last_seen_level';

/** Most common tag on the user's moves, counted as the number of games it occurs in. */
function topTag(db: DatabaseSync, level: Level): { tag: Tag; count: number; games: number } | null {
  const rows = db
    .prepare(
      `SELECT g.id FROM games g JOIN game_analysis a ON a.game_id = g.id
       WHERE a.status = 'done' AND g.duplicate_of IS NULL ORDER BY g.played_at DESC, g.id DESC LIMIT ?`,
    )
    .all(FOCUS_GAMES);
  const perTag = new Map<Tag, number>();
  let games = 0;
  for (const row of rows) {
    const analysis = getAnalysis(db, Number(row.id), level);
    if (!analysis) continue;
    games += 1;
    const seen = new Set<Tag>(userMoveTags(analysis.moves));
    for (const t of seen) perTag.set(t, (perTag.get(t) ?? 0) + 1);
  }
  let best: { tag: Tag; count: number } | null = null;
  const rank = (t: Tag) => TAG_SEVERITY.indexOf(t);
  for (const [tag, count] of perTag) {
    if (!best || count > best.count || (count === best.count && rank(tag) < rank(best.tag))) best = { tag, count };
  }
  return best && { ...best, games };
}

export interface LevelUp { from: number; to: number; message: string }

/** Own-move nodes (the mover is the owner's colour) that first appear at `level`, over all repertoires. */
function countOwnLines(reps: readonly Repertoire[], level: number): number {
  const walk = (nodes: RepNode[], color: string): number =>
    nodes.reduce((sum, n) => sum + (n.level === level && n.mover === color ? 1 : 0) + walk(n.children, color), 0);
  return reps.reduce((sum, r) => sum + walk(r.roots, r.color), 0);
}

const unit = (n: number, word: string): string => `${n} new ${word}${n === 1 ? '' : 's'}`;

function levelUpMessage(to: number, lessons: readonly Lesson[], reps: readonly Repertoire[]): string {
  const newLessons = lessons.filter((l) => l.level === to).length;
  return `Level ${to} unlocked: ${unit(newLessons, 'lesson')} and ${unit(countOwnLines(reps, to), 'opening line')}.`;
}

function levelUp(db: DatabaseSync, current: CurrentLevel, getLessons: () => Lesson[], getReps: () => Repertoire[]): LevelUp | null {
  // The default level is a guess. Remember a level only once it comes from real data or an override.
  if (current.source === 'default') return null;
  const level = current.level;
  const stored = getSetting(db, LAST_SEEN_LEVEL);
  if (stored === null) {
    setSetting(db, LAST_SEEN_LEVEL, String(level));
    return null;
  }
  const from = Number(stored);
  return level > from ? { from, to: level, message: levelUpMessage(level, getLessons(), getReps()) } : null;
}

export function dashboardRoutes(db: DatabaseSync, now: () => number, getLessons: () => Lesson[], getReps: () => Repertoire[]): Hono {
  return new Hono()
    .get('/dashboard', (c) => {
      const level = currentLevel(db);
      return c.json({
        review: reviewStats(db, now(), getLessons()),
        sync: { chesscom: getLastSyncedAt(db, 'chesscom'), lichess: getLastSyncedAt(db, 'lichess') },
        recentGames: listGames(db, { limit: RECENT_GAMES }).items,
        topTag: topTag(db, level.level),
        level: { level: level.level, rating: level.rating, source: level.source },
        levelUp: levelUp(db, level, getLessons, getReps),
      });
    })
    .post('/dashboard/level-seen', (c) => {
      setSetting(db, LAST_SEEN_LEVEL, String(currentLevel(db).level));
      return c.json({ ok: true });
    });
}
