import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { LESSON_IDS } from '../../shared/lessons.js';
import type { ProviderId, WeaknessReport, WeaknessReportNote } from '../../shared/types.js';
import { getSettings } from '../config.js';
import type { Repertoire } from '../repertoire/types.js';
import { toStrictJsonSchema } from './json-schema.js';
import { findWeaknessNote, latestWeaknessNote, saveNote, weaknessKey } from './notes-repo.js';
import { buildUserPrompt, PROMPT_VERSION, SYSTEM } from './prompts/weakness.js';
import type { Registry } from './registry.js';
import { runStructured } from './runner.js';
import { NOT_CONFIGURED } from './game-review.js';
import { DEFAULT_LAST_N, weaknessAllowedSan, weaknessFacts, weaknessFactsText } from './weakness-facts.js';

export { weaknessFacts } from './weakness-facts.js';
export type { WeaknessFacts } from './weakness-facts.js';

export const MAX_WEAKNESSES = 3;
export const NO_GAMES = 'Analyse a few games first.';

const item = z.object({ title: z.string(), rule: z.string(), lessonId: z.enum(LESSON_IDS), focus: z.string() });
const schemaFor = (minWeaknesses: number) => z.object({
  headline: z.string(),
  weaknesses: z.array(item).min(minWeaknesses).max(MAX_WEAKNESSES),
  encouragement: z.string(),
});

/** Strict: additionalProperties false, every key required, no numeric bounds. */
export const WEAKNESS_JSON_SCHEMA: object = toStrictJsonSchema(schemaFor(0));

export const latestWeakness = (db: DatabaseSync): WeaknessReportNote | null => latestWeaknessNote(db);

export async function weaknessReport(
  db: DatabaseSync,
  registry: Registry,
  opts: { provider?: ProviderId; signal?: AbortSignal; reps?: Pick<Repertoire, 'id' | 'name'>[]; lastN?: number },
): Promise<WeaknessReportNote> {
  const facts = weaknessFacts(db, opts.lastN ?? DEFAULT_LAST_N, opts.reps ?? []);
  if (facts.games === 0) throw new Error(NO_GAMES);
  const settings = getSettings(db);
  const provider = await registry.pick(opts.provider ?? settings.aiProvider);
  if (!provider) throw new Error(NOT_CONFIGURED);

  const hash = createHash('sha1').update(weaknessFactsText(facts)).digest('hex');
  const promptVersion = `${PROMPT_VERSION}:${hash}`;
  const configured = settings.aiModels[provider.id] ?? null;
  const cached = findWeaknessNote(db, { promptVersion, provider: provider.id, model: configured });
  if (cached) return cached;

  const hasTags = Object.values(facts.tagCounts).some((n) => n > 0);
  const { value, model } = await runStructured(
    provider,
    { system: SYSTEM, user: buildUserPrompt(facts), schemaName: 'weakness_report', jsonSchema: WEAKNESS_JSON_SCHEMA },
    schemaFor(hasTags ? 1 : 0),
    {
      model: configured,
      allowedSan: weaknessAllowedSan(facts),
      textOf: (r) => [r.headline, r.encouragement, ...r.weaknesses.flatMap((w) => [w.title, w.rule, w.focus])],
      signal: opts.signal,
    },
  );
  const report: WeaknessReport = value;
  saveNote(db, weaknessKey(promptVersion, provider.id, model), report);
  return { provider: provider.id, model, createdAt: Date.now(), report };
}
