import { LESSON_TITLES, TAG_TO_LESSON, type LessonId } from '../../../shared/lessons';
import type { Tag } from '../../../shared/types';

export const lessonForTag = (tag: Tag): LessonId => TAG_TO_LESSON[tag];

export function lessonLink(tag: Tag): { to: string; title: string } {
  const id = lessonForTag(tag);
  return { to: `/course/${id}`, title: LESSON_TITLES[id] };
}
