import type { DatabaseSync } from 'node:sqlite';
import { requeuePending } from './analysis/queue.js';
import { lazyEnginePool } from './engine/pool.js';
import { backfillMistakeCards, backfillThreatCards } from './srs/backfill.js';

export function startBackgroundJobs(db: DatabaseSync): void {
  setImmediate(() => {
    requeuePending(db, { pool: lazyEnginePool });
    backfillMistakeCards(db, lazyEnginePool);
    backfillThreatCards(db, lazyEnginePool);
  });
}
