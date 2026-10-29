import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { LESSON_IDS } from '../../shared/lessons.js';
import { loadAllRepertoires } from '../repertoire/load.js';
import { replayBoard } from './board.js';
import { listPlanFiles, loadPlan, loadPlans, PlanError } from './load.js';

const reps = loadAllRepertoires();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const raw = (): Record<string, any> => JSON.parse(readFileSync('content/plans/__test__/sample.json', 'utf8'));
const load = (json: unknown) => loadPlan(json, reps, LESSON_IDS);

describe('replayBoard', () => {
  it('replays SAN moves to a FEN and the last move squares', () => {
    const r = replayBoard(['e4', 'e5', 'Nf3']);
    expect(r?.fen).toBe('rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2');
    expect(r?.sans).toEqual(['e4', 'e5', 'Nf3']);
    expect(r?.lastMove).toEqual({ from: 'g1', to: 'f3' });
  });

  it('gives no last move for an empty list and null for an illegal SAN', () => {
    expect(replayBoard([])?.lastMove).toBeNull();
    expect(replayBoard(['e4', 'e4'])).toBeNull();
  });
});

describe('loadPlan', () => {
  it('loads the valid sample', () => {
    const plan = load(raw());
    expect(plan.id).toBe('sample');
    expect(plan.steps).toHaveLength(3);
    expect(plan.trigger?.all).toHaveLength(4);
  });

  it.each([
    ['steps', 2, 6],
    ['jobs', 2, 7],
    ['exercises', 2, 7],
  ])('rejects %s outside its count limits', (key, low, high) => {
    for (const n of [low, high]) {
      const json = raw();
      const base = json[key as string] as unknown[];
      json[key as string] = Array.from({ length: n }, (_, i) => base[i % base.length]);
      expect(() => load(json), `${key} x${n}`).toThrow(PlanError);
    }
  });

  it('rejects an exercise with 1 or 5 choices', () => {
    for (const n of [1, 5]) {
      const json = raw();
      const ex = json.exercises[0];
      ex.choices = Array.from({ length: n }, (_, i) => ({ san: `m${i}`, why: 'x' }));
      expect(() => load(json), `choices x${n}`).toThrow(PlanError);
    }
  });

  it('allows a null trigger only in group general', () => {
    const json = raw();
    json.trigger = null;
    expect(() => load(json)).toThrow(/trigger/);
    json.group = 'general';
    expect(load(json).trigger).toBeNull();
  });

  it('rejects an unknown lesson id and an unknown repertoire id in guideLinks', () => {
    const a = raw();
    a.lessons = ['no-such-lesson'];
    expect(() => load(a)).toThrow(/lesson/);
    const b = raw();
    b.guideLinks = [{ repertoireId: 'no-such-rep', variation: 'x' }];
    expect(() => load(b)).toThrow(/repertoire/);
  });

  it('rejects wrong types and bad levels', () => {
    const a = raw();
    a.level = 4;
    expect(() => load(a)).toThrow(PlanError);
    const b = raw();
    b.summary = 5;
    expect(() => load(b)).toThrow(PlanError);
    expect(() => load('nope')).toThrow(PlanError);
  });

  it('rejects an unknown condition type in the trigger', () => {
    const json = raw();
    json.trigger.all.push({ type: 'mystery' });
    expect(() => load(json)).toThrow(/condition/);
  });
});

describe('loadPlans and listPlanFiles', () => {
  const dirWith = (files: Record<string, string>): string => {
    const dir = mkdtempSync(join(tmpdir(), 'plans-'));
    mkdirSync(join(dir, '__test__'));
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
    return dir;
  };

  it('lists top-level json files only', () => {
    const dir = dirWith({ 'a.json': '{}', 'b.txt': '' });
    writeFileSync(join(dir, '__test__', 'c.json'), '{}');
    expect(listPlanFiles(dir).map((f) => f.split('/').pop())).toEqual(['a.json']);
  });

  it('loads valid files and skips a malformed file with one report (Review Focus 1)', () => {
    const ok = JSON.stringify({ ...raw(), id: 'good' });
    const dir = dirWith({ 'good.json': ok, 'bad.json': '{"id":"bad"}', 'broken.json': '{not json' });
    const onError = vi.fn();
    const plans = loadPlans(dir, reps, LESSON_IDS, onError);
    expect(plans.map((p) => p.id)).toEqual(['good']);
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it('skips a file whose id differs from the file name', () => {
    const dir = dirWith({ 'other.json': JSON.stringify(raw()) });
    const onError = vi.fn();
    expect(loadPlans(dir, reps, LESSON_IDS, onError)).toEqual([]);
    expect(onError.mock.calls[0]![1].message).toMatch(/file name/);
  });

  it('returns an empty list when the folder is missing', () => {
    expect(loadPlans(join(tmpdir(), 'no-such-plans-dir'), reps, LESSON_IDS)).toEqual([]);
  });
});
