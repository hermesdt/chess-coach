import type { Classification, Tag } from './types';

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
};

/** Plain label for the classifications that can be a key-moment reason. */
export const CLASSIFICATION_TEXT: Partial<Record<Classification, string>> = {
  blunder: 'Blunder',
  mistake: 'Mistake',
  inaccuracy: 'Inaccuracy',
};
