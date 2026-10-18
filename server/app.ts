import type { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { healthRoutes } from './routes/health.js';
import { settingsRoutes } from './routes/settings.js';

export interface AppDeps {
  db: DatabaseSync;
  fetchFn?: typeof fetch;
  now?: () => number;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.route('/api', healthRoutes);
  app.route('/api', settingsRoutes(deps.db));
  return app;
}
