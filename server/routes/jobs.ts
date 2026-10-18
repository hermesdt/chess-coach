import type { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { getJob } from '../jobs.js';

export function jobsRoutes(db: DatabaseSync): Hono {
  return new Hono().get('/jobs/:id', (c) => {
    const job = /^\d+$/.test(c.req.param('id')) ? getJob(db, Number(c.req.param('id'))) : null;
    return job ? c.json(job) : c.json({ error: 'not found' }, 404);
  });
}
