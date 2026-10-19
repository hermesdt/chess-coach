import type { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import type { InsightsWindow } from '../../shared/types.js';
import { getInsights } from '../insights/insights.js';

const WINDOWS: readonly string[] = ['30d', '90d', '365d', 'all'];

export function insightsRoutes(db: DatabaseSync, now: () => number): Hono {
  return new Hono().get('/insights', (c) => {
    const window = c.req.query('window') ?? '90d';
    if (!WINDOWS.includes(window)) return c.json({ error: 'window must be 30d, 90d, 365d or all' }, 400);
    return c.json(getInsights(db, window as InsightsWindow, now()));
  });
}
