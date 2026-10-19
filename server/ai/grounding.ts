// Plan regex, with a lookbehind instead of `\b` (so `_Nf3_` and `abe4` are handled), a trailing guard,
// and an optional promotion on captures.
export const SAN_RE =
  /(?<![A-Za-z0-9])(?:[KQRBNnrqk][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x[a-h][1-8](?:=[QRBN])?|[a-h][1-8](?:=[QRBN])?|O-O(?:-O)?)[+#]?(?![A-Za-z0-9])/g;
const SQUARE_RE = /(?<![A-Za-z0-9])[a-h][1-8](?![A-Za-z0-9])/g;
const BARE_SQUARE = /^[a-h][1-8]$/;
const MOVE_VERB =
  /^(?:play(?:s|ed|ing)?|mov(?:e|es|ed|ing)|push(?:es|ed|ing)?|advanc(?:e|es|ed|ing)|go(?:es|ing)?|went|tak(?:e|es|ing)|took|captur(?:e|es|ed|ing)|answer(?:s|ed|ing)?|repl(?:y|ies|ied|ying))$/i;
/** A move-looking start right after a digit or check mark means two moves are glued together. */
const GLUED = /([1-8+#])(?=(?:[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x?[a-h]?[1-8]|O-O))/g;

/** Splits glued moves, but keeps disambiguated piece moves whole (`R1a3`, `Qh4e1`). */
function splitGlued(text: string): string {
  return text.replace(GLUED, (match, _mark: string, offset: number) => {
    const before = text.slice(Math.max(0, offset - 2), offset);
    const after = text.slice(offset + 1);
    if (/[KQRBN]$/.test(before)) return match;
    if (/[KQRBN][a-h]$/.test(before) && /^[a-h]x?[1-8]/.test(after)) return match;
    return `${match} `;
  });
}

/** Drops check marks; the promotion part is kept. */
const normalise = (san: string) => san.replace(/[+#]+$/, '');
const stripPromotion = (san: string) => san.replace(/=[QRBN]$/, '');

/**
 * Builds the set of tokens the AI may mention: the facts' SAN moves (without +/#), plus `@square`
 * entries for descriptive use: the destination of each SAN ("the f3 square" after "Nf3") and plain
 * squares named in `factsText`. A bare square is only a description unless a move verb comes just
 * before it (see `findUngroundedMoves`).
 */
export function groundingSet(sans: Iterable<string>, factsText = ''): Set<string> {
  const out = new Set<string>();
  for (const raw of sans) {
    const san = normalise(raw);
    out.add(san);
    const dest = /([a-h][1-8])(?:=[QRBN])?$/.exec(san);
    if (dest?.[1] !== undefined) out.add(`@${dest[1]}`);
  }
  for (const sq of factsText.match(SQUARE_RE) ?? []) out.add(`@${sq}`);
  return out;
}

const PIECE_SYMBOLS: Record<string, string> = { '♔': 'K', '♕': 'Q', '♖': 'R', '♗': 'B', '♘': 'N', '♚': 'K', '♛': 'Q', '♜': 'R', '♝': 'B', '♞': 'N' };
const PIECE_WORDS: Record<string, string> = { king: 'K', queen: 'Q', rook: 'R', bishop: 'B', knight: 'N', pawn: 'P' };
/** "knight to g5", "rook d1", "pawn takes e5". A bare "pawn e4" is only a description, so pawns need a connective. */
export const WORD_MOVE_RE = /(?<![A-Za-z])(king|queen|rook|bishop|knight|pawn)(?:\s+(?:to|takes|captures|x)\s+|\s+x\s*|\s+)([a-h][1-8])(?![A-Za-z0-9])/gi;
/** "push the d-pawn to d5". */
const FILE_PAWN_RE = /(?<![A-Za-z])[a-h]-?\s?pawn(?:\s+(?:to|takes|captures|x)\s+|\s+x\s*)([a-h][1-8])(?![A-Za-z0-9])/gi;
/** "Nf3-g5", "e2-e4", "g1 to f3". The origin square is ignored; the piece letter, when given, must match. */
const COORD_MOVE_RE = /(?<![A-Za-z0-9])([KQRBN])?[a-h][1-8](?:\s*[-x]\s*|\s+to\s+)([a-h][1-8])(?![A-Za-z0-9])/g;

export function prepare(text: string): string {
  const cleaned = text
    .normalize('NFKC')
    .replace(/[♔♕♖♗♘♚♛♜♝♞]/g, (c) => PIECE_SYMBOLS[c] ?? c)
    .replace(/[♙♟]x?/g, ' pawn to ')
    .replace(/[‐-―−]/g, '-')
    .replace(/[_*`~]/g, ' ')
    .replace(/(?<![A-Za-z0-9])0-0(-0)?(?![A-Za-z0-9])/g, (m) => m.replaceAll('0', 'O'));
  return splitGlued(cleaned);
}

/** Lowercase piece letters (n, r, q, k) are pieces; `b` stays a file. */
export const canon = (token: string): string => (/^[nrqk]/.test(token) ? token[0]!.toUpperCase() + token.slice(1) : token);

/** `piece + destination` ("Ng5", "Pd5") for every move in the set; castling and `@` entries are skipped. */
function pieceDestinations(allowed: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const entry of allowed) {
    const m = /^([KQRBN])?[a-h]?[1-8]?x?([a-h][1-8])(?:=[QRBN])?$/.exec(normalise(entry));
    if (m?.[2] !== undefined) out.add(`${m[1] ?? 'P'}${m[2]}`);
  }
  return out;
}

/** Plain-language and coordinate moves. Matched spans are blanked so the SAN scan does not see them twice. */
function plainMoves(prepared: string, allowed: Set<string>): { rest: string; bad: string[] } {
  const known = pieceDestinations(allowed);
  const anyPiece = (dest: string): boolean => [...known].some((k) => k.endsWith(dest));
  const bad: string[] = [];
  const flag = (label: string): void => {
    if (!bad.includes(label)) bad.push(label);
  };
  let rest = prepared.replace(COORD_MOVE_RE, (whole, piece: string | undefined, dest: string) => {
    if (!(piece === undefined ? anyPiece(dest) : known.has(`${piece}${dest}`))) flag(whole.trim());
    return ' '.repeat(whole.length);
  });
  rest = rest.replace(FILE_PAWN_RE, (whole, dest: string) => {
    if (!known.has(`P${dest}`)) flag(`${dest}`);
    return whole.replace(/[a-h][1-8]$/, (s) => ' '.repeat(s.length));
  });
  rest = rest.replace(WORD_MOVE_RE, (whole, word: string, dest: string) => {
    const piece = PIECE_WORDS[word.toLowerCase()]!;
    if (!known.has(`${piece}${dest}`)) flag(`${piece === 'P' ? '' : piece}${dest}`);
    return whole.replace(/[a-h][1-8]$/, '  ');
  });
  return { rest, bad };
}

/** True when one of the two words before `index` is a move verb ("play e4", "reply with e4"). */
function afterMoveVerb(text: string, index: number): boolean {
  const tail = text.slice(0, index).split(/[.!?]/).pop() ?? '';
  return tail.split(/[^A-Za-z]+/).filter(Boolean).slice(-2).some((w) => MOVE_VERB.test(w));
}

/**
 * Returns SAN-looking tokens in `text` that are not in `allowedSan` (ignoring +/#; 0-0 counts as O-O).
 * A bare square such as "e4" is a move when a move verb is within two words before it: then a pawn
 * SAN with that destination must be in the set. Otherwise it is a description and `@e4` (or `e4`) suffices.
 */
export function findUngroundedMoves(text: string, allowedSan: Set<string>): string[] {
  const allowed = new Set<string>();
  const allowedNoPromotion = new Set<string>();
  const pawnDestinations = new Set<string>();
  for (const entry of allowedSan) {
    const n = normalise(entry);
    allowed.add(n);
    allowedNoPromotion.add(stripPromotion(n));
    const pawn = /^(?:[a-h]x)?([a-h][1-8])(?:=[QRBN])?$/.exec(n);
    if (pawn?.[1] !== undefined) pawnDestinations.add(pawn[1]);
  }
  const { rest: prepared, bad } = plainMoves(prepare(text), allowed);
  for (const match of prepared.matchAll(SAN_RE)) {
    const token = canon(normalise(match[0]));
    let ok: boolean;
    if (BARE_SQUARE.test(token)) {
      ok = afterMoveVerb(prepared, match.index) ? pawnDestinations.has(token) : allowed.has(token) || allowed.has(`@${token}`) || pawnDestinations.has(token);
    } else if (token.includes('=')) {
      ok = allowed.has(token);
    } else {
      ok = allowed.has(token) || allowedNoPromotion.has(token);
    }
    if (!ok && !bad.includes(token)) bad.push(token);
  }
  return bad;
}
