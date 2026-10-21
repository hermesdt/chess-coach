import type { DatabaseSync } from 'node:sqlite';
import type { GameAnalysis, KeyMoment, MoveAnalysis, Tag } from '../../shared/types.js';
import { LEVEL_TAGS, TAG_TO_LESSON } from '../../shared/lessons.js';
import { transaction } from '../db/db.js';
import { currentLevel, type Level } from '../level.js';

/** 2: M9 added the tags missed_fork, missed_pin, weak_back_rank and bad_bishop. */
export const ANALYSIS_VERSION = 2;

export function saveAnalysis(db: DatabaseSync, a: GameAnalysis): void {
  transaction(db, () => {
    db.prepare('DELETE FROM move_analysis WHERE game_id = ?').run(a.gameId);
    db.prepare(
      `INSERT INTO game_analysis
         (game_id, version, status, error, accuracy_user, accuracy_opp, counts_json, key_moments_json, analysed_at, user_tags_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(game_id) DO UPDATE SET
         version = excluded.version, status = excluded.status, error = excluded.error,
         accuracy_user = excluded.accuracy_user, accuracy_opp = excluded.accuracy_opp,
         counts_json = excluded.counts_json, key_moments_json = excluded.key_moments_json,
         analysed_at = excluded.analysed_at, user_tags_json = excluded.user_tags_json, cards_built_at = NULL`,
    ).run(
      a.gameId, a.version, a.status, a.error, a.accuracyUser, a.accuracyOpp,
      JSON.stringify(a.counts), JSON.stringify(a.keyMoments), a.analysedAt, JSON.stringify(tagCounts(a.moves)),
    );
    const insert = db.prepare('INSERT INTO move_analysis (game_id, ply, data_json) VALUES (?, ?, ?)');
    for (const m of a.moves) insert.run(a.gameId, m.ply, JSON.stringify(m));
  });
}

/** Every tag on the user's own moves, one entry per occurrence. */
export function userMoveTags(moves: MoveAnalysis[]): Tag[] {
  return moves.filter((m) => m.isUserMove).flatMap((m) => m.tags);
}

function tagCounts(moves: MoveAnalysis[]): Partial<Record<Tag, number>> {
  const counts: Partial<Record<Tag, number>> = {};
  for (const tag of userMoveTags(moves)) counts[tag] = (counts[tag] ?? 0) + 1;
  return counts;
}

/** Status of the stored analysis, or null when the game has none. Does not read the owner's level. */
export function analysisStatus(db: DatabaseSync, gameId: number): GameAnalysis['status'] | null {
  const row = db.prepare('SELECT status FROM game_analysis WHERE game_id = ?').get(gameId);
  return row ? (row.status as GameAnalysis['status']) : null;
}

/**
 * Reads an analysis for the owner's level. Tags above the level, and key moments that exist only because
 * of such a tag, are left out, so no caller can show them. The stored rows keep every tag.
 */
export function getAnalysis(db: DatabaseSync, gameId: number, level: Level = currentLevel(db).level): GameAnalysis | null {
  const row = db.prepare('SELECT * FROM game_analysis WHERE game_id = ?').get(gameId);
  if (!row) return null;
  const shown = LEVEL_TAGS[level];
  const moves = db.prepare('SELECT data_json FROM move_analysis WHERE game_id = ? ORDER BY ply').all(gameId)
    .map((r) => JSON.parse(String(r.data_json)) as MoveAnalysis)
    .map((m) => (m.tags.every((t) => shown.includes(t)) ? m : { ...m, tags: m.tags.filter((t) => shown.includes(t)) }));
  const isHidden = (reason: KeyMoment['reason']): boolean => reason in TAG_TO_LESSON && !shown.includes(reason as Tag);
  return {
    gameId,
    version: row.version as number,
    status: row.status as GameAnalysis['status'],
    error: (row.error as string | null) ?? null,
    accuracyUser: (row.accuracy_user as number | null) ?? null,
    accuracyOpp: (row.accuracy_opp as number | null) ?? null,
    counts: JSON.parse(String(row.counts_json)) as GameAnalysis['counts'],
    moves,
    keyMoments: (JSON.parse(String(row.key_moments_json)) as KeyMoment[]).filter((k) => !isHidden(k.reason)),
    analysedAt: (row.analysed_at as number | null) ?? null,
  };
}

/** Sets the status of a game analysis. Creates the row when missing. */
export function markAnalysis(db: DatabaseSync, gameId: number, status: GameAnalysis['status'], error: string | null = null): void {
  db.prepare(
    `INSERT INTO game_analysis (game_id, version, status, error) VALUES (?, ?, ?, ?)
     ON CONFLICT(game_id) DO UPDATE SET status = excluded.status, error = excluded.error,
       -- A failed re-analysis is final at the current version: failed analyses are not retried automatically.
       version = CASE WHEN excluded.status = 'error' THEN excluded.version ELSE game_analysis.version END`,
  ).run(gameId, ANALYSIS_VERSION, status, error);
}

/** Records that the mistake cards of an analysis are built. */
export function markCardsBuilt(db: DatabaseSync, gameId: number, at: number): void {
  db.prepare('UPDATE game_analysis SET cards_built_at = ? WHERE game_id = ?').run(at, gameId);
}
