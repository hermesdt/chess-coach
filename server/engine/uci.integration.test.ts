import { Chess } from 'chess.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isStockfishAvailable, resolveStockfishPath } from './stockfish-path.js';
import { UciEngine } from './uci.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe.skipIf(!isStockfishAvailable())('UciEngine (Stockfish)', () => {
  let engine: UciEngine;
  beforeAll(async () => {
    engine = await UciEngine.start(resolveStockfishPath());
    await engine.setOptions({ Threads: 1, Hash: 16 });
  });
  afterAll(async () => {
    await engine.quit();
  });

  it('returns one line with a legal first move from the start position', async () => {
    const lines = await engine.analyse(START, { nodes: 50000 });
    expect(lines).toHaveLength(1);
    const uci = lines[0]!.pv[0]!;
    const move = new Chess(START).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    expect(move).toBeTruthy();
  });

  it('returns three sorted lines with multipv 3', async () => {
    const lines = await engine.analyse(START, { nodes: 50000, multipv: 3 });
    expect(lines.map((l) => l.multipv)).toEqual([1, 2, 3]);
  });

  it('returns three distinct first moves with multipv 3 under a node limit', async () => {
    const lines = await engine.analyse(START, { nodes: 400000, multipv: 3 });
    expect(lines.map((l) => l.multipv)).toEqual([1, 2, 3]);
    expect(new Set(lines.map((l) => l.pv[0])).size).toBe(3);
  });

  it('returns three distinct first moves after 1.e4 c6 2.d4 d5 3.e5 at 1M nodes', async () => {
    const chess = new Chess();
    for (const m of ['e4', 'c6', 'd4', 'd5', 'e5']) chess.move(m);
    for (let n = 0; n < 3; n++) {
      const lines = await engine.analyse(chess.fen(), { nodes: 1_000_000, multipv: 3, timeoutMs: 60_000 });
      expect(lines.map((l) => l.multipv)).toEqual([1, 2, 3]);
      expect(new Set(lines.map((l) => l.pv[0])).size).toBe(3);
    }
  }, 180_000);

  it('finds a forced mate in 1', async () => {
    const lines = await engine.analyse('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', { nodes: 50000 });
    expect(lines[0]!.score.mate).toBe(1);
    expect(lines[0]!.pv[0]).toBe('d1d8');
  });

  it('reports alive until quit', async () => {
    const e = await UciEngine.start(resolveStockfishPath());
    expect(e.alive).toBe(true);
    await e.quit();
    expect(e.alive).toBe(false);
  });
});
