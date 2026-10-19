import type { DatabaseSync } from 'node:sqlite';
import { Chess } from 'chess.js';
import { transaction } from '../db/db.js';

const DAY_MS = 86_400_000;

interface Candidate { id: number; source: string; pgn: string }

/** Mainline SAN list as one string, or null when the PGN does not parse. */
function sanKey(pgn: string): string | null {
  try {
    const chess = new Chess();
    chess.loadPgn(pgn);
    return chess.history().join(' ');
  } catch {
    return null;
  }
}

/**
 * Platform rows are distinct games by definition, so they never link to each other.
 * Only an import row can be a copy. It links to the lowest-id platform row of its group,
 * else to the lowest-id import row. Returns the canonical id for an import row.
 */
function canonicalOf(rows: Candidate[]): number {
  const platform = rows.filter((r) => r.source !== 'import');
  return Math.min(...(platform.length > 0 ? platform : rows).map((r) => r.id));
}

/** Set links for rows that share players, day and moves. Returns the number of rows whose link changed. */
function linkRows(db: DatabaseSync, rows: Candidate[]): number {
  const bySan = new Map<string, Candidate[]>();
  for (const r of rows) {
    const key = sanKey(r.pgn);
    if (key === null) continue;
    bySan.set(key, [...(bySan.get(key) ?? []), r]);
  }
  const set = db.prepare('UPDATE games SET duplicate_of = ? WHERE id = ? AND duplicate_of IS NOT ?');
  let changed = 0;
  for (const group of bySan.values()) {
    if (group.length < 2) continue;
    const canonical = canonicalOf(group);
    for (const r of group) {
      const target = r.source !== 'import' || r.id === canonical ? null : canonical;
      changed += Number(set.run(target, r.id, target).changes);
    }
  }
  return changed;
}

const SAME_GAME = `CAST(played_at / ${DAY_MS} AS INTEGER) = ? AND LOWER(white) = ? AND LOWER(black) = ? AND ply_count = ?`;

/** Link one freshly inserted game to its copies. Call inside the insert transaction. */
export function linkDuplicatesOf(db: DatabaseSync, id: number): boolean {
  const g = db.prepare('SELECT played_at, white, black, ply_count FROM games WHERE id = ?').get(id);
  if (!g) return false;
  const rows = db
    .prepare(`SELECT id, source, pgn FROM games WHERE ${SAME_GAME}`)
    .all(Math.floor(Number(g.played_at) / DAY_MS), String(g.white).toLowerCase(), String(g.black).toLowerCase(), g.ply_count as number);
  if (rows.length > 1) linkRows(db, rows as unknown as Candidate[]);
  return db.prepare('SELECT duplicate_of FROM games WHERE id = ?').get(id)?.duplicate_of != null;
}

/** Idempotent backfill for existing databases. Returns the number of links changed. */
export function linkAllDuplicates(db: DatabaseSync): number {
  const groups = db
    .prepare(
      `SELECT CAST(played_at / ${DAY_MS} AS INTEGER) AS day, LOWER(white) AS w, LOWER(black) AS b, ply_count AS p
       FROM games GROUP BY day, w, b, p HAVING COUNT(*) > 1`,
    )
    .all();
  const members = db.prepare(`SELECT id, source, pgn FROM games WHERE ${SAME_GAME}`);
  return transaction(db, () => {
    let changed = 0;
    for (const g of groups) changed += linkRows(db, members.all(g.day as number, g.w as string, g.b as string, g.p as number) as unknown as Candidate[]);
    return changed;
  });
}
