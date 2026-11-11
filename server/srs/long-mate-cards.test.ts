import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { GameAnalysis, MoveAnalysis } from '../../shared/types.js';
import { ANALYSIS_VERSION, saveAnalysis } from '../analysis/analysis-repo.js';
import { openDb } from '../db/db.js';
import { insertGames } from '../db/games-repo.js';
import type { EngineLine } from '../engine/uci.js';
import { listCardsByKind, longMatePlies, positionKey, upsertCard } from './cards-repo.js';
import { buildLongMateCards } from './long-mate-cards.js';
import { mainLine } from './long-mates.js';
import { buildMateCards, syncMateCards } from './mate-cards.js';
import { buildMistakeCards } from './mistake-cards.js';

const L3 = '8/7k/8/8/8/8/R7/1R4K1 w - - 0 1';
const NO_MATE = '8/8/8/4k3/8/8/8/4K2R w K - 0 1';
const recorded = JSON.parse(readFileSync(new URL('./__fixtures__/long-mates-engine.json', import.meta.url), 'utf8')) as Record<string, EngineLine[]>;
const recordedPool = {
  analyse: async (fen: string): Promise<EngineLine[]> => {
    const lines = recorded[fen];
    if (!lines) throw new Error(`no recording for ${fen}`);
    return lines;
  },
};
const throwingPool = { analyse: async (fen: string): Promise<EngineLine[]> => { throw new Error(`no engine call expected: ${fen}`); } };
// Step 2 lines for the mistake builder at L3: Rb6 is best, the played Kf2 is far worse.
const mistakePool = {
  analyse: async (): Promise<EngineLine[]> => [
    { multipv: 1, score: { cp: null, mate: 3 }, pv: ['b1b6'] },
    { multipv: 2, score: { cp: 300, mate: null }, pv: ['g1f2'] },
  ],
};

function move(over: Partial<MoveAnalysis>): MoveAnalysis {
  return {
    ply: 2, san: 'Kf2', uci: 'g1f2', color: 'white', fenBefore: L3,
    evalBefore: { cp: null, mate: 3 }, evalAfter: { cp: -300, mate: null },
    bestUci: 'b1b6', bestSan: 'Rb6', pvSan: ['Rb6'],
    winBefore: 100, winAfter: 70, winLoss: 30, classification: 'blunder', tags: [], isUserMove: true,
    ...over,
  };
}
const analysis = (moves: MoveAnalysis[]): GameAnalysis => ({
  gameId: 1, version: ANALYSIS_VERSION, status: 'done', error: null, accuracyUser: null, accuracyOpp: null,
  counts: { blunder: 0, mistake: 0, inaccuracy: 0 }, moves, keyMoments: [], analysedAt: 1,
});
const opts = { nodes: 1 };
const active = (db: DatabaseSync, kind: 'mate' | 'mistake' | 'threat') => listCardsByKind(db, kind).filter((c) => !c.suspended);

let db: DatabaseSync;
beforeEach(() => {
  db = openDb(':memory:');
});

describe('buildLongMateCards', () => {
  it('builds a mate card with the proven tree for a missed mate in 3', async () => {
    const r = await buildLongMateCards(db, analysis([move({})]), recordedPool, opts);
    expect(r).toMatchObject({ created: 1, skipped: 0 });
    const [card] = active(db, 'mate');
    expect(card!.prompt).toBe('White to move. You played Kf2 in a game. Find the mate in 3.');
    const tree = card!.solution.tree!;
    expect(card!.solution).toMatchObject({ mateIn: 3, played: 'Kf2', best: tree.accepted[0]!.uci });
    expect(card!.solution.accepted).toEqual(tree.accepted.map((s) => s.uci));
    expect(card!.solution.explanation).toBe(`Mate in 3: ${mainLine(tree).join(' ')}.`);
    expect(card!.refs).toEqual([{ gameId: 1, ply: 2 }]);
  });

  it('is idempotent', async () => {
    await buildLongMateCards(db, analysis([move({})]), recordedPool, opts);
    const r = await buildLongMateCards(db, analysis([move({})]), recordedPool, opts);
    expect(r).toMatchObject({ created: 0, updated: 1 });
    expect(active(db, 'mate')).toHaveLength(1);
  });

  it('suspends the mistake card and the threat card at the same ply', async () => {
    for (const kind of ['mistake', 'threat'] as const) {
      upsertCard(db, { kind, positionKey: positionKey(L3), fen: L3, sideToMove: 'white', prompt: 'p', solution: { accepted: ['b1b6'], best: 'b1b6', explanation: null }, refs: [{ gameId: 1, ply: 2 }], lastMove: null });
    }
    await buildLongMateCards(db, analysis([move({})]), recordedPool, opts);
    expect(active(db, 'mistake')).toHaveLength(0);
    expect(active(db, 'threat')).toHaveLength(0);
    expect(longMatePlies(db, 1)).toEqual(new Set([2]));
  });

  it('skips a position when chess.js cannot prove the stored mate', async () => {
    const lying = { analyse: async () => [{ multipv: 1, score: { cp: null, mate: 1 }, pv: ['h1h5'] }] };
    const r = await buildLongMateCards(db, analysis([move({ fenBefore: NO_MATE, san: 'Kd2', uci: 'e1d2' })]), lying, opts);
    expect(r).toMatchObject({ created: 0, skipped: 1 });
  });

  it('makes no card when the played move is one of the proven fastest moves', async () => {
    const r = await buildLongMateCards(db, analysis([move({ san: 'Rb6', uci: 'b1b6' })]), recordedPool, opts);
    expect(r.created).toBe(0);
  });

  it('a dropped long mate lets the mistake card come back', async () => {
    await buildMistakeCards(db, analysis([move({})]), mistakePool, opts);
    await buildLongMateCards(db, analysis([move({})]), recordedPool, opts);
    expect(active(db, 'mistake')).toHaveLength(0);
    // Re-analysis: the engine now says the played move kept the fastest mate, so there is no miss.
    const fixed = analysis([move({ evalAfter: { cp: null, mate: -2 } })]);
    await buildLongMateCards(db, fixed, throwingPool, opts);
    expect(active(db, 'mate')).toHaveLength(0);
    await buildMistakeCards(db, analysis([move({})]), mistakePool, opts);
    expect(active(db, 'mistake')).toHaveLength(1);
  });

  it('buildMistakeCards makes no card at a long-mate ply', async () => {
    await buildLongMateCards(db, analysis([move({})]), recordedPool, opts);
    await buildMistakeCards(db, analysis([move({})]), throwingPool, opts);
    expect(active(db, 'mistake')).toHaveLength(0);
  });
});

describe('M13 mate cards own only mate in 1 and 2', () => {
  it('syncMateCards keeps long mate cards', async () => {
    insertGames(db, [{
      source: 'chesscom', sourceId: 'a', playedAt: 1000, timeClass: 'blitz', rated: true, white: 'Me', black: 'Opp',
      whiteElo: 1500, blackElo: 1500, userColor: 'white', result: 'win', termination: null, eco: null, openingName: null,
      pgn: '1. e4 e5 *', url: null, plyCount: 2,
    }]); // game id 1
    saveAnalysis(db, analysis([move({})]));
    await buildLongMateCards(db, analysis([move({})]), recordedPool, opts);
    syncMateCards(db);
    expect(active(db, 'mate')).toHaveLength(1);
  });

  it('buildMateCards still drops its own stale mate-in-1 refs', async () => {
    const M1 = '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1';
    upsertCard(db, { kind: 'mate', positionKey: positionKey(M1), fen: M1, sideToMove: 'white', prompt: 'p', solution: { accepted: ['a1a8'], best: 'a1a8', explanation: null, mateIn: 1 }, refs: [{ gameId: 1, ply: 4 }], lastMove: null });
    await buildLongMateCards(db, analysis([move({})]), recordedPool, opts);
    buildMateCards(db, analysis([move({})]));
    const mates = active(db, 'mate');
    expect(mates).toHaveLength(1);
    expect(mates[0]!.solution.mateIn).toBe(3);
  });
});
