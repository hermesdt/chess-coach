import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LESSON_IDS } from '../../shared/lessons.js';
import type { Exercise, Lesson, Tag } from '../../shared/types.js';

export { validateLesson } from './validate.js';

export class LessonError extends Error {
  constructor(
    readonly lessonId: string,
    message: string,
  ) {
    super(`${message} (lesson "${lessonId}")`);
    this.name = 'LessonError';
  }
}

const DEFAULT_DIR = 'content/lessons';
const TAGS: readonly string[] = [
  'hung_piece', 'missed_capture', 'missed_mate', 'allowed_mate', 'bad_trade',
  'early_queen', 'slow_development', 'no_castle', 'same_piece_twice',
];

const isString = (v: unknown): v is string => typeof v === 'string';
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString);

function loadExercise(lessonId: string, raw: unknown): Exercise {
  const e = raw as Record<string, unknown> | null;
  if (
    typeof e !== 'object' || e === null || !isString(e.id) || !isString(e.fen) || !isString(e.prompt) ||
    !isStringArray(e.solution) || !isString(e.explanation)
  ) {
    throw new LessonError(lessonId, 'Each exercise needs id, fen, prompt, solution (string[]) and explanation');
  }
  return { id: e.id, fen: e.fen, prompt: e.prompt, solution: e.solution, explanation: e.explanation };
}

/** Shape checks only. Chess and content rules (FEN, moves, word count) belong to `validateLesson`. */
export function loadLesson(json: unknown): Lesson {
  const raw = json as Record<string, unknown> | null;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new LessonError('(root)', 'Lesson must be an object');
  const { id } = raw;
  if (!isString(id) || !(LESSON_IDS as readonly string[]).includes(id)) {
    throw new LessonError(String(id), `Lesson id must be one of ${LESSON_IDS.join(', ')}`);
  }
  if (typeof raw.order !== 'number') throw new LessonError(id, 'Lesson needs a numeric order');
  if (raw.level !== 1 && raw.level !== 2 && raw.level !== 3) throw new LessonError(id, 'level must be 1, 2 or 3');
  if (!isString(raw.title) || !isString(raw.summary) || !isString(raw.body)) {
    throw new LessonError(id, 'Lesson needs title, summary and body strings');
  }
  if (!isStringArray(raw.tags) || !raw.tags.every((t) => TAGS.includes(t))) {
    throw new LessonError(id, 'Each tag must be a known tag');
  }
  if (!Array.isArray(raw.exercises)) throw new LessonError(id, 'Lesson needs an exercises array');
  const links = raw.links;
  if (
    !Array.isArray(links) ||
    !links.every((l) => typeof l === 'object' && l !== null && isString((l as Record<string, unknown>).title) && isString((l as Record<string, unknown>).url))
  ) {
    throw new LessonError(id, 'links must be an array of { title, url }');
  }
  return {
    id, order: raw.order, level: raw.level, title: raw.title, summary: raw.summary, tags: raw.tags as Tag[],
    body: raw.body, exercises: raw.exercises.map((e) => loadExercise(id, e)),
    links: (links as { title: string; url: string }[]).map((l) => ({ title: l.title, url: l.url })),
  };
}

/** Top-level `*.json` files only, so `__test__/` fixtures are never picked up. */
export function listLessonFiles(dir: string = DEFAULT_DIR): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map((e) => join(dir, e.name))
    .sort();
}

/** Loads every valid lesson. A malformed file is skipped and reported to `onError`, so one bad file never empties the course. */
export function loadLessons(
  dir: string = DEFAULT_DIR,
  onError: (file: string, error: Error) => void = (file, e) => console.error(`lesson file skipped: ${file}: ${e.message}`),
): Lesson[] {
  const lessons: Lesson[] = [];
  for (const file of listLessonFiles(dir)) {
    try {
      lessons.push(loadLesson(JSON.parse(readFileSync(file, 'utf8'))));
    } catch (e) {
      if (!(e instanceof LessonError || e instanceof SyntaxError)) throw e;
      onError(file, e);
    }
  }
  return lessons.sort((a, b) => a.order - b.order);
}
