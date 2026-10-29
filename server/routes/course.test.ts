import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CourseLesson, CourseLessonDetail, Lesson } from '../../shared/types.js';
import { readFileSync } from 'node:fs';
import type { PlanFile } from '../../shared/plans.js';
import { createApp } from '../app.js';
import { loadPlan } from '../plans/load.js';
import { loadAllRepertoires } from '../repertoire/load.js';
import { loadLessons } from '../course/load.js';
import { openDb } from '../db/db.js';
import { setSetting } from '../db/settings-repo.js';
import { listCardsByKind } from '../srs/cards-repo.js';

let db: DatabaseSync;
let app: ReturnType<typeof createApp>;
let first: Lesson;
let second: Lesson;
beforeEach(() => {
  db = openDb(':memory:');
  first = loadLessons('content/lessons/__test__')[0]!;
  second = { ...first, id: 'free-material', order: 2, level: 2, title: 'Free stuff' };
  app = createApp({ db, lessons: [first, second], now: () => 5000 });
});
const post = (path: string) => app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });

describe('GET /api/course', () => {
  it('lists lessons with status and exercise count; a lesson above the level is locked', async () => {
    const list = (await (await app.request('/api/course')).json()) as CourseLesson[];
    expect(list).toEqual([
      { id: 'blunder-check', order: 1, level: 1, title: 'Blunder check', summary: first.summary, status: 'new', exercises: 3 },
      { id: 'free-material', order: 2, level: 2, title: 'Free stuff', summary: first.summary, status: 'locked', exercises: 3 },
    ]);
  });

  it('shows a completed lesson as done even when it is above the current level', async () => {
    db.prepare("INSERT INTO lesson_progress (lesson_id, status, completed_at) VALUES ('free-material', 'done', 1)").run();
    const list = (await (await app.request('/api/course')).json()) as CourseLesson[];
    expect(list.map((l) => l.status)).toEqual(['new', 'done']);
    const detail = (await (await app.request('/api/course/free-material')).json()) as CourseLessonDetail;
    expect(detail.status).toBe('done');
  });

  it('unlocks a lesson when the level reaches it', async () => {
    setSetting(db, 'level_override', '2');
    const list = (await (await app.request('/api/course')).json()) as CourseLesson[];
    expect(list.map((l) => l.status)).toEqual(['new', 'new']);
  });
});

describe('GET /api/course/:id', () => {
  it('returns the lesson with its status', async () => {
    const res = await app.request('/api/course/blunder-check');
    const body = (await res.json()) as CourseLessonDetail;
    expect(body.status).toBe('new');
    expect(body.body).toBe(first.body);
    expect(body.exercises).toHaveLength(3);
  });

  it('returns 404 for an unknown lesson', async () => {
    expect((await app.request('/api/course/nope')).status).toBe(404);
  });
});

describe('POST /api/course/:id/complete', () => {
  it('creates cards, marks the lesson done and is idempotent', async () => {
    const res = await post('/api/course/blunder-check/complete');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ created: 3 });
    expect(listCardsByKind(db, 'lesson')).toHaveLength(3);
    const list = (await (await app.request('/api/course')).json()) as CourseLesson[];
    expect(list[0]!.status).toBe('done');
    expect(await (await post('/api/course/blunder-check/complete')).json()).toEqual({ created: 0 });
    expect(listCardsByKind(db, 'lesson')).toHaveLength(3);
  });

  it('refuses a locked lesson with 409 and creates no cards', async () => {
    expect((await post('/api/course/free-material/complete')).status).toBe(409);
    expect(listCardsByKind(db, 'lesson')).toEqual([]);
  });

  it('returns 404 for an unknown lesson', async () => {
    expect((await post('/api/course/nope/complete')).status).toBe(404);
  });
});

describe('related plans', () => {
  it('lists the plans that name the lesson', async () => {
    const plan: PlanFile = { ...loadPlan(JSON.parse(readFileSync('content/plans/__test__/sample.json', 'utf8')), loadAllRepertoires()), lessons: ['blunder-check'] };
    const planApp = createApp({ db, lessons: [first, second], plans: [plan], now: () => 5000 });
    const mine = (await (await planApp.request('/api/course/blunder-check')).json()) as CourseLessonDetail;
    expect(mine.relatedPlans).toEqual([{ id: 'sample', title: 'Sample plan' }]);
    const other = (await (await planApp.request('/api/course/free-material')).json()) as CourseLessonDetail;
    expect(other.relatedPlans).toEqual([]);
  });
});
