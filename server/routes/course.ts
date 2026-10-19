import type { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import type { CourseLesson, CourseLessonDetail, Lesson, LessonStatus } from '../../shared/types.js';
import { completeLesson, lessonStatuses } from '../course/lesson-cards.js';
import { currentLevel } from '../level.js';

export function courseRoutes(db: DatabaseSync, getLessons: () => Lesson[], now: () => number): Hono {
  /** Computes the level and the progress once; a completed lesson stays `done` even above the level. */
  const statusResolver = (): ((lesson: Lesson) => LessonStatus) => {
    const level = currentLevel(db).level;
    const progress = lessonStatuses(db);
    return (lesson) => {
      if (progress.get(lesson.id) === 'done') return 'done';
      return lesson.level > level ? 'locked' : 'new';
    };
  };
  const find = (id: string) => getLessons().find((l) => l.id === id);

  return new Hono()
    .get('/course', (c) => {
      const statusOf = statusResolver();
      const list: CourseLesson[] = getLessons().map((l) => ({
        id: l.id, order: l.order, level: l.level, title: l.title, summary: l.summary, status: statusOf(l), exercises: l.exercises.length,
      }));
      return c.json(list);
    })
    .get('/course/:id', (c) => {
      const lesson = find(c.req.param('id'));
      if (!lesson) return c.json({ error: 'not found' }, 404);
      const detail: CourseLessonDetail = { ...lesson, status: statusResolver()(lesson) };
      return c.json(detail);
    })
    .post('/course/:id/complete', (c) => {
      const lesson = find(c.req.param('id'));
      if (!lesson) return c.json({ error: 'not found' }, 404);
      if (statusResolver()(lesson) === 'locked') return c.json({ error: 'lesson is locked' }, 409);
      return c.json(completeLesson(db, lesson, now()));
    });
}
