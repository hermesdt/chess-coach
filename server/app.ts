import type { DatabaseSync } from 'node:sqlite';
import { Hono, type MiddlewareHandler } from 'hono';
import { analysisRoutes } from './routes/analysis.js';
import { gamesRoutes } from './routes/games.js';
import type { EnginePool } from './engine/pool.js';
import { lazyEnginePool } from './engine/pool.js';
import { healthRoutes } from './routes/health.js';
import { importRoutes } from './routes/import.js';
import { jobsRoutes } from './routes/jobs.js';
import { reviewRoutes } from './routes/review.js';
import { settingsRoutes } from './routes/settings.js';
import { syncRoutes } from './routes/sync.js';

export interface AppDeps {
  db: DatabaseSync;
  fetchFn?: typeof fetch;
  now?: () => number;
  /** Engine pool for analysis. Defaults to the shared Stockfish pool, created on first use. */
  pool?: Pick<EnginePool, 'analyse'>;
}

const LOCAL_HOST = /^(127\.0\.0\.1|localhost)(:\d+)?$/i;
const WRITE_METHODS = new Set(['POST', 'PUT', 'DELETE']);

/** Rejects DNS-rebinding (foreign Host) and cross-site form posts (non-JSON writes). */
const localOnly: MiddlewareHandler = async (c, next) => {
  const host = c.req.header('host');
  if (host !== undefined && !LOCAL_HOST.test(host)) return c.json({ error: 'forbidden host' }, 403);
  if (WRITE_METHODS.has(c.req.method)) {
    const type = c.req.header('content-type') ?? '';
    if (!/^application\/json\s*(;|$)/i.test(type)) return c.json({ error: 'content-type must be application/json' }, 415);
  }
  await next();
};

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  const pool = deps.pool ?? lazyEnginePool;
  app.use('/api/*', localOnly);
  app.route('/api', healthRoutes);
  app.route('/api', settingsRoutes(deps.db));
  app.route('/api', syncRoutes(deps.db, { fetchFn: deps.fetchFn, now: deps.now, pool }));
  app.route('/api', jobsRoutes(deps.db));
  app.route('/api', gamesRoutes(deps.db));
  app.route('/api', importRoutes(deps.db));
  app.route('/api', analysisRoutes(deps.db, pool));
  app.route('/api', reviewRoutes(deps.db, deps.now ?? Date.now));
  app.all('/api/*', (c) => c.json({ error: 'not found' }, 404));
  return app;
}
