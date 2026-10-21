import type { Classification, Tag } from './types';

/** Tags from most to least serious. Used to order explanations and break ties. */
export const TAG_SEVERITY: Tag[] = [
  'allowed_mate',
  'missed_mate',
  'hung_piece',
  'bad_trade',
  'missed_capture',
  'missed_fork',
  'missed_pin',
  'weak_back_rank',
  'no_castle',
  'early_queen',
  'slow_development',
  'same_piece_twice',
  'bad_bishop',
];

/** Sorts tags by severity. Does not change the input. */
export function bySeverity(tags: readonly Tag[]): Tag[] {
  return [...tags].sort((a, b) => TAG_SEVERITY.indexOf(a) - TAG_SEVERITY.indexOf(b));
}

/** Plain-words explanation for every tag. */
export const TAG_TEXT: Record<Tag, string> = {
  hung_piece: 'You left a piece undefended',
  missed_capture: 'You missed free material',
  bad_trade: 'This capture lost material',
  missed_mate: 'You missed a checkmate',
  allowed_mate: 'This allowed a checkmate',
  early_queen: 'Queen out too early',
  slow_development: 'Pieces still at home',
  no_castle: 'King still in the centre',
  same_piece_twice: 'Same piece moved twice',
  missed_fork: 'You missed a fork',
  missed_pin: 'You missed a pin',
  weak_back_rank: 'Your back rank was weak',
  bad_bishop: 'Your pawns block your bishop',
};

/** Plain label for the classifications that can be a key-moment reason. */
export const CLASSIFICATION_TEXT: Partial<Record<Classification, string>> = {
  blunder: 'Blunder',
  mistake: 'Mistake',
  inaccuracy: 'Inaccuracy',
};
