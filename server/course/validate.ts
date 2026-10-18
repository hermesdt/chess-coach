import { Chess } from 'chess.js';
import { LESSON_IDS } from '../../shared/lessons.js';
import type { Exercise, Lesson } from '../../shared/types.js';
import { moverWinAfter, winPct } from '../analysis/winpct.js';
import type { EnginePool } from '../engine/pool.js';
import type { EngineLine } from '../engine/uci.js';
import type { ValidationIssue } from '../repertoire/types.js';

export const MAX_WIN_LOSS = 10;
export const MIN_BEST_GAIN = 5;
export const MIN_BODY_WORDS = 150;
export const MAX_BODY_WORDS = 400;
export const MAX_SUMMARY_LENGTH = 140;
export const MIN_EXERCISES = 3;
export const MAX_EXERCISES = 6;

/** Engine lines (multipv 2) per FEN. */
export type LessonEngineCache = Map<string, EngineLine[]>;

export interface LessonValidateOptions {
  nodes: number;
}

function sanFromUci(fen: string, uci: string | undefined): string {
  if (!uci) return '?';
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch {
    return uci;
  }
}

function tryMove(chess: Chess, uci: string): boolean {
  try {
    chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return true;
  } catch {
    return false;
  }
}

/** Words of the body without Markdown markers such as `###` and list dashes. */
export function bodyWordCount(body: string): number {
  return body.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

function staticIssues(lesson: Lesson, file: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (nodeId: string, rule: string, detail: string) => issues.push({ file, nodeId, rule, detail });
  const root = '(lesson)';

  if (LESSON_IDS.indexOf(lesson.id as (typeof LESSON_IDS)[number]) + 1 !== lesson.order) {
    add(root, 'order', `Order ${lesson.order} does not match the fixed position of "${lesson.id}"`);
  }
  if (lesson.summary.length > MAX_SUMMARY_LENGTH) {
    add(root, 'summary-length', `Summary has ${lesson.summary.length} characters (max ${MAX_SUMMARY_LENGTH})`);
  }
  const words = bodyWordCount(lesson.body);
  if (words < MIN_BODY_WORDS || words > MAX_BODY_WORDS) {
    add(root, 'body-length', `Body has ${words} words (allowed ${MIN_BODY_WORDS}-${MAX_BODY_WORDS})`);
  }
  if (!lesson.body.includes('Rule of thumb:')) add(root, 'rule-of-thumb', 'Body has no "Rule of thumb:" line');
  if (lesson.exercises.length < MIN_EXERCISES || lesson.exercises.length > MAX_EXERCISES) {
    add(root, 'exercise-count', `Lesson has ${lesson.exercises.length} exercises (allowed ${MIN_EXERCISES}-${MAX_EXERCISES})`);
  }
  const seen = new Set<string>();
  for (const ex of lesson.exercises) {
    if (seen.has(ex.id)) add(ex.id, 'duplicate-exercise', `Duplicate exercise id "${ex.id}"`);
    seen.add(ex.id);
  }
  return issues;
}

export async function validateLesson(
  lesson: Lesson,
  engine: Pick<EnginePool, 'analyse'>,
  opts: LessonValidateOptions,
  cache: LessonEngineCache = new Map(),
): Promise<ValidationIssue[]> {
  const file = `${lesson.id}.json`;
  const issues = staticIssues(lesson, file);
  const add = (nodeId: string, rule: string, detail: string, severity: 'error' | 'warning' = 'error') =>
    issues.push({ file, nodeId, rule, detail, severity });

  const search = async (fen: string): Promise<EngineLine[]> => {
    const hit = cache.get(fen);
    if (hit) return hit;
    const lines = await engine.analyse(fen, { nodes: opts.nodes, multipv: 2 });
    cache.set(fen, lines);
    return lines;
  };

  /** Mover's win % after the move; the position may be game over (no engine lines). */
  const winAfter = async (fenAfter: string): Promise<number> => {
    const lines = await search(fenAfter);
    if (lines.length === 0) return new Chess(fenAfter).isCheckmate() ? 100 : 50;
    return moverWinAfter(lines[0]!.score);
  };

  const checkExercise = async (ex: Exercise): Promise<void> => {
    let chess: Chess;
    try {
      chess = new Chess(ex.fen);
    } catch {
      add(ex.id, 'invalid-fen', `Invalid FEN "${ex.fen}"`);
      return;
    }
    const side = chess.turn() === 'w' ? 'White' : 'Black';
    if (!ex.prompt.startsWith(`${side} to move.`)) {
      add(ex.id, 'prompt-side', `Prompt must start with "${side} to move."`);
    }
    if (ex.solution.length === 0) {
      add(ex.id, 'illegal-solution', 'Solution has no moves');
      return;
    }
    const legal: string[] = [];
    for (const uci of ex.solution) {
      if (tryMove(new Chess(ex.fen), uci)) legal.push(uci);
      else add(ex.id, 'illegal-solution', `Solution move ${uci} is illegal`);
    }
    if (legal.length === 0) return;

    const lines = await search(ex.fen);
    const best = lines[0];
    if (!best) return;
    const bestWin = winPct(best.score);
    for (const uci of legal) {
      const inTop = lines.find((l) => l.pv[0] === uci);
      let win: number;
      if (inTop) win = winPct(inTop.score);
      else {
        const after = new Chess(ex.fen);
        tryMove(after, uci);
        win = await winAfter(after.fen());
      }
      const loss = bestWin - win;
      if (loss >= MAX_WIN_LOSS) {
        add(ex.id, 'engine-loss', `${sanFromUci(ex.fen, uci)} loses ${loss.toFixed(1)} win % (best: ${sanFromUci(ex.fen, best.pv[0])})`);
      }
    }
    const second = lines[1];
    if (second && bestWin - winPct(second.score) < MIN_BEST_GAIN) {
      add(ex.id, 'trivial-exercise', `Best move gains only ${(bestWin - winPct(second.score)).toFixed(1)} win % over the second best: the exercise teaches nothing`, 'warning');
    }
    if (best.pv[0] && legal.includes(best.pv[0]) && legal[0] !== best.pv[0]) {
      add(ex.id, 'best-not-first', `The engine best ${sanFromUci(ex.fen, best.pv[0])} is in the solution but not listed first; the card shows the first move`, 'warning');
    }
  };

  for (const ex of lesson.exercises) await checkExercise(ex);
  return issues;
}
