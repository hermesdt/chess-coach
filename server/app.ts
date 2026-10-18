import type { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { gamesRoutes } from './routes/games.js';
import { healthRoutes } from './routes/health.js';
import { importRoutes } from './routes/import.js';
import { jobsRoutes } from './routes/jobs.js';
import { settingsRoutes } from './routes/settings.js';
import { syncRoutes } from './routes/sync.js';

export interface AppDeps {
  db: DatabaseSync;
  fetchFn?: typeof fetch;
  now?: () => number;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.route('/api', healthRoutes);
  app.route('/api', settingsRoutes(deps.db));
  app.route('/api', syncRoutes(deps.db, { fetchFn: deps.fetchFn, now: deps.now }));
  app.route('/api', jobsRoutes(deps.db));
  app.route('/api', gamesRoutes(deps.db));
  app.route('/api', importRoutes(deps.db));
  app.all('/api/*', (c) => c.json({ error: 'not found' }, 404));
  return app;
}
