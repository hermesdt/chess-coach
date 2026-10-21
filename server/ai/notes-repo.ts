import type { DatabaseSync } from 'node:sqlite';
import type { GameReview, GameReviewNote, ProviderId, WeaknessReport, WeaknessReportNote } from '../../shared/types.js';

/** `model` is the REQUESTED model ('default' when none is configured); it is part of the cache key. */
export interface NoteKey { subject: string; promptVersion: string; analysisVersion: number; provider: ProviderId; model: string }

/** `modelUsed` is the model the provider reported; it is only shown to the user. */
export function saveNote(db: DatabaseSync, key: NoteKey, modelUsed: string, review: GameReview | WeaknessReport, now = Date.now()): void {
  db.prepare(
    `INSERT INTO ai_notes (subject, prompt_version, analysis_version, provider, model, model_used, json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(subject, prompt_version, analysis_version, provider, model)
     DO UPDATE SET json = excluded.json, model_used = excluded.model_used, created_at = excluded.created_at`,
  ).run(key.subject, key.promptVersion, key.analysisVersion, key.provider, key.model, modelUsed, JSON.stringify(review), now);
}

function toNote(r: Record<string, unknown>): GameReviewNote {
  return {
    provider: r.provider as ProviderId, model: (r.model_used ?? r.model) as string, createdAt: r.created_at as number,
    review: JSON.parse(String(r.json)) as GameReview,
  };
}

/** Newest note of a provider for the requested model (the cache key). */
export function findNote(
  db: DatabaseSync,
  q: { subject: string; promptVersion: string; analysisVersion: number; provider: ProviderId; model: string },
): GameReviewNote | null {
  const row = db.prepare(
    `SELECT * FROM ai_notes WHERE subject = ? AND prompt_version = ? AND analysis_version = ? AND provider = ? AND model = ?
       ORDER BY created_at DESC, id DESC LIMIT 1`,
  ).get(q.subject, q.promptVersion, q.analysisVersion, q.provider, q.model);
  return row ? toNote(row) : null;
}

/** All notes for a subject, newest first. */
export function listNotes(db: DatabaseSync, subject: string, promptVersion: string, analysisVersion: number): GameReviewNote[] {
  return db.prepare(
    'SELECT * FROM ai_notes WHERE subject = ? AND prompt_version = ? AND analysis_version = ? ORDER BY created_at DESC, id DESC',
  ).all(subject, promptVersion, analysisVersion).map(toNote);
}

/** The newest review of a subject for an analysis version, from any provider. */
export function latestReview(db: DatabaseSync, subject: string, analysisVersion: number): GameReview | null {
  const row = db.prepare(
    'SELECT * FROM ai_notes WHERE subject = ? AND analysis_version = ? ORDER BY created_at DESC, id DESC LIMIT 1',
  ).get(subject, analysisVersion);
  return row ? toNote(row).review : null;
}

/** The newest review of a subject for an analysis version or an older one. A re-analysis keeps the coach's earlier notes usable. */
export function latestReviewUpTo(db: DatabaseSync, subject: string, maxAnalysisVersion: number): GameReview | null {
  const row = db.prepare(
    'SELECT * FROM ai_notes WHERE subject = ? AND analysis_version <= ? ORDER BY analysis_version DESC, created_at DESC, id DESC LIMIT 1',
  ).get(subject, maxAnalysisVersion);
  return row ? toNote(row).review : null;
}

const WEAKNESS_SUBJECT = 'weakness';

/** Weakness reports are keyed by the facts hash, which goes into the prompt version (analysis version is 0). */
export const weaknessKey = (promptVersion: string, provider: ProviderId, model: string): NoteKey =>
  ({ subject: WEAKNESS_SUBJECT, promptVersion, analysisVersion: 0, provider, model });

function toWeaknessNote(r: Record<string, unknown>): WeaknessReportNote {
  return { provider: r.provider as ProviderId, model: (r.model_used ?? r.model) as string, createdAt: r.created_at as number, report: JSON.parse(String(r.json)) as WeaknessReport };
}

export function findWeaknessNote(db: DatabaseSync, q: { promptVersion: string; provider: ProviderId; model: string }): WeaknessReportNote | null {
  const row = db.prepare(
    `SELECT * FROM ai_notes WHERE subject = ? AND prompt_version = ? AND provider = ? AND model = ?
       ORDER BY created_at DESC, id DESC LIMIT 1`,
  ).get(WEAKNESS_SUBJECT, q.promptVersion, q.provider, q.model);
  return row ? toWeaknessNote(row) : null;
}

/** The newest weakness report from any provider. */
export function latestWeaknessNote(db: DatabaseSync): WeaknessReportNote | null {
  const row = db.prepare('SELECT * FROM ai_notes WHERE subject = ? ORDER BY created_at DESC, id DESC LIMIT 1').get(WEAKNESS_SUBJECT);
  return row ? toWeaknessNote(row) : null;
}
