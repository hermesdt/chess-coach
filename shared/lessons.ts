import type { Tag } from './types';

export const LESSON_IDS = [
  'blunder-check', 'free-material', 'center', 'develop', 'castle', 'trades',
  'bishop-pair', 'castling-sides', 'tactics', 'mates', 'caro-kann-plans', 'london-plans',
  'pawn-structures', 'outposts', 'good-bad-bishop', 'rook-endgames',
] as const;
export type LessonId = (typeof LESSON_IDS)[number];

export const TAG_TO_LESSON: Record<Tag, LessonId> = {
  hung_piece: 'blunder-check',
  missed_capture: 'free-material',
  bad_trade: 'trades',
  missed_mate: 'mates',
  allowed_mate: 'mates',
  early_queen: 'develop',
  slow_development: 'develop',
  same_piece_twice: 'develop',
  no_castle: 'castle',
};

export const LESSON_TITLES: Record<LessonId, string> = {
  'blunder-check': 'Blunder check',
  'free-material': 'Free stuff',
  center: 'Take the centre',
  develop: 'Develop fast',
  castle: 'Castle early',
  trades: 'Taking is not always good',
  'bishop-pair': 'The bishop pair',
  'castling-sides': 'Opposite-side and same-side castling',
  tactics: 'Basic tactics',
  mates: 'Mating patterns',
  'caro-kann-plans': 'Caro-Kann plans',
  'london-plans': 'London plans',
  'pawn-structures': 'Pawn structures',
  outposts: 'Outposts and weak squares',
  'good-bad-bishop': 'Good and bad bishops',
  'rook-endgames': 'Rook endgames',
};
