import { describe, expect, it } from 'vitest';
import type { FactPack } from './fact-pack.js';
import { chatCard } from './chat-card.js';

const FEN = 'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1';
const line = (n: number, uci: string, win: number) => ({ id: `t1.L${n}`, kind: 'best', startFen: FEN, san: [uci], uci: [uci, 'a7a6'], winPctForUser: win });
function pack(over: { userColor?: 'white' | 'black'; wins?: number[]; inBranch?: boolean; played?: unknown } = {}): FactPack {
  const [a, b, c] = over.wins ?? [55, 52, 43];
  return {
    turnPrefix: 't1.',
    anchor: { fen: FEN, sideToMove: 'white', ply: 5, path: over.inBranch ? ['d2d4'] : [], inBranch: over.inBranch ?? false, isUserToMove: true, describe: 'x' },
    played: over.played ?? null,
    lines: [line(1, 'g1f3', a!), line(2, 'c2c4', b!), line(3, 'b1c3', c!), { id: 't1.REF', kind: 'refutation', startFen: FEN, san: ['x'], uci: ['h2h3'], winPctForUser: 99 }],
    game: { userColor: over.userColor ?? 'white' },
  } as unknown as FactPack;
}

describe('chatCard', () => {
  it('accepts L1 and L2 within 5 win %, not L3 12 % worse', () => {
    const c = chatCard(pack(), { id: 7 });
    expect(c).toMatchObject({
      kind: 'mistake', fen: FEN, sideToMove: 'white', prompt: 'Find the best move.',
      solution: { accepted: ['g1f3', 'c2c4'], best: 'g1f3', explanation: null },
    });
    expect(c.positionKey).toBe('rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq -');
  });

  it('judges lines from the side to move when the owner plays the other colour', () => {
    const c = chatCard(pack({ userColor: 'black', wins: [45, 48, 57] }), { id: 7 });
    expect(c.solution.accepted).toEqual(['g1f3', 'c2c4']);
  });

  it('marks a branch anchor with source chat', () => {
    expect(chatCard(pack({ inBranch: true }), { id: 7 }).refs).toEqual([{ gameId: 7, ply: 5, source: 'chat' }]);
    expect(chatCard(pack(), { id: 7 }).refs).toEqual([{ gameId: 7, ply: 5, source: 'chat' }]);
  });

  it('leaves the source off when the owner erred from this position in the game', () => {
    const played = { san: 'e4', mover: 'white', classification: 'blunder' };
    // the mistake-card convention: the ply of the move played from the anchor position
    expect(chatCard(pack({ played }), { id: 7 }).refs).toEqual([{ gameId: 7, ply: 6 }]);
  });

  it('uses a chosen line as the best move', () => {
    const c = chatCard(pack(), { id: 7 }, 't1.L2');
    expect(c.solution.best).toBe('c2c4');
    expect(c.solution.accepted).toEqual(['c2c4', 'g1f3']);
    expect(() => chatCard(pack(), { id: 7 }, 't1.REF')).toThrow(RangeError);
  });
});
