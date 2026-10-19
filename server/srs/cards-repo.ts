import type { DatabaseSync } from 'node:sqlite';
import type { Card, CardFlag, FlagDetail, CardRef, ReviewResult, ReviewSubmit } from '../../shared/types.js';
import { transaction } from '../db/db.js';
import { schedule } from './scheduler.js';

type Row = Record<string, unknown>;

/** First four FEN fields: placement, side, castling, en passant. */
export function positionKey(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

function toCard(r: Row): Card {
  return {
    id: r.id as number,
    kind: r.kind as Card['kind'],
    positionKey: r.position_key as string,
    fen: r.fen as string,
    sideToMove: r.side_to_move as Card['sideToMove'],
    prompt: r.prompt as string,
    solution: JSON.parse(r.solution_json as string) as Card['solution'],
    refs: JSON.parse(r.refs_json as string) as CardRef[],
    suspended: r.suspended === 1,
    createdAt: r.created_at as number,
    lastMove: r.last_move_uci ? { uci: r.last_move_uci as string } : null,
  };
}

function toFlag(r: Row): CardFlag {
  return { id: r.id as number, cardId: r.card_id as number, note: r.note as string, createdAt: r.created_at as number };
}

function mergeRefs(a: CardRef[], b: CardRef[]): CardRef[] {
  const seen = new Set<string>();
  const out: CardRef[] = [];
  for (const ref of [...a, ...b]) {
    const key = JSON.stringify(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

export function getCard(db: DatabaseSync, id: number): Card | null {
  const r = db.prepare('SELECT * FROM cards WHERE id = ?').get(id);
  return r ? toCard(r) : null;
}

function mustGetCard(db: DatabaseSync, id: number): Card {
  const c = getCard(db, id);
  if (!c) throw new Error(`card ${id} not found`);
  return c;
}

/**
 * Insert a card, or update the existing (kind, positionKey) card. FSRS state is kept.
 * A card with a flag stays suspended; any other suspended card is un-suspended.
 * Refs are merged unless `mergeRefs` is false.
 */
export function upsertCard(
  db: DatabaseSync,
  c: Omit<Card, 'id' | 'createdAt' | 'suspended'> & { sortOrder?: number | null },
  opts: { mergeRefs?: boolean } = {},
): Card {
  return transaction(db, () => {
    const existing = db.prepare('SELECT * FROM cards WHERE kind = ? AND position_key = ?').get(c.kind, c.positionKey);
    if (!existing) {
      const res = db.prepare(`INSERT INTO cards
        (kind, position_key, fen, side_to_move, prompt, solution_json, refs_json, last_move_uci, sort_order, suspended, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`).run(
        c.kind, c.positionKey, c.fen, c.sideToMove, c.prompt, JSON.stringify(c.solution), JSON.stringify(c.refs),
        c.lastMove?.uci ?? null, c.sortOrder ?? null, Date.now(),
      );
      return mustGetCard(db, Number(res.lastInsertRowid));
    }
    const old = toCard(existing);
    const refs = opts.mergeRefs === false ? c.refs : mergeRefs(old.refs, c.refs);
    const flagged = db.prepare('SELECT 1 FROM card_flags WHERE card_id = ? LIMIT 1').get(old.id) !== undefined;
    db.prepare(`UPDATE cards SET fen = ?, prompt = ?, solution_json = ?, refs_json = ?, last_move_uci = ?,
      sort_order = ?, suspended = ? WHERE id = ?`).run(
      c.fen, c.prompt, JSON.stringify(c.solution), JSON.stringify(refs), c.lastMove?.uci ?? null, c.sortOrder ?? null, flagged && old.suspended ? 1 : 0, old.id,
    );
    return mustGetCard(db, old.id);
  });
}

export function listCardsByKind(db: DatabaseSync, kind: Card['kind']): Card[] {
  return db.prepare('SELECT * FROM cards WHERE kind = ? ORDER BY id').all(kind).map(toCard);
}

export function setSuspended(db: DatabaseSync, id: number, suspended: boolean): void {
  db.prepare('UPDATE cards SET suspended = ? WHERE id = ?').run(suspended ? 1 : 0, id);
}

export function setRefs(db: DatabaseSync, id: number, refs: CardRef[]): void {
  db.prepare('UPDATE cards SET refs_json = ? WHERE id = ?').run(JSON.stringify(refs), id);
}

export function setSolution(db: DatabaseSync, id: number, solution: Card['solution']): void {
  db.prepare('UPDATE cards SET solution_json = ? WHERE id = ?').run(JSON.stringify(solution), id);
}

export function listCardsByRef(db: DatabaseSync, gameId: number): Card[] {
  return db.prepare('SELECT * FROM cards ORDER BY id').all()
    .map(toCard)
    .filter((c) => c.refs.some((r) => r.gameId === gameId));
}

export function recordReview(db: DatabaseSync, cardId: number, submit: ReviewSubmit, now: number): ReviewResult {
  return transaction(db, () => {
    mustGetCard(db, cardId);
    db.prepare('UPDATE cards SET priority = 0 WHERE id = ?').run(cardId);
    const prev = db.prepare('SELECT fsrs_json FROM card_state WHERE card_id = ?').get(cardId);
    const next = schedule(prev ? (prev.fsrs_json as string) : null, submit.rating, now);
    db.prepare(`INSERT INTO card_state (card_id, fsrs_json, due, last_review) VALUES (?, ?, ?, ?)
      ON CONFLICT(card_id) DO UPDATE SET fsrs_json = excluded.fsrs_json, due = excluded.due, last_review = excluded.last_review`)
      .run(cardId, next.fsrsJson, next.due, now);
    db.prepare('INSERT INTO reviews (card_id, rating, answer_uci, duration_ms, reviewed_at) VALUES (?, ?, ?, ?, ?)')
      .run(cardId, submit.rating, submit.answerUci, submit.durationMs, now);
    return { cardId, nextDue: next.due };
  });
}

/** Store a "report a problem" flag and suspend the card. */
export function addFlag(db: DatabaseSync, cardId: number, note: string, now: number): CardFlag {
  return transaction(db, () => {
    mustGetCard(db, cardId);
    const res = db.prepare('INSERT INTO card_flags (card_id, note, created_at) VALUES (?, ?, ?)').run(cardId, note, now);
    setSuspended(db, cardId, true);
    return { id: Number(res.lastInsertRowid), cardId, note, createdAt: now };
  });
}

export function listFlags(db: DatabaseSync): CardFlag[] {
  return db.prepare('SELECT * FROM card_flags ORDER BY id').all().map(toFlag);
}

export function listFlagDetails(db: DatabaseSync): FlagDetail[] {
  return db
    .prepare(
      `SELECT f.id, f.card_id, f.note, f.created_at, c.kind, c.fen, c.prompt
       FROM card_flags f JOIN cards c ON c.id = f.card_id ORDER BY f.id`,
    )
    .all()
    .map((r) => ({
      id: r.id as number, cardId: r.card_id as number, kind: r.kind as string, fen: r.fen as string,
      prompt: r.prompt as string, note: r.note as string, createdAt: r.created_at as number,
    }));
}

/** Delete every flag of the flag's card and un-suspend it. Returns false for an unknown flag. */
export function restoreFlaggedCard(db: DatabaseSync, flagId: number): boolean {
  return transaction(db, () => {
    const row = db.prepare('SELECT card_id FROM card_flags WHERE id = ?').get(flagId);
    if (!row) return false;
    const cardId = row.card_id as number;
    db.prepare('DELETE FROM card_flags WHERE card_id = ?').run(cardId);
    setSuspended(db, cardId, false);
    return true;
  });
}
