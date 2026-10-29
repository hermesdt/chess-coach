import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { GameAnalysis, MoveAnalysis } from '../../shared/types.js';
import { saveAnalysis } from '../analysis/analysis-repo.js';
import { openDb } from '../db/db.js';
import { addFlag, listCardsByKind, listCardsByRef, positionKey, recordReview, upsertCard } from './cards-repo.js';
import { buildMateCards, findMateMisses, syncMateCards } from './mate-cards.js';
import { buildMistakeCards } from './mistake-cards.js';

const M1 = '6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1';
const M2W = '7k/8/8/8/8/8/1R6/R3K3 w - - 0 1';
const M2B = 'r3k3/1r6/8/8/8/8/8/7K b - - 0 1';
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function move(over: Partial<MoveAnalysis>): MoveAnalysis {
  return {
    ply: 1, san: 'Ra7', uci: 'a1a7', color: 'white', fenBefore: M1,
    evalBefore: { cp: null, mate: 1 }, evalAfter: { cp: 500, mate: null },
    bestUci: 'a1a8', bestSan: 'Ra8#', pvSan: ['Ra8#'],
    winBefore: 100, winAfter: 90, winLoss: 10, classification: 'good', tags: ['missed_mate'], isUserMove: true,
    ...over,
  };
}

describe('findMateMisses', () => {
  it('ignores a fastest mate that was played', () => {
    const r = findMateMisses([move({ san: 'Ra8#', uci: 'a1a8' })]);
    expect(r).toEqual({ misses: [], skipped: 0 });
  });

  it('finds a missed mate in 1 and keeps the played move', () => {
    const { misses, skipped } = findMateMisses([move({})]);
    expect(skipped).toBe(0);
    expect(misses).toHaveLength(1);
    expect(misses[0]).toMatchObject({ ply: 1, fen: M1, color: 'white', mateIn: 1, accepted: ['a1a8'], best: 'a1a8', playedSan: 'Ra7', line: ['Ra8#'] });
  });

  it('finds a missed mate in 2 as Black', () => {
    const { misses } = findMateMisses([move({
      color: 'black', fenBefore: M2B, evalBefore: { cp: null, mate: 2 }, san: 'Ra7', uci: 'a8a7',
      bestUci: 'a8a2', bestSan: 'Ra2', pvSan: [],
    })]);
    expect(misses).toHaveLength(1);
    expect(misses[0]!.mateIn).toBe(2);
    expect(misses[0]!.accepted).toEqual(expect.arrayContaining(['a8a2', 'b7b2']));
    expect(misses[0]!.color).toBe('black');
  });

  it('ignores a played move that mates faster than the stored mate', () => {
    const r = findMateMisses([move({ evalBefore: { cp: null, mate: 2 }, san: 'Ra8#', uci: 'a1a8' })]);
    expect(r).toEqual({ misses: [], skipped: 1 });
  });

  it('skips a stored mate that chess.js cannot confirm', () => {
    const r = findMateMisses([move({ fenBefore: START, san: 'e4', uci: 'e2e4' })]);
    expect(r).toEqual({ misses: [], skipped: 1 });
  });

  it('ignores other moves, no mate and long mates', () => {
    const rows = [
      move({ isUserMove: false }),
      move({ evalBefore: { cp: 100, mate: null } }),
      move({ evalBefore: { cp: null, mate: -1 } }),
      move({ evalBefore: { cp: null, mate: 3 } }),
    ];
    expect(findMateMisses(rows)).toEqual({ misses: [], skipped: 0 });
  });

  it('keeps the engine line when it replays to mate', () => {
    const { misses } = findMateMisses([move({
      fenBefore: M2W, evalBefore: { cp: null, mate: 2 }, san: 'Kd2', uci: 'e1d2',
      bestUci: 'a1a7', bestSan: 'Ra7', pvSan: ['Ra7', 'Kg8', 'Rb8#'],
    })]);
    expect(misses[0]!.best).toBe('a1a7');
    expect(misses[0]!.line).toEqual(['Ra7', 'Kg8', 'Rb8#']);
  });

  it('drops the line when it starts with another move than the best move', () => {
    const { misses } = findMateMisses([move({
      fenBefore: M2W, evalBefore: { cp: null, mate: 2 }, san: 'Kd2', uci: 'e1d2',
      bestUci: 'b2b7', bestSan: 'Rb7', pvSan: ['Ra7', 'Kg8', 'Rb8#'],
    })]);
    expect(misses[0]!.best).toBe('b2b7');
    expect(misses[0]!.line).toBeNull();
  });

  it('uses the first accepted move when the engine move is not a mate', () => {
    const { misses } = findMateMisses([move({ bestUci: 'a1a7', bestSan: 'Ra7', san: 'Kd2', uci: 'e1d2' })]);
    expect(misses[0]!.best).toBe('a1a8');
  });
});

// --- cards ---
function analysis(gameId: number, moves: MoveAnalysis[], version = 2): GameAnalysis {
  return {
    gameId, version, status: 'done', error: null, accuracyUser: null, accuracyOpp: null,
    counts: { blunder: 0, mistake: 0, inaccuracy: 0 }, moves, keyMoments: [], analysedAt: 1,
  };
}

let db: DatabaseSync;
beforeEach(() => {
  db = openDb(':memory:');
  db.exec(`INSERT INTO games (id, source, source_id, played_at, time_class, rated, white, black, pgn, ply_count, imported_at)
    VALUES (1, 'chesscom', 'a', 1, 'blitz', 1, 'Me', 'Opp', '*', 2, 1), (2, 'chesscom', 'b', 1, 'blitz', 1, 'Me', 'Opp', '*', 2, 1)`);
});

describe('buildMateCards', () => {
  it('creates one card per miss with the played move in the prompt', () => {
    const r = buildMateCards(db, analysis(1, [move({})]));
    expect(r).toMatchObject({ created: 1, updated: 0, suspended: 0, skipped: 0 });
    const [card] = listCardsByKind(db, 'mate');
    expect(card).toMatchObject({
      kind: 'mate', positionKey: positionKey(M1), fen: M1, sideToMove: 'white', suspended: false,
      prompt: 'White to move. You played Ra7 in a game. Find the mate in 1.',
      refs: [{ gameId: 1, ply: 1 }],
    });
    expect(card!.solution).toEqual({ accepted: ['a1a8'], best: 'a1a8', explanation: 'Mate in 1: Ra8#.', mateIn: 1, played: 'Ra7' });
  });

  it('explains a mate in 2 with the proven line, or with the first move only', () => {
    const base = { fenBefore: M2W, evalBefore: { cp: null, mate: 2 }, san: 'Kd2', uci: 'e1d2', bestUci: 'a1a7', bestSan: 'Ra7' };
    buildMateCards(db, analysis(1, [move({ ...base, pvSan: ['Ra7', 'Kg8', 'Rb8#'] })]));
    expect(listCardsByKind(db, 'mate')[0]!.solution.explanation).toBe('Mate in 2: Ra7 Kg8 Rb8#.');
    buildMateCards(db, analysis(1, [move({ ...base, pvSan: [] })]));
    expect(listCardsByKind(db, 'mate')[0]!.solution.explanation).toBe('Mate in 2 starts with Ra7.');
  });

  it('a second run creates no card', () => {
    buildMateCards(db, analysis(1, [move({})]));
    const r = buildMateCards(db, analysis(1, [move({})]));
    expect(r.created).toBe(0);
    expect(listCardsByKind(db, 'mate')).toHaveLength(1);
  });

  it('two games with the same position give one card with two refs', () => {
    buildMateCards(db, analysis(1, [move({})]));
    buildMateCards(db, analysis(2, [move({ ply: 5 })]));
    const cards = listCardsByKind(db, 'mate');
    expect(cards).toHaveLength(1);
    expect(cards[0]!.refs).toEqual([{ gameId: 1, ply: 1 }, { gameId: 2, ply: 5 }]);
  });

  it('a miss that is gone drops its ref and suspends an empty card; FSRS state stays', () => {
    buildMateCards(db, analysis(1, [move({})]));
    const [card] = listCardsByKind(db, 'mate');
    recordReview(db, card!.id, { rating: 'good', answerUci: 'a1a8', durationMs: 1 }, 5);
    const r = buildMateCards(db, analysis(1, [move({ san: 'Ra8#', uci: 'a1a8' })]));
    expect(r.suspended).toBe(1);
    const after = listCardsByKind(db, 'mate')[0]!;
    expect(after.suspended).toBe(true);
    expect(after.refs).toEqual([]);
    expect(db.prepare('SELECT 1 FROM card_state WHERE card_id = ?').get(card!.id)).toBeDefined();
  });

  it('a mistake card at a mate ply loses its ref and is suspended', () => {
    upsertCard(db, {
      kind: 'mistake', positionKey: positionKey(M1), fen: M1, sideToMove: 'white', prompt: 'p',
      solution: { accepted: ['a1a8'], best: 'a1a8', explanation: null }, refs: [{ gameId: 1, ply: 1 }], lastMove: null,
    });
    buildMateCards(db, analysis(1, [move({})]));
    const mistake = listCardsByRef(db, 1).find((c) => c.kind === 'mistake');
    expect(mistake).toBeUndefined();
    const all = listCardsByKind(db, 'mistake');
    expect(all[0]).toMatchObject({ suspended: true, refs: [] });
  });

  it('a flagged mate card stays suspended after a new run', () => {
    buildMateCards(db, analysis(1, [move({})]));
    const [card] = listCardsByKind(db, 'mate');
    addFlag(db, card!.id, 'wrong', 1);
    buildMateCards(db, analysis(1, [move({})]));
    expect(listCardsByKind(db, 'mate')[0]!.suspended).toBe(true);
  });
});

describe('syncMateCards', () => {
  it('covers finished analyses at the current version and skips the others', () => {
    saveAnalysis(db, analysis(1, [move({})]));
    saveAnalysis(db, analysis(2, [move({ ply: 5, fenBefore: M2W, evalBefore: { cp: null, mate: 2 }, san: 'Kd2', uci: 'e1d2' })], 1));
    const r = syncMateCards(db);
    expect(r).toMatchObject({ games: 1, created: 1 });
    expect(listCardsByKind(db, 'mate')).toHaveLength(1);
    expect(syncMateCards(db)).toMatchObject({ games: 1, created: 0 });
  });
});

describe('buildMistakeCards and mates', () => {
  it('makes no mistake card at a ply that is a missed mate', async () => {
    const calls: string[] = [];
    const pool = { analyse: async (fen: string) => { calls.push(fen); return []; } };
    const r = await buildMistakeCards(db, analysis(1, [move({ classification: 'blunder' })]), pool, { nodes: 1 });
    expect(r.created).toBe(0);
    expect(calls).toEqual([]);
    expect(listCardsByKind(db, 'mistake')).toHaveLength(0);
  });
});
