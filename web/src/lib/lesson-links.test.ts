import { describe, expect, it } from 'vitest';
import { LESSON_IDS, LESSON_TITLES } from '../../../shared/lessons';
import type { Tag } from '../../../shared/types';
import { lessonForTag, lessonLink } from './lesson-links';

const ALL_TAGS: Tag[] = [
  'hung_piece', 'missed_capture', 'missed_mate', 'allowed_mate', 'bad_trade',
  'early_queen', 'slow_development', 'no_castle', 'same_piece_twice',
];

describe('lessonForTag', () => {
  it('maps every tag to a known lesson', () => {
    for (const tag of ALL_TAGS) expect(LESSON_IDS).toContain(lessonForTag(tag));
  });

  it('links to the lesson page with its title', () => {
    expect(lessonLink('hung_piece')).toEqual({ to: '/course/blunder-check', title: LESSON_TITLES['blunder-check'] });
  });
});
