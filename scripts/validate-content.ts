import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { closeEnginePool, lazyEnginePool } from '../server/engine/pool.js';
import { LessonError, listLessonFiles, loadLesson, validateLesson } from '../server/course/load.js';
import type { LessonEngineCache } from '../server/course/validate.js';
import { GuideError, listGuideFiles, loadGuide, validateGuide } from '../server/guides/load.js';
import { listRepertoireFiles, loadAllRepertoires, loadRepertoire, RepertoireError } from '../server/repertoire/load.js';
import { validateRepertoire, type EngineCache } from '../server/repertoire/validate.js';
import type { ValidationIssue } from '../server/repertoire/types.js';
import { parseValidateArgs } from './validate-args.js';

const NODES = 1_000_000;
const PROGRESS_EVERY = 20;

async function lessonIssues(paths: string[]): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const cache: LessonEngineCache = new Map();
  const seen = new Map<string, string>();
  const seenFens = new Map<string, string>();
  for (const path of paths) {
    const file = basename(path);
    try {
      const lesson = loadLesson(JSON.parse(readFileSync(path, 'utf8')));
      const other = seen.get(lesson.id);
      if (other) issues.push({ file, nodeId: '(lesson)', rule: 'duplicate-lesson', detail: `Lesson id "${lesson.id}" is already used by ${other}` });
      seen.set(lesson.id, file);
      console.log(`${file}: checking ${lesson.exercises.length} exercises`);
      issues.push(...(await validateLesson(lesson, lazyEnginePool, { nodes: NODES, seenFens }, cache)).map((i) => ({ ...i, file })));
    } catch (e) {
      if (!(e instanceof LessonError || e instanceof SyntaxError)) throw e;
      issues.push({ file, nodeId: '(file)', rule: 'invalid-lesson', detail: e.message });
    }
  }
  return issues;
}

async function repertoireIssues(paths: string[]): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const cache: EngineCache = new Map();
  let total = 0;
  for (const path of paths) {
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
  return issues;
}

async function guideIssues(paths: string[]): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const reps = loadAllRepertoires();
  for (const path of paths) {
    const file = basename(path);
    try {
      const guide = loadGuide(JSON.parse(readFileSync(path, 'utf8')), reps);
      const rep = reps.find((r) => r.id === guide.repertoireId)!;
      console.log(`${file}: checking ${guide.variations.length} variations`);
      issues.push(...(await validateGuide(guide, rep, lazyEnginePool, { nodes: NODES })).map((i) => ({ ...i, file })));
    } catch (e) {
      if (!(e instanceof GuideError || e instanceof SyntaxError)) throw e;
      issues.push({ file, nodeId: '(file)', rule: 'invalid-guide', detail: e.message });
    }
  }
  return issues;
}

/** A guide file has a `repertoireId` key. */
function isGuideFile(path: string): boolean {
  try {
    return 'repertoireId' in (JSON.parse(readFileSync(path, 'utf8')) as object);
  } catch {
    return path.includes('guides');
  }
}

/** A file with an `exercises` key is a lesson, any other file is a repertoire. */
function isLessonFile(path: string): boolean {
  try {
    return 'exercises' in (JSON.parse(readFileSync(path, 'utf8')) as object);
  } catch {
    return path.includes('lessons');
  }
}

async function main(): Promise<number> {
  const args = parseValidateArgs(process.argv.slice(2));
  const issues: ValidationIssue[] = [];
  if (args.file !== null) {
    if (!existsSync(args.file)) {
      console.log(`File not found: ${args.file}`);
      return 1;
    }
    const run = isGuideFile(args.file) ? guideIssues : isLessonFile(args.file) ? lessonIssues : repertoireIssues;
    issues.push(...(await run([args.file])));
  } else {
    if (args.repertoires) issues.push(...(await repertoireIssues(listRepertoireFiles())));
    if (args.lessons) issues.push(...(await lessonIssues(listLessonFiles())));
    if (args.repertoires) issues.push(...(await guideIssues(listGuideFiles())));
  }
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
