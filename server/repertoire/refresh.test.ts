import type { DatabaseSync } from 'node:sqlite';
import { Chess } from 'chess.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../db/db.js';
import { insertGames } from '../db/games-repo.js';
import { getSetting } from '../db/settings-repo.js';
import { loadRepertoire } from './load.js';
import { refreshOpenings, repertoireHash } from './refresh.js';

const NOW = new Date(2026, 9, 18, 12, 0, 0).getTime();

const make = (reply: string) => loadRepertoire({
  id: 'e5', name: 'E5', color: 'black',
  moves: [{ san: 'e4', children: [{ san: 'e5', comment: 'c', children: [{ san: 'Nf3', children: [{ san: reply, comment: 'c' }] }] }] }],
});
const v1 = () => make('Nc6');
const v2 = () => make('Nf6');

let db: DatabaseSync;
beforeEach(() => {
  db = openDb(':memory:');
});

function addGame(sans: string, id: string): void {
  const chess = new Chess();
  for (const s of sans.split(' ')) chess.move(s);
  insertGames(db, [{
    source: 'chesscom', sourceId: id, playedAt: NOW - 1, timeClass: 'blitz', rated: true, white: 'Me', black: 'Opp',
    whiteElo: 1000, blackElo: 1000, userColor: 'black', result: 'win', termination: null, eco: null, openingName: null,
    pgn: chess.pgn(), url: null, plyCount: sans.split(' ').length,
  }]);
}
const events = () => db.prepare('SELECT kind, node_id FROM opening_events ORDER BY game_id').all();

describe('repertoireHash', () => {
  it('changes with the moves and levels, not with the order of the list or the comments', () => {
    expect(repertoireHash([v1()])).toBe(repertoireHash([v1()]));
    expect(repertoireHash([v1()])).not.toBe(repertoireHash([v2()]));
    const a = loadRepertoire({ id: 'a', name: 'A', color: 'white', moves: [{ san: 'e4', comment: 'x' }] });
    const b = loadRepertoire({ id: 'b', name: 'B', color: 'white', moves: [{ san: 'd4', comment: 'x' }] });
    const a2 = loadRepertoire({ id: 'a', name: 'A', color: 'white', moves: [{ san: 'e4', comment: 'other words' }] });
    expect(repertoireHash([a, b])).toBe(repertoireHash([b, a]));
    expect(repertoireHash([a, b])).toBe(repertoireHash([a2, b]));
    const lvl = loadRepertoire({ id: 'a', name: 'A', color: 'white', moves: [{ san: 'e4', level: 2 }] });
    expect(repertoireHash([lvl])).not.toBe(repertoireHash([a]));
  });
});

describe('refreshOpenings', () => {
  it('syncs opening cards, scans leaks and stores the hash', () => {
    addGame('e4 e5 Nf3 Nf6', 'g1');
    refreshOpenings(db, [v1()], NOW);
    expect(db.prepare("SELECT COUNT(*) AS n FROM cards WHERE kind = 'opening'").get()).toEqual({ n: 2 });
    expect(events()).toEqual([{ kind: 'leak', node_id: 'e4 e5 Nf3 Nc6' }]);
    expect(getSetting(db, 'repertoire_hash')).toBe(repertoireHash([v1()]));
  });

  it('rescans all games when the repertoire content changed', () => {
    addGame('e4 e5 Nf3 Nc6', 'g1');
    refreshOpenings(db, [v1()], NOW);
    expect(events()).toEqual([{ kind: 'end_of_book', node_id: null }]);
    refreshOpenings(db, [v2()], NOW);
    expect(events()).toEqual([{ kind: 'leak', node_id: 'e4 e5 Nf3 Nf6' }]);
    expect(getSetting(db, 'repertoire_hash')).toBe(repertoireHash([v2()]));
  });

  it('does not rescan when the hash is unchanged', () => {
    addGame('e4 e5 Nf3 Nc6', 'g1');
    refreshOpenings(db, [v1()], NOW);
    db.prepare("UPDATE opening_events SET kind = 'marker'").run();
    refreshOpenings(db, [v1()], NOW);
    expect(events()).toEqual([{ kind: 'marker', node_id: null }]);
  });

  it('does not flag cards again for a leak that already existed after a content change', () => {
    addGame('e4 e5 Nf3 Nf6', 'g1');
    const withLevel = (comment: string) => loadRepertoire({
      id: 'e5', name: 'E5', color: 'black',
      moves: [{ san: 'e4', children: [{ san: 'e5', comment: 'c', children: [{ san: 'Nf3', children: [{ san: 'Nc6', comment }] },
        { san: 'Bc4', level: 3, children: [{ san: 'Nf6', comment: 'c' }] }] }] }],
    });
    refreshOpenings(db, [v1()], NOW);
    db.prepare('UPDATE cards SET priority = 0').run();
    refreshOpenings(db, [withLevel('c')], NOW);
    expect(repertoireHash([withLevel('c')])).not.toBe(repertoireHash([v1()]));
    expect(events()).toEqual([{ kind: 'leak', node_id: 'e4 e5 Nf3 Nc6' }]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM cards WHERE priority = 1').get()).toEqual({ n: 0 });
  });
});
