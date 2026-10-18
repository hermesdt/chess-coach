import { describe, expect, it } from 'vitest';
import { openDb, transaction } from './db.js';

const count = (db: ReturnType<typeof openDb>) => Number(db.prepare('SELECT COUNT(*) AS n FROM settings').get()?.n);
const add = (db: ReturnType<typeof openDb>, key: string) =>
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, 'v');

describe('transaction', () => {
  it('commits on success and returns the value', () => {
    const db = openDb(':memory:');
    expect(transaction(db, () => { add(db, 'a'); return 7; })).toBe(7);
    expect(count(db)).toBe(1);
  });

  it('rolls back on throw and rethrows', () => {
    const db = openDb(':memory:');
    expect(() => transaction(db, () => { add(db, 'a'); throw new Error('x'); })).toThrow('x');
    expect(count(db)).toBe(0);
  });

  it('nests: an inner rollback keeps the outer work, an outer rollback drops everything', () => {
    const db = openDb(':memory:');
    transaction(db, () => {
      add(db, 'outer');
      expect(() => transaction(db, () => { add(db, 'inner'); throw new Error('x'); })).toThrow('x');
      transaction(db, () => add(db, 'inner2'));
    });
    expect(count(db)).toBe(2);

    expect(() =>
      transaction(db, () => {
        transaction(db, () => add(db, 'kept-until-outer-fails'));
        throw new Error('y');
      }),
    ).toThrow('y');
    expect(count(db)).toBe(2);
  });
});
