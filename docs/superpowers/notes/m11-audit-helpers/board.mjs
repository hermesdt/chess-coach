import { Chess } from '../../../../node_modules/chess.js/dist/esm/chess.js';

const files = 'abcdefgh';
const squares = [];
for (let r = 8; r >= 1; r--) for (const f of files) squares.push(f + r);

export function after(fen, sanList) {
  const g = new Chess(fen);
  const fens = [fen];
  for (const san of sanList) {
    try { g.move(san); } catch { throw new Error(`Illegal move "${san}" at ply ${fens.length} in position ${g.fen()}`); }
    fens.push(g.fen());
  }
  return fens;
}

/** Absolutely pinned pieces of both colors (legal-move test). The own king is swapped
 * for a knight (same blocker, no king safety). If that side is in check, the checking
 * pieces are removed from a copy first, so check does not cut legal moves. */
export function pinned(fen) {
  const res = [];
  for (const color of ['w', 'b']) {
    const parts = fen.split(' ');
    if (parts[1] !== color) { parts[1] = color; parts[3] = '-'; }
    let g;
    try { g = new Chess(parts.join(' ')); } catch { continue; }
    const ks = squares.find((s) => { const p = g.get(s); return p && p.type === 'k' && p.color === color; });
    const opp = color === 'w' ? 'b' : 'w';
    const checkers = g.attackers(ks, opp);
    const mk = (swapKing) => {
      const h = new Chess(parts.join(' '));
      for (const c of checkers) h.remove(c);
      if (swapKing) { h.remove(ks); h.put({ type: 'n', color }, ks); }
      return h;
    };
    const legalG = mk(false), freeG = mk(true);
    for (const sq of squares) {
      const p = g.get(sq);
      if (!p || p.color !== color || p.type === 'k') continue;
      if (legalG.moves({ square: sq }).length < freeG.moves({ square: sq }).length) res.push({ square: sq, piece: color + p.type.toUpperCase() });
    }
  }
  return res;
}

export function attackersTable(fen) {
  const g = new Chess(fen);
  const t = {};
  for (const sq of squares) {
    const p = g.get(sq);
    if (!p) continue;
    const opp = p.color === 'w' ? 'b' : 'w';
    t[sq] = { piece: p.color + p.type.toUpperCase(), attackedBy: g.attackers(sq, opp), guardedBy: g.attackers(sq, p.color) };
  }
  return t;
}

export function lineOpen(fen, from, to) {
  const g = new Chess(fen);
  const df = files.indexOf(to[0]) - files.indexOf(from[0]);
  const dr = Number(to[1]) - Number(from[1]);
  if ((df === 0 && dr === 0) || !(df === 0 || dr === 0 || Math.abs(df) === Math.abs(dr))) throw new Error(`${from} and ${to} are not on one rank, file or diagonal`);
  const n = Math.max(Math.abs(df), Math.abs(dr));
  const sf = Math.sign(df), sr = Math.sign(dr);
  const blockers = [];
  for (let i = 1; i < n; i++) {
    const sq = files[files.indexOf(from[0]) + sf * i] + (Number(from[1]) + sr * i);
    const p = g.get(sq);
    if (p) blockers.push({ square: sq, piece: p.color + p.type.toUpperCase() });
  }
  return { open: blockers.length === 0, blockers };
}

/** Pseudo-moves of the bishop on `square` by board scan (ignores turn, pins and check).
 * Returns strings like "Bf5" or "Bxe4". Never flips the turn. */
export function bishopMoves(fen, square) {
  const g = new Chess(fen);
  const p = g.get(square);
  if (!p || p.type !== 'b') throw new Error(`No bishop on ${square}`);
  const out = [];
  for (const [df, dr] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    let f = files.indexOf(square[0]) + df, r = Number(square[1]) + dr;
    while (f >= 0 && f < 8 && r >= 1 && r <= 8) {
      const sq = files[f] + r;
      const q = g.get(sq);
      if (q) { if (q.color !== p.color) out.push('Bx' + sq); break; }
      out.push('B' + sq);
      f += df; r += dr;
    }
  }
  return out;
}
