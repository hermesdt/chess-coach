import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../db/db.js';
import { positionKey, setSuspended, upsertCard } from '../srs/cards-repo.js';
import { buildSession } from '../srs/session.js';
import { loadRepertoire } from './load.js';
import { syncOpeningCards } from './opening-cards.js';

const NOW = new Date(2026, 9, 18, 12, 0, 0).getTime();
let db: DatabaseSync;
beforeEach(() => {
  db = openDb(':memory:');
});

const tiny = () => loadRepertoire(JSON.parse(readFileSync('content/repertoires/__test__/tiny.json', 'utf8')));
const openingCards = () =>
  db.prepare("SELECT * FROM cards WHERE kind = 'opening' ORDER BY sort_order, id").all();

describe('syncOpeningCards', () => {
  it('creates cards only for repertoire-side moves, with solution, refs and last move', () => {
    const res = syncOpeningCards(db, [tiny()], 1);
    expect(res).toEqual({ created: 2, updated: 0, suspended: 0 });
    const rows = openingCards();
    expect(rows).toHaveLength(2);
    const first = rows[0]!;
    expect(first.prompt).toBe('Tiny Test: your move.');
    expect(first.side_to_move).toBe('black');
    expect(first.last_move_uci).toBe('e2e4');
    expect(first.sort_order).toBe(0);
    expect(JSON.parse(first.solution_json as string)).toEqual({ accepted: ['e7e5'], best: 'e7e5', explanation: 'Take the centre too.' });
    expect(JSON.parse(first.refs_json as string)).toEqual([{ repertoire: 'tiny', nodeId: 'e4 e5' }]);
    expect(rows[1]!.sort_order).toBe(1);
  });

  it('is idempotent', () => {
    syncOpeningCards(db, [tiny()], 1);
    expect(syncOpeningCards(db, [tiny()], 1)).toEqual({ created: 0, updated: 0, suspended: 0 });
    expect(openingCards()).toHaveLength(2);
  });

  it('makes a card for the start position of a white repertoire', () => {
    const rep = loadRepertoire({ id: 'w', name: 'W', color: 'white', moves: [{ san: 'd4', comment: 'Centre.', children: [{ san: 'd5' }] }] });
    expect(syncOpeningCards(db, [rep], 1).created).toBe(1);
    const row = openingCards()[0]!;
    expect(row.side_to_move).toBe('white');
    expect(row.last_move_uci).toBeNull();
  });

  it('merges a transposition into one card with two refs', () => {
    const rep = loadRepertoire({
      id: 'x', name: 'X', color: 'black',
      moves: [
        { san: 'e4', children: [{ san: 'e5', children: [{ san: 'Nf3', children: [{ san: 'Nc6', children: [{ san: 'Bc4', children: [{ san: 'Nf6' }] }] }] }] }] },
        { san: 'Nf3', children: [{ san: 'e5', children: [{ san: 'e4', children: [{ san: 'Nc6', children: [{ san: 'Bc4', children: [{ san: 'Nf6' }] }] }] }] }] },
      ],
    });
    const bc4 = rep.byId.get('e4 e5 Nf3 Nc6 Bc4')!;
    syncOpeningCards(db, [rep], 1);
    const row = db.prepare("SELECT * FROM cards WHERE position_key = ?").all(positionKey(bc4.fenAfter));
    expect(row).toHaveLength(1);
    expect(JSON.parse(row[0]!.refs_json as string)).toEqual([
      { repertoire: 'x', nodeId: 'e4 e5 Nf3 Nc6 Bc4 Nf6' },
      { repertoire: 'x', nodeId: 'Nf3 e5 e4 Nc6 Bc4 Nf6' },
    ]);
    // Cards: after e4, after Nf3, after 1.e4 e5 2.Nf3 (= 1.Nf3 e5 2.e4, merged), after Bc4 (merged).
    expect(openingCards()).toHaveLength(4);
  });

  it('updates the accepted answer when a move changes', () => {
    syncOpeningCards(db, [tiny()], 1);
    const edited = loadRepertoire({
      id: 'tiny', name: 'Tiny Test', color: 'black',
      moves: [{ san: 'e4', children: [{ san: 'c5', comment: 'Sicilian.', children: [{ san: 'Nf3', children: [{ san: 'd6' }] }] }] }],
    });
    const res = syncOpeningCards(db, [edited], 1);
    expect(res.created).toBe(1);
    expect(res.updated).toBe(1);
    expect(res.suspended).toBe(1);
    const e4 = db.prepare("SELECT * FROM cards WHERE last_move_uci = 'e2e4'").get()!;
    expect(JSON.parse(e4.solution_json as string).accepted).toEqual(['c7c5']);
    expect(JSON.parse(e4.refs_json as string)).toEqual([{ repertoire: 'tiny', nodeId: 'e4 c5' }]);
    expect(e4.suspended).toBe(0);
  });

  it('suspends cards whose node was removed', () => {
    syncOpeningCards(db, [tiny()], 1);
    const res = syncOpeningCards(db, [], 1);
    expect(res.suspended).toBe(2);
    expect(openingCards().every((r) => r.suspended === 1)).toBe(true);
    expect(syncOpeningCards(db, [], 1).suspended).toBe(0);
  });

  it('skips nodes above the level and suspends their existing cards', () => {
    const rep = loadRepertoire({
      id: 'l', name: 'L', color: 'black',
      moves: [{ san: 'e4', children: [{ san: 'e5', children: [{ san: 'Nf3', children: [{ san: 'Nc6', level: 2 }] }] }] }],
    });
    expect(syncOpeningCards(db, [rep], 1).created).toBe(1);
    expect(syncOpeningCards(db, [rep], 2).created).toBe(1);
    expect(openingCards().every((r) => r.suspended === 0)).toBe(true);
    expect(syncOpeningCards(db, [rep], 1).suspended).toBe(1);
    expect(openingCards().map((r) => r.suspended)).toEqual([0, 1]);
  });

  it('keeps FSRS-independent state: un-suspends a returning card', () => {
    syncOpeningCards(db, [tiny()], 1);
    syncOpeningCards(db, [], 1);
    syncOpeningCards(db, [tiny()], 1);
    expect(openingCards().every((r) => r.suspended === 0)).toBe(true);
  });
});

describe('session ordering', () => {
  function card(kind: 'mistake' | 'opening', n: number, sortOrder: number | null): number {
    const fen = `8/8/8/8/8/8/8/${n}K6 w - -`;
    return upsertCard(db, {
      kind, positionKey: positionKey(fen) + kind, fen, sideToMove: 'white', prompt: 'p',
      solution: { accepted: ['a1a2'], best: 'a1a2', explanation: null }, refs: [], lastMove: null, sortOrder,
    }).id;
  }

  it('alternates mistake and opening new cards, openings in sort order', () => {
    const mistakes = Array.from({ length: 5 }, (_, i) => card('mistake', i + 1, null));
    // Created in reverse of the depth-first order, so id order differs from sort order.
    const openings = [4, 3, 2, 1, 0].map((s, i) => ({ id: card('opening', i + 10, s), s }));
    const s = buildSession(db, NOW, { daily: 20, newPerDay: 4 });
    const byOrder = [...openings].sort((a, b) => a.s - b.s).map((o) => o.id);
    expect(s.cards.map((c) => c.id)).toEqual([mistakes[0], byOrder[0], mistakes[1], byOrder[1]]);
    expect(s.newAvailable).toBe(10);
  });

  it('skips a kind with no cards left', () => {
    const m = card('mistake', 1, null);
    const o1 = card('opening', 2, 0);
    const o2 = card('opening', 3, 1);
    const s = buildSession(db, NOW, { daily: 20, newPerDay: 10 });
    expect(s.cards.map((c) => c.id)).toEqual([m, o1, o2]);
  });

  it('ignores suspended new cards', () => {
    const o1 = card('opening', 2, 0);
    const o2 = card('opening', 3, 1);
    setSuspended(db, o1, true);
    expect(buildSession(db, NOW, { daily: 20, newPerDay: 10 }).cards.map((c) => c.id)).toEqual([o2]);
  });
});

describe('card order across repertoires', () => {
  it('alternates repertoires, depth-first inside each', () => {
    const white = loadRepertoire({
      id: 'a', name: 'A', color: 'white',
      moves: [{ san: 'e4', comment: 'c', children: [{ san: 'e5', children: [{ san: 'Nf3', comment: 'c', children: [{ san: 'Nc6', children: [{ san: 'Bb5', comment: 'c' }] }] }] }] }],
    });
    const black = loadRepertoire({
      id: 'b', name: 'B', color: 'black',
      moves: [{ san: 'd4', children: [{ san: 'd5', comment: 'c', children: [{ san: 'c4', children: [{ san: 'e6', comment: 'c', children: [{ san: 'Nc3', children: [{ san: 'Nf6', comment: 'c' }] }] }] }] }] }],
    });
    syncOpeningCards(db, [white, black], 1);
    const prompts = (db.prepare("SELECT prompt FROM cards WHERE kind = 'opening' ORDER BY sort_order").all() as { prompt: string }[]).map((r) => r.prompt);
    expect(prompts).toEqual(['A: your move.', 'B: your move.', 'A: your move.', 'B: your move.', 'A: your move.', 'B: your move.']);
    const second = db.prepare("SELECT sort_order, fen FROM cards WHERE kind = 'opening' ORDER BY sort_order").all() as { sort_order: number; fen: string }[];
    expect(second.map((r) => r.sort_order)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

