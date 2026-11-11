import { readFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import type { MateNode, MoveAnalysis } from '../../shared/types.js';
import type { EngineLine } from '../engine/uci.js';
import { findLongMateMisses, mainLine, proveMate } from './long-mates.js';
import { findMates } from './mates.js';

// Rook ladders. L3 mates in 3; L4 mates in 4 (Stockfish depth 40, proven here with chess.js).
const L3 = '8/7k/8/8/8/8/R7/1R4K1 w - - 0 1';
const L4 = '8/8/6k1/8/8/8/R7/1R4K1 w - - 0 1';
// Kf7 stalemates here, and there is no mate in 1 or 2.
const STALE = '7k/8/5KP1/8/8/8/8/8 w - - 0 1';

// Real Stockfish lines (MultiPV 5) for every position the proof asks about, recorded once.
const recorded = JSON.parse(readFileSync(new URL('./__fixtures__/long-mates-engine.json', import.meta.url), 'utf8')) as Record<string, EngineLine[]>;
const recordedPool = {
  analyse: async (fen: string): Promise<EngineLine[]> => {
    const lines = recorded[fen];
    if (!lines) throw new Error(`no recording for ${fen}`);
    return lines;
  },
};
/** An engine that claims a mate in 1 for the given moves. Only chess.js may decide. */
const lyingPool = (moves: (fen: string) => string[]) => ({
  analyse: async (fen: string): Promise<EngineLine[]> =>
    moves(fen).map((uci, i) => ({ multipv: i + 1, score: { cp: null, mate: 1 }, pv: [uci] })),
});
const opts = { nodes: 1 };
const uciOf = (m: { from: string; to: string; promotion?: string }) => m.from + m.to + (m.promotion ?? '');
const play = (fen: string, uci: string): Chess => {
  const c = new Chess(fen);
  c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  return c;
};

/** Replays the main line and returns the final position. */
function replayMain(fen: string, node: MateNode): Chess {
  const c = new Chess(fen);
  for (const san of mainLine(node)) c.move(san);
  return c;
}

describe('proveMate', () => {
  it('proves mate in 3 on L3', async () => {
    const node = await proveMate(L3, 3, recordedPool, opts);
    expect(node?.mateIn).toBe(3);
    expect(node!.accepted.length).toBeGreaterThan(0);
    expect(mainLine(node!)).toHaveLength(5);
    expect(replayMain(L3, node!).isCheckmate()).toBe(true);
  });

  it('proves mate in 4 on L4', async () => {
    const node = await proveMate(L4, 4, recordedPool, opts);
    expect(node?.mateIn).toBe(4);
    expect(mainLine(node!)).toHaveLength(7);
    expect(replayMain(L4, node!).isCheckmate()).toBe(true);
    expect(node!.accepted[0]!.next?.mateIn).toBe(3);
  }, 30_000); // a full chess.js proof of a mate in 4 takes several seconds

  it('every defence of an accepted L3 move leaves a mate in 2 at most (checked by chess.js alone)', async () => {
    const node = (await proveMate(L3, 3, recordedPool, opts))!;
    for (const step of node.accepted) {
      const after = play(L3, step.uci);
      const replies = after.moves({ verbose: true });
      expect(replies.length).toBeGreaterThan(0);
      expect(replies.map(uciOf)).toContain(step.defence!.uci);
      for (const r of replies) {
        after.move(r);
        expect(findMates(after.fen())?.mateIn ?? 99).toBeLessThanOrEqual(2);
        after.undo();
      }
    }
  });

  it('picks the longest defence: after it the mate still takes 2 moves', async () => {
    const node = (await proveMate(L3, 3, recordedPool, opts))!;
    for (const step of node.accepted) expect(step.next?.mateIn).toBe(2);
  });

  it('accepts every mate in 1 and 2 at the last steps (complete findMates list)', async () => {
    const node = (await proveMate(L3, 3, recordedPool, opts))!;
    const step = node.accepted[0]!;
    const afterDefence = play(play(L3, step.uci).fen(), step.defence!.uci).fen();
    expect(step.next!.accepted.map((s) => s.uci).sort()).toEqual([...findMates(afterDefence)!.moves].sort());
  });

  it('the tie rule prefers the reply from the stored engine line', async () => {
    const plain = (await proveMate(L3, 3, recordedPool, opts))!;
    const step = plain.accepted[0]!;
    const after = play(L3, step.uci);
    const equal = after.moves({ verbose: true }).filter((r) => {
      after.move(r);
      const m = findMates(after.fen())?.mateIn;
      after.undo();
      return m === 2;
    });
    const other = equal.find((r) => uciOf(r) !== step.defence!.uci);
    expect(other).toBeDefined(); // the position must offer two equally long defences, or the test proves nothing
    if (!other) return;
    const withPv = (await proveMate(L3, 3, recordedPool, { ...opts, pvSan: [step.san, other.san] }))!;
    expect(withPv.accepted.find((s) => s.uci === step.uci)!.defence!.uci).toBe(uciOf(other));
  });

  it('rejects a lying engine claim on a position without a mate in 3', async () => {
    const fen = '8/8/8/4k3/8/8/8/4K2R w K - 0 1';
    const pool = lyingPool((f) => new Chess(f).moves({ verbose: true }).slice(0, 5).map(uciOf));
    expect(await proveMate(fen, 3, pool, opts)).toBeNull();
  });

  it('a move that stalemates is not accepted', async () => {
    expect(await proveMate(STALE, 3, lyingPool(() => ['f6f7']), opts)).toBeNull();
  });

  it('returns a shorter node when the position mates faster than k', async () => {
    const node = await proveMate(L3, 4, recordedPool, opts);
    expect(node?.mateIn).toBe(3);
  });

  it('returns null over the engine budget', async () => {
    expect(await proveMate(L3, 3, recordedPool, { ...opts, maxEngineCalls: 0 })).toBeNull();
  });

  it('returns null over the time budget', async () => {
    expect(await proveMate(L4, 4, recordedPool, { ...opts, maxMs: 0 })).toBeNull();
  });
});

describe('findLongMateMisses', () => {
  const row = (over: Partial<MoveAnalysis>): MoveAnalysis => ({
    ply: 21, san: 'Kf2', uci: 'g1f2', color: 'white', fenBefore: L3,
    evalBefore: { cp: null, mate: 3 }, evalAfter: { cp: 900, mate: null },
    bestUci: 'b1b7', bestSan: 'Rb7+', pvSan: ['Rb7+', 'Kh6', 'Ra6+', 'Kg5', 'Rg7+'],
    winBefore: 100, winAfter: 95, winLoss: 5, classification: 'good', tags: [], isUserMove: true, ...over,
  });

  it('finds a missed mate in 3 and keeps the engine line', () => {
    expect(findLongMateMisses([row({})])).toEqual([
      { ply: 21, fen: L3, color: 'white', mateIn: 3, playedSan: 'Kf2', playedUci: 'g1f2', pvSan: ['Rb7+', 'Kh6', 'Ra6+', 'Kg5', 'Rg7+'] },
    ]);
  });

  it('finds a missed mate in 4', () => {
    expect(findLongMateMisses([row({ fenBefore: L4, evalBefore: { cp: null, mate: 4 } })])[0]?.mateIn).toBe(4);
  });

  it('ignores a fastest move (the mate goes down by one)', () => {
    expect(findLongMateMisses([row({ evalAfter: { cp: null, mate: -2 } })])).toEqual([]);
  });

  it('counts a slower mate as a miss', () => {
    expect(findLongMateMisses([row({ evalAfter: { cp: null, mate: -3 } })])).toHaveLength(1);
  });

  it('ignores other mate lengths, opponent moves and positions with a mate in 1 or 2', () => {
    expect(findLongMateMisses([
      row({ evalBefore: { cp: null, mate: 2 } }),
      row({ evalBefore: { cp: null, mate: 5 } }),
      row({ isUserMove: false }),
      row({ fenBefore: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1' }),
    ])).toEqual([]);
  });
});
