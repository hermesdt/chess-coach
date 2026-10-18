import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listLessonFiles, loadLesson, loadLessons, LessonError } from './load.js';

const SAMPLE_DIR = 'content/lessons/__test__';

describe('loadLessons', () => {
  it('loads the sample lesson fixture', () => {
    const [lesson, ...rest] = loadLessons(SAMPLE_DIR);
    expect(rest).toEqual([]);
    expect(lesson!.id).toBe('blunder-check');
    expect(lesson!.exercises).toHaveLength(3);
    expect(lesson!.links).toEqual([]);
  });

  it('sorts by order and ignores sub-directories such as __test__', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lessons-'));
    const base = JSON.parse(JSON.stringify(loadLessons(SAMPLE_DIR)[0]));
    writeFileSync(join(dir, 'b.json'), JSON.stringify({ ...base, id: 'center', order: 3 }));
    writeFileSync(join(dir, 'a.json'), JSON.stringify({ ...base, id: 'free-material', order: 2 }));
    mkdirSync(join(dir, '__test__'));
    writeFileSync(join(dir, '__test__', 'x.json'), JSON.stringify(base));
    writeFileSync(join(dir, 'notes.txt'), 'ignored');
    expect(loadLessons(dir).map((l) => l.id)).toEqual(['free-material', 'center']);
    expect(listLessonFiles(dir)).toHaveLength(2);
  });

  it('skips a malformed file, reports it and keeps the valid lessons', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lessons-'));
    writeFileSync(join(dir, 'good.json'), JSON.stringify(loadLessons(SAMPLE_DIR)[0]));
    writeFileSync(join(dir, 'bad.json'), JSON.stringify({ id: 'nope' }));
    writeFileSync(join(dir, 'broken.json'), '{ not json');
    const errors: string[] = [];
    const lessons = loadLessons(dir, (file) => errors.push(file));
    expect(lessons.map((l) => l.id)).toEqual(['blunder-check']);
    expect(errors.map((f) => f.split('/').pop())).toEqual(['bad.json', 'broken.json']);
  });

  it('returns an empty list when the directory does not exist', () => {
    expect(loadLessons(join(tmpdir(), 'no-such-lessons-dir'))).toEqual([]);
  });

  it('loads the real content directory without throwing', () => {
    expect(() => loadLessons()).not.toThrow();
  });
});

describe('loadLesson (shape checks)', () => {
  const good = () => JSON.parse(JSON.stringify(loadLessons(SAMPLE_DIR)[0]));

  it('rejects an unknown lesson id', () => {
    expect(() => loadLesson({ ...good(), id: 'nope' })).toThrow(LessonError);
  });

  it('rejects a bad level, tag or exercise shape', () => {
    expect(() => loadLesson({ ...good(), level: 4 })).toThrow(/level/);
    expect(() => loadLesson({ ...good(), tags: ['bogus'] })).toThrow(/tag/);
    expect(() => loadLesson({ ...good(), exercises: [{ id: 'x' }] })).toThrow(/exercise/);
    expect(() => loadLesson(null)).toThrow(LessonError);
  });
});
