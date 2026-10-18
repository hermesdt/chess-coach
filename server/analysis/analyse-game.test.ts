import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import type { Color, EngineScore, GameDetail, MoveInfo } from '../../shared/types.js';
import type { EngineLine } from '../engine/uci.js';
import { analyseGame } from './analyse-game.js';
import { ANALYSIS_VERSION } from './analysis-repo.js';

const cp = (n: number): EngineScore => ({ cp: n, mate: null });
const mate = (n: number): EngineScore => ({ cp: null, mate: n });
const line = (score: EngineScore, ...pv: string[]): EngineLine => ({ multipv: 1, score, pv });

function detail(sans: string[], userColor: Color | null, startFen?: string): GameDetail {
  const chess = startFen ? new Chess(startFen) : new Chess();
  const start = chess.fen();
  const moves: MoveInfo[] = sans.map((san, i) => {
    const fenBefore = chess.fen();
    const m = chess.move(san);
    return { ply: i + 1, san: m.san, uci: m.from + m.to + (m.promotion ?? ''), fenBefore, fenAfter: chess.fen() };
  });
  return {
    id: 7, source: 'import', sourceId: 'x', playedAt: 0, timeClass: 'unknown', rated: false, white: 'Me', black: 'Opp',
    whiteElo: null, blackElo: null, userColor, result: null, termination: null, eco: null, openingName: null,
    url: null, plyCount: moves.length, pgn: '', startFen: start, moves,
  };
}

function fakePool(script: Record<string, EngineLine[]>) {
  const calls: { fen: string; opts: { nodes: number; multipv?: number } }[] = [];
  return {
    calls,
    analyse: async (fen: string, opts: { nodes: number; multipv?: number }): Promise<EngineLine[]> => {
      calls.push({ fen, opts });
      return script[fen] ?? [line(cp(0))];
    },
  };
}

function fenAfter(sans: string[]): string {
  const c = new Chess();
  for (const s of sans) c.move(s);
  return c.fen();
}

describe('analyseGame', () => {
  it('flags a blunder with hung_piece, a key moment and counts', async () => {
    const sans = ['e4', 'e5', 'Qh5', 'Nc6', 'Qxe5', 'Nxe5'];
    const game = detail(sans, 'white');
    const pool = fakePool({
      [fenAfter(sans.slice(0, 4))]: [line(cp(30), 'g1f3')],
      [fenAfter(sans.slice(0, 5))]: [line(cp(900), 'c6e5')],
      [fenAfter(sans)]: [line(cp(-880))],
    });
    const a = await analyseGame(game, pool, { nodes: 1000 });
    expect(a.gameId).toBe(7);
    expect(a.version).toBe(ANALYSIS_VERSION);
    expect(a.moves).toHaveLength(6);
    const blunder = a.moves[4]!;
    expect(blunder).toMatchObject({ ply: 5, san: 'Qxe5+', color: 'white', classification: 'blunder', isUserMove: true });
    expect(blunder.tags).toContain('hung_piece');
    expect(blunder.winLoss).toBeGreaterThan(40);
    expect(a.counts).toEqual({ blunder: 1, mistake: 0, inaccuracy: 0 });
    expect(a.keyMoments).toEqual([{ ply: 5, reason: 'blunder', winLoss: blunder.winLoss }]);
    expect(a.moves[5]).toMatchObject({ isUserMove: false, tags: [] });
    expect(a.accuracyUser).toBeLessThan(a.accuracyOpp!);
    expect(a.analysedAt).toBeTypeOf('number');
    expect(pool.calls.every((c) => c.opts.nodes === 1000 && c.opts.multipv === 1)).toBe(true);
  });

  it('scores a checkmate final position without calling the engine', async () => {
    const sans = ['f3', 'e5', 'g4', 'Qh4#'];
    const game = detail(sans, 'black');
    const pool = fakePool({ [fenAfter(sans.slice(0, 3))]: [line(mate(1), 'd8h4')] });
    const a = await analyseGame(game, pool, { nodes: 10 });
    const finalFen = fenAfter(sans);
    expect(pool.calls.map((c) => c.fen)).not.toContain(finalFen);
    expect(pool.calls).toHaveLength(4);
    const last = a.moves[3]!;
    expect(last.evalAfter).toEqual({ cp: null, mate: 0 });
    expect(last.winAfter).toBe(100);
    expect(last.classification).toBe('best');
    expect(last.isUserMove).toBe(true);
  });

  it('scores a stalemate final position as 0 cp without calling the engine', async () => {
    const stale = detail(['Qg6'], 'white', '7k/8/5K2/8/8/8/8/6Q1 w - - 0 1');
    const pool = fakePool({});
    const a = await analyseGame(stale, pool, { nodes: 10 });
    expect(pool.calls.map((c) => c.fen)).toEqual([stale.startFen]);
    expect(a.moves[0]!.evalAfter).toEqual({ cp: 0, mate: null });
  });

  it('throws when the engine returns nothing for a live position', async () => {
    const pool = { analyse: async (): Promise<EngineLine[]> => [] };
    await expect(analyseGame(detail(['e4'], 'white'), pool, { nodes: 10 })).rejects.toThrow();
  });

  it('analyses from a custom start FEN with Black to move', async () => {
    const startFen = '4k3/8/8/8/8/8/8/4K2R b - - 0 1';
    const game = detail(['Kd7', 'Rh7+'], 'black', startFen);
    const pool = fakePool({});
    const a = await analyseGame(game, pool, { nodes: 10 });
    expect(pool.calls.map((c) => c.fen)).toContain(startFen);
    expect(a.moves.map((m) => m.color)).toEqual(['black', 'white']);
    expect(a.moves.map((m) => m.isUserMove)).toEqual([true, false]);
    expect(a.moves[0]!.fenBefore).toBe(startFen);
  });

  it('converts promotion lines to SAN and stops at the first illegal move', async () => {
    const startFen = '8/4P3/8/8/8/8/k7/7K w - - 0 1';
    const game = detail(['Kg1'], 'white', startFen);
    const pool = fakePool({ [startFen]: [line(cp(800), 'e7e8q', 'a2b3', 'h7h8', 'b3b2')] });
    const a = await analyseGame(game, pool, { nodes: 10 });
    expect(a.moves[0]!.bestUci).toBe('e7e8q');
    expect(a.moves[0]!.bestSan).toBe('e8=Q');
    expect(a.moves[0]!.pvSan).toEqual(['e8=Q', 'Kb3']);
  });

  it('limits pvSan to 8 plies', async () => {
    const pv = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5', 'c2c3', 'g8f6', 'd2d4', 'e5d4'];
    const game = detail(['d4'], 'white');
    const pool = fakePool({ [game.startFen]: [line(cp(20), ...pv)] });
    const a = await analyseGame(game, pool, { nodes: 10 });
    expect(a.moves[0]!.pvSan).toHaveLength(8);
  });

  it('marks the engine best move as best', async () => {
    const game = detail(['e4'], 'white');
    const pool = fakePool({ [game.startFen]: [line(cp(20), 'e2e4')] });
    const a = await analyseGame(game, pool, { nodes: 10 });
    expect(a.moves[0]!.classification).toBe('best');
  });

  it('adds opening tags only for user moves', async () => {
    const sans = ['e4', 'e5', 'Qh5', 'Nc6'];
    const white = await analyseGame(detail(sans, 'white'), fakePool({}), { nodes: 10 });
    expect(white.moves[2]!.tags).toContain('early_queen');
    const black = await analyseGame(detail(sans, 'black'), fakePool({}), { nodes: 10 });
    expect(black.moves[2]!.tags).not.toContain('early_queen');
  });

  it('passes the level to key moment selection', async () => {
    const sans = ['e4', 'e5'];
    const game = detail(sans, 'white');
    // winBefore 50 (cp 0), winAfter ~ 32 => loss ~17 (inaccuracy at level 2+)
    const pool = fakePool({ [fenAfter(['e4'])]: [line(cp(200), 'e7e5')] });
    const l1 = await analyseGame(game, pool, { nodes: 10, level: 1 });
    const l2 = await analyseGame(game, pool, { nodes: 10, level: 2 });
    expect(l1.moves[0]!.classification).toBe('inaccuracy');
    expect(l1.keyMoments).toEqual([]);
    expect(l2.keyMoments).toHaveLength(1);
  });

  it('classifies a move that allows a forced mate as a blunder', async () => {
    const sans = ['e4', 'e5', 'Nf3', 'd6', 'Bc4', 'Bg4', 'Nc3', 'g6', 'Nxe5', 'Bxd1', 'Bxf7+', 'Ke7', 'Nd5#'];
    const game = detail(sans, 'black');
    const pool = fakePool({
      [fenAfter(sans.slice(0, 9))]: [line(cp(-80), 'g4e6')],
      [fenAfter(sans.slice(0, 10))]: [line(mate(3), 'f1f7')],
      [fenAfter(sans.slice(0, 11))]: [line(mate(-2), 'e8e7')],
    });
    const a = await analyseGame(game, pool, { nodes: 10 });
    const m = a.moves[9]!;
    expect(m).toMatchObject({ ply: 10, san: 'Bxd1', classification: 'blunder' });
    expect(a.counts.blunder).toBe(1);
    expect(a.keyMoments.find((k) => k.ply === 10)).toMatchObject({ reason: 'blunder' });
  });

  it('keeps classify() when the position was already mated', async () => {
    const sans = ['e4', 'e5', 'Nf3', 'd6', 'Bc4', 'Bg4', 'Nc3', 'g6', 'Nxe5', 'Bxd1'];
    const game = detail(sans, 'black');
    const pool = fakePool({
      [fenAfter(sans.slice(0, 9))]: [line(mate(-4), 'g4d1')],
      [fenAfter(sans)]: [line(mate(3), 'f1f7')],
    });
    const a = await analyseGame(game, pool, { nodes: 10 });
    expect(a.moves[9]!.classification).toBe('best');
    const pool2 = fakePool({
      [fenAfter(sans.slice(0, 9))]: [line(mate(-4), 'a7a6')],
      [fenAfter(sans)]: [line(mate(3), 'f1f7')],
    });
    const b = await analyseGame(game, pool2, { nodes: 10 });
    expect(b.moves[9]!.classification).toBe('good');
  });

  it('skips opening tags for games from a custom start FEN', async () => {
    const startFen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2';
    const a = await analyseGame(detail(['Qh4', 'Nc3', 'Qxe4+'], 'black', startFen), fakePool({}), { nodes: 10 });
    expect(a.moves.every((m) => !m.tags.includes('early_queen'))).toBe(true);
  });

  it('renders castling in pvSan and recognises it as the best move', async () => {
    const startFen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
    const game = detail(['O-O'], 'white', startFen);
    const pool = fakePool({ [startFen]: [line(cp(30), 'e1g1', 'e8c8')] });
    const a = await analyseGame(game, pool, { nodes: 10 });
    expect(a.moves[0]).toMatchObject({ uci: 'e1g1', bestSan: 'O-O', classification: 'best' });
    expect(a.moves[0]!.pvSan).toEqual(['O-O', 'O-O-O']);
  });
});
