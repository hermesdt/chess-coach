import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { LESSON_IDS } from '../../shared/lessons.js';
import type { Condition, PlanBoard, PlanExercise, PlanFile, PlanMistake, PlanModel, PlanStep, Trigger } from '../../shared/plans.js';
import { loadAllRepertoires } from '../repertoire/load.js';
import type { Repertoire } from '../repertoire/types.js';

export class PlanError extends Error {
  constructor(
    readonly file: string,
    message: string,
  ) {
    super(`${message} (plan "${file}")`);
    this.name = 'PlanError';
  }
}

const DEFAULT_DIR = 'content/plans';

const isString = (v: unknown): v is string => typeof v === 'string';
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isSquare = (v: unknown): v is string => isString(v) && /^[a-h][1-8]$/.test(v);

const GROUPS = ['london', 'caro-kann', 'slav', 'general'];
const SIDES = ['white', 'black'];
const PIECES = ['K', 'Q', 'R', 'B', 'N', 'P'];
const ARROW_KINDS = ['move', 'attack', 'route'];

function inRange(n: number, low: number, high: number): boolean {
  return n >= low && n <= high;
}

function loadCondition(fail: (m: string) => never, raw: unknown): Condition {
  if (!isObject(raw)) return fail('A trigger condition must be an object');
  const own = raw.side === 'own' || raw.side === 'opp';
  switch (raw.type) {
    case 'piece':
      if (!own || !isString(raw.piece) || !PIECES.includes(raw.piece) || !Array.isArray(raw.on) || raw.on.length === 0 || !raw.on.every(isSquare)) {
        return fail('A piece condition needs side, piece and a non-empty list of squares');
      }
      return { type: 'piece', side: raw.side as 'own' | 'opp', piece: raw.piece as 'K', on: raw.on };
    case 'pawns':
      if (!own || !Array.isArray(raw.on) || raw.on.length === 0 || !raw.on.every(isSquare)) return fail('A pawns condition needs side and a non-empty list of squares');
      return { type: 'pawns', side: raw.side as 'own' | 'opp', on: raw.on };
    case 'noPawn':
      if (!own || !isString(raw.file) || !/^[a-h]$/.test(raw.file)) return fail('A noPawn condition needs side and a file a to h');
      return { type: 'noPawn', side: raw.side as 'own' | 'opp', file: raw.file };
    case 'castled':
      if (!own || (raw.wing !== 'short' && raw.wing !== 'long')) return fail('A castled condition needs side and wing short or long');
      return { type: 'castled', side: raw.side as 'own' | 'opp', wing: raw.wing };
    case 'queensOn':
      return { type: 'queensOn' };
    case 'minPieces':
      if (typeof raw.count !== 'number' || !Number.isInteger(raw.count) || raw.count < 1) return fail('A minPieces condition needs a count of 1 or more');
      return { type: 'minPieces', count: raw.count };
    default:
      return fail(`Unknown trigger condition type "${String(raw.type)}"`);
  }
}

function loadTrigger(fail: (m: string) => never, raw: unknown): Trigger {
  if (!isObject(raw) || !Array.isArray(raw.all) || raw.all.length === 0) return fail('A trigger needs a non-empty `all` list');
  if (raw.none !== undefined && !Array.isArray(raw.none)) return fail('A trigger `none` must be a list');
  const all = raw.all.map((c) => loadCondition(fail, c));
  const none = (raw.none as unknown[] | undefined)?.map((c) => loadCondition(fail, c));
  return none === undefined || none.length === 0 ? { all } : { all, none };
}

function loadBoard(fail: (m: string) => never, raw: unknown, what: string): PlanBoard {
  if (!isObject(raw) || !isStringArray(raw.moves)) return fail(`${what} needs a moves string array`);
  const board: PlanBoard = { moves: raw.moves };
  if (raw.fromNode !== undefined) {
    const f = raw.fromNode;
    if (!isObject(f) || !isString(f.repertoireId) || !isString(f.nodeId)) return fail(`${what} fromNode needs repertoireId and nodeId strings`);
    board.fromNode = { repertoireId: f.repertoireId, nodeId: f.nodeId };
  }
  if (raw.arrows !== undefined) {
    if (!Array.isArray(raw.arrows)) return fail(`${what} arrows must be a list`);
    board.arrows = raw.arrows.map((a) => {
      if (!isObject(a) || !isSquare(a.from) || !isSquare(a.to) || !isString(a.kind) || !ARROW_KINDS.includes(a.kind)) {
        return fail(`${what} has an arrow without from, to and kind (move, attack or route)`);
      }
      return { from: a.from, to: a.to, kind: a.kind as 'move' };
    });
  }
  if (raw.marks !== undefined) {
    if (!Array.isArray(raw.marks) || !raw.marks.every(isSquare)) return fail(`${what} marks must be a list of squares`);
    board.marks = raw.marks;
  }
  return board;
}

function loadPlanFile(file: string, json: unknown, reps: Repertoire[], lessonIds: readonly string[]): PlanFile {
  const fail = (m: string): never => {
    throw new PlanError(file, m);
  };
  if (!isObject(json)) return fail('Plan must be an object');
  const j = json;
  for (const key of ['id', 'title', 'summary', 'goal'] as const) if (!isString(j[key])) fail(`${key} must be a string`);
  if (!isString(j.group) || !GROUPS.includes(j.group)) fail(`group must be one of ${GROUPS.join(', ')}`);
  if (!isString(j.side) || !SIDES.includes(j.side)) fail('side must be white or black');
  if (j.level !== 1 && j.level !== 2 && j.level !== 3) fail('level must be 1, 2 or 3');
  if ((j.summary as string).length > 140) fail('summary is longer than 140 characters');

  if (!Array.isArray(j.guideLinks)) fail('guideLinks must be a list');
  const guideLinks = (j.guideLinks as unknown[]).map((g) => {
    if (!isObject(g) || !isString(g.repertoireId) || !isString(g.variation)) return fail('Each guide link needs repertoireId and variation strings');
    if (!reps.some((r) => r.id === g.repertoireId)) return fail(`Unknown repertoire "${g.repertoireId}" in guideLinks`);
    return { repertoireId: g.repertoireId, variation: g.variation };
  });
  if (!isStringArray(j.lessons)) fail('lessons must be a string array');
  for (const l of j.lessons as string[]) if (!lessonIds.includes(l)) fail(`Unknown lesson "${l}"`);

  const position = loadBoard(fail, j.position, 'position');
  const trigger = j.trigger === null ? null : loadTrigger(fail, j.trigger);
  if (trigger === null && j.group !== 'general') fail('trigger may be null only in group general');

  if (!Array.isArray(j.steps) || !inRange(j.steps.length, 3, 5)) fail('steps needs 3 to 5 entries');
  const steps: PlanStep[] = (j.steps as unknown[]).map((s) => {
    if (!isObject(s) || !isString(s.text)) return fail('Each step needs a text string');
    return s.board === undefined ? { text: s.text } : { text: s.text, board: loadBoard(fail, s.board, 'step board') };
  });

  if (!Array.isArray(j.jobs) || !inRange(j.jobs.length, 3, 6)) fail('jobs needs 3 to 6 entries');
  const jobs = (j.jobs as unknown[]).map((x) => {
    if (!isObject(x) || !isSquare(x.square) || !isString(x.text)) return fail('Each job needs a square and a text string');
    return { square: x.square, text: x.text };
  });

  if (!Array.isArray(j.breaks) || j.breaks.length > 3) fail('breaks needs 0 to 3 entries');
  const breaks = (j.breaks as unknown[]).map((x) => {
    if (!isObject(x) || !isSquare(x.from) || !isSquare(x.to) || !isString(x.text)) return fail('Each break needs from, to and a text string');
    return { from: x.from, to: x.to, text: x.text };
  });

  if (!Array.isArray(j.opponent) || !inRange(j.opponent.length, 1, 3)) fail('opponent needs 1 to 3 entries');
  const opponent = (j.opponent as unknown[]).map((x) => {
    if (!isObject(x) || !isString(x.text)) return fail('Each opponent entry needs a text string');
    return x.board === undefined ? { text: x.text } : { text: x.text, board: loadBoard(fail, x.board, 'opponent board') };
  });

  if (!isStringArray(j.notNow) || !inRange(j.notNow.length, 1, 3)) fail('notNow needs 1 to 3 strings');

  if (!Array.isArray(j.mistakes) || !inRange(j.mistakes.length, 1, 4)) fail('mistakes needs 1 to 4 entries');
  const mistakes: PlanMistake[] = (j.mistakes as unknown[]).map((m) => {
    if (!isObject(m) || !isStringArray(m.moves) || !isString(m.text) || !isString(m.bad) || !isStringArray(m.good)) {
      return fail('Each mistake needs moves, text, bad and good');
    }
    return { moves: m.moves, text: m.text, bad: m.bad, good: m.good };
  });

  if (!Array.isArray(j.models) || j.models.length > 2) fail('models needs 0 to 2 entries');
  const models: PlanModel[] = (j.models as unknown[]).map((m) => {
    if (
      !isObject(m) || !isString(m.title) || !isStringArray(m.moves) || typeof m.startPly !== 'number' || !Number.isInteger(m.startPly) ||
      (m.kind !== 'plan' && m.kind !== 'trap') || (m.source !== 'tree' && m.source !== 'stockfish') || !Array.isArray(m.comments)
    ) {
      return fail('Each model needs title, moves, startPly, kind (plan or trap), source (tree or stockfish) and comments');
    }
    const comments = m.comments.map((c: unknown) => {
      if (!isObject(c) || typeof c.ply !== 'number' || !isString(c.text)) return fail('Each model comment needs a ply number and a text string');
      return { ply: c.ply, text: c.text };
    });
    return { title: m.title, moves: m.moves, startPly: m.startPly, kind: m.kind, source: m.source, comments };
  });

  if (!Array.isArray(j.exercises) || !inRange(j.exercises.length, 3, 6)) fail('exercises needs 3 to 6 entries');
  const exercises: PlanExercise[] = (j.exercises as unknown[]).map((e) => {
    if (!isObject(e) || !isString(e.id) || !isString(e.prompt) || !isString(e.explanation) || !isStringArray(e.accepted) || !Array.isArray(e.choices)) {
      return fail('Each exercise needs id, board, prompt, choices, accepted and explanation');
    }
    if (!inRange(e.choices.length, 2, 4)) return fail(`Exercise "${e.id}" needs 2 to 4 choices`);
    const choices = e.choices.map((c: unknown) => {
      if (!isObject(c) || !isString(c.san) || !isString(c.why)) return fail(`Each choice of exercise "${e.id}" needs san and why strings`);
      return { san: c.san, why: c.why };
    });
    return { id: e.id, board: loadBoard(fail, e.board, `exercise "${e.id}" board`), prompt: e.prompt, choices, accepted: e.accepted, explanation: e.explanation };
  });

  return {
    id: j.id as string, title: j.title as string, group: j.group as PlanFile['group'], side: j.side as PlanFile['side'],
    level: j.level as 1 | 2 | 3, summary: j.summary as string, guideLinks, lessons: j.lessons as string[], position, trigger,
    goal: j.goal as string, steps, jobs, breaks, opponent, notNow: j.notNow as string[], mistakes, models, exercises,
  };
}

/** Shape checks only. Chess and engine rules belong to `validatePlan`. */
export function loadPlan(json: unknown, reps: Repertoire[], lessonIds: readonly string[] = LESSON_IDS): PlanFile {
  const file = isObject(json) && isString(json.id) ? json.id : '(root)';
  return loadPlanFile(file, json, reps, lessonIds);
}

/** Top-level `*.json` files only, so `__test__/` fixtures are never picked up. */
export function listPlanFiles(dir: string = DEFAULT_DIR): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map((e) => join(dir, e.name))
    .sort();
}

/** Loads every valid plan. A malformed file is skipped and reported to `onError`. A plan id must equal its file name. */
export function loadPlans(
  dir: string = DEFAULT_DIR,
  reps: Repertoire[] = loadAllRepertoires(),
  lessonIds: readonly string[] = LESSON_IDS,
  onError: (file: string, error: Error) => void = (file, e) => console.error(`plan file skipped: ${file}: ${e.message}`),
): PlanFile[] {
  const plans: PlanFile[] = [];
  for (const file of listPlanFiles(dir)) {
    try {
      const plan = loadPlan(JSON.parse(readFileSync(file, 'utf8')), reps, lessonIds);
      if (plan.id !== basename(file, '.json')) throw new PlanError(plan.id, `id must equal the file name "${basename(file)}"`);
      plans.push(plan);
    } catch (e) {
      if (!(e instanceof PlanError || e instanceof SyntaxError)) throw e;
      onError(file, e);
    }
  }
  return plans;
}
