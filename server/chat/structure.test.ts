import { describe, expect, it } from 'vitest';
import { structureFacts } from './structure.js';

describe('structureFacts', () => {
  it('describes king wings, files, pawns and shields from the board', () => {
    const facts = structureFacts('6k1/5ppp/8/3p4/2PP4/2P5/5PPP/6K1 w - - 0 1');
    expect(facts.kings).toEqual({ white: { square: 'g1', wing: 'short' }, black: { square: 'g8', wing: 'short' } });
    expect(facts.files.a).toBe('open');
    expect(facts.files.c).toBe('half-open-black');
    expect(facts.files.d).toBe('closed');
    expect(facts.pawns.white.doubled).toEqual(['c4', 'c3']);
    expect(facts.pawns.black.isolated).toContain('d5');
    expect(facts.shield.white).toEqual(['f2', 'g2', 'h2']);
    expect(facts.shield.black).toEqual(['f7', 'g7', 'h7']);
    expect(facts.breaks.white.map((m) => m.san)).toContain('cxd5');
  });

  it('finds passed pawns and excludes pawn moves illegal due to check', () => {
    const facts = structureFacts('4r1k1/8/8/3p4/2P5/8/P7/4K3 w - - 0 1');
    expect(facts.pawns.white.passed).toContain('a2');
    expect(facts.breaks.white.map((m) => m.san)).not.toContain('cxd5');
  });

  it('keeps en passant only for the side actually to move', () => {
    const facts = structureFacts('6k1/8/8/3pP3/8/8/8/6K1 w - d6 0 1');
    expect(facts.breaks.white.map((m) => m.uci)).toContain('e5d6');
    expect(facts.breaks.black.map((m) => m.uci)).not.toContain('d5e4');
  });
});
