import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { NewGame } from '../../shared/types.js';
import { openDb } from '../db/db.js';
import { insertGames, listGames } from '../db/games-repo.js';
import { eligibleUnanalysed } from '../analysis/queue.js';
import { getInsights } from '../insights/insights.js';
import { linkAllDuplicates } from './duplicates.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 5, 1, 10, 0, 0);
const LINE_A = '1. e4 c6 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Bf5 5. Ng3 Bg6 6. h4 h6 7. Nf3 Nd7 *';
const LINE_B = '1. e4 c6 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Bf5 5. Ng3 Bg6 6. h4 h6 7. Nf3 Ngf6 *';

function game(over: Partial<NewGame>): NewGame {
  return {
    source: 'import', sourceId: 'x', playedAt: T0, timeClass: 'blitz', rated: true,
    white: 'Opp', black: 'Me', whiteElo: 1500, blackElo: 1480, userColor: 'black', result: 'win',
    termination: 'resigned', eco: 'B12', openingName: 'Caro-Kann Defense', pgn: LINE_A,
    url: null, plyCount: 14, ...over,
  };
}

const links = (db: DatabaseSync) =>
  db.prepare('SELECT id, duplicate_of FROM games ORDER BY id').all().map((r) => [r.id, r.duplicate_of]);

let db: DatabaseSync;
beforeEach(() => { db = openDb(':memory:'); });

describe('duplicate links', () => {
  it('links an imported copy to the synced copy, in either arrival order', () => {
    insertGames(db, [game({ sourceId: 'imp1' })]);
    insertGames(db, [game({ source: 'chesscom', sourceId: 'cc1', white: 'OPP', playedAt: T0 + 5000 })]);
    expect(links(db)).toEqual([[1, 2], [2, null]]);

    const db2 = openDb(':memory:');
    insertGames(db2, [game({ source: 'chesscom', sourceId: 'cc1' })]);
    insertGames(db2, [game({ sourceId: 'imp1' })]);
    expect(links(db2)).toEqual([[1, null], [2, 1]]);
  });

  it('does not merge different games between the same players on the same day', () => {
    insertGames(db, [game({ sourceId: 'a' }), game({ source: 'chesscom', sourceId: 'b', pgn: LINE_B })]);
    expect(links(db)).toEqual([[1, null], [2, null]]);
  });

  it('does not merge identical games on different days, or with swapped colours', () => {
    insertGames(db, [
      game({ sourceId: 'a' }),
      game({ source: 'chesscom', sourceId: 'b', playedAt: T0 + DAY }),
      game({ source: 'lichess', sourceId: 'c', white: 'Me', black: 'Opp' }),
    ]);
    expect(links(db)).toEqual([[1, null], [2, null], [3, null]]);
  });

  it('re-points links when the canonical copy changes, so links never chain', () => {
    insertGames(db, [game({ sourceId: 'a' }), game({ sourceId: 'b' })]);
    expect(links(db)).toEqual([[1, null], [2, 1]]);
    insertGames(db, [game({ source: 'lichess', sourceId: 'c' })]);
    expect(links(db)).toEqual([[1, 3], [2, 3], [3, null]]);
  });

  it('never links two platform rows, even with the same players, day and moves', () => {
    insertGames(db, [game({ source: 'chesscom', sourceId: 'r1' }), game({ source: 'chesscom', sourceId: 'r2' })]);
    expect(links(db)).toEqual([[1, null], [2, null]]);
    insertGames(db, [game({ sourceId: 'imp' })]);
    expect(links(db)).toEqual([[1, null], [2, null], [3, 1]]);
    db.exec('UPDATE games SET duplicate_of = NULL');
    linkAllDuplicates(db);
    expect(links(db)).toEqual([[1, null], [2, null], [3, 1]]);
  });

  it('counts an imported copy of a synced game as a duplicate, not as inserted', () => {
    insertGames(db, [game({ source: 'chesscom', sourceId: 'cc' })]);
    expect(insertGames(db, [game({ sourceId: 'imp' })])).toEqual({ inserted: 0, duplicates: 1 });
  });

  it('backfills existing databases and is idempotent', () => {
    insertGames(db, [game({ sourceId: 'a' }), game({ source: 'chesscom', sourceId: 'b' }), game({ source: 'chesscom', sourceId: 'c', pgn: LINE_B })]);
    db.exec('UPDATE games SET duplicate_of = NULL');
    expect(linkAllDuplicates(db)).toBe(1);
    expect(links(db)).toEqual([[1, 2], [2, null], [3, null]]);
    expect(linkAllDuplicates(db)).toBe(0);
    expect(links(db)).toEqual([[1, 2], [2, null], [3, null]]);
  });

  it('hides duplicates from lists, insights and analysis eligibility', () => {
    insertGames(db, [game({ sourceId: 'a' }), game({ source: 'chesscom', sourceId: 'b' })]);
    expect(listGames(db, {}).items.map((g) => g.id)).toEqual([2]);
    expect(listGames(db, {}).total).toBe(1);
    expect(listGames(db, { includeDuplicates: true }).total).toBe(2);
    expect(eligibleUnanalysed(db, 10)).toEqual([2]);
    expect(getInsights(db, 'all', T0).summary.games).toBe(1);
  });
});
