import type { Rating } from '../../../shared/types';

/** Owner moves kept in one play-it-out card. */
export const PLAYOUT_MOVES = 5;
/** Win % points that count as "about the same". */
const BAND = 10;

export interface PlayoutResult { firstUci: string; rewinds: number; warnings: number; startWin: number; endWin: number }

/** Good: no rewind and at most 10 points lost. Hard: one rewind, or more lost. Again: two or more rewinds. */
export function playoutRating(r: { rewinds: number; startWin: number; endWin: number }): Rating {
  if (r.rewinds >= 2) return 'again';
  if (r.rewinds === 1) return 'hard';
  return r.endWin >= r.startWin - BAND ? 'good' : 'hard';
}

export function playoutVerdict(startWin: number, endWin: number): 'Better' | 'About the same' | 'Worse' {
  const diff = endWin - startWin;
  if (diff > BAND) return 'Better';
  if (diff < -BAND) return 'Worse';
  return 'About the same';
}
