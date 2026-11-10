import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { GameAnalysis, MoveAnalysis } from '../../shared/types.js';
import { openDb } from '../db/db.js';
import type { EngineLine } from '../engine/uci.js';
import { listCardsByKind, listCardsByRef, threatPlies } from './cards-repo.js';
import { buildMateCards } from './mate-cards.js';
import { buildMistakeCards } from './mistake-cards.js';
import { buildThreatCards } from './threat-cards.js';

const A = '4k3/8/1b6/8/3Q4/8/8/4K3 w - - 0 1';
const A_NULL = '4k3/8/1b6/8/3Q4/8/8/4K3 b - - 0 1';
const B = '6k1/1p3ppp/8/8/8/8/8/4R1K1 b - - 0 1';
const B_NULL = '6k1/1p3ppp/8/8/8/8/8/4R1K1 w - - 0 1';
const AFTER = '4k3/8/8/8/3b4/8/8/4K3 w - - 0 1';
const M = '6k1/5ppp/8/8/3Q4/8/8/R3K1b1 w - - 0 1';

const line = (pv: string[], cp: number, multipv = 1): EngineLine => ({ multipv, score: { cp, mate: null }, pv });

function move(over: Partial<MoveAnalysis>): MoveAnalysis {
  return {
    ply: 1, san: 'Ke2', uci: 'e1e2', color: 'white', fenBefore: A,
    evalBefore: { cp: 0, mate: null }, evalAfter: { cp: 0, mate: null },
    bestUci: 'e1e2', bestSan: 'Ke2', pvSan: [],
    winBefore: 50, winAfter: 20, winLoss: 30, classification: 'blunder', tags: [], isUserMove: true,
    ...over,
  };
}

function rows(owner: Partial<MoveAnalysis>, next: Partial<MoveAnalysis> = {}): MoveAnalysis[] {
  return [
    move({ ply: 1, san: 'Nf3', uci: 'g1f3', color: 'black', isUserMove: false, classification: 'good' }),
    move({ ply: 2, ...owner }),
    move({ ply: 3, san: 'Bxd4', uci: 'b6d4', color: 'black', isUserMove: false, bestUci: 'b6d4', ...next }),
  ];
}

function analysis(moves: MoveAnalysis[]): GameAnalysis {
  return {
    gameId: 1, version: 1, status: 'done', error: null, accuracyUser: null, accuracyOpp: null,
    counts: { blunder: 0, mistake: 0, inaccuracy: 0 }, moves, keyMoments: [], analysedAt: 1,
  };
}

/** Fake pool keyed by FEN. An unknown FEN fails the test. */
function fakePool(table: Record<string, EngineLine[]>): { analyse: (fen: string) => Promise<EngineLine[]>; seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    analyse: async (fen: string) => {
      seen.push(fen);
      const lines = table[fen] ?? table[fen.split(' ').slice(0, 4).join(' ') + ' 0 1'];
      if (!lines) throw new Error(`unexpected FEN ${fen}`);
      return lines;
    },
  };
}

// Step 1 at A_NULL: Bxd4 wins the queen. Step 2 at A: Qxb6 is best, Ke2 loses.
const CAPTURE_POOL = {
  [A_NULL]: [line(['b6d4'], 900, 1), line(['e8d8'], 880, 2)],
  [A]: [line(['d4b6'], 600, 1), line(['d4d1'], 580, 2), line(['e1e2'], -900, 3)],
};
const OPTS = { nodes: 1 };

let db: DatabaseSync;
beforeEach(() => {
  db = openDb(':memory:');
});

describe('buildThreatCards', () => {
  it('builds a capture threat card', async () => {
    const r = await buildThreatCards(db, analysis(rows({})), fakePool(CAPTURE_POOL), OPTS);
    expect(r).toEqual({ created: 1, updated: 0, suspended: 0, skipped: 0 });
    const cards = listCardsByKind(db, 'threat');
    expect(cards).toHaveLength(1);
    const c = cards[0]!;
    expect(c.fen).toBe(A);
    expect(c.sideToMove).toBe('white');
    expect(c.prompt).toBe('White to move. Your opponent just played Nf3. What does it threaten?');
    expect(c.lastMove).toEqual({ uci: 'g1f3' });
    expect(c.refs).toEqual([{ gameId: 1, ply: 2 }]);
    expect(c.solution.threat).toMatchObject({ fen: A_NULL, accepted: ['b6d4'], best: 'b6d4' });
    expect(c.solution.threat!.explanation).toBe('Bxd4 takes your queen.');
    expect(c.solution.accepted).toEqual(['d4b6', 'd4d1']);
    expect(c.solution.best).toBe('d4b6');
    expect(c.solution.played).toBe('Ke2');
    expect(c.solution.explanation).toBe('In the game you played Ke2. Black played Bxd4.');
    expect(threatPlies(db, 1)).toEqual(new Set([2]));
  });

  it('builds a mate threat card without asking the engine for step 1', async () => {
    const pool = fakePool({ [B]: [line(['g8f8'], 0, 1), line(['b7b6'], -3000, 2)] });
    const moves = rows(
      { fenBefore: B, color: 'black', san: 'b6', uci: 'b7b6' },
      { san: 'Re8#', uci: 'e1e8', bestUci: 'e1e8', evalBefore: { cp: null, mate: 1 }, color: 'white' },
    );
    const r = await buildThreatCards(db, analysis(moves), pool, OPTS);
    expect(r.created).toBe(1);
    expect(pool.seen).not.toContain(B_NULL);
    const c = listCardsByKind(db, 'threat')[0]!;
    expect(c.solution.threat).toMatchObject({ fen: B_NULL, accepted: ['e1e8'], best: 'e1e8', explanation: 'Re8# is checkmate.' });
    expect(c.solution.explanation).toBe('In the game you played b6. White played Re8#.');
  });

  it('suspends the mistake card at the same ply', async () => {
    const a = analysis(rows({}));
    await buildMistakeCards(db, a, fakePool(CAPTURE_POOL), OPTS);
    expect(listCardsByKind(db, 'mistake')[0]!.suspended).toBe(false);
    const r = await buildThreatCards(db, a, fakePool(CAPTURE_POOL), OPTS);
    expect(r.suspended).toBe(1);
    expect(listCardsByKind(db, 'mistake')[0]!.suspended).toBe(true);
    expect(listCardsByKind(db, 'threat')[0]!.suspended).toBe(false);
  });

  it('buildMistakeCards makes no card at a threat ply', async () => {
    const a = analysis(rows({}));
    await buildThreatCards(db, a, fakePool(CAPTURE_POOL), OPTS);
    const r = await buildMistakeCards(db, a, fakePool(CAPTURE_POOL), OPTS);
    expect(r).toEqual({ created: 0, updated: 0, suspended: 0 });
    expect(listCardsByKind(db, 'mistake')).toHaveLength(0);
  });

  it('a mate miss wins over a threat', async () => {
    const pool = fakePool({ ...CAPTURE_POOL, [M]: CAPTURE_POOL[A] });
    const moves = rows({ fenBefore: M, evalBefore: { cp: null, mate: 1 }, bestUci: 'a1a8', bestSan: 'Ra8#' }, { uci: 'g1d4' });
    const a = analysis(moves);
    buildMateCards(db, a);
    expect(listCardsByKind(db, 'mate')).toHaveLength(1);
    const r = await buildThreatCards(db, a, pool, OPTS);
    expect(r).toEqual({ created: 0, updated: 0, suspended: 0, skipped: 0 });
    expect(listCardsByKind(db, 'threat')).toHaveLength(0);
  });

  it('skips when the engine does not confirm T', async () => {
    // T is not in the lines: the pool is asked about the position after Bxd4, where Black stays level.
    const pool = fakePool({ ...CAPTURE_POOL, [A_NULL]: [line(['e8d8'], 900, 1), line(['e8e7'], 890, 2), line(['e8f8'], 880, 3)], [AFTER]: [line(['d4d1'], 0)] });
    const r = await buildThreatCards(db, analysis(rows({})), pool, OPTS);
    expect(r.skipped).toBe(1);
    expect(r.created).toBe(0);
    expect(listCardsByKind(db, 'threat')).toHaveLength(0);
  });

  it('skips when the played move is within the step 2 margin', async () => {
    const pool = fakePool({ ...CAPTURE_POOL, [A]: [line(['d4b6'], 600, 1), line(['e1e2'], 590, 2)] });
    const r = await buildThreatCards(db, analysis(rows({})), pool, OPTS);
    expect(r).toMatchObject({ created: 0, skipped: 1 });
  });

  it('is idempotent', async () => {
    const a = analysis(rows({}));
    await buildThreatCards(db, a, fakePool(CAPTURE_POOL), OPTS);
    const r = await buildThreatCards(db, a, fakePool(CAPTURE_POOL), OPTS);
    expect(r).toMatchObject({ created: 0, updated: 1, suspended: 0 });
    expect(listCardsByKind(db, 'threat')).toHaveLength(1);
    expect(listCardsByRef(db, 1)).toHaveLength(1);
  });

  it('a dropped threat brings back the mistake card', async () => {
    const a = analysis(rows({}));
    await buildMistakeCards(db, a, fakePool(CAPTURE_POOL), OPTS);
    await buildThreatCards(db, a, fakePool(CAPTURE_POOL), OPTS);
    const unconfirmed = { ...CAPTURE_POOL, [A_NULL]: [line(['e8d8'], 900, 1)], [AFTER]: [line(['d4d1'], 0)] };
    const r = await buildThreatCards(db, a, fakePool(unconfirmed), OPTS);
    expect(r).toMatchObject({ skipped: 1, suspended: 1 });
    expect(listCardsByKind(db, 'threat')[0]!.suspended).toBe(true);
    await buildMistakeCards(db, a, fakePool(CAPTURE_POOL), OPTS);
    const mistake = listCardsByKind(db, 'mistake')[0]!;
    expect(mistake.suspended).toBe(false);
    expect(mistake.refs).toEqual([{ gameId: 1, ply: 2 }]);
  });
});
