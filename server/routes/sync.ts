import type { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { runJob } from '../jobs.js';
import { getLastSyncedAt, type SyncDeps, summaryMessage, syncAll } from '../sync/sync-service.js';

export function syncRoutes(db: DatabaseSync, deps: SyncDeps): Hono {
  return new Hono()
    .post('/sync', (c) => {
      const job = runJob(db, 'sync', async (report) => {
        const summary = await syncAll(db, deps, report);
        return summaryMessage(summary);
      });
      return c.json({ jobId: job.id });
    })
    .get('/sync/status', (c) =>
      c.json({ chesscom: getLastSyncedAt(db, 'chesscom'), lichess: getLastSyncedAt(db, 'lichess') }),
    );
}
