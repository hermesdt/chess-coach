import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import type { EngineScore } from '../../shared/types.js';
import type { EngineLines } from '../engine/uci.js';
import { PlayoutInputError, playoutStep } from './playout-step.js';

const after = (fen: string, ...uci: string[]): string => {
  const chess = new Chess(fen);
  for (const u of uci) chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.slice(4) || undefined });
  return chess.fen();
};

/** A fake pool: one line per position, keyed by FEN. Records every search. */
function fakePool(table: Record<string, { score: EngineScore; pv: string[] }>) {
  const calls: string[] = [];
  return {
    calls,
    analyse: async (fen: string): Promise<EngineLines> => {
      calls.push(fen);
      const row = table[fen];
      if (!row) throw new Error(`no line for ${fen}`);
      return [{ multipv: 1, ...row }];
    },
  };
}
const cp = (n: number): EngineScore => ({ cp: n, mate: null });

describe('playoutStep', () => {
  it('hung piece: returns blunder, the capturing reply and the template text', async () => {
    const fen = '6k1/p1b5/8/8/8/5N2/P7/6K1 w - - 0 1';
    const fenAfter = after(fen, 'f3e5');
    const pool = fakePool({ [fen]: { score: cp(0), pv: ['g1f2'] }, [fenAfter]: { score: cp(600), pv: ['c7e5'] } });
    const step = await playoutStep(fen, 'f3e5', pool);
    expect(step).toMatchObject({
      san: 'Ne5', fenAfter, classification: 'blunder', bestUci: 'g1f2', bestSan: 'Kf2',
      reply: { uci: 'c7e5', san: 'Bxe5', fen: after(fenAfter, 'c7e5') }, gameOver: false,
      feedback: 'Your knight on e5 was undefended. Bxe5 takes it.',
    });
    expect(step.tags).toContain('hung_piece');
    expect(step.winBefore).toBeCloseTo(50);
    expect(step.winAfter).toBeLessThan(20);
  });

  it('missed capture text names the free piece and the best move', async () => {
    const fen = '6k1/8/8/3n4/8/8/8/3R2K1 w - - 0 1';
    const fenAfter = after(fen, 'g1h1');
    const pool = fakePool({ [fen]: { score: cp(500), pv: ['d1d5'] }, [fenAfter]: { score: cp(0), pv: ['d5f4'] } });
    const step = await playoutStep(fen, 'g1h1', pool);
    expect(step.classification).toBe('blunder');
    expect(step.tags).toEqual(['missed_capture']);
    expect(step.feedback).toBe('You could take the knight on d5: Rxd5.');
  });

  it('safe move: feedback null and reply played', async () => {
    const fen = new Chess().fen();
    const fenAfter = after(fen, 'e2e4');
    const pool = fakePool({ [fen]: { score: cp(30), pv: ['e2e4'] }, [fenAfter]: { score: cp(-30), pv: ['e7e5'] } });
    const step = await playoutStep(fen, 'e2e4', pool);
    expect(step).toMatchObject({ classification: 'best', feedback: null, reply: { uci: 'e7e5', san: 'e5' }, gameOver: false });
  });

  it('a mistake without a tag names the lost winning chances', async () => {
    const fen = new Chess().fen();
    const fenAfter = after(fen, 'f2f3');
    const pool = fakePool({ [fen]: { score: cp(30), pv: ['e2e4'] }, [fenAfter]: { score: cp(220), pv: ['e7e5'] } });
    const step = await playoutStep(fen, 'f2f3', pool);
    expect(step.classification).toBe('mistake');
    expect(step.feedback).toBe('This move loses 22 % of your winning chances. Stockfish prefers e4.');
  });

  it('owner mates: gameOver true, reply null, one search only', async () => {
    const fen = '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1';
    const pool = fakePool({ [fen]: { score: { cp: null, mate: 1 }, pv: ['a1a8'] } });
    const step = await playoutStep(fen, 'a1a8', pool);
    expect(step).toMatchObject({ san: 'Ra8#', winAfter: 100, reply: null, gameOver: true, feedback: null });
    expect(pool.calls).toHaveLength(1);
  });

  it('reply mates the owner: gameOver true', async () => {
    const fen = '1r4k1/8/8/8/8/8/P4PPP/6K1 w - - 0 1';
    const fenAfter = after(fen, 'a2a3');
    const pool = fakePool({ [fen]: { score: cp(-50), pv: ['h2h3'] }, [fenAfter]: { score: { cp: null, mate: 1 }, pv: ['b8b1'] } });
    const step = await playoutStep(fen, 'a2a3', pool);
    expect(step).toMatchObject({ classification: 'blunder', reply: { san: 'Rb1#' }, gameOver: true });
    expect(step.feedback).toBe('This move allows mate. Rb1# starts it.');
  });

  it('promotion by the owner and by the reply give correct SAN', async () => {
    const own = '8/P5k1/8/8/8/8/8/6K1 w - - 0 1';
    const ownAfter = after(own, 'a7a8q');
    const p1 = fakePool({ [own]: { score: cp(900), pv: ['a7a8q'] }, [ownAfter]: { score: cp(-900), pv: ['g7f6'] } });
    expect(await playoutStep(own, 'a7a8q', p1)).toMatchObject({ san: 'a8=Q', reply: { san: 'Kf6' } });

    const theirs = '6k1/8/8/8/8/8/p7/6K1 w - - 0 1';
    const theirsAfter = after(theirs, 'g1f2');
    const p2 = fakePool({ [theirs]: { score: cp(-900), pv: ['g1f2'] }, [theirsAfter]: { score: cp(900), pv: ['a2a1q'] } });
    expect(await playoutStep(theirs, 'g1f2', p2)).toMatchObject({ reply: { uci: 'a2a1q', san: 'a1=Q' } });
  });

  it('rejects an illegal move or a bad FEN without an engine call', async () => {
    const pool = fakePool({});
    await expect(playoutStep(new Chess().fen(), 'e2e5', pool)).rejects.toBeInstanceOf(PlayoutInputError);
    await expect(playoutStep('not a fen', 'e2e4', pool)).rejects.toBeInstanceOf(PlayoutInputError);
    expect(pool.calls).toEqual([]);
  });
});
