import { DatabaseSync } from 'node:sqlite';
import { migrate } from './migrate.js';

export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  if (path !== ':memory:') db.exec('PRAGMA journal_mode=WAL');
  db.exec('PRAGMA foreign_keys=ON');
  migrate(db);
  return db;
}

let savepointCounter = 0;

/** Runs fn in a SAVEPOINT. Commits on return, rolls back on throw. Calls nest. */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  const name = `sp_${savepointCounter++}`;
  db.exec(`SAVEPOINT ${name}`);
  try {
    const result = fn();
    db.exec(`RELEASE ${name}`);
    return result;
  } catch (err) {
    db.exec(`ROLLBACK TO ${name}`);
    db.exec(`RELEASE ${name}`);
    throw err;
  }
}
