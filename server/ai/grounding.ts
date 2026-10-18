const SAN_RE = /\b(?:[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x[a-h][1-8]|[a-h][1-8](?:=[QRBN])?|O-O(?:-O)?)[+#]?/g;
const SQUARE_RE = /\b[a-h][1-8]\b/g;

/** Drops check marks; the promotion part is kept. */
const normalise = (san: string) => san.replace(/[+#]+$/, '');
const stripPromotion = (san: string) => san.replace(/=[QRBN]$/, '');

/**
 * Builds the set of tokens the AI may mention: the facts' SAN moves, their destination squares
 * (so "the f3 square" is fine after "Nf3"), and plain squares named in `factsText`.
 * A bare square such as "e4" looks like a pawn move to the regex, so it must be allowed this way.
 */
export function groundingSet(sans: Iterable<string>, factsText = ''): Set<string> {
  const out = new Set<string>();
  for (const raw of sans) {
    const san = normalise(raw);
    out.add(san);
    const dest = /([a-h][1-8])(?:=[QRBN])?$/.exec(san);
    if (dest?.[1] !== undefined) out.add(dest[1]);
  }
  for (const sq of factsText.match(SQUARE_RE) ?? []) out.add(sq);
  return out;
}

/** Returns SAN-looking tokens in `text` that are not in `allowedSan` (ignoring +/#; 0-0 counts as O-O). */
export function findUngroundedMoves(text: string, allowedSan: Set<string>): string[] {
  const allowed = new Set<string>();
  for (const san of allowedSan) {
    const n = normalise(san);
    allowed.add(n);
    allowed.add(stripPromotion(n));
  }
  const prepared = text.replace(/\b0-0(-0)?(?![\w-])/g, (m) => m.replaceAll('0', 'O'));
  const bad: string[] = [];
  for (const match of prepared.match(SAN_RE) ?? []) {
    const token = normalise(match);
    if (allowed.has(token) || allowed.has(stripPromotion(token))) continue;
    if (!bad.includes(token)) bad.push(token);
  }
  return bad;
}
