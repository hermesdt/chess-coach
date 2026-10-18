import type { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { getAnalysis } from '../analysis/analysis-repo.js';
import { selectKeyMoments } from '../analysis/key-moments.js';
import { eligibleUnanalysed, enqueueAnalysis, minPlyCount, type QueueDeps } from '../analysis/queue.js';
import { getGameRow } from '../db/games-repo.js';
import { currentLevel } from '../level.js';

const DEFAULT_LIMIT = 20;

export function analysisRoutes(db: DatabaseSync, pool: QueueDeps['pool']): Hono {
  return new Hono()
    .get('/games/:id/analysis', (c) => {
      const id = c.req.param('id');
      const analysis = /^\d+$/.test(id) ? getAnalysis(db, Number(id)) : null;
      if (!analysis) return c.json({ status: 'none' });
      // Only expose analysis data when it is complete. Old rows can stay behind after an error.
      if (analysis.status !== 'done') return c.json({ status: analysis.status, error: analysis.error });
      // Key moments depend on the current level, so they are recomputed on read.
      return c.json({ ...analysis, keyMoments: selectKeyMoments(analysis.moves, currentLevel(db).level) });
    })
    .post('/games/:id/analyse', (c) => {
      const id = c.req.param('id');
      const game = /^\d+$/.test(id) ? getGameRow(db, Number(id)) : null;
      if (!game) return c.json({ error: 'not found' }, 404);
      if (game.userColor === null) return c.json({ error: 'You did not play in this game.' }, 400);
      if (game.plyCount < minPlyCount(game.userColor)) return c.json({ error: 'Game too short to analyse.' }, 400);
      return c.json({ jobId: enqueueAnalysis(db, [game.id], { pool }, { priority: true }).jobId });
    })
    .post('/analysis/queue', async (c) => {
      const body = (await c.req.json().catch(() => null)) as { limit?: unknown } | null;
      const raw = body?.limit;
      const limit = typeof raw === 'number' && Number.isFinite(raw) ? Math.min(200, Math.max(1, Math.floor(raw))) : DEFAULT_LIMIT;
      return c.json(enqueueAnalysis(db, eligibleUnanalysed(db, limit), { pool }));
    })
    .get('/level', (c) => c.json(currentLevel(db)));
}
