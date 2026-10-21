import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { setSetting } from '../db/settings-repo.js';
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

  it('stores every tag of the user moves in user_tags_json, including the level-2 tags', () => {
    const forkMove = { ...move(3), tags: ['missed_fork' as const, 'bad_bishop' as const] };
    saveAnalysis(db, analysis({ moves: [move(1), forkMove, { ...move(4), isUserMove: false, tags: ['missed_pin' as const] }] }));
    const row = db.prepare('SELECT user_tags_json FROM game_analysis WHERE game_id = ?').get(gameId)!;
    expect(JSON.parse(String(row.user_tags_json))).toEqual({ early_queen: 1, missed_fork: 1, bad_bishop: 1 });
  });

  describe('level filter on read', () => {
    const level2Moves = (): MoveAnalysis[] => [
      { ...move(1), tags: ['hung_piece', 'missed_fork'] },
      { ...move(3), tags: ['bad_bishop'] },
    ];
    const withLevel2Tags = (): GameAnalysis => analysis({
      moves: level2Moves(),
      keyMoments: [{ ply: 1, reason: 'missed_fork', winLoss: 14 }, { ply: 3, reason: 'blunder', winLoss: 40 }, { ply: 5, reason: 'missed_capture', winLoss: 12 }],
    });

    it('hides tags and key-moment reasons above level 1 but keeps the stored rows', () => {
      setSetting(db, 'level_override', '1');
      saveAnalysis(db, withLevel2Tags());
      const got = getAnalysis(db, gameId)!;
      expect(got.moves.map((m) => m.tags)).toEqual([['hung_piece'], []]);
      expect(got.keyMoments.map((k) => k.reason)).toEqual(['blunder', 'missed_capture']);
      const stored = db.prepare('SELECT data_json FROM move_analysis WHERE game_id = ? AND ply = 1').get(gameId)!;
      expect(JSON.parse(String(stored.data_json)).tags).toEqual(['hung_piece', 'missed_fork']);
    });

    it('shows them again at level 2 and 3', () => {
      saveAnalysis(db, withLevel2Tags());
      for (const level of ['2', '3']) {
        setSetting(db, 'level_override', level);
        expect(getAnalysis(db, gameId)).toEqual(withLevel2Tags());
      }
    });

    it('uses an explicit level when given', () => {
      saveAnalysis(db, withLevel2Tags());
      expect(getAnalysis(db, gameId, 2)).toEqual(withLevel2Tags());
      expect(getAnalysis(db, gameId, 1)!.moves[0]!.tags).toEqual(['hung_piece']);
    });
  });
});
