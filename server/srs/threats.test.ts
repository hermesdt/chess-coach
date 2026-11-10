import { describe, expect, it } from 'vitest';
import type { MoveAnalysis } from '../../shared/types.js';
import type { EngineLine } from '../engine/uci.js';
import { confirmThreat, findThreatCandidates, lineGain, nullMoveFen, threatText } from './threats.js';

const A = '4k3/8/1b6/8/3Q4/8/8/4K3 w - - 0 1';
const A_NULL = '4k3/8/1b6/8/3Q4/8/8/4K3 b - - 0 1';
const B = '6k1/1p3ppp/8/8/8/8/8/4R1K1 b - - 0 1';
const C = '4k3/8/8/8/8/8/4r3/4K3 w - - 0 1';
const P = '3r2k1/4P3/8/8/8/8/8/7K b - - 0 1';

function move(over: Partial<MoveAnalysis>): MoveAnalysis {
  return {
    ply: 1, san: 'Ke2', uci: 'e1e2', color: 'white', fenBefore: A,
    evalBefore: { cp: 0, mate: null }, evalAfter: { cp: 0, mate: null },
    bestUci: 'e1e2', bestSan: 'Ke2', pvSan: [],
    winBefore: 50, winAfter: 20, winLoss: 30, classification: 'blunder', tags: [], isUserMove: true,
    ...over,
  };
}

/** Rows for ply 1 (opponent), 2 (owner mistake) and 3 (opponent reply). */
function rows(owner: Partial<MoveAnalysis>, next: Partial<MoveAnalysis> = {}): MoveAnalysis[] {
  return [
    move({ ply: 1, san: 'Nf3', uci: 'g1f3', color: 'black', isUserMove: false, classification: 'good' }),
    move({ ply: 2, ...owner }),
    move({ ply: 3, san: 'Bxd4', uci: 'b6d4', color: 'black', isUserMove: false, bestUci: 'b6d4', ...next }),
  ];
}

const line = (pv: string[], cp: number, multipv = 1): EngineLine => ({ multipv, score: { cp, mate: null }, pv });

describe('nullMoveFen', () => {
  it('flips the side and clears en passant', () => {
    expect(nullMoveFen(A)).toBe(A_NULL);
    expect(nullMoveFen('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1')).toBe('4k3/8/8/3pP3/8/8/8/4K3 b - - 0 1');
    expect(nullMoveFen(C)).toBeNull();
  });
});

describe('lineGain', () => {
  it('counts the first capture', () => {
    expect(lineGain(A_NULL, ['b6d4'], 4)).toBe(9);
  });
  it('gives 0 for a recapture trade', () => {
    expect(lineGain('3rk3/8/8/8/8/8/3R4/4K3 w - - 0 1', ['d2d8', 'e8d8'], 4)).toBe(0);
  });
  it('stops at the first illegal move', () => {
    expect(lineGain(A_NULL, ['b6d4', 'a1a2', 'e1d4'], 4)).toBe(9);
  });
});

describe('findThreatCandidates', () => {
  it('finds a capture threat', () => {
    const c = findThreatCandidates(rows({}), new Set());
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({
      ply: 2, kind: 'capture', threat: 'b6d4', playedSan: 'Ke2', playedUci: 'e1e2', nullFen: A_NULL,
      lastMove: { uci: 'g1f3', san: 'Nf3' }, replySan: 'Bxd4', mateMoves: [],
    });
  });

  it('finds a mate threat', () => {
    const c = findThreatCandidates(
      rows({ fenBefore: B, color: 'black', san: 'b6', uci: 'b7b6' }, { evalBefore: { cp: null, mate: 1 }, bestUci: 'e1e8', san: 'Re8#' }),
      new Set(),
    );
    expect(c).toHaveLength(1);
    expect(c[0]!.kind).toBe('mate');
    expect(c[0]!.mateMoves).toContain('e1e8');
  });

  it('prefers mate when a threat is both', () => {
    // Re8# is mate; Re1-b1 is not a capture, so the mate row decides in both cases.
    const c = findThreatCandidates(
      rows({ fenBefore: B, color: 'black', san: 'b6', uci: 'b7b6' }, { evalBefore: { cp: null, mate: 1 }, bestUci: 'e1e8' }),
      new Set(),
    );
    expect(c[0]!.kind).toBe('mate');
    const both = findThreatCandidates(
      rows({ fenBefore: B, color: 'black', san: 'b6', uci: 'b7b6' }, { evalBefore: { cp: null, mate: 1 }, bestUci: 'e1b1' }),
      new Set(),
    );
    expect(both[0]!.kind).toBe('mate');
  });

  it('needs a positive opponent mate', () => {
    const c = findThreatCandidates(
      rows({ fenBefore: B, color: 'black', san: 'b6', uci: 'b7b6' }, { evalBefore: { cp: null, mate: -1 }, bestUci: 'e1e8' }),
      new Set(),
    );
    expect(c).toEqual([]);
  });

  it('skips a capture that was not legal before the move', () => {
    expect(findThreatCandidates(rows({}, { bestUci: 'b6a5' }), new Set())).toEqual([]);
    expect(findThreatCandidates(rows({}, { bestUci: 'h1h2' }), new Set())).toEqual([]);
  });

  it('skips plies in skipPlies', () => {
    expect(findThreatCandidates(rows({}), new Set([2]))).toEqual([]);
  });

  it('skips non-mistakes and opponent moves', () => {
    expect(findThreatCandidates(rows({ classification: 'good' }), new Set())).toEqual([]);
    expect(findThreatCandidates(rows({ classification: 'inaccuracy' }), new Set())).toEqual([]);
    expect(findThreatCandidates(rows({ isUserMove: false }), new Set())).toEqual([]);
    expect(findThreatCandidates(rows({ classification: 'mistake' }), new Set())).toHaveLength(1);
  });

  it('skips a position where the owner is in check', () => {
    expect(findThreatCandidates(rows({ fenBefore: C }), new Set())).toEqual([]);
  });

  it('skips the first and the last ply', () => {
    const r = rows({});
    expect(findThreatCandidates([{ ...r[1]!, ply: 1 }, { ...r[2]!, ply: 2 }], new Set())).toEqual([]);
    expect(findThreatCandidates(r.slice(0, 2), new Set())).toEqual([]);
  });

  it('accepts a promotion capture threat', () => {
    const c = findThreatCandidates(
      rows({ fenBefore: P, color: 'black', san: 'Kh8', uci: 'g8h8' }, { bestUci: 'E7D8Q' }),
      new Set(),
    );
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ kind: 'capture', threat: 'e7d8q' });
    const nullFen = c[0]!.nullFen;
    const r = confirmThreat(nullFen, 'e7d8q', [line(['E7D8Q', 'g8h8'], 300)], null);
    expect(r).toEqual({ accepted: ['e7d8q'], best: 'e7d8q' });
  });
});

describe('confirmThreat', () => {
  it('keeps lines within 5 win % that gain 2 pawns', () => {
    const lines = [line(['b6d4'], 900, 1), line(['e8d8'], 890, 2), line(['b6a5'], -400, 3)];
    expect(confirmThreat(A_NULL, 'b6d4', lines, null)).toEqual({ accepted: ['b6d4'], best: 'b6d4' });
  });

  it('does not accept a line 6 win % below the top', () => {
    // 300 cp is about 70 %, 150 cp is about 59 %.
    expect(confirmThreat(A_NULL, 'b6d4', [line(['b6d4'], 300, 1)], null)).not.toBeNull();
    expect(confirmThreat(A_NULL, 'b6d4', [line(['e8d8'], 300, 1), line(['b6d4'], 120, 2)], null)).toBeNull();
  });

  it('uses the extra line when T is outside the top 3', () => {
    const lines = [line(['e8d8'], 100, 1), line(['e8e7'], 100, 2), line(['e8f8'], 100, 3)];
    const extra = line(['b6d4'], 100, 4);
    expect(confirmThreat(A_NULL, 'b6d4', lines, extra)?.accepted).toContain('b6d4');
    expect(confirmThreat(A_NULL, 'b6d4', lines, null)).toBeNull();
  });

  it('returns null when T fails the rule', () => {
    expect(confirmThreat(A_NULL, 'b6d4', [line(['b6d4'], 100, 1)], null)).not.toBeNull();
    expect(confirmThreat(A_NULL, 'b6a5', [line(['b6a5'], 100, 1)], null)).toBeNull();
  });
});

describe('threatText', () => {
  it('describes the threat', () => {
    expect(threatText('6k1/1p3ppp/8/8/8/8/8/4R1K1 w - - 0 1', 'e1e8', true)).toBe('Re8# is checkmate.');
    expect(threatText(A_NULL, 'b6d4', false)).toBe('Bxd4 takes your queen.');
    expect(threatText('4k3/5p2/8/8/8/1B6/8/4K3 w - - 0 1', 'b3f7', false)).toBe('Bxf7+ takes your pawn with check.');
    expect(threatText('4k3/8/8/8/3N4/8/8/4K3 w - - 0 1', 'd4f5', false)).toBe('Nf5 wins material.');
  });
});
