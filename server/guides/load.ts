import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Repertoire } from '../repertoire/types.js';
import { loadAllRepertoires } from '../repertoire/load.js';
import type { GuideFile, GuideVariation } from './types.js';

export { validateGuide } from './validate.js';

export class GuideError extends Error {
  constructor(
    readonly file: string,
    message: string,
  ) {
    super(`${message} (guide "${file}")`);
    this.name = 'GuideError';
  }
}

const DEFAULT_DIR = 'content/guides';

const isString = (v: unknown): v is string => typeof v === 'string';
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function loadVariation(file: string, raw: unknown): GuideVariation {
  if (!isObject(raw) || !isString(raw.key) || !isString(raw.name)) throw new GuideError(file, 'Each variation needs key and name strings');
  const key = raw.key;
  const fail = (m: string): never => {
    throw new GuideError(file, `${m} (variation "${key}")`);
  };
  if (!isStringArray(raw.roots) || raw.roots.length === 0) fail('roots must be a non-empty string array');
  const ff = raw.finalForm;
  if (!isObject(ff) || !isString(ff.nodeId) || !Array.isArray(ff.jobs)) fail('finalForm needs nodeId and a jobs array');
  const finalForm = ff as { nodeId: string; jobs: unknown[] };
  const jobs = finalForm.jobs.map((j) => {
    if (!isObject(j) || !isString(j.square) || !isString(j.text)) return fail('Each job needs square and text strings');
    return { square: j.square, text: j.text };
  });
  if (!Array.isArray(raw.route)) fail('route must be an array');
  const route = (raw.route as unknown[]).map((r) => {
    if (!isObject(r) || !isString(r.nodeId) || !isString(r.why)) return fail('Each route step needs nodeId and why strings');
    return { nodeId: r.nodeId, why: r.why };
  });
  if (!Array.isArray(raw.deviations)) fail('deviations must be an array');
  const deviations = (raw.deviations as unknown[]).map((d) => {
    if (!isObject(d) || !isString(d.nodeId) || !isString(d.plan) || (d.showNodeId !== undefined && !isString(d.showNodeId))) {
      return fail('Each deviation needs nodeId and plan strings, and an optional showNodeId string');
    }
    return d.showNodeId === undefined ? { nodeId: d.nodeId, plan: d.plan } : { nodeId: d.nodeId, plan: d.plan, showNodeId: d.showNodeId };
  });
  if (!isString(raw.middlegame)) fail('middlegame must be a string');
  if (!Array.isArray(raw.mistakes)) fail('mistakes must be an array');
  const mistakes = (raw.mistakes as unknown[]).map((m) => {
    if (!isObject(m) || !isStringArray(m.moves) || !isString(m.text)) return fail('Each mistake needs a moves string array and a text string');
    if (m.bad !== undefined && !isString(m.bad)) return fail('A mistake bad move needs a string');
    if (m.good !== undefined && !isStringArray(m.good)) return fail('A mistake good needs a string array');
    return {
      moves: m.moves, text: m.text,
      ...(m.bad === undefined ? {} : { bad: m.bad }),
      ...(m.good === undefined ? {} : { good: m.good }),
    };
  });
  return {
    key, name: raw.name, roots: raw.roots as string[], finalForm: { nodeId: finalForm.nodeId, jobs },
    route, deviations, middlegame: raw.middlegame as string, mistakes,
  };
}

/** Shape checks only. Node and chess rules belong to `validateGuide`. */
export function loadGuide(json: unknown, reps: Repertoire[]): GuideFile {
  if (!isObject(json)) throw new GuideError('(root)', 'Guide must be an object');
  const { repertoireId } = json;
  if (!isString(repertoireId)) throw new GuideError('(root)', 'Guide needs a repertoireId string');
  if (!reps.some((r) => r.id === repertoireId)) throw new GuideError(repertoireId, `Unknown repertoire "${repertoireId}"`);
  if (!isString(json.why)) throw new GuideError(repertoireId, 'Guide needs a why string');
  if (!Array.isArray(json.variations) || json.variations.length === 0) throw new GuideError(repertoireId, 'Guide needs a non-empty variations array');
  return { repertoireId, why: json.why, variations: json.variations.map((v) => loadVariation(repertoireId, v)) };
}

/** Top-level `*.json` files only, so `__test__/` fixtures are never picked up. */
export function listGuideFiles(dir: string = DEFAULT_DIR): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map((e) => join(dir, e.name))
    .sort();
}

/** Loads every valid guide. A malformed file is skipped and reported to `onError`. */
export function loadGuides(
  dir: string = DEFAULT_DIR,
  reps: Repertoire[] = loadAllRepertoires(),
  onError: (file: string, error: Error) => void = (file, e) => console.error(`guide file skipped: ${file}: ${e.message}`),
): GuideFile[] {
  const guides: GuideFile[] = [];
  for (const file of listGuideFiles(dir)) {
    try {
      guides.push(loadGuide(JSON.parse(readFileSync(file, 'utf8')), reps));
    } catch (e) {
      if (!(e instanceof GuideError || e instanceof SyntaxError)) throw e;
      onError(file, e);
    }
  }
  return guides;
}
