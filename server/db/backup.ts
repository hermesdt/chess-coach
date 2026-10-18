import type { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const KEEP = 7;
const FILE_PATTERN = /^chess-.*\.db$/;

const pad = (n: number) => String(n).padStart(2, '0');

/** Writes `<dir>/chess-YYYY-MM-DD.db` (once per day), then keeps the newest 7 backups. */
export function backupDb(db: DatabaseSync, dir: string, now: Date): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `chess-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.db`);
  if (!existsSync(path)) {
    const tmp = `${path}.tmp`;
    rmSync(tmp, { force: true });
    db.exec(`VACUUM INTO '${tmp.replaceAll("'", "''")}'`);
    renameSync(tmp, path);
  }
  const old = readdirSync(dir).filter((f) => FILE_PATTERN.test(f)).sort().slice(0, -KEEP);
  for (const file of old) rmSync(join(dir, file), { force: true });
  return path;
}
