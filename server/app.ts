import type { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { healthRoutes } from './routes/health.js';

export interface AppDeps {
  db: DatabaseSync;
  fetchFn?: typeof fetch;
  now?: () => number;
}

export function createApp(deps: AppDeps): Hono {
  void deps; // db is used from Task 2 on
  const app = new Hono();
  app.route('/api', healthRoutes);
  return app;
}
