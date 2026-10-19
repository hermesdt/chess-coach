import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { NewGame } from '../shared/types.js';
import { openDb } from './db/db.js';
import { insertGames } from './db/games-repo.js';
import { setSetting } from './db/settings-repo.js';
import { currentLevel } from './level.js';

let db: DatabaseSync;
beforeEach(() => {
  db = openDb(':memory:');
});

let counter = 0;
function add(over: Partial<NewGame> & { elo?: number }): void {
  const { elo, ...rest } = over;
  const userColor = rest.userColor === undefined ? 'white' : rest.userColor;
  counter += 1;
  insertGames(db, [{
    source: 'chesscom', sourceId: `g${counter}`, playedAt: 1000 + counter, timeClass: 'rapid', rated: true,
    white: 'Me', black: `Opp${counter}`,
    whiteElo: userColor === 'white' ? (elo ?? 1000) : 1000, blackElo: userColor === 'black' ? (elo ?? 1000) : 1000,
    userColor, result: 'win', termination: null, eco: null, openingName: null,
    pgn: '1. e4 *', url: null, plyCount: 1, ...rest,
  }]);
}
const addMany = (n: number, over: Partial<NewGame> & { elo?: number }): void => {
  for (let i = 0; i < n; i++) add(over);
};

describe('currentLevel', () => {
  it('defaults to level 1 with no games', () => {
    expect(currentLevel(db)).toEqual({ level: 1, rating: null, source: 'default' });
  });

  it('applies the thresholds 900 and 1400', () => {
    addMany(5, { elo: 899 });
    expect(currentLevel(db)).toEqual({ level: 1, rating: 899, source: 'games' });
  });

  it('maps 900 to level 2', () => {
    addMany(5, { elo: 900 });
    expect(currentLevel(db)).toMatchObject({ level: 2, rating: 900 });
  });

  it('maps 1400 to level 3', () => {
    addMany(5, { elo: 1400 });
    expect(currentLevel(db)).toMatchObject({ level: 3, rating: 1400 });
  });

  it('subtracts 300 from lichess ratings', () => {
    addMany(5, { source: 'lichess', elo: 1500 });
    expect(currentLevel(db)).toMatchObject({ level: 2, rating: 1200 });
  });

  it('uses the user elo for black games and the median', () => {
    add({ userColor: 'black', elo: 1000 });
    add({ userColor: 'black', elo: 1100 });
    add({ userColor: 'black', elo: 2000 });
    expect(currentLevel(db)).toMatchObject({ rating: 1100, level: 2 });
  });

  it('ignores unrated games and games without user colour', () => {
    addMany(3, { rated: false, elo: 2000 });
    addMany(3, { userColor: null, elo: 2000 });
    expect(currentLevel(db)).toEqual({ level: 1, rating: null, source: 'default' });
  });

  it('prefers rapid and blitz when at least 5 exist', () => {
    addMany(5, { timeClass: 'rapid', elo: 1000 });
    addMany(10, { timeClass: 'classical', elo: 1800 });
    expect(currentLevel(db).rating).toBe(1000);
  });

  it('falls back to any time class with fewer than 5 rapid or blitz games', () => {
    addMany(4, { timeClass: 'blitz', elo: 1000 });
    addMany(10, { timeClass: 'classical', elo: 1800 });
    expect(currentLevel(db).rating).toBe(1800);
  });

  it('only looks at the last 20 games', () => {
    addMany(20, { elo: 1500 });
    // older games, lower played_at
    for (let i = 0; i < 30; i++) add({ elo: 600, playedAt: 1 + i });
    expect(currentLevel(db).rating).toBe(1500);
  });

  it('lets the override win', () => {
    addMany(5, { elo: 1800 });
    setSetting(db, 'level_override', '2');
    expect(currentLevel(db)).toEqual({ level: 2, rating: 1800, source: 'override' });
  });

  it('ignores an invalid override', () => {
    setSetting(db, 'level_override', '9');
    expect(currentLevel(db).source).toBe('default');
  });
});
