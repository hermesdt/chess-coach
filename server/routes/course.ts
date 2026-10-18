import type { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import type { CourseLesson, CourseLessonDetail, Lesson, LessonStatus } from '../../shared/types.js';
import { completeLesson, lessonStatuses } from '../course/lesson-cards.js';
import { currentLevel } from '../level.js';

export function courseRoutes(db: DatabaseSync, getLessons: () => Lesson[], now: () => number): Hono {
  const statusOf = (lesson: Lesson): LessonStatus => {
    if (lesson.level > currentLevel(db).level) return 'locked';
    return lessonStatuses(db).get(lesson.id) === 'done' ? 'done' : 'new';
  };
  const find = (id: string) => getLessons().find((l) => l.id === id);

  return new Hono()
    .get('/course', (c) => {
      const list: CourseLesson[] = getLessons().map((l) => ({
        id: l.id, order: l.order, level: l.level, title: l.title, summary: l.summary, status: statusOf(l), exercises: l.exercises.length,
      }));
      return c.json(list);
    })
    .get('/course/:id', (c) => {
      const lesson = find(c.req.param('id'));
      if (!lesson) return c.json({ error: 'not found' }, 404);
      const detail: CourseLessonDetail = { ...lesson, status: statusOf(lesson) };
      return c.json(detail);
    })
    .post('/course/:id/complete', (c) => {
      const lesson = find(c.req.param('id'));
      if (!lesson) return c.json({ error: 'not found' }, 404);
      if (statusOf(lesson) === 'locked') return c.json({ error: 'lesson is locked' }, 409);
      return c.json(completeLesson(db, lesson, now()));
    });
}
