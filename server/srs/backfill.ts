import type { DatabaseSync } from 'node:sqlite';
import type { GameAnalysis } from '../../shared/types.js';
import { ANALYSIS_VERSION, getAnalysis, markCardsBuilt, markLongMateCardsBuilt, markThreatCardsBuilt } from '../analysis/analysis-repo.js';
import { getSettings } from '../config.js';
import type { EnginePool } from '../engine/pool.js';
import { findActiveJob, runJob } from '../jobs.js';
import { buildLongMateCards } from './long-mate-cards.js';
import { buildMistakeCards } from './mistake-cards.js';
import { buildThreatCards } from './threat-cards.js';

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

type Marker = 'threat_cards_built_at' | 'long_mate_cards_built_at';

/** Games with a finished analysis at the current version whose `marker` is not set. Newest first. */
function unbuiltBy(db: DatabaseSync, marker: Marker): number[] {
  return db.prepare(
    `SELECT a.game_id FROM game_analysis a JOIN games g ON g.id = a.game_id
     WHERE a.status = 'done' AND a.version = ? AND a.${marker} IS NULL
     ORDER BY g.played_at DESC, a.game_id DESC`,
  ).all(ANALYSIS_VERSION).map((r) => r.game_id as number);
}

/**
 * Runs one card builder once per analysis as a background job of its own kind, so several kinds can run at
 * the same time. A game is marked only after a successful build; a failed game is retried at the next start.
 */
function backfillOnce(
  db: DatabaseSync,
  spec: {
    kind: string; marker: Marker; label: string;
    build: (analysis: GameAnalysis, nodes: number) => Promise<unknown>;
    mark: (gameId: number, at: number) => void;
  },
  nodesOpt: number | undefined,
): { jobId: number | null } {
  if (findActiveJob(db, spec.kind)) return { jobId: null };
  const ids = unbuiltBy(db, spec.marker);
  if (ids.length === 0) return { jobId: null };
  const job = runJob(db, spec.kind, async (report) => {
    const nodes = nodesOpt ?? getSettings(db).engineNodes;
    let built = 0;
    let failed = 0;
    report(0, ids.length, `${spec.label} built for 0 of ${ids.length}`);
    for (const [i, id] of ids.entries()) {
      const analysis = getAnalysis(db, id);
      try {
        if (analysis?.status === 'done') {
          await spec.build(analysis, nodes);
          spec.mark(id, Date.now());
          built += 1;
        }
      } catch (e) {
        console.error(`${spec.label} backfill failed for game ${id}:`, e);
        failed += 1;
      }
      report(i + 1, ids.length, `${spec.label} built for ${i + 1} of ${ids.length}`);
    }
    return `${spec.label} built for ${built} of ${ids.length}${failed > 0 ? ` (${failed} failed)` : ''}`;
  });
  return { jobId: job.id };
}

/** Builds threat cards for analyses that have none yet. Returns the job id, or null when there is nothing to do. */
export function backfillThreatCards(
  db: DatabaseSync,
  pool: Pick<EnginePool, 'analyse'>,
  opts: { nodes?: number } = {},
): { jobId: number | null } {
  return backfillOnce(db, {
    kind: 'threat-backfill', marker: 'threat_cards_built_at', label: 'Threat cards',
    build: (analysis, nodes) => buildThreatCards(db, analysis, pool, { nodes }),
    mark: (id, at) => markThreatCardsBuilt(db, id, at),
  }, opts.nodes);
}

/** Builds mate-in-3 and mate-in-4 cards for analyses that have none yet. Returns the job id, or null. */
export function backfillLongMateCards(
  db: DatabaseSync,
  pool: Pick<EnginePool, 'analyse'>,
  opts: { nodes?: number } = {},
): { jobId: number | null } {
  return backfillOnce(db, {
    kind: 'long-mate-backfill', marker: 'long_mate_cards_built_at', label: 'Long mate cards',
    build: (analysis, nodes) => buildLongMateCards(db, analysis, pool, { nodes }),
    mark: (id, at) => markLongMateCardsBuilt(db, id, at),
  }, opts.nodes);
}
