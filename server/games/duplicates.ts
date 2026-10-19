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

/** A synced copy beats an imported one. Between copies of one kind, the lower id wins. */
function canonicalOf(rows: Candidate[]): number {
  const pool = rows.some((r) => r.source !== 'import') ? rows.filter((r) => r.source !== 'import') : rows;
  return Math.min(...pool.map((r) => r.id));
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
      changed += Number(set.run(r.id === canonical ? null : canonical, r.id, r.id === canonical ? null : canonical).changes);
    }
  }
  return changed;
}

const SAME_GAME = `CAST(played_at / ${DAY_MS} AS INTEGER) = ? AND LOWER(white) = ? AND LOWER(black) = ? AND ply_count = ?`;

/** Link one freshly inserted game to its copies. Call inside the insert transaction. */
export function linkDuplicatesOf(db: DatabaseSync, id: number): void {
  const g = db.prepare('SELECT played_at, white, black, ply_count FROM games WHERE id = ?').get(id);
  if (!g) return;
  const rows = db
    .prepare(`SELECT id, source, pgn FROM games WHERE ${SAME_GAME}`)
    .all(Math.floor(Number(g.played_at) / DAY_MS), String(g.white).toLowerCase(), String(g.black).toLowerCase(), g.ply_count as number);
  if (rows.length > 1) linkRows(db, rows as unknown as Candidate[]);
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
