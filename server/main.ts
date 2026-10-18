import { existsSync, mkdirSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './app.js';
import { openDb } from './db/db.js';
import { backfillMistakeCards } from './srs/backfill.js';
import { requeuePending } from './analysis/queue.js';
import { closeEnginePool, lazyEnginePool } from './engine/pool.js';
import { recoverInterruptedJobs } from './jobs.js';

if (existsSync('.env')) process.loadEnvFile('.env');

mkdirSync('data', { recursive: true });
const db = openDb('data/chess.db');
recoverInterruptedJobs(db, Date.now());
requeuePending(db, { pool: lazyEnginePool });
backfillMistakeCards(db, lazyEnginePool);
const app = createApp({ db });

if (existsSync('dist')) {
  app.use('/*', serveStatic({ root: './dist' }));
  app.get('*', serveStatic({ path: './dist/index.html' }));
}

serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 8787 }, (info) => {
  console.log(`chess-coach listening on http://127.0.0.1:${info.port}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void closeEnginePool().finally(() => process.exit(0));
  });
}
