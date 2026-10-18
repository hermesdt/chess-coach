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
