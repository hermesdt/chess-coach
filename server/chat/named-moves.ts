import { Chess, type Move } from 'chess.js';
import { canon, prepare, SAN_RE, WORD_MOVE_RE } from '../ai/grounding.js';

export interface NamedMove { text: string; status: 'legal' | 'illegal' | 'ambiguous'; uci?: string }

export const MAX_NAMED_MOVES = 3;

const PIECE_LETTERS: Record<string, string> = { king: 'K', queen: 'Q', rook: 'R', bishop: 'B', knight: 'N', pawn: '' };
const SAN_PARTS = /^([KQRBN])?([a-h])?([1-8])?(x)?([a-h][1-8])(?:=([QRBN]))?$/;
const BARE_SQUARE = /^[a-h][1-8]$/;

const uciOf = (m: Move): string => m.from + m.to + (m.promotion ?? '');

/** Tokens in text order. Phrases such as "knight to f3" become SAN ("Nf3"). */
function tokensIn(text: string): string[] {
  const found: { index: number; token: string }[] = [];
  const rest = prepare(text).replace(WORD_MOVE_RE, (whole: string, word: string, square: string, index: number) => {
    found.push({ index, token: `${PIECE_LETTERS[word.toLowerCase()] ?? ''}${square}` });
    return ' '.repeat(whole.length);
  });
  for (const m of rest.matchAll(SAN_RE)) found.push({ index: m.index, token: canon(m[0].replace(/[+#]+$/, '')) });
  return found.sort((a, b) => a.index - b.index).map((f) => f.token);
}

/** Status of one SAN-like token in the position. Returns null when the token is not a move at all. */
function resolve(token: string, legal: Move[]): NamedMove | null {
  if (token === 'O-O' || token === 'O-O-O') {
    const flag = token === 'O-O' ? 'k' : 'q';
    const hit = legal.find((m) => m.flags.includes(flag));
    return hit ? { text: token, status: 'legal', uci: uciOf(hit) } : { text: token, status: 'illegal' };
  }
  const parts = SAN_PARTS.exec(token);
  if (!parts) return null;
  const [, piece, file, rank, capture, dest, promotion] = parts as unknown as [string, string | undefined, string | undefined, string | undefined, string | undefined, string, string | undefined];
  const hits = legal.filter((m) => {
    if (m.to !== dest) return false;
    if (piece === undefined) {
      if (m.piece !== 'p') return false;
      if ((file ?? dest[0]) !== m.from[0]) return false;
    } else {
      if (m.piece !== piece.toLowerCase()) return false;
      if (file !== undefined && m.from[0] !== file) return false;
    }
    if (rank !== undefined && m.from[1] !== rank) return false;
    return promotion === undefined || m.promotion === promotion.toLowerCase();
  });
  if (hits.length === 1) return { text: token, status: 'legal', uci: uciOf(hits[0]!) };
  if (hits.length > 1) return { text: token, status: 'ambiguous' };
  // A bare square ("e5") is mostly a description of the board, not a move.
  return BARE_SQUARE.test(token) && capture === undefined ? null : { text: token, status: 'illegal' };
}

/** SAN-like tokens and "knight to f3" phrases in the question, checked against the position. At most 3 distinct. */
export function parseNamedMoves(text: string, fen: string): NamedMove[] {
  const legal = new Chess(fen).moves({ verbose: true });
  const out: NamedMove[] = [];
  const seen = new Set<string>();
  for (const token of tokensIn(text)) {
    if (seen.has(token)) continue;
    seen.add(token);
    const named = resolve(token, legal);
    if (named) out.push(named);
    if (out.length === MAX_NAMED_MOVES) break;
  }
  return out;
}
