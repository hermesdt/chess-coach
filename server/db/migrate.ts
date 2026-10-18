import { readdirSync, readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { transaction } from './db.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));

export function migrate(db: DatabaseSync): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER)');
  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((r) => String(r.version)),
  );
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(MIGRATIONS_DIR + file, 'utf8');
    transaction(db, () => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(file, Date.now());
    });
  }
}
