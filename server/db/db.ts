import { DatabaseSync } from 'node:sqlite';
import { migrate } from './migrate.js';

export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  if (path !== ':memory:') db.exec('PRAGMA journal_mode=WAL');
  db.exec('PRAGMA foreign_keys=ON');
  migrate(db);
  return db;
}
