import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Lesson } from '../../shared/types.js';
import { openDb } from '../db/db.js';
import { listCardsByKind, positionKey, setSuspended } from '../srs/cards-repo.js';
import { completeLesson, lessonStatuses, syncLessonCards } from './lesson-cards.js';
import { loadLessons } from './load.js';

let db: DatabaseSync;
let lesson: Lesson;
beforeEach(() => {
  db = openDb(':memory:');
  lesson = loadLessons('content/lessons/__test__')[0]!;
});

describe('completeLesson', () => {
  it('creates one card per exercise with the lesson fields', () => {
    expect(completeLesson(db, lesson, 1000)).toEqual({ created: 3 });
    const cards = listCardsByKind(db, 'lesson');
    expect(cards).toHaveLength(3);
    const ex = lesson.exercises[0]!;
    const card = cards.find((c) => c.refs[0]?.exerciseId === ex.id)!;
    expect(card.positionKey).toBe(positionKey(ex.fen));
    expect(card.fen).toBe(ex.fen);
    expect(card.sideToMove).toBe('white');
    expect(card.prompt).toBe(ex.prompt);
    expect(card.solution).toEqual({ accepted: ex.solution, best: ex.solution[0], explanation: ex.explanation });
    expect(card.refs).toEqual([{ lessonId: lesson.id, exerciseId: ex.id }]);
    expect(cards.find((c) => c.refs[0]?.exerciseId === 'fools-mate')!.sideToMove).toBe('black');
    expect(lessonStatuses(db).get(lesson.id)).toBe('done');
  });

  it('does not duplicate cards when completed twice', () => {
    completeLesson(db, lesson, 1000);
    expect(completeLesson(db, lesson, 2000)).toEqual({ created: 0 });
    expect(listCardsByKind(db, 'lesson')).toHaveLength(3);
    const row = db.prepare('SELECT completed_at FROM lesson_progress WHERE lesson_id = ?').get(lesson.id);
    expect(row?.completed_at).toBe(1000);
  });
});

describe('syncLessonCards', () => {
  it('creates nothing for lessons that are not completed', () => {
    syncLessonCards(db, [lesson]);
    expect(listCardsByKind(db, 'lesson')).toEqual([]);
  });

  it('updates the card solution when an exercise changes after completion', () => {
    completeLesson(db, lesson, 1000);
    const edited: Lesson = {
      ...lesson,
      exercises: lesson.exercises.map((e) =>
        e.id === 'free-queen' ? { ...e, solution: ['d1d5', 'd1d4'], explanation: 'New text.' } : e),
    };
    syncLessonCards(db, [edited]);
    const cards = listCardsByKind(db, 'lesson');
    expect(cards).toHaveLength(3);
    const card = cards.find((c) => c.refs[0]?.exerciseId === 'free-queen')!;
    expect(card.solution).toEqual({ accepted: ['d1d5', 'd1d4'], best: 'd1d5', explanation: 'New text.' });
  });

  it('suspends cards whose exercise was removed or whose position changed', () => {
    completeLesson(db, lesson, 1000);
    const [a, b, c] = lesson.exercises;
    const moved = { ...b!, fen: '4k3/8/8/3q4/8/8/8/2R1K3 w - - 0 1', solution: ['c1c8'] };
    syncLessonCards(db, [{ ...lesson, exercises: [a!, moved] }]);
    const cards = listCardsByKind(db, 'lesson');
    const state = (id: string) => cards.filter((x) => x.refs[0]?.exerciseId === id).map((x) => x.suspended);
    expect(state(a!.id)).toEqual([false]);
    expect(state(b!.id)).toEqual([true, false]);
    expect(state(c!.id)).toEqual([true]);
  });

  it('keeps a flagged card suspended', () => {
    completeLesson(db, lesson, 1000);
    const card = listCardsByKind(db, 'lesson')[0]!;
    db.prepare('INSERT INTO card_flags (card_id, note, created_at) VALUES (?, ?, ?)').run(card.id, 'bad', 1);
    setSuspended(db, card.id, true);
    syncLessonCards(db, [lesson]);
    expect(listCardsByKind(db, 'lesson').find((c) => c.id === card.id)!.suspended).toBe(true);
  });
});
