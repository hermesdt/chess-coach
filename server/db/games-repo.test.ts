import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { NewGame } from '../../shared/types.js';
import { openDb } from './db.js';
import { getGameRow, insertGames, latestPlayedAt, listGames } from './games-repo.js';
import { migrate } from './migrate.js';

function game(over: Partial<NewGame>): NewGame {
  return {
    source: 'chesscom', sourceId: 'a', playedAt: 1000, timeClass: 'blitz', rated: true,
    white: 'Me', black: 'Opp', whiteElo: 1500, blackElo: 1480, userColor: 'white', result: 'win',
    termination: 'resigned', eco: 'B12', openingName: 'Caro-Kann Defense', pgn: '1. e4 c6 *',
    url: 'https://example.com/a', plyCount: 2, ...over,
  };
}

let db: DatabaseSync;
beforeEach(() => {
  db = openDb(':memory:');
});

describe('games repo', () => {
  it('ignores duplicates and lists newest first', () => {
    const games = [game({ sourceId: 'a', playedAt: 1000 }), game({ sourceId: 'b', playedAt: 2000, userColor: 'black', result: 'loss', openingName: 'Sicilian' })];
    expect(insertGames(db, games)).toEqual({ inserted: 2, duplicates: 0 });
    expect(insertGames(db, games)).toEqual({ inserted: 0, duplicates: 2 });
    const list = listGames(db, {});
    expect(list.total).toBe(2);
    expect(list.items.map((g) => g.playedAt)).toEqual([2000, 1000]);
    expect(list.items[0]?.rated).toBe(true);
    expect(list.items[0]).not.toHaveProperty('pgn');
  });

  it('filters by q, color and result', () => {
    insertGames(db, [
      game({ sourceId: 'a' }),
      game({ sourceId: 'b', playedAt: 2000, userColor: 'black', result: 'win', openingName: 'Sicilian' }),
      game({ sourceId: 'c', playedAt: 3000, userColor: 'black', result: 'loss', openingName: 'Sicilian' }),
    ]);
    expect(listGames(db, { q: 'caro' }).items.map((g) => g.sourceId)).toEqual(['a']);
    expect(listGames(db, { color: 'black', result: 'win' }).items.map((g) => g.sourceId)).toEqual(['b']);
    expect(listGames(db, { limit: 1, offset: 1 })).toMatchObject({ total: 3, items: [{ sourceId: 'b' }] });
  });

  it('getGameRow returns summary with pgn or null', () => {
    insertGames(db, [game({ sourceId: 'a' })]);
    const id = listGames(db, {}).items[0]!.id;
    expect(getGameRow(db, id)).toMatchObject({ id, pgn: '1. e4 c6 *', plyCount: 2 });
    expect(getGameRow(db, 999)).toBeNull();
  });

  it('latestPlayedAt returns max per source or null', () => {
    expect(latestPlayedAt(db, 'chesscom')).toBeNull();
    insertGames(db, [game({ sourceId: 'a', playedAt: 1000 }), game({ sourceId: 'b', playedAt: 5000 }), game({ source: 'lichess', sourceId: 'c', playedAt: 9000 })]);
    expect(latestPlayedAt(db, 'chesscom')).toBe(5000);
    expect(latestPlayedAt(db, 'import')).toBeNull();
  });

  it('migrate twice does not throw', () => {
    expect(() => migrate(db)).not.toThrow();
  });
});
