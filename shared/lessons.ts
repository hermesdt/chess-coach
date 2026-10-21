import type { Tag } from './types';

export const LESSON_IDS = [
  'blunder-check', 'free-material', 'center', 'develop', 'castle', 'trades',
  'bishop-pair', 'castling-sides', 'tactics', 'mates', 'caro-kann-plans', 'london-plans',
  'pawn-structures', 'outposts', 'good-bad-bishop', 'rook-endgames',
  'king-activity', 'prophylaxis', 'calculation',
  'minority-attack', 'pawn-breaks', 'trades-by-plan', 'converting', 'defence', 'opposite-bishops',
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
  missed_fork: 'tactics',
  missed_pin: 'tactics',
  weak_back_rank: 'mates',
  bad_bishop: 'good-bad-bishop',
};

/** Tags the owner sees at each level. Level 1 keeps the nine M2 tags; levels 2 and 3 add the four M9 tags. */
const LEVEL_1_TAGS: Tag[] = [
  'hung_piece', 'missed_capture', 'bad_trade', 'missed_mate', 'allowed_mate',
  'early_queen', 'slow_development', 'same_piece_twice', 'no_castle',
];
export const LEVEL_TAGS: Record<1 | 2 | 3, Tag[]> = {
  1: LEVEL_1_TAGS,
  2: [...LEVEL_1_TAGS, 'missed_fork', 'missed_pin', 'weak_back_rank', 'bad_bishop'],
  3: [...LEVEL_1_TAGS, 'missed_fork', 'missed_pin', 'weak_back_rank', 'bad_bishop'],
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
  'king-activity': 'King activity',
  prophylaxis: 'Prophylaxis',
  calculation: 'Calculation',
  'minority-attack': 'Minority attack',
  'pawn-breaks': 'Pawn breaks',
  'trades-by-plan': 'Trading with a plan',
  converting: 'Converting an advantage',
  defence: 'Defensive technique',
  'opposite-bishops': 'Opposite-colour bishops',
};
