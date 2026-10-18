import type { DatabaseSync } from 'node:sqlite';
import type { GameReview, GameReviewNote, ProviderId } from '../../shared/types.js';

export interface NoteKey { subject: string; promptVersion: string; analysisVersion: number; provider: ProviderId; model: string }

export function saveNote(db: DatabaseSync, key: NoteKey, review: GameReview, now = Date.now()): void {
  db.prepare(
    `INSERT INTO ai_notes (subject, prompt_version, analysis_version, provider, model, json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(subject, prompt_version, analysis_version, provider, model)
     DO UPDATE SET json = excluded.json, created_at = excluded.created_at`,
  ).run(key.subject, key.promptVersion, key.analysisVersion, key.provider, key.model, JSON.stringify(review), now);
}

function toNote(r: Record<string, unknown>): GameReviewNote {
  return {
    provider: r.provider as ProviderId, model: r.model as string, createdAt: r.created_at as number,
    review: JSON.parse(String(r.json)) as GameReview,
  };
}

/** Newest note of a provider. When `model` is given, only notes of that model count. */
export function findNote(
  db: DatabaseSync,
  q: { subject: string; promptVersion: string; analysisVersion: number; provider: ProviderId; model: string | null },
): GameReviewNote | null {
  const row = db.prepare(
    `SELECT * FROM ai_notes WHERE subject = ? AND prompt_version = ? AND analysis_version = ? AND provider = ?
       AND (? IS NULL OR model = ?) ORDER BY created_at DESC, id DESC LIMIT 1`,
  ).get(q.subject, q.promptVersion, q.analysisVersion, q.provider, q.model, q.model);
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
