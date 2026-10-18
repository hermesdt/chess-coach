import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Classification, GameAnalysis, MoveAnalysis, Tag } from '../../shared/types.js';
import { openDb } from '../db/db.js';
import type { EngineLine } from '../engine/uci.js';
import { listCardsByRef } from './cards-repo.js';
import { acceptedMoves, buildMistakeCards } from './mistake-cards.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const PROMO_FEN = '4k3/4P3/8/8/8/8/8/4K3 w - - 0 1';

/** Engine line whose side-to-move win % is `win`. Inverts winPct: cp = ln(w / (100 - w)) / k. */
const line = (multipv: number, win: number, move: string): EngineLine => ({
  multipv, score: { cp: Math.round(Math.log(win / (100 - win)) / 0.00368208), mate: null }, pv: [move],
});

function move(over: Partial<MoveAnalysis> = {}): MoveAnalysis {
  return {
    ply: 1, san: 'a3', uci: 'a2a3', color: 'white', fenBefore: START,
    evalBefore: { cp: 0, mate: null }, evalAfter: { cp: 0, mate: null },
    bestUci: 'e2e4', bestSan: 'e4', pvSan: [], winBefore: 80, winAfter: 40, winLoss: 40,
    classification: 'blunder', tags: [], isUserMove: true, ...over,
  };
}
function analysis(gameId: number, moves: MoveAnalysis[]): GameAnalysis {
  return {
    gameId, version: 1, status: 'done', error: null, accuracyUser: null, accuracyOpp: null,
    counts: { blunder: 0, mistake: 0, inaccuracy: 0 }, moves, keyMoments: [], analysedAt: 1,
  };
}
const pool = (lines: EngineLine[]) => ({ analyse: async (): Promise<EngineLine[]> => lines });

let db: DatabaseSync;
beforeEach(() => {
  db = openDb(':memory:');
  db.exec(`INSERT INTO games (id, source, source_id, played_at, time_class, rated, white, black, pgn, ply_count, imported_at)
    VALUES (1, 'chesscom', 'a', 1, 'blitz', 1, 'Me', 'Opp', '*', 2, 1), (2, 'chesscom', 'b', 1, 'blitz', 1, 'Me', 'Opp', '*', 2, 1)`);
});

describe('acceptedMoves', () => {
  it('accepts lines within 5 of the best', () => {
    expect(acceptedMoves([line(1, 80, 'e2e4'), line(2, 78, 'd2d4'), line(3, 40, 'a2a4')], 'a2a3')).toEqual(['e2e4', 'd2d4']);
  });
  it('accepts only the move in an only-move position', () => {
    expect(acceptedMoves([line(1, 80, 'e2e4'), line(2, 40, 'd2d4'), line(3, 30, 'a2a4')], 'a2a3')).toEqual(['e2e4']);
  });
  it('never accepts the played move', () => {
    expect(acceptedMoves([line(1, 80, 'e2e4'), line(2, 79, 'a2a3'), line(3, 78, 'd2d4')], 'a2a3')).toEqual(['e2e4', 'd2d4']);
  });
});

describe('buildMistakeCards', () => {
  const three = [line(1, 80, 'e2e4'), line(2, 78, 'd2d4'), line(3, 40, 'a2a4')];

  it('creates a card with prompt, accepted moves and explanation', async () => {
    const tags: Tag[] = ['hung_piece'];
    const res = await buildMistakeCards(db, analysis(1, [move({ tags })]), pool(three), { nodes: 10 });
    expect(res).toEqual({ created: 1, updated: 0, suspended: 0 });
    const [c] = listCardsByRef(db, 1);
    expect(c).toMatchObject({
      kind: 'mistake', fen: START, sideToMove: 'white',
      prompt: 'White to move. You played a3 here in a game. Find a better move.',
      solution: { accepted: ['e2e4', 'd2d4'], best: 'e2e4', explanation: 'Blunder — You left a piece undefended.' },
      refs: [{ gameId: 1, ply: 1 }],
    });
  });

  it('uses the classification text alone when there are no tags', async () => {
    await buildMistakeCards(db, analysis(1, [move({ classification: 'mistake' })]), pool(three), { nodes: 10 });
    expect(listCardsByRef(db, 1)[0]?.solution.explanation).toBe('Mistake');
  });

  it('ignores opponent moves and other classifications', async () => {
    const ok: Classification = 'good';
    const res = await buildMistakeCards(db, analysis(1, [move({ isUserMove: false }), move({ ply: 3, classification: ok })]), pool(three), { nodes: 10 });
    expect(res).toEqual({ created: 0, updated: 0, suspended: 0 });
  });

  it('adds a ref, not a card, when a second game reaches the same position', async () => {
    await buildMistakeCards(db, analysis(1, [move()]), pool(three), { nodes: 10 });
    const res = await buildMistakeCards(db, analysis(2, [move({ ply: 5 })]), pool(three), { nodes: 10 });
    expect(res).toEqual({ created: 0, updated: 1, suspended: 0 });
    const cards = listCardsByRef(db, 2);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.refs).toEqual([{ gameId: 1, ply: 1 }, { gameId: 2, ply: 5 }]);
  });

  it('suspends a card when re-analysis no longer finds the mistake', async () => {
    await buildMistakeCards(db, analysis(1, [move()]), pool(three), { nodes: 10 });
    const res = await buildMistakeCards(db, analysis(1, [move({ classification: 'good' })]), pool(three), { nodes: 10 });
    expect(res).toEqual({ created: 0, updated: 0, suspended: 1 });
    expect(listCardsByRef(db, 1)[0]?.suspended).toBe(true);
  });

  it('stores a promotion answer with the piece letter', async () => {
    const m = move({ fenBefore: PROMO_FEN, san: 'e8=N', uci: 'e7e8n' });
    await buildMistakeCards(db, analysis(1, [m]), pool([line(1, 90, 'e7e8q'), line(2, 20, 'e7e8n')]), { nodes: 10 });
    expect(listCardsByRef(db, 1)[0]?.solution).toMatchObject({ accepted: ['e7e8q'], best: 'e7e8q' });
  });
});
