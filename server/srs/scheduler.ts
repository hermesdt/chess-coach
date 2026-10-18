import { type Card as FsrsCard, createEmptyCard, fsrs, Rating as FsrsRating } from 'ts-fsrs';
import type { Rating } from '../../shared/types.js';

const scheduler = fsrs();

const RATINGS = {
  again: FsrsRating.Again,
  hard: FsrsRating.Hard,
  good: FsrsRating.Good,
  easy: FsrsRating.Easy,
} as const;

function parseCard(json: string): FsrsCard {
  const raw = JSON.parse(json) as FsrsCard & { due: string; last_review?: string | null };
  return { ...raw, due: new Date(raw.due), last_review: raw.last_review ? new Date(raw.last_review) : undefined };
}

/** Next FSRS state for a card. `prev` is the stored JSON, or null for a new card. */
export function schedule(prev: string | null, rating: Rating, now: number): { fsrsJson: string; due: number } {
  const nowDate = new Date(now);
  const card = prev === null ? createEmptyCard(nowDate) : parseCard(prev);
  const next = scheduler.next(card, nowDate, RATINGS[rating]).card;
  return { fsrsJson: JSON.stringify(next), due: next.due.getTime() };
}
