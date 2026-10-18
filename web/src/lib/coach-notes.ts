import type { GameReviewNote, ProviderId } from '../../../shared/types';

/** Stable key for a coach tab. */
export const noteKey = (n: Pick<GameReviewNote, 'provider' | 'model'>): string => `${n.provider}:${n.model}`;

/**
 * Index of the note to show after a coach job for `provider` ends. Notes are newest first.
 * An exact model match wins, then the newest note of the provider, then the first note.
 */
export function noteIndexFor(notes: GameReviewNote[], provider: ProviderId | null, model: string | null = null): number {
  if (provider === null) return 0;
  const exact = model === null ? -1 : notes.findIndex((n) => n.provider === provider && n.model === model);
  if (exact >= 0) return exact;
  const byProvider = notes.findIndex((n) => n.provider === provider);
  return byProvider >= 0 ? byProvider : 0;
}
