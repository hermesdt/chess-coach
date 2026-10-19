import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { AnalysisBadge, GameList, GameListQuery, GameSummary, NewGame, Source } from '../../shared/types.js';
import { linkDuplicatesOf } from '../games/duplicates.js';
import { transaction } from './db.js';

type Row = Record<string, unknown>;

function toSummary(r: Row): GameSummary {
  return {
    id: r.id as number,
    source: r.source as GameSummary['source'],
    sourceId: r.source_id as string,
    playedAt: r.played_at as number,
    timeClass: r.time_class as GameSummary['timeClass'],
    rated: r.rated === 1,
    white: r.white as string,
    black: r.black as string,
    whiteElo: r.white_elo as number | null,
    blackElo: r.black_elo as number | null,
    userColor: r.user_color as GameSummary['userColor'],
    result: r.result as GameSummary['result'],
    termination: r.termination as string | null,
    eco: r.eco as string | null,
    openingName: r.opening_name as string | null,
    url: r.url as string | null,
    plyCount: r.ply_count as number,
    ...badge(r),
  };
}

function badge(r: Row): { analysis?: AnalysisBadge } {
  if (r.a_status === null || r.a_status === undefined) return {};
  const status = r.a_status as AnalysisBadge['status'];
  if (status !== 'done') return { analysis: { accuracyUser: null, blunders: 0, mistakes: 0, status } };
  const counts = JSON.parse(String(r.a_counts)) as { blunder: number; mistake: number };
  return {
    analysis: { accuracyUser: (r.a_accuracy as number | null) ?? null, blunders: counts.blunder, mistakes: counts.mistake, status },
  };
}

export function insertGames(db: DatabaseSync, games: NewGame[]): { inserted: number; duplicates: number } {
  const stmt = db.prepare(`INSERT OR IGNORE INTO games
    (source, source_id, played_at, time_class, rated, white, black, white_elo, black_elo, user_color, result,
     termination, eco, opening_name, pgn, url, ply_count, imported_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let inserted = 0;
  const now = Date.now();
  transaction(db, () => {
    for (const g of games) {
      const res = stmt.run(
        g.source, g.sourceId, g.playedAt, g.timeClass, g.rated ? 1 : 0, g.white, g.black, g.whiteElo, g.blackElo,
        g.userColor, g.result, g.termination, g.eco, g.openingName, g.pgn, g.url, g.plyCount, now,
      );
      if (Number(res.changes) > 0) {
        inserted += 1;
        linkDuplicatesOf(db, Number(res.lastInsertRowid));
      }
    }
  });
  return { inserted, duplicates: games.length - inserted };
}

export function listGames(db: DatabaseSync, q: GameListQuery): GameList {
  const where: string[] = [];
  const params: SQLInputValue[] = [];
  if (!q.includeDuplicates) where.push('duplicate_of IS NULL');
  if (q.source) { where.push('source = ?'); params.push(q.source); }
  if (q.color) { where.push('user_color = ?'); params.push(q.color); }
  if (q.result) { where.push('result = ?'); params.push(q.result); }
  if (q.q) {
    where.push("(white LIKE ? ESCAPE '\\' OR black LIKE ? ESCAPE '\\' OR opening_name LIKE ? ESCAPE '\\')");
    const like = `%${q.q.replace(/[\\%_]/g, '\\$&')}%`;
    params.push(like, like, like);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = Number(db.prepare(`SELECT COUNT(*) AS n FROM games ${clause}`).get(...params)?.n ?? 0);
  const rows = db
    .prepare(
      `SELECT g.*, a.status AS a_status, a.accuracy_user AS a_accuracy, a.counts_json AS a_counts
       FROM games g LEFT JOIN game_analysis a ON a.game_id = g.id
       ${clause} ORDER BY g.played_at DESC, g.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, q.limit ?? 50, q.offset ?? 0);
  return { items: rows.map(toSummary), total };
}

export function getGameRow(db: DatabaseSync, id: number): (GameSummary & { pgn: string }) | null {
  const row = db.prepare('SELECT * FROM games WHERE id = ?').get(id);
  return row ? { ...toSummary(row), pgn: row.pgn as string } : null;
}

export function latestPlayedAt(db: DatabaseSync, source: Source): number | null {
  const row = db.prepare('SELECT MAX(played_at) AS m FROM games WHERE source = ?').get(source);
  return row && row.m !== null ? Number(row.m) : null;
}

export function latestPlayedAtFor(db: DatabaseSync, source: Source, username: string): number | null {
  const row = db
    .prepare('SELECT MAX(played_at) AS m FROM games WHERE source = ? AND (LOWER(white) = LOWER(?) OR LOWER(black) = LOWER(?))')
    .get(source, username, username);
  return row && row.m !== null ? Number(row.m) : null;
}
