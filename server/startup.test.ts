import { expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { startBackgroundJobs } from './startup.js';
import { requeuePending } from './analysis/queue.js';
import { lazyEnginePool } from './engine/pool.js';
import { backfillRepertoirePlayoutCards } from './repertoire/playout-ends.js';
import type { Repertoire } from './repertoire/types.js';
import { backfillLongMateCards, backfillMistakeCards, backfillPlayoutCards, backfillThreatCards } from './srs/backfill.js';

vi.mock('./analysis/queue.js', () => ({ requeuePending: vi.fn() }));
vi.mock('./repertoire/playout-ends.js', () => ({ backfillRepertoirePlayoutCards: vi.fn() }));
vi.mock('./srs/backfill.js', () => ({ backfillMistakeCards: vi.fn(), backfillThreatCards: vi.fn(), backfillLongMateCards: vi.fn(), backfillPlayoutCards: vi.fn() }));

it('starts engine-backed jobs only after synchronous startup yields', async () => {
  const db = {} as DatabaseSync;
  const reps = [{ id: 'r' }] as Repertoire[];
  startBackgroundJobs(db, reps);

  expect(requeuePending).not.toHaveBeenCalled();
  expect(backfillMistakeCards).not.toHaveBeenCalled();
  expect(backfillThreatCards).not.toHaveBeenCalled();
  expect(backfillLongMateCards).not.toHaveBeenCalled();
  expect(backfillPlayoutCards).not.toHaveBeenCalled();
  expect(backfillRepertoirePlayoutCards).not.toHaveBeenCalled();

  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(requeuePending).toHaveBeenCalledOnce();
  expect(backfillMistakeCards).toHaveBeenCalledOnce();
  expect(backfillThreatCards).toHaveBeenCalledOnce();
  expect(backfillLongMateCards).toHaveBeenCalledOnce();
  expect(backfillPlayoutCards).toHaveBeenCalledOnce();
  expect(backfillRepertoirePlayoutCards).toHaveBeenCalledExactlyOnceWith(db, reps, lazyEnginePool);
});
