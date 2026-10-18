import type { DatabaseSync } from 'node:sqlite';
import { Chess } from 'chess.js';
import type { Lesson, LessonStatus } from '../../shared/types.js';
import { transaction } from '../db/db.js';
import { positionKey, upsertCard } from '../srs/cards-repo.js';

/** Order the cards of lesson N before those of lesson N+1 (at most 99 exercises per lesson). */
const SORT_STRIDE = 100;

export function lessonStatuses(db: DatabaseSync): Map<string, LessonStatus> {
  const rows = db.prepare('SELECT lesson_id, status FROM lesson_progress').all();
  return new Map(rows.map((r) => [r.lesson_id as string, r.status as LessonStatus]));
}

/** Insert or update one card per exercise. Returns how many cards are new. */
function upsertLessonCards(db: DatabaseSync, lesson: Lesson): number {
  let created = 0;
  lesson.exercises.forEach((ex, i) => {
    const key = positionKey(ex.fen);
    const exists = db.prepare("SELECT 1 FROM cards WHERE kind = 'lesson' AND position_key = ?").get(key) !== undefined;
    upsertCard(db, {
      kind: 'lesson', positionKey: key, fen: ex.fen,
      sideToMove: new Chess(ex.fen).turn() === 'w' ? 'white' : 'black',
      prompt: ex.prompt,
      // The validator warns when the engine best is not listed first, so the first move is the best.
      solution: { accepted: ex.solution, best: ex.solution[0]!, explanation: ex.explanation },
      refs: [{ lessonId: lesson.id, exerciseId: ex.id }],
      lastMove: null, sortOrder: lesson.order * SORT_STRIDE + i,
    }, { mergeRefs: false });
    if (!exists) created += 1;
  });
  return created;
}

/** Mark the lesson done and create its cards. Safe to call again: no duplicates, first completion time kept. */
export function completeLesson(db: DatabaseSync, lesson: Lesson, now: number): { created: number } {
  return transaction(db, () => {
    db.prepare(`INSERT INTO lesson_progress (lesson_id, status, completed_at) VALUES (?, 'done', ?)
      ON CONFLICT(lesson_id) DO NOTHING`).run(lesson.id, now);
    return { created: upsertLessonCards(db, lesson) };
  });
}

/** Bring the cards of every completed lesson in line with the lesson files. Idempotent. */
export function syncLessonCards(db: DatabaseSync, lessons: Lesson[]): void {
  const done = lessonStatuses(db);
  for (const lesson of lessons) {
    if (done.get(lesson.id) === 'done') transaction(db, () => upsertLessonCards(db, lesson));
  }
}
