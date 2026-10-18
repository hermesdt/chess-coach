import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from './db.js';
import { backupDb } from './backup.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'chess-backup-test-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('backupDb', () => {
  it('creates a dated backup file that holds the data', () => {
    const db = openDb(':memory:');
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('a', 'v');
    const path = backupDb(db, join(dir, 'nested'), new Date(2026, 9, 18));
    expect(path).toBe(join(dir, 'nested', 'chess-2026-10-18.db'));
    const copy = openDb(path);
    expect(copy.prepare('SELECT value FROM settings WHERE key = ?').get('a')?.value).toBe('v');
    copy.close();
  });

  it('does nothing on a second call the same day', () => {
    const db = openDb(':memory:');
    const now = new Date(2026, 9, 18);
    const path = backupDb(db, dir, now);
    writeFileSync(path, 'marker');
    expect(backupDb(db, dir, now)).toBe(path);
    expect(readdirSync(dir)).toEqual(['chess-2026-10-18.db']);
    expect(readdirSync(dir).length).toBe(1);
  });

  it('keeps the newest 7 backups', () => {
    const db = openDb(':memory:');
    for (let day = 1; day <= 9; day++) backupDb(db, dir, new Date(2026, 9, day));
    const files = readdirSync(dir).sort();
    expect(files).toHaveLength(7);
    expect(files[0]).toBe('chess-2026-10-03.db');
    expect(files[6]).toBe('chess-2026-10-09.db');
  });
});
