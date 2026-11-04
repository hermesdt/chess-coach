import { Chess, type Color, type Square } from 'chess.js';

const FILES = 'abcdefgh';
type Side = 'white' | 'black';
type FileStatus = 'open' | 'closed' | 'half-open-white' | 'half-open-black';

export interface StructureFacts {
  kings: Record<Side, { square: string; wing: 'short' | 'long' | 'centre' }>;
  files: Record<string, FileStatus>;
  pawns: Record<Side, { isolated: string[]; doubled: string[]; passed: string[] }>;
  shield: Record<Side, string[]>;
  breaks: Record<Side, { san: string; uci: string }[]>;
}

/** Half-open names identify the side without a pawn on that file. */
export function structureFacts(fen: string): StructureFacts {
  const chess = new Chess(fen);
  const pieces = chess.board().flat().filter((p) => p !== null);
  const pawns = (color: Color) => pieces.filter((p) => p.color === color && p.type === 'p').map((p) => p.square);
  const white = pawns('w');
  const black = pawns('b');
  const files: Record<string, FileStatus> = {};
  for (const file of FILES) {
    const w = white.some((s) => s[0] === file);
    const b = black.some((s) => s[0] === file);
    files[file] = w ? (b ? 'closed' : 'half-open-black') : (b ? 'half-open-white' : 'open');
  }
  const one = (color: Color) => {
    const own = color === 'w' ? white : black;
    const enemy = color === 'w' ? black : white;
    const king = pieces.find((p) => p.color === color && p.type === 'k')!.square;
    const fileIndex = (s: string) => FILES.indexOf(s[0]!);
    const rank = (s: string) => Number(s[1]);
    const isolated = own.filter((s) => !own.some((p) => Math.abs(fileIndex(s) - fileIndex(p)) === 1));
    const doubled = own.filter((s) => own.some((p) => p !== s && p[0] === s[0]));
    const passed = own.filter((s) => !enemy.some((p) => Math.abs(fileIndex(p) - fileIndex(s)) <= 1 && (color === 'w' ? rank(p) > rank(s) : rank(p) < rank(s))));
    const shield = own.filter((s) => Math.abs(fileIndex(s) - fileIndex(king)) <= 1 && (color === 'w' ? rank(s) - rank(king) : rank(king) - rank(s)) >= 1 && (color === 'w' ? rank(s) - rank(king) : rank(king) - rank(s)) <= 2).sort();
    const wing: 'long' | 'short' | 'centre' = fileIndex(king) <= 2 ? 'long' : fileIndex(king) >= 5 ? 'short' : 'centre';
    const fields = fen.split(' ');
    const hypothetical = color !== chess.turn();
    if (hypothetical) { fields[1] = color; fields[3] = '-'; }
    const mover = hypothetical ? new Chess(fields.join(' ')) : chess;
    const breaks = mover.moves({ verbose: true }).filter((m) => {
      if (m.piece !== 'p') return false;
      if (m.captured === 'p') return true;
      const targetFile = fileIndex(m.to);
      const targetRank = rank(m.to) + (color === 'w' ? 1 : -1);
      return enemy.some((p) => Math.abs(fileIndex(p) - targetFile) === 1 && rank(p) === targetRank);
    }).map((m) => ({ san: m.san, uci: m.from + m.to + (m.promotion ?? '') }));
    return { king: { square: king as Square, wing }, pawns: { isolated, doubled, passed }, shield, breaks };
  };
  const w = one('w');
  const b = one('b');
  return { kings: { white: w.king, black: b.king }, files, pawns: { white: w.pawns, black: b.pawns }, shield: { white: w.shield, black: b.shield }, breaks: { white: w.breaks, black: b.breaks } };
}
