// Plan regex, with a lookbehind instead of `\b` (so `_Nf3_` and `abe4` are handled), a trailing guard,
// and an optional promotion on captures.
const SAN_RE =
  /(?<![A-Za-z0-9])(?:[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x[a-h][1-8](?:=[QRBN])?|[a-h][1-8](?:=[QRBN])?|O-O(?:-O)?)[+#]?(?![A-Za-z0-9])/g;
const SQUARE_RE = /(?<![A-Za-z0-9])[a-h][1-8](?![A-Za-z0-9])/g;
const BARE_SQUARE = /^[a-h][1-8]$/;
const MOVE_VERB =
  /^(?:play(?:s|ed|ing)?|mov(?:e|es|ed|ing)|push(?:es|ed|ing)?|advanc(?:e|es|ed|ing)|go(?:es|ing)?|went|tak(?:e|es|ing)|took|captur(?:e|es|ed|ing)|answer(?:s|ed|ing)?|repl(?:y|ies|ied|ying))$/i;
/** A move-looking start right after a digit or check mark means two moves are glued together. */
const GLUED = /([1-8+#])(?=(?:[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x?[a-h]?[1-8]|O-O))/g;

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

function prepare(text: string): string {
  return text
    .replace(/[‐-―−]/g, '-')
    .replace(/[_*`~]/g, ' ')
    .replace(/(?<![A-Za-z0-9])0-0(-0)?(?![A-Za-z0-9])/g, (m) => m.replaceAll('0', 'O'))
    .replace(GLUED, '$1 ');
}

/** True when one of the two words before `index` is a move verb ("play e4", "reply with e4"). */
function afterMoveVerb(text: string, index: number): boolean {
  const tail = text.slice(0, index).split(/[.!?;:\n]/).pop() ?? '';
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
  const prepared = prepare(text);
  const bad: string[] = [];
  for (const match of prepared.matchAll(SAN_RE)) {
    const token = normalise(match[0]);
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
