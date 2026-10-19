import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { parseNamedMoves } from './named-moves.js';

const START = new Chess().fen();
const AFTER_D4_NF6 = (() => {
  const c = new Chess();
  c.move('d4');
  c.move('Nf6');
  return c.fen();
})();
// White knights on b1 and f3: both reach d2.
const TWO_KNIGHTS = 'rnbqkbnr/pppppppp/8/8/8/5N2/PPP1PPPP/RNBQKB1R w KQkq - 0 1';

describe('parseNamedMoves', () => {
  it('reports an illegal SAN move', () => {
    expect(parseNamedMoves('what about Qh5?', START)).toEqual([{ text: 'Qh5', status: 'illegal' }]);
  });

  it('resolves a legal SAN move to UCI', () => {
    expect(parseNamedMoves('How about Nf3?', START)).toEqual([{ text: 'Nf3', status: 'legal', uci: 'g1f3' }]);
  });

  it('reports a move that two pieces can play as ambiguous', () => {
    expect(parseNamedMoves('and Nd2?', TWO_KNIGHTS)).toEqual([{ text: 'Nd2', status: 'ambiguous' }]);
  });

  it('accepts a disambiguated move', () => {
    expect(parseNamedMoves('try Nbd2', TWO_KNIGHTS)).toEqual([{ text: 'Nbd2', status: 'legal', uci: 'b1d2' }]);
  });

  it('handles castling, captures and check marks', () => {
    const fen = 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1';
    expect(parseNamedMoves('O-O or O-O-O?', fen)).toEqual([
      { text: 'O-O', status: 'legal', uci: 'e1g1' },
      { text: 'O-O-O', status: 'legal', uci: 'e1c1' },
    ]);
    expect(parseNamedMoves('Qh5+ ?', START)[0]).toMatchObject({ text: 'Qh5', status: 'illegal' });
  });

  it('reads plain-language phrases', () => {
    expect(parseNamedMoves('what about knight to f3?', START)).toEqual([{ text: 'Nf3', status: 'legal', uci: 'g1f3' }]);
  });

  it('ignores bare squares that are not legal pawn moves', () => {
    expect(parseNamedMoves('why is the bishop on e5 strong? and the pawn on h6', AFTER_D4_NF6)).toEqual([]);
  });

  it('keeps a legal pawn move', () => {
    expect(parseNamedMoves('what about e4?', START)).toEqual([{ text: 'e4', status: 'legal', uci: 'e2e4' }]);
  });

  it('keeps at most three distinct moves, in text order', () => {
    const out = parseNamedMoves('Nf3 or Nc3 or e4 or d4 or Nf3', START);
    expect(out.map((m) => m.text)).toEqual(['Nf3', 'Nc3', 'e4']);
  });

  it('returns nothing for a question without moves', () => {
    expect(parseNamedMoves('why did I lose?', START)).toEqual([]);
  });
});
