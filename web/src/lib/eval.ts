import { CLASSIFICATION_TEXT, TAG_TEXT } from '../../../shared/tag-text';
import type { Classification, MoveAnalysis, Tag } from '../../../shared/types';

/**
 * White's win % at every position: index 0 = start position, index i = after ply i.
 * `winAfter` is from the mover's view, so it flips when Black moved.
 */
export function whiteWinSeries(moves: MoveAnalysis[]): number[] {
  if (moves.length === 0) return [];
  const whiteView = (m: MoveAnalysis, win: number) => (m.color === 'white' ? win : 100 - win);
  return [whiteView(moves[0], moves[0].winBefore), ...moves.map((m) => whiteView(m, m.winAfter))];
}

export function glyph(c: Classification): '' | '?!' | '?' | '??' {
  if (c === 'blunder') return '??';
  if (c === 'mistake') return '?';
  if (c === 'inaccuracy') return '?!';
  return '';
}

/** Plain-words text for a key-moment reason (a tag or a classification). */
export function reasonText(reason: Classification | Tag): string {
  return (TAG_TEXT as Record<string, string>)[reason] ?? CLASSIFICATION_TEXT[reason as Classification] ?? reason;
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Heading and plain-words reasons for a move: the classification label, then one reason per tag.
 * Without a classification label (a tag-only moment) the first tag becomes the heading.
 */
export function momentText(move: MoveAnalysis): { title: string; reasons: string[] } {
  const reasons = move.tags.map((t) => TAG_TEXT[t]);
  const label = CLASSIFICATION_TEXT[move.classification];
  if (label) return { title: label, reasons };
  const [first, ...rest] = reasons;
  return first === undefined ? { title: capitalise(move.classification), reasons: [] } : { title: first, reasons: rest };
}

/** One line for a move: "Blunder: You left a piece undefended, This capture lost material". */
export function momentLine(move: MoveAnalysis): string {
  const { title, reasons } = momentText(move);
  return reasons.length > 0 ? `${title} \u2014 ${reasons.join(', ')}` : title;
}
