import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { Chess } from 'chess.js';
import { beforeEach, describe, expect, it } from 'vitest';
import type { MoveInfo, NewGame } from '../../shared/types.js';
import { openDb } from '../db/db.js';
import { insertGames } from '../db/games-repo.js';
import { parsePgn } from '../chess/pgn.js';
import { positionKey, upsertCard } from '../srs/cards-repo.js';
import { findLeak, openingMoves, scanLeaks } from './leaks.js';
import { loadRepertoire } from './load.js';
import { syncOpeningCards } from './opening-cards.js';

const NOW = new Date(2026, 9, 18, 12, 0, 0).getTime();
const load = (name: string) => loadRepertoire(JSON.parse(readFileSync(`content/repertoires/${name}.json`, 'utf8')));
const caro = load('caro-kann');
const london = load('london');

function movesOf(sans: string): MoveInfo[] {
  const chess = new Chess();
  const out: MoveInfo[] = [];
  for (const san of sans.split(' ')) {
    const fenBefore = chess.fen();
    const m = chess.move(san);
    out.push({ ply: out.length + 1, san: m.san, uci: m.from + m.to, fenBefore, fenAfter: chess.fen() });
  }
  return out;
}

describe('findLeak', () => {
  it('finds the exact leak at ply 6', () => {
    const res = findLeak(caro, movesOf('e4 c6 d4 d5 e5 Bg4 Nf3'), 'black');
    expect(res).toEqual({ kind: 'leak', nodeId: 'e4 c6 d4 d5 e5 Bf5', ply: 6, expectedSan: 'Bf5', playedSan: 'Bg4' });
  });

  it('treats an opponent deviation as out_of_book, not a leak', () => {
    const res = findLeak(caro, movesOf('e4 c6 d4 d5 h3'), 'black');
    expect(res).toEqual({ kind: 'out_of_book', nodeId: 'e4 c6 d4 d5', ply: 5, playedSan: 'h3' });
  });

  it('returns end_of_book when the game follows the repertoire to its end', () => {
    expect(findLeak(caro, movesOf('e4 c6 d4 d5 e5 Bf5'), 'black')).toEqual({ kind: 'end_of_book' });
  });

  it('returns not_this_opening for a London game as White against the Caro-Kann', () => {
    expect(findLeak(caro, movesOf('d4 d5 Bf4 Nf6'), 'white')).toEqual({ kind: 'not_this_opening' });
    expect(findLeak(london, movesOf('d4 d5 Bf4 Nf6'), 'white')).toEqual({ kind: 'end_of_book' });
  });

  it('returns not_this_opening when the first move is not a root move', () => {
    expect(findLeak(caro, movesOf('d4 d5'), 'black')).toEqual({ kind: 'not_this_opening' });
    expect(findLeak(london, movesOf('e4 e5'), 'white')).toEqual({ kind: 'not_this_opening' });
  });

  it('stops at nodes above the allowed level', () => {
    const rep = loadRepertoire({
      id: 'lv', name: 'Lv', color: 'black',
      moves: [{ san: 'e4', children: [{ san: 'e5', comment: 'c', children: [{ san: 'Nf3', children: [{ san: 'Nc6', level: 2, comment: 'c' }] }] }] }],
    });
    expect(findLeak(rep, movesOf('e4 e5 Nf3 Nf6'), 'black', 1)).toEqual({ kind: 'end_of_book' });
    expect(findLeak(rep, movesOf('e4 e5 Nf3 Nf6'), 'black', 2)).toMatchObject({ kind: 'leak', expectedSan: 'Nc6', playedSan: 'Nf6' });
  });
});

let db: DatabaseSync;
let seq = 0;
beforeEach(() => {
  db = openDb(':memory:');
  seq = 0;
});

function addGame(sans: string, userColor: 'white' | 'black' | null): number {
  seq += 1;
  const chess = new Chess();
  for (const s of sans.split(' ')) chess.move(s);
  const game: NewGame = {
    source: 'chesscom', sourceId: `g${seq}`, playedAt: NOW - seq, timeClass: 'blitz', rated: true, white: 'Me', black: 'Opp',
    whiteElo: 1000, blackElo: 1000, userColor, result: 'win', termination: null, eco: null, openingName: null,
    pgn: chess.pgn(), url: null, plyCount: parsePgn(chess.pgn()).moves.length,
  };
  insertGames(db, [game]);
  return Number((db.prepare('SELECT id FROM games WHERE source_id = ?').get(`g${seq}`) as { id: number }).id);
}

const events = () => db.prepare('SELECT * FROM opening_events ORDER BY game_id').all() as Record<string, unknown>[];

describe('scanLeaks', () => {
  it('skips duplicate copies', () => {
    const chess = new Chess();
    for (const s of 'e4 c6 d4 d5 e5 Bg4 Nf3'.split(' ')) chess.move(s);
    const copy = (source: 'import' | 'chesscom', sourceId: string): NewGame => ({
      source, sourceId, playedAt: NOW, timeClass: 'blitz', rated: true, white: 'Me', black: 'Opp', whiteElo: 1000, blackElo: 1000,
      userColor: 'black', result: 'win', termination: null, eco: null, openingName: null, pgn: chess.pgn(), url: null, plyCount: 7,
    });
    insertGames(db, [copy('import', 'a'), copy('chesscom', 'b')]);
    scanLeaks(db, [caro, london], NOW);
    expect(events().map((e) => e.game_id)).toEqual([2]);
  });

  it('records one event per game and replaces them on rescan', () => {
    const g1 = addGame('e4 c6 d4 d5 e5 Bg4 Nf3', 'black');
    const g2 = addGame('d4 d5 Bf4 Nf6', 'black');
    scanLeaks(db, [caro, london], NOW);
    expect(events()).toMatchObject([
      { game_id: g1, repertoire_id: 'caro-kann', kind: 'leak', node_id: 'e4 c6 d4 d5 e5 Bf5', ply: 6, expected_san: 'Bf5', played_san: 'Bg4' },
      { game_id: g2, kind: 'not_this_opening' },
    ]);
    scanLeaks(db, [caro, london], NOW, { rescan: true });
    expect(events()).toHaveLength(2);
  });

  it('skips games without user colour and games already scanned', () => {
    addGame('e4 c6', null);
    scanLeaks(db, [caro], NOW);
    expect(events()).toHaveLength(0);
    addGame('e4 c6 d4 d5 e5 Bg4', 'black');
    scanLeaks(db, [caro], NOW);
    scanLeaks(db, [caro], NOW);
    expect(events()).toHaveLength(1);
  });

  it('picks the repertoire of the user colour whose root move matches', () => {
    const slav = load('slav');
    const g = addGame('d4 d5 c4 c6 Nf3 Nf6 Nc3 e6 Bg5 h6', 'black');
    scanLeaks(db, [caro, slav], NOW);
    expect(events()[0]).toMatchObject({ game_id: g, repertoire_id: 'slav' });
  });

  it('makes the opening card at the leak position due now, unless suspended', () => {
    syncOpeningCards(db, [caro], 3);
    const leakFen = movesOf('e4 c6 d4 d5 e5 Bg4')[5]!.fenBefore;
    const card = db.prepare("SELECT id FROM cards WHERE kind = 'opening' AND position_key = ?").get(positionKey(leakFen)) as { id: number };
    const later = NOW + 86_400_000 * 5;
    const setState = (id: number) =>
      db.prepare("INSERT OR REPLACE INTO card_state (card_id, fsrs_json, due, last_review) VALUES (?, '{}', ?, 1)").run(id, later);
    setState(card.id);
    addGame('e4 c6 d4 d5 e5 Bg4', 'black');
    scanLeaks(db, [caro], NOW);
    expect((db.prepare('SELECT due FROM card_state WHERE card_id = ?').get(card.id) as { due: number }).due).toBe(NOW);

    setState(card.id);
    db.prepare('UPDATE cards SET suspended = 1 WHERE id = ?').run(card.id);
    scanLeaks(db, [caro], NOW, { rescan: true });
    expect((db.prepare('SELECT due FROM card_state WHERE card_id = ?').get(card.id) as { due: number }).due).toBe(later);
  });

  it('gives a new opening card priority without creating card_state', () => {
    syncOpeningCards(db, [caro], 3);
    const leakFen = movesOf('e4 c6 d4 d5 e5 Bg4')[5]!.fenBefore;
    const key = positionKey(leakFen);
    addGame('e4 c6 d4 d5 e5 Bg4', 'black');
    scanLeaks(db, [caro], NOW);
    expect(db.prepare("SELECT priority FROM cards WHERE kind = 'opening' AND position_key = ?").get(key)).toEqual({ priority: 1 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM card_state').get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM cards WHERE priority = 1").get()).toEqual({ n: 1 });
  });

  it('records leaks from games older than 30 days without flagging cards', () => {
    syncOpeningCards(db, [caro], 3);
    addGame('e4 c6 d4 d5 e5 Bg4', 'black');
    db.prepare('UPDATE games SET played_at = ?').run(NOW - 31 * 86_400_000);
    scanLeaks(db, [caro], NOW);
    expect(events()).toHaveLength(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM cards WHERE priority = 1').get()).toEqual({ n: 0 });
  });

  it('rescans games recorded at a lower level without flagging known leaks again', () => {
    syncOpeningCards(db, [caro], 3);
    const leakFen = movesOf('e4 c6 d4 d5 e5 Bg4')[5]!.fenBefore;
    const card = db.prepare("SELECT id FROM cards WHERE position_key = ?").get(positionKey(leakFen)) as { id: number };
    const setLevel = (l: string) =>
      db.prepare("INSERT INTO settings (key, value) VALUES ('level_override', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(l);
    setLevel('1');
    addGame('e4 c6 d4 d5 e5 Bg4', 'black');
    addGame('e4 c6 d4 d5 e5 Bf5 Nf3 e6', 'black');
    scanLeaks(db, [caro], NOW);
    expect(events().map((e) => e.level)).toEqual([1, 1]);
    // The user reviewed the card and it is scheduled later; a level-up rescan must not make it due again.
    const later = NOW + 5 * 86_400_000;
    db.prepare("INSERT INTO card_state (card_id, fsrs_json, due, last_review) VALUES (?, '{}', ?, 1)").run(card.id, later);
    db.prepare('UPDATE cards SET priority = 0 WHERE id = ?').run(card.id);
    setLevel('2');
    scanLeaks(db, [caro], NOW);
    expect(events().map((e) => e.level)).toEqual([2, 2]);
    expect(db.prepare('SELECT due FROM card_state WHERE card_id = ?').get(card.id)).toEqual({ due: later });
  });

  it('does not touch cards when no card exists at the position', () => {
    upsertCard(db, {
      kind: 'mistake', positionKey: 'x', fen: 'x', sideToMove: 'black', prompt: 'p',
      solution: { accepted: ['a'], best: 'a', explanation: null }, refs: [], lastMove: null,
    });
    addGame('e4 c6 d4 d5 e5 Bg4', 'black');
    expect(() => scanLeaks(db, [caro], NOW)).not.toThrow();
    expect(events()).toHaveLength(1);
  });
});

const lv = () => loadRepertoire({
  id: 'lv', name: 'Lv', color: 'black',
  moves: [{ san: 'e4', children: [{ san: 'e5', comment: 'c', children: [{ san: 'Nf3', children: [{ san: 'Nc6', level: 2, comment: 'c' }] }] }] }],
});
const setLevel = (l: string) =>
  db.prepare("INSERT INTO settings (key, value) VALUES ('level_override', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(l);

describe('scanLeaks edge cases', () => {
  it('skips games that do not start from the standard position', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/1PPPPPPP/RNBQKBNR w KQkq - 0 1';
    const chess = new Chess(fen);
    for (const s of 'e4 c6 d4 d5 e5 Bg4'.split(' ')) chess.move(s);
    chess.setHeader('SetUp', '1');
    chess.setHeader('FEN', fen);
    const pgn = chess.pgn();
    insertGames(db, [{
      source: 'chesscom', sourceId: 'odd', playedAt: NOW - 1, timeClass: 'blitz', rated: true, white: 'Me', black: 'Opp',
      whiteElo: 1000, blackElo: 1000, userColor: 'black', result: 'win', termination: null, eco: null, openingName: null,
      pgn, url: null, plyCount: 6,
    }]);
    scanLeaks(db, [caro], NOW);
    expect(events()).toMatchObject([{ kind: 'not_this_opening', repertoire_id: null }]);
  });

  it('replays only the opening of a long game and classifies it like a full replay', () => {
    const shuffle = ' Nf3 Nf6 Ng1 Ng8'.repeat(20);
    const sans = `e4 c6 d4 d5 e5 Bg4${shuffle}`;
    const long = addGame(sans, 'black');
    const fine = addGame(`e4 c6 d4 d5 e5 Bf5${shuffle}`, 'black');
    const pgn = new Chess();
    for (const s of sans.split(' ')) pgn.move(s);
    const part = openingMoves(pgn.pgn(), 10);
    expect(part).toHaveLength(10);
    expect(part).toEqual(parsePgn(pgn.pgn()).moves.slice(0, 10));
    scanLeaks(db, [caro], NOW);
    expect(events()).toMatchObject([
      { game_id: long, ...findLeakFields(findLeak(caro, movesOf(sans), 'black', 1)) },
      { game_id: fine, ...findLeakFields(findLeak(caro, movesOf(`e4 c6 d4 d5 e5 Bf5${shuffle}`), 'black', 1)) },
    ]);
  });

  it('rescans a game when the level drops, so leaks at now-locked nodes disappear', () => {
    const rep = lv();
    setLevel('2');
    addGame('e4 e5 Nf3 Nf6', 'black');
    scanLeaks(db, [rep], NOW);
    expect(events()).toMatchObject([{ kind: 'leak', node_id: 'e4 e5 Nf3 Nc6', level: 2 }]);
    setLevel('1');
    scanLeaks(db, [rep], NOW);
    expect(events()).toMatchObject([{ kind: 'end_of_book', node_id: null, level: 1 }]);
  });
});

function findLeakFields(res: ReturnType<typeof findLeak>) {
  return { kind: res.kind, node_id: 'nodeId' in res ? res.nodeId : null, ply: 'ply' in res ? res.ply : null };
}

