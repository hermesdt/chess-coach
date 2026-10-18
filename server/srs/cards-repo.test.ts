import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../db/db.js';
import { addFlag, getCard, listCardsByRef, listFlags, positionKey, recordReview, setSuspended, upsertCard } from './cards-repo.js';

type NewCard = Parameters<typeof upsertCard>[1];

const FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';

function card(over: Partial<NewCard> = {}): NewCard {
  return {
    kind: 'mistake', positionKey: positionKey(FEN), fen: FEN, sideToMove: 'black',
    prompt: 'Black to move.', solution: { accepted: ['e7e5'], best: 'e7e5', explanation: null },
    refs: [{ gameId: 1, ply: 2 }], lastMove: null, ...over,
  };
}

let db: DatabaseSync;
beforeEach(() => {
  db = openDb(':memory:');
  db.exec(`INSERT INTO games (id, source, source_id, played_at, time_class, rated, white, black, pgn, ply_count, imported_at)
    VALUES (1, 'chesscom', 'a', 1, 'blitz', 1, 'Me', 'Opp', '*', 2, 1), (2, 'chesscom', 'b', 1, 'blitz', 1, 'Me', 'Opp', '*', 2, 1)`);
});

function count(table: string): number {
  return Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
}

describe('positionKey', () => {
  it('keeps the first four FEN fields', () => {
    expect(positionKey(FEN)).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3');
  });
});

describe('upsertCard', () => {
  it('inserts then returns a full card', () => {
    const c = upsertCard(db, card());
    expect(c).toMatchObject({ kind: 'mistake', suspended: false, refs: [{ gameId: 1, ply: 2 }], lastMove: null });
    expect(getCard(db, c.id)).toEqual(c);
    expect(getCard(db, 999)).toBeNull();
  });

  it('keeps one row for the same (kind, positionKey) and merges refs without duplicates', () => {
    const a = upsertCard(db, card());
    const b = upsertCard(db, card({
      refs: [{ gameId: 1, ply: 2 }, { gameId: 2, ply: 4 }],
      solution: { accepted: ['c7c5'], best: 'c7c5', explanation: 'new' },
      prompt: 'Changed.',
    }));
    expect(count('cards')).toBe(1);
    expect(b.id).toBe(a.id);
    expect(b.refs).toEqual([{ gameId: 1, ply: 2 }, { gameId: 2, ply: 4 }]);
    expect(b.solution.best).toBe('c7c5');
    expect(b.prompt).toBe('Changed.');
    expect(listCardsByRef(db, 2).map((x) => x.id)).toEqual([a.id]);
    expect(listCardsByRef(db, 3)).toEqual([]);
  });

  it('keeps different kinds for the same position as different cards', () => {
    upsertCard(db, card());
    upsertCard(db, card({ kind: 'opening' }));
    expect(count('cards')).toBe(2);
  });

  it('replaces refs when mergeRefs is false', () => {
    upsertCard(db, card());
    const b = upsertCard(db, card({ refs: [{ gameId: 2, ply: 4 }] }), { mergeRefs: false });
    expect(b.refs).toEqual([{ gameId: 2, ply: 4 }]);
  });

  it('un-suspends a card suspended without flags', () => {
    const a = upsertCard(db, card());
    setSuspended(db, a.id, true);
    expect(upsertCard(db, card()).suspended).toBe(false);
  });

  it('keeps a flagged card suspended after a later upsert', () => {
    const a = upsertCard(db, card());
    addFlag(db, a.id, 'wrong answer', 100);
    expect(upsertCard(db, card()).suspended).toBe(true);
  });
});

describe('flags', () => {
  it('stores a flag and suspends the card', () => {
    const a = upsertCard(db, card());
    const f = addFlag(db, a.id, 'bad', 123);
    expect(f).toMatchObject({ cardId: a.id, note: 'bad', createdAt: 123 });
    expect(getCard(db, a.id)?.suspended).toBe(true);
    expect(listFlags(db)).toEqual([f]);
  });
});

describe('recordReview', () => {
  it('writes a reviews row and card_state', () => {
    const a = upsertCard(db, card());
    const now = 1_700_000_000_000;
    const res = recordReview(db, a.id, { rating: 'good', answerUci: 'e7e5', durationMs: 1200 }, now);
    expect(res.cardId).toBe(a.id);
    expect(res.nextDue).toBeGreaterThan(now);
    const review = db.prepare('SELECT * FROM reviews WHERE card_id = ?').get(a.id) as Record<string, unknown>;
    expect(review).toMatchObject({ rating: 'good', answer_uci: 'e7e5', duration_ms: 1200, reviewed_at: now });
    const state = db.prepare('SELECT * FROM card_state WHERE card_id = ?').get(a.id) as Record<string, unknown>;
    expect(state).toMatchObject({ due: res.nextDue, last_review: now });
  });

  it('updates the same state row on a second review', () => {
    const a = upsertCard(db, card());
    const first = recordReview(db, a.id, { rating: 'good', answerUci: null, durationMs: 1 }, 1_700_000_000_000);
    const second = recordReview(db, a.id, { rating: 'good', answerUci: null, durationMs: 1 }, first.nextDue);
    expect(count('card_state')).toBe(1);
    expect(count('reviews')).toBe(2);
    expect(second.nextDue).toBeGreaterThan(first.nextDue);
  });

  it('throws for an unknown card', () => {
    expect(() => recordReview(db, 999, { rating: 'good', answerUci: null, durationMs: 1 }, 1)).toThrow();
  });
});

