import type { DatabaseSync } from 'node:sqlite';
import { getSetting } from './db/settings-repo.js';

export type Level = 1 | 2 | 3;
export interface CurrentLevel { level: Level; rating: number | null; source: 'override' | 'games' | 'default' }

const RECENT_GAMES = 20;
const MIN_PREFERRED_GAMES = 5;
const LICHESS_OFFSET = 300;

function levelFor(rating: number): Level {
  if (rating >= 1400) return 3;
  if (rating >= 900) return 2;
  return 1;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

function recentRatings(db: DatabaseSync, onlyFast: boolean): number[] {
  const rows = db.prepare(
    `SELECT source, user_color, white_elo, black_elo FROM games
     WHERE rated = 1 AND user_color IS NOT NULL AND duplicate_of IS NULL ${onlyFast ? "AND time_class IN ('rapid', 'blitz')" : ''}
     ORDER BY played_at DESC, id DESC LIMIT ${RECENT_GAMES}`,
  ).all();
  const ratings: number[] = [];
  for (const r of rows) {
    const elo = (r.user_color === 'white' ? r.white_elo : r.black_elo) as number | null;
    if (elo === null) continue;
    ratings.push(r.source === 'lichess' ? elo - LICHESS_OFFSET : elo);
  }
  return ratings;
}

function gamesRating(db: DatabaseSync): number | null {
  let ratings = recentRatings(db, true);
  if (ratings.length < MIN_PREFERRED_GAMES) ratings = recentRatings(db, false);
  return ratings.length === 0 ? null : median(ratings);
}

export function currentLevel(db: DatabaseSync): CurrentLevel {
  const rating = gamesRating(db);
  const override = getSetting(db, 'level_override');
  if (override === '1' || override === '2' || override === '3') {
    return { level: Number(override) as Level, rating, source: 'override' };
  }
  if (rating === null) return { level: 1, rating: null, source: 'default' };
  return { level: levelFor(rating), rating, source: 'games' };
}
