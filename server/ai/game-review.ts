import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { LESSON_IDS } from '../../shared/lessons.js';
import type { GameDetail, GameReview, GameReviewNote, ProviderId } from '../../shared/types.js';
import { getAnalysis } from '../analysis/analysis-repo.js';
import { parsePgn } from '../chess/pgn.js';
import { getSettings } from '../config.js';
import { getGameRow } from '../db/games-repo.js';
import { currentLevel, type Level } from '../level.js';
import { applyCoachExplanations } from '../srs/mistake-cards.js';
import { allowedSan, gameFacts } from './facts.js';
import { toStrictJsonSchema } from './json-schema.js';
import { findNote, listNotes, saveNote } from './notes-repo.js';
import { buildUserPrompt, PROMPT_VERSION, SYSTEM } from './prompts/game-review.js';
import { redact } from './redact.js';
import type { Registry } from './registry.js';
import { runStructured } from './runner.js';
import { AiCancelledError, AiGroundingError, AiRefusalError, AiTimeoutError } from './types.js';

const reviewSchema = z.object({
  summary: z.string(),
  openingNote: z.string(),
  moments: z.array(z.object({
    ply: z.number().int(),
    whatHappened: z.string(),
    whyItMatters: z.string(),
    principle: z.string(),
    lessonId: z.enum(LESSON_IDS).nullable(),
  })),
  oneThingToPractice: z.string(),
});

/** Strict: additionalProperties false, every key required, lessonId nullable. */
export const GAME_REVIEW_JSON_SCHEMA: object = toStrictJsonSchema(reviewSchema);

export const NOT_CONFIGURED = 'AI not configured. Choose a provider in Settings.';

/** Notes depend on the level (the facts and the tone change), so the level is part of the cache key. */
export const promptVersionFor = (level: Level): string => `${PROMPT_VERSION}:l${level}`;

const subjectOf = (gameId: number): string => `game:${gameId}`;

export function loadGame(db: DatabaseSync, gameId: number): GameDetail | null {
  const row = getGameRow(db, gameId);
  if (!row) return null;
  const { startFen, moves } = parsePgn(row.pgn);
  return { ...row, startFen, moves };
}

/** Cached notes of the game at the current level, newest first. */
export function gameNotes(db: DatabaseSync, gameId: number): GameReviewNote[] {
  const analysis = getAnalysis(db, gameId);
  if (!analysis) return [];
  return listNotes(db, subjectOf(gameId), promptVersionFor(currentLevel(db).level), analysis.version);
}

export async function reviewGame(
  db: DatabaseSync,
  registry: Registry,
  gameId: number,
  opts: { provider?: ProviderId; signal?: AbortSignal },
): Promise<GameReviewNote> {
  const game = loadGame(db, gameId);
  if (!game) throw new Error('Game not found.');
  const analysis = getAnalysis(db, gameId);
  if (analysis?.status !== 'done') throw new Error('Analyse this game first.');
  const settings = getSettings(db);
  const provider = await registry.pick(opts.provider ?? settings.aiProvider);
  if (!provider) throw new Error(NOT_CONFIGURED);

  const { level, rating } = currentLevel(db);
  const subject = subjectOf(gameId);
  const promptVersion = promptVersionFor(level);
  const configured = settings.aiModels[provider.id] ?? null;
  const cached = findNote(db, { subject, promptVersion, analysisVersion: analysis.version, provider: provider.id, model: configured });
  if (cached) {
    applyCoachExplanations(db, analysis, cached.review);
    return cached;
  }

  const facts = gameFacts(game, analysis, { level, rating });
  const plies = new Set(facts.keyMoments.map((k) => k.ply));
  const { value, model } = await runStructured(
    provider,
    { system: SYSTEM, user: buildUserPrompt(facts), schemaName: 'game_review', jsonSchema: GAME_REVIEW_JSON_SCHEMA },
    reviewSchema,
    {
      model: configured,
      allowedSan: allowedSan(facts),
      textOf: (r) => [r.summary, r.openingNote, r.oneThingToPractice, ...r.moments.flatMap((m) => [m.whatHappened, m.whyItMatters, m.principle])],
      signal: opts.signal,
    },
  );
  const seen = new Set<number>();
  const moments = value.moments.filter((m) => plies.has(m.ply) && !seen.has(m.ply) && seen.add(m.ply));
  const review: GameReview = { ...value, moments };
  saveNote(db, { subject, promptVersion, analysisVersion: analysis.version, provider: provider.id, model }, review);
  applyCoachExplanations(db, analysis, review);
  return { provider: provider.id, model, createdAt: Date.now(), review };
}

/** Plain-words job error for the coach. */
export function coachErrorMessage(err: unknown, secrets: (string | null)[] = []): string {
  if (err instanceof AiGroundingError) return 'The coach answer mentioned moves I could not verify. Try again or use another provider.';
  if (err instanceof AiTimeoutError) return 'The coach took too long. Try again or use another provider.';
  if (err instanceof AiCancelledError) return 'Cancelled.';
  if (err instanceof AiRefusalError) return 'The provider declined this request. Try another provider.';
  const text = err instanceof Error ? err.message : String(err);
  return secrets.reduce<string>((out, s) => (s && s.length >= 4 ? redact(out, s) : out), text);
}
