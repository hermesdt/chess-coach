import type { DatabaseSync } from 'node:sqlite';
import { requeuePending } from './analysis/queue.js';
import { lazyEnginePool } from './engine/pool.js';
import { backfillRepertoirePlayoutCards } from './repertoire/playout-ends.js';
import type { Repertoire } from './repertoire/types.js';
import { backfillLongMateCards, backfillMistakeCards, backfillPlayoutCards, backfillThreatCards } from './srs/backfill.js';

/** Card backfills and the analysis queue. They start after the synchronous start-up, so the server answers first. */
export function startBackgroundJobs(db: DatabaseSync, reps: Repertoire[] = []): void {
  setImmediate(() => {
    requeuePending(db, { pool: lazyEnginePool });
    backfillMistakeCards(db, lazyEnginePool);
    backfillThreatCards(db, lazyEnginePool);
    backfillLongMateCards(db, lazyEnginePool);
    backfillPlayoutCards(db);
    backfillRepertoirePlayoutCards(db, reps, lazyEnginePool);
  });
}
