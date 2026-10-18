import type { DatabaseSync } from 'node:sqlite';
import { Hono, type MiddlewareHandler } from 'hono';
import { createRegistry, type Registry } from './ai/registry.js';
import { aiRoutes } from './routes/ai.js';
import { analysisRoutes } from './routes/analysis.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { gamesRoutes } from './routes/games.js';
import type { EnginePool } from './engine/pool.js';
import { lazyEnginePool } from './engine/pool.js';
import { healthRoutes } from './routes/health.js';
import { importRoutes } from './routes/import.js';
import { jobsRoutes } from './routes/jobs.js';
import { openingsRoutes } from './routes/openings.js';
import { loadAllRepertoires } from './repertoire/load.js';
import type { Repertoire } from './repertoire/types.js';
import { reviewRoutes } from './routes/review.js';
import { settingsRoutes } from './routes/settings.js';
import { syncRoutes } from './routes/sync.js';

export interface AppDeps {
  db: DatabaseSync;
  fetchFn?: typeof fetch;
  now?: () => number;
  /** Engine pool for analysis. Defaults to the shared Stockfish pool, created on first use. */
  pool?: Pick<EnginePool, 'analyse'>;
  /** Repertoires for the openings API. Defaults to `content/repertoires`, loaded on first use. */
  repertoires?: Repertoire[];
  /** AI provider registry. Defaults to the built-in adapters. */
  ai?: Registry;
  /** Timeout of POST /api/ai/providers/:id/test in ms (default 60000). */
  aiTestTimeoutMs?: number;
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
  let reps = deps.repertoires;
  const getReps = () => (reps ??= loadAllRepertoires());
  const ai = deps.ai ?? createRegistry({ db: deps.db, fetchFn: deps.fetchFn });
  app.use('/api/*', localOnly);
  app.route('/api', healthRoutes);
  app.route('/api', settingsRoutes(deps.db));
  app.route('/api', aiRoutes(deps.db, ai, deps.aiTestTimeoutMs));
  app.route('/api', syncRoutes(deps.db, { fetchFn: deps.fetchFn, now: deps.now, pool }, getReps));
  app.route('/api', jobsRoutes(deps.db));
  app.route('/api', gamesRoutes(deps.db));
  app.route('/api', importRoutes(deps.db, getReps));
  app.route('/api', analysisRoutes(deps.db, pool));
  app.route('/api', reviewRoutes(deps.db, deps.now ?? Date.now, pool));
  app.route('/api', openingsRoutes(deps.db, getReps));
  app.route('/api', dashboardRoutes(deps.db, deps.now ?? Date.now));
  app.all('/api/*', (c) => c.json({ error: 'not found' }, 404));
  return app;
}
