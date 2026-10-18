import type { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import type { EnginePool } from '../engine/pool.js';
import { backfillMistakeCards } from '../srs/backfill.js';
import type { Rating, ReviewSubmit } from '../../shared/types.js';
import { getSettings } from '../config.js';
import { addFlag, getCard, listFlags, recordReview } from '../srs/cards-repo.js';
import { buildSession } from '../srs/session.js';
import { reviewStats } from '../srs/stats.js';

const RATINGS: readonly string[] = ['again', 'hard', 'good', 'easy'];

function parseId(raw: string): number | null {
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

function parseSubmit(body: unknown): ReviewSubmit | null {
  if (body === null || typeof body !== 'object') return null;
  const { rating, answerUci, durationMs } = body as Record<string, unknown>;
  if (typeof rating !== 'string' || !RATINGS.includes(rating)) return null;
  if (answerUci !== null && typeof answerUci !== 'string') return null;
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) return null;
  return { rating: rating as Rating, answerUci, durationMs };
}

export function reviewRoutes(db: DatabaseSync, now: () => number, pool: Pick<EnginePool, 'analyse'>): Hono {
  return new Hono()
    .get('/review/session', (c) => {
      const { reviewDailyLimit, reviewNewPerDay } = getSettings(db);
      return c.json(buildSession(db, now(), { daily: reviewDailyLimit, newPerDay: reviewNewPerDay }));
    })
    .get('/review/stats', (c) => c.json(reviewStats(db, now())))
    .post('/review/:cardId', async (c) => {
      const id = parseId(c.req.param('cardId'));
      const submit = parseSubmit(await c.req.json().catch(() => null));
      if (id === null || submit === null) return c.json({ error: 'Invalid review' }, 400);
      const card = getCard(db, id);
      if (!card) return c.json({ error: 'card not found' }, 404);
      if (card.suspended) return c.json({ error: 'card is suspended' }, 409);
      return c.json(recordReview(db, id, submit, now()));
    })
    .post('/cards/backfill', (c) => c.json(backfillMistakeCards(db, pool)))
    .get('/cards/flags', (c) => c.json(listFlags(db)))
    .post('/cards/:id/flag', async (c) => {
      const id = parseId(c.req.param('id'));
      const body = (await c.req.json().catch(() => null)) as { note?: unknown } | null;
      if (id === null || body === null || typeof body !== 'object' || typeof body.note !== 'string') {
        return c.json({ error: 'note must be a string' }, 400);
      }
      if (!getCard(db, id)) return c.json({ error: 'card not found' }, 404);
      return c.json(addFlag(db, id, body.note, now()));
    });
}
