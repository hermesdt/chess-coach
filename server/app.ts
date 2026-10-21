import type { DatabaseSync } from 'node:sqlite';
import { Hono, type MiddlewareHandler } from 'hono';
import { createRegistry, type Registry } from './ai/registry.js';
import { aiRoutes } from './routes/ai.js';
import { chatRoutes } from './routes/chat.js';
import { analysisRoutes } from './routes/analysis.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { loadLessons } from './course/load.js';
import { courseRoutes } from './routes/course.js';
import { gamesRoutes } from './routes/games.js';
import { StreamHub } from './chat/stream-hub.js';
import type { EnginePool } from './engine/pool.js';
import { lazyEnginePool } from './engine/pool.js';
import { EngineCache } from './engine/cache.js';
import { lazyLiveEngine, type LiveEngine } from './engine/live.js';
import { liveRoutes } from './routes/live.js';
import { healthRoutes } from './routes/health.js';
import { importRoutes } from './routes/import.js';
import { insightsRoutes } from './routes/insights.js';
import { jobsRoutes } from './routes/jobs.js';
import { openingsRoutes } from './routes/openings.js';
import { loadAllRepertoires } from './repertoire/load.js';
import type { Repertoire } from './repertoire/types.js';
import type { Lesson } from '../shared/types.js';
import { reviewRoutes } from './routes/review.js';
import { settingsRoutes } from './routes/settings.js';
import { syncRoutes } from './routes/sync.js';

export interface AppDeps {
  db: DatabaseSync;
  fetchFn?: typeof fetch;
  now?: () => number;
  /** Engine pool for analysis. Defaults to the shared Stockfish pool, created on first use. */
  pool?: Pick<EnginePool, 'analyse'>;
  /** Live engine for GET /api/live. Defaults to the dedicated Stockfish process, started on first use. */
  live?: Pick<LiveEngine, 'analyse'>;
  /** Engine results shared by the live eval and the chat fact pack. Defaults to one cache per app. */
  cache?: EngineCache;
  /** Repertoires for the openings API. Defaults to `content/repertoires`, loaded on first use. */
  repertoires?: Repertoire[];
  /** Lessons for the course API. Defaults to `content/lessons`, loaded on first use. */
  lessons?: Lesson[];
  /** AI provider registry. Defaults to the built-in adapters. */
  ai?: Registry;
  /** Timeout of POST /api/ai/providers/:id/test in ms (default 60000). */
  aiTestTimeoutMs?: number;
  /** Fan-out of streamed chat answers. Defaults to one hub per app. Tests pass a fresh one. */
  hub?: StreamHub;
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
  const cache = deps.cache ?? new EngineCache();
  let reps = deps.repertoires;
  const getReps = () => (reps ??= loadAllRepertoires());
  let lessons = deps.lessons;
  const getLessons = () => (lessons ??= loadLessons());
  const ai = deps.ai ?? createRegistry({ db: deps.db, fetchFn: deps.fetchFn });
  app.use('/api/*', localOnly);
  app.route('/api', healthRoutes);
  app.route('/api', settingsRoutes(deps.db, getReps));
  app.route('/api', aiRoutes(deps.db, ai, deps.aiTestTimeoutMs, getReps));
  app.route('/api', chatRoutes(deps.db, ai, pool, getReps, deps.hub ?? new StreamHub(), cache));
  app.route('/api', liveRoutes(deps.live ?? lazyLiveEngine, cache));
  app.route('/api', syncRoutes(deps.db, { fetchFn: deps.fetchFn, now: deps.now, pool }, getReps));
  app.route('/api', jobsRoutes(deps.db));
  app.route('/api', gamesRoutes(deps.db));
  app.route('/api', importRoutes(deps.db, getReps));
  app.route('/api', analysisRoutes(deps.db, pool));
  app.route('/api', reviewRoutes(deps.db, deps.now ?? Date.now, pool, getReps, getLessons, cache));
  app.route('/api', openingsRoutes(deps.db, getReps));
  app.route('/api', courseRoutes(deps.db, getLessons, deps.now ?? Date.now));
  app.route('/api', dashboardRoutes(deps.db, deps.now ?? Date.now, getLessons, getReps));
  app.route('/api', insightsRoutes(deps.db, deps.now ?? Date.now));
  app.all('/api/*', (c) => c.json({ error: 'not found' }, 404));
  return app;
}
