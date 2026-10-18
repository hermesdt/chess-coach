import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { GameAnalysis, MoveAnalysis } from '../../shared/types.js';
import { openDb } from '../db/db.js';
import { insertGames, listGames } from '../db/games-repo.js';
import { ANALYSIS_VERSION, getAnalysis, markAnalysis, saveAnalysis } from './analysis-repo.js';

let db: DatabaseSync;
let gameId: number;
beforeEach(() => {
  db = openDb(':memory:');
  insertGames(db, [{
    source: 'chesscom', sourceId: 'a', playedAt: 1000, timeClass: 'blitz', rated: true, white: 'Me', black: 'Opp',
    whiteElo: 1500, blackElo: 1500, userColor: 'white', result: 'win', termination: null, eco: null, openingName: null,
    pgn: '1. e4 e5 *', url: null, plyCount: 2,
  }]);
  gameId = listGames(db, {}).items[0]!.id;
});

const move = (ply: number): MoveAnalysis => ({
  ply, san: 'e4', uci: 'e2e4', color: 'white', fenBefore: 'f', evalBefore: { cp: 20, mate: null }, evalAfter: { cp: null, mate: 0 },
  bestUci: 'e2e4', bestSan: 'e4', pvSan: ['e4', 'e5'], winBefore: 51, winAfter: 100, winLoss: 0,
  classification: 'best', tags: ['early_queen'], isUserMove: true,
});
const analysis = (over: Partial<GameAnalysis> = {}): GameAnalysis => ({
  gameId, version: ANALYSIS_VERSION, status: 'done', error: null, accuracyUser: 91.5, accuracyOpp: null,
  counts: { blunder: 1, mistake: 2, inaccuracy: 3 }, moves: [move(1), move(2)],
  keyMoments: [{ ply: 2, reason: 'blunder', winLoss: 40 }], analysedAt: 12345, ...over,
});

describe('analysis repo', () => {
  it('returns null when nothing is stored', () => {
    expect(getAnalysis(db, gameId)).toBeNull();
  });

  it('round-trips a saved analysis', () => {
    saveAnalysis(db, analysis());
    expect(getAnalysis(db, gameId)).toEqual(analysis());
  });

  it('replaces rows on a second save', () => {
    saveAnalysis(db, analysis());
    saveAnalysis(db, analysis({ moves: [move(1)], keyMoments: [], counts: { blunder: 0, mistake: 0, inaccuracy: 0 } }));
    const got = getAnalysis(db, gameId)!;
    expect(got.moves).toHaveLength(1);
    expect(got.keyMoments).toEqual([]);
  });

  it('rolls back the whole save when a move row fails', () => {
    saveAnalysis(db, analysis());
    const broken = analysis({ moves: [move(1), move(1)] });
    expect(() => saveAnalysis(db, broken)).toThrow();
    expect(getAnalysis(db, gameId)).toEqual(analysis());
  });

  it('markAnalysis creates a row with the current version', () => {
    markAnalysis(db, gameId, 'pending');
    expect(getAnalysis(db, gameId)).toMatchObject({ status: 'pending', error: null, version: ANALYSIS_VERSION, moves: [], analysedAt: null });
  });

  it('markAnalysis records an error and keeps stored moves', () => {
    saveAnalysis(db, analysis());
    markAnalysis(db, gameId, 'error', 'engine crashed');
    expect(getAnalysis(db, gameId)).toMatchObject({ status: 'error', error: 'engine crashed', moves: [move(1), move(2)] });
    markAnalysis(db, gameId, 'running');
    expect(getAnalysis(db, gameId)).toMatchObject({ status: 'running', error: null });
  });
});
