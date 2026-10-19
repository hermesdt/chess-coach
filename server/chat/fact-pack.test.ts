import type { DatabaseSync } from 'node:sqlite';
import { Chess } from 'chess.js';
import { beforeEach, describe, expect, it } from 'vitest';
import type { GameAnalysis, MoveAnalysis, NewGame } from '../../shared/types.js';
import { saveAnalysis } from '../analysis/analysis-repo.js';
import { parsePgn } from '../chess/pgn.js';
import { openDb } from '../db/db.js';
import { insertGames } from '../db/games-repo.js';
import type { EngineLine } from '../engine/uci.js';
import { EngineCache } from '../engine/cache.js';
import { loadRepertoire } from '../repertoire/load.js';
import { buildFactPack, factPackSan, NotAnalysedError } from './fact-pack.js';

const PGN = '1. d4 Nf6 2. Bg5 h6 3. Bxh6 gxh6 *';
const MATE_PGN = '1. f3 e5 2. g4 Qh4# 0-1';
const { moves } = parsePgn(PGN);

function newGame(pgn: string, sourceId: string, over: Partial<NewGame> = {}): NewGame {
  return {
    source: 'chesscom', sourceId, playedAt: 1, timeClass: 'blitz', rated: true, white: 'Me', black: 'Opp',
    whiteElo: 600, blackElo: 650, userColor: 'white', result: 'loss', termination: null, eco: null,
    openingName: null, pgn, url: null, plyCount: parsePgn(pgn).moves.length, ...over,
  };
}

function analysisFor(gameId: number, pgn: string, status: GameAnalysis['status'] = 'done'): GameAnalysis {
  const ms: MoveAnalysis[] = parsePgn(pgn).moves.map((m) => ({
    ply: m.ply, san: m.san, uci: m.uci, color: m.ply % 2 === 1 ? 'white' : 'black', fenBefore: m.fenBefore,
    evalBefore: { cp: 20, mate: null }, evalAfter: { cp: -20, mate: null }, bestUci: m.uci, bestSan: m.san, pvSan: [m.san],
    winBefore: 55, winAfter: 40, winLoss: 15, classification: 'inaccuracy', tags: ['bad_trade'], isUserMove: m.ply % 2 === 1,
  }));
  return {
    gameId, version: 1, status, error: null, accuracyUser: 50, accuracyOpp: 50, counts: { blunder: 0, mistake: 0, inaccuracy: 1 },
    moves: ms, keyMoments: [], analysedAt: 1,
  };
}

const line = (multipv: number, cp: number, pv: string[]): EngineLine => ({ multipv, score: { cp, mate: null }, pv });

function fakePool(script: Record<string, EngineLine[]>) {
  const calls: { fen: string; multipv: number | undefined }[] = [];
  return {
    calls,
    analyse: (fen: string, opts: { nodes: number; multipv?: number }) => {
      calls.push({ fen, multipv: opts.multipv });
      return Promise.resolve(script[fen] ?? []);
    },
  };
}

const fenAfter = (ply: number): string => moves[ply - 1]!.fenAfter;
const fenOf = (pgn: string): string => {
  const c = new Chess();
  c.loadPgn(pgn);
  return c.fen();
};

let db: DatabaseSync;
beforeEach(() => {
  db = openDb(':memory:');
  insertGames(db, [newGame(PGN, 'a'), newGame(MATE_PGN, 'b', { userColor: 'black', result: 'win' })]);
  saveAnalysis(db, analysisFor(1, PGN));
  saveAnalysis(db, { ...analysisFor(2, MATE_PGN) });
});

const input = (ply: number, path: string[] = [], question = 'why?', turn = 1) => ({ gameId: 1, anchor: { ply, path }, question, turn });

describe('buildFactPack', () => {
  it('gives three MultiPV lines with turn-prefixed ids', async () => {
    const fen = fenAfter(2);
    const pool = fakePool({
      [fen]: [line(1, 50, ['c1g5', 'h7h6']), line(2, 30, ['e2e3']), line(3, 10, ['g1f3'])],
    });
    const pack = await buildFactPack({ db, pool, reps: [], nodes: 1000 }, input(2, [], 'why?', 3));
    expect(pack.turnPrefix).toBe('t3.');
    expect(pack.lines.filter((l) => l.kind === 'best').map((l) => l.id)).toEqual(['t3.L1', 't3.L2', 't3.L3']);
    expect(pool.calls.find((c) => c.fen === fen)?.multipv).toBe(3);
    expect(pack.lines[0]).toMatchObject({ startFen: fen, san: ['Bg5', 'h6'], uci: ['c1g5', 'h7h6'], evalCp: 50, evalMate: null });
    expect(pack.anchor).toMatchObject({ fen, sideToMove: 'white', ply: 2, path: [], inBranch: false, isUserToMove: true });
    expect(pack.game.userColor).toBe('white');
  });

  it('reuses a cached MultiPV 3 for the anchor when it searched enough nodes', async () => {
    const fen = fenAfter(2);
    const cache = new EngineCache();
    cache.set(fen, 3, [line(1, 77, ['c1g5', 'h7h6']), line(2, 30, ['e2e3']), line(3, 10, ['g1f3'])], 1000);
    const pool = fakePool({ [fen]: [line(1, 50, ['c1g5'])] });
    const pack = await buildFactPack({ db, pool, reps: [], nodes: 1000, cache }, input(2));
    expect(pool.calls.some((c) => c.fen === fen)).toBe(false);
    expect(pack.lines[0]).toMatchObject({ evalCp: 77 });
  });

  it('runs the pool when the cached search is too shallow, then stores the result', async () => {
    const fen = fenAfter(2);
    const cache = new EngineCache();
    cache.set(fen, 3, [line(1, 77, ['c1g5'])], 999);
    const pool = fakePool({ [fen]: [line(1, 50, ['c1g5'])] });
    const pack = await buildFactPack({ db, pool, reps: [], nodes: 1000, cache }, input(2));
    expect(pool.calls.filter((c) => c.fen === fen)).toHaveLength(1);
    expect(pack.lines[0]).toMatchObject({ evalCp: 50 });
    expect(cache.get(fen, 3, 1000)).toEqual([line(1, 50, ['c1g5'])]);
  });

  it('converts evals to the user view (black to move, user is white)', async () => {
    const fen = fenAfter(1);
    const pool = fakePool({ [fen]: [line(1, 100, ['d7d5'])] });
    const pack = await buildFactPack({ db, pool, reps: [], nodes: 1 }, input(1));
    expect(pack.anchor.isUserToMove).toBe(false);
    expect(pack.lines[0]).toMatchObject({ evalCp: -100 });
    expect(pack.lines[0]!.winPctForUser).toBeLessThan(50);
  });

  it('on the main line, gives the played move and the refutation line REF', async () => {
    const fen = fenAfter(2);
    const pool = fakePool({
      [fen]: [line(1, 50, ['c1g5'])],
      [fenAfter(3)]: [line(1, 300, ['h7h6', 'g5f6'])],
    });
    const pack = await buildFactPack({ db, pool, reps: [], nodes: 1 }, input(2));
    expect(pack.played).toEqual({ san: 'Bg5', mover: 'white', winBefore: 55, winAfter: 40, classification: 'inaccuracy', tags: ['bad_trade'] });
    const ref = pack.lines.find((l) => l.kind === 'refutation');
    expect(ref).toMatchObject({ id: 't1.REF', startFen: fenAfter(3), san: ['h6', 'Bxf6'], evalCp: -300 });
  });

  it('in a branch, has no played move and marks inBranch', async () => {
    const pool = fakePool({});
    const pack = await buildFactPack({ db, pool, reps: [], nodes: 1 }, input(2, ['g1f3']));
    expect(pack.played).toBeNull();
    expect(pack.anchor).toMatchObject({ inBranch: true, path: ['g1f3'], sideToMove: 'black', isUserToMove: false });
    expect(pack.anchor.describe).toBe('a side line: 2. Nf3 (after 1...Nf6)');
    expect(pack.lines.some((l) => l.kind === 'refutation')).toBe(false);
  });

  it('describes main-line and start positions', async () => {
    const pool = fakePool({});
    const a = await buildFactPack({ db, pool, reps: [], nodes: 1 }, input(4));
    expect(a.anchor.describe).toBe('the position after 2...h6 (your move 3)');
    const b = await buildFactPack({ db, pool, reps: [], nodes: 1 }, input(3));
    expect(b.anchor.describe).toBe('the position after 2. Bg5 (their move 2)');
    const c = await buildFactPack({ db, pool, reps: [], nodes: 1 }, input(0));
    expect(c.anchor.describe).toBe('the start position');
    const d = await buildFactPack({ db, pool, reps: [], nodes: 1 }, input(2, ['g1f3', 'g7g6']));
    expect(d.anchor.describe).toBe('a side line: 2. Nf3 g6 (after 1...Nf6)');
  });

  it('counts captures, material and checks along a line', async () => {
    const fen = fenAfter(4);
    const pool = fakePool({ [fen]: [line(1, 0, ['g5h6', 'g7h6'])] });
    const pack = await buildFactPack({ db, pool, reps: [], nodes: 1 }, input(4));
    const l1 = pack.lines[0]!;
    expect(l1.san).toEqual(['Bxh6', 'gxh6']);
    expect(l1.captures).toEqual([
      { ply: 1, piece: 'pawn', square: 'h6', by: 'white' },
      { ply: 2, piece: 'bishop', square: 'h6', by: 'black' },
    ]);
    expect(l1.materialEnd).toEqual({ white: 36, black: 38 });
    expect(l1.checks).toBe(0);
  });

  it('cuts lines to 16 plies', async () => {
    const fen = new Chess().fen();
    const pv = Array.from({ length: 10 }, () => ['g1f3', 'g8f6', 'f3g1', 'f6g8']).flat();
    const pool = fakePool({ [fen]: [line(1, 0, pv)] });
    const pack = await buildFactPack({ db, pool, reps: [], nodes: 1 }, input(0));
    expect(pack.lines[0]!.san).toHaveLength(16);
  });

  it('returns no lines for a checkmate anchor', async () => {
    const pool = fakePool({});
    const pack = await buildFactPack({ db, pool, reps: [], nodes: 1 }, { gameId: 2, anchor: { ply: 4, path: [] }, question: 'why?', turn: 1 });
    expect(pack.isFinal).toBe('checkmate');
    expect(pack.lines).toEqual([]);
    expect(pack.threat).toBeNull();
    expect(pool.calls).toEqual([]);
  });

  it('analyses legal named moves as Q lines and reports illegal ones', async () => {
    const fen = fenAfter(2);
    const afterNf3 = (() => {
      const c = new Chess(fen);
      c.move('Nf3');
      return c.fen();
    })();
    const pool = fakePool({ [afterNf3]: [line(1, -20, ['e7e6', 'c1f4'])] });
    const pack = await buildFactPack({ db, pool, reps: [], nodes: 1 }, input(2, [], 'what about Nf3 or Qh5?'));
    expect(pack.named).toEqual([
      { text: 'Nf3', status: 'legal', lineId: 't1.Q1' },
      { text: 'Qh5', status: 'illegal' },
    ]);
    const q1 = pack.lines.find((l) => l.id === 't1.Q1')!;
    expect(q1).toMatchObject({ kind: 'named', startFen: fen, san: ['Nf3', 'e6', 'Bf4'], evalCp: 20 });
  });

  it('adds repertoire moves that match the anchor, with their comment', async () => {
    const rep = loadRepertoire({
      id: 'london', name: 'London', color: 'white',
      moves: [{ san: 'd4', children: [{ san: 'Nf6', children: [{ san: 'Bf4', comment: 'The London bishop.' }] }] }],
    });
    const fen = fenAfter(2);
    const afterBf4 = (() => {
      const c = new Chess(fen);
      c.move('Bf4');
      return c.fen();
    })();
    const pool = fakePool({ [afterBf4]: [line(1, -15, [])] });
    const pack = await buildFactPack({ db, pool, reps: [rep], nodes: 1 }, input(2));
    const rep1 = pack.lines.find((l) => l.id === 't1.REP1')!;
    expect(rep1).toMatchObject({ kind: 'repertoire', san: ['Bf4'], uci: ['c1f4'], comment: 'The London bishop.', evalCp: 15 });
  });

  it('adds the threat from a null move, and skips it when in check', async () => {
    const fen = fenAfter(2);
    const nullFen = fen.replace(' w ', ' b ').replace(/ [a-h][36] /, ' - ');
    const pool = fakePool({ [nullFen]: [line(1, 0, ['h7h6'])] });
    const pack = await buildFactPack({ db, pool, reps: [], nodes: 1 }, input(2));
    expect(pool.calls.find((c) => c.fen === nullFen)?.multipv).toBe(1);
    expect(pack.threat).toEqual({ san: 'h6', uci: 'h7h6' });
    // in check: Bg5 line, then ...
    const checkPgn = '1. e4 f5 2. Qh5+ *';
    insertGames(db, [newGame(checkPgn, 'c')]);
    saveAnalysis(db, analysisFor(3, checkPgn));
    const pool2 = fakePool({});
    const p2 = await buildFactPack({ db, pool: pool2, reps: [], nodes: 1 }, { gameId: 3, anchor: { ply: 3, path: [] }, question: '', turn: 1 });
    expect(p2.threat).toBeNull();
    expect(pool2.calls).toHaveLength(1);
    expect(fenOf(checkPgn)).toBe(p2.anchor.fen);
  });

  it('throws NotAnalysedError when the analysis is missing or not done', async () => {
    const pool = fakePool({});
    insertGames(db, [newGame('1. e4 *', 'd')]);
    await expect(buildFactPack({ db, pool, reps: [], nodes: 1 }, { gameId: 3, anchor: { ply: 0, path: [] }, question: '', turn: 1 })).rejects.toBeInstanceOf(NotAnalysedError);
    saveAnalysis(db, analysisFor(3, '1. e4 *', 'running'));
    await expect(buildFactPack({ db, pool, reps: [], nodes: 1 }, { gameId: 3, anchor: { ply: 0, path: [] }, question: '', turn: 1 })).rejects.toBeInstanceOf(NotAnalysedError);
  });

  it('factPackSan lists every SAN in lines, threat and played', async () => {
    const fen = fenAfter(2);
    const nullFen = fen.replace(' w ', ' b ').replace(/ [a-h][36] /, ' - ');
    const pool = fakePool({ [fen]: [line(1, 50, ['c1g5', 'h7h6'])], [nullFen]: [line(1, 0, ['a7a6'])] });
    const pack = await buildFactPack({ db, pool, reps: [], nodes: 1 }, input(2));
    expect(new Set(factPackSan(pack))).toEqual(new Set(['Bg5', 'h6', 'a6']));
  });
});
