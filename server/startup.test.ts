import { expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { startBackgroundJobs } from './startup.js';
import { requeuePending } from './analysis/queue.js';
import { backfillLongMateCards, backfillMistakeCards, backfillThreatCards } from './srs/backfill.js';

vi.mock('./analysis/queue.js', () => ({ requeuePending: vi.fn() }));
vi.mock('./srs/backfill.js', () => ({ backfillMistakeCards: vi.fn(), backfillThreatCards: vi.fn(), backfillLongMateCards: vi.fn() }));

it('starts engine-backed jobs only after synchronous startup yields', async () => {
  const db = {} as DatabaseSync;
  startBackgroundJobs(db);

  expect(requeuePending).not.toHaveBeenCalled();
  expect(backfillMistakeCards).not.toHaveBeenCalled();
  expect(backfillThreatCards).not.toHaveBeenCalled();
  expect(backfillLongMateCards).not.toHaveBeenCalled();

  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(requeuePending).toHaveBeenCalledOnce();
  expect(backfillMistakeCards).toHaveBeenCalledOnce();
  expect(backfillThreatCards).toHaveBeenCalledOnce();
  expect(backfillLongMateCards).toHaveBeenCalledOnce();
});
