import type { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { enqueueAnalysis, eligibleUnanalysed, type QueueDeps } from '../analysis/queue.js';
import { refreshOpenings } from '../repertoire/refresh.js';
import type { Repertoire } from '../repertoire/types.js';
import { findActiveJob, runJob } from '../jobs.js';
import { getLastSyncedAt, type SyncDeps, summaryMessage, syncAll } from '../sync/sync-service.js';

export function syncRoutes(db: DatabaseSync, deps: SyncDeps & { pool: QueueDeps['pool'] }, getReps: () => Repertoire[]): Hono {
  return new Hono()
    .post('/sync', (c) => {
      const active = findActiveJob(db, 'sync');
      if (active) return c.json({ jobId: active.id, alreadyRunning: true });
      const job = runJob(db, 'sync', async (report) => {
        const summary = await syncAll(db, deps, report);
        try {
          // Games may change the level, which changes which opening cards exist.
          refreshOpenings(db, getReps());
        } catch (e) {
          console.error('could not refresh openings after sync', e);
        }
        if ((summary.chesscom ?? 0) + (summary.lichess ?? 0) > 0) {
          try {
            enqueueAnalysis(db, eligibleUnanalysed(db, 50), { pool: deps.pool });
          } catch (e) {
            console.error('could not queue analysis after sync', e);
          }
        }
        return summaryMessage(summary);
      });
      return c.json({ jobId: job.id });
    })
    .get('/sync/status', (c) =>
      c.json({
        chesscom: getLastSyncedAt(db, 'chesscom'),
        lichess: getLastSyncedAt(db, 'lichess'),
        runningJobId: findActiveJob(db, 'sync')?.id ?? null,
      }),
    );
}
