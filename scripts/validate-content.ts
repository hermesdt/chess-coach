import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { closeEnginePool, lazyEnginePool } from '../server/engine/pool.js';
import { LessonError, listLessonFiles, loadLesson, validateLesson } from '../server/course/load.js';
import type { LessonEngineCache } from '../server/course/validate.js';
import { listRepertoireFiles, loadRepertoire, RepertoireError } from '../server/repertoire/load.js';
import { validateRepertoire, type EngineCache } from '../server/repertoire/validate.js';
import type { ValidationIssue } from '../server/repertoire/types.js';

const NODES = 1_000_000;
const PROGRESS_EVERY = 20;

async function lessonIssues(): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const cache: LessonEngineCache = new Map();
  const seen = new Map<string, string>();
  for (const path of listLessonFiles()) {
    const file = basename(path);
    try {
      const lesson = loadLesson(JSON.parse(readFileSync(path, 'utf8')));
      const other = seen.get(lesson.id);
      if (other) issues.push({ file, nodeId: '(lesson)', rule: 'duplicate-lesson', detail: `Lesson id "${lesson.id}" is already used by ${other}` });
      seen.set(lesson.id, file);
      console.log(`${file}: checking ${lesson.exercises.length} exercises`);
      issues.push(...(await validateLesson(lesson, lazyEnginePool, { nodes: NODES }, cache)).map((i) => ({ ...i, file })));
    } catch (e) {
      if (!(e instanceof LessonError || e instanceof SyntaxError)) throw e;
      issues.push({ file, nodeId: '(file)', rule: 'invalid-lesson', detail: e.message });
    }
  }
  return issues;
}

async function main(): Promise<number> {
  const issues: ValidationIssue[] = [];
  const cache: EngineCache = new Map();
  let total = 0;
  for (const path of listRepertoireFiles()) {
    const file = basename(path);
    try {
      const rep = loadRepertoire(JSON.parse(readFileSync(path, 'utf8')));
      const base = total;
      issues.push(
        ...(await validateRepertoire(rep, lazyEnginePool, {
          nodes: NODES,
          onProgress: (n) => {
            if (n % PROGRESS_EVERY === 0) console.log(`${file}: ${n} positions checked (${base + n} total)`);
          },
        }, cache)),
      );
      total += rep.byId.size;
    } catch (e) {
      if (!(e instanceof RepertoireError || e instanceof SyntaxError)) throw e;
      issues.push({ file, nodeId: e instanceof RepertoireError ? e.nodeId : '(file)', rule: 'illegal-san', detail: e.message });
    }
  }
  issues.push(...(await lessonIssues()));
  const errors = issues.filter((i) => i.severity !== 'warning');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const files = [...new Set(issues.map((i) => i.file))];
  for (const file of files) {
    console.log(`\n${file}`);
    for (const i of issues.filter((x) => x.file === file)) {
      console.log(`  [${i.severity === 'warning' ? 'warning ' : ''}${i.rule}] ${i.nodeId || '(root)'}: ${i.detail}`);
    }
  }
  if (errors.length === 0) {
    console.log(warnings.length === 0 ? 'content OK' : `\ncontent OK (${warnings.length} warning(s))`);
    return 0;
  }
  console.log(`\n${errors.length} issue(s)${warnings.length ? `, ${warnings.length} warning(s)` : ''}`);
  return 1;
}

try {
  process.exitCode = await main();
} finally {
  await closeEnginePool();
}
