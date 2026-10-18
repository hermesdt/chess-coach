import type { DatabaseSync } from 'node:sqlite';
import { ANALYSIS_VERSION, getAnalysis, markCardsBuilt } from '../analysis/analysis-repo.js';
import { getSettings } from '../config.js';
import type { EnginePool } from '../engine/pool.js';
import { findActiveJob, runJob } from '../jobs.js';
import { buildMistakeCards } from './mistake-cards.js';

/** Games with a finished analysis at the current version whose cards were never built. Newest first. */
function unbuilt(db: DatabaseSync): number[] {
  return db.prepare(
    `SELECT a.game_id FROM game_analysis a JOIN games g ON g.id = a.game_id
     WHERE a.status = 'done' AND a.version = ? AND a.cards_built_at IS NULL
     ORDER BY g.played_at DESC, a.game_id DESC`,
  ).all(ANALYSIS_VERSION).map((r) => r.game_id as number);
}

/**
 * Builds mistake cards for analyses that have none yet (games analysed before cards existed,
 * or whose card build failed). Runs as a background job. Returns the job id, or null when
 * there is nothing to do or a backfill is already running.
 */
export function backfillMistakeCards(
  db: DatabaseSync,
  pool: Pick<EnginePool, 'analyse'>,
  opts: { nodes?: number } = {},
): { jobId: number | null } {
  if (findActiveJob(db, 'cards-backfill')) return { jobId: null };
  const ids = unbuilt(db);
  if (ids.length === 0) return { jobId: null };
  const job = runJob(db, 'cards-backfill', async (report) => {
    const nodes = opts.nodes ?? getSettings(db).engineNodes;
    let built = 0;
    let failed = 0;
    report(0, ids.length, `Cards built for 0 of ${ids.length}`);
    for (const [i, id] of ids.entries()) {
      const analysis = getAnalysis(db, id);
      try {
        if (analysis?.status === 'done') {
          await buildMistakeCards(db, analysis, pool, { nodes });
          markCardsBuilt(db, id, Date.now());
          built += 1;
        }
      } catch (e) {
        console.error(`Card backfill failed for game ${id}:`, e);
        failed += 1;
      }
      report(i + 1, ids.length, `Cards built for ${i + 1} of ${ids.length}`);
    }
    return `Cards built for ${built} of ${ids.length}${failed > 0 ? ` (${failed} failed)` : ''}`;
  });
  return { jobId: job.id };
}
