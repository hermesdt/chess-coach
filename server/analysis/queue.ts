import type { DatabaseSync } from 'node:sqlite';
import type { GameDetail } from '../../shared/types.js';
import { parsePgn } from '../chess/pgn.js';
import { getSettings } from '../config.js';
import { getGameRow } from '../db/games-repo.js';
import type { EnginePool } from '../engine/pool.js';
import { runJob } from '../jobs.js';
import { currentLevel } from '../level.js';
import { buildMistakeCards } from '../srs/mistake-cards.js';
import { analyseGame } from './analyse-game.js';
import { ANALYSIS_VERSION, markAnalysis, markCardsBuilt, saveAnalysis } from './analysis-repo.js';

export interface QueueDeps { pool: Pick<EnginePool, 'analyse'>; nodes?: number }

interface ActiveRun {
  jobId: number;
  /** Explicitly requested games. They run before `pending`. */
  priority: number[];
  /** Newest first. */
  pending: number[];
  seen: Set<number>;
  current: number | null;
  total: number;
}

export interface EnqueueResult { jobId: number | null; queued: number }

// One analysis job per database at a time. The queue lives in this process only.
const active = new WeakMap<DatabaseSync, ActiveRun>();

/** White needs ply_count >= 11 and Black >= 12 for at least 6 user moves. */
const MIN_USER_MOVES = 6;
export const minPlyCount = (color: 'white' | 'black'): number => MIN_USER_MOVES * 2 - (color === 'white' ? 1 : 0);

export function eligibleUnanalysed(db: DatabaseSync, limit: number): number[] {
  const rows = db.prepare(
    `SELECT g.id FROM games g
     LEFT JOIN game_analysis a ON a.game_id = g.id
     WHERE g.user_color IS NOT NULL AND g.duplicate_of IS NULL
       AND g.ply_count >= CASE g.user_color WHEN 'white' THEN ? ELSE ? END
       AND NOT (COALESCE(a.status, '') IN ('done', 'error') AND COALESCE(a.version, -1) = ?)
     ORDER BY g.played_at DESC, g.id DESC LIMIT ?`,
  ).all(minPlyCount('white'), minPlyCount('black'), ANALYSIS_VERSION, limit);
  return rows.map((r) => r.id as number);
}

function isCurrent(db: DatabaseSync, id: number): boolean {
  const row = db.prepare('SELECT status, version FROM game_analysis WHERE game_id = ?').get(id);
  return row !== undefined && row.status === 'done' && row.version === ANALYSIS_VERSION;
}

function loadGame(db: DatabaseSync, id: number): GameDetail {
  const row = getGameRow(db, id);
  if (!row) throw new Error(`Game ${id} not found`);
  const { startFen, moves } = parsePgn(row.pgn);
  return { ...row, startFen, moves };
}

/** Returns a note to append to the job message when card building failed. */
async function analyseOne(db: DatabaseSync, id: number, deps: QueueDeps): Promise<string> {
  let nodes: number;
  let result: Awaited<ReturnType<typeof analyseGame>>;
  try {
    markAnalysis(db, id, 'running');
    const game = loadGame(db, id);
    nodes = deps.nodes ?? getSettings(db).engineNodes;
    result = await analyseGame(game, deps.pool, { nodes, level: currentLevel(db).level });
    saveAnalysis(db, { ...result, status: 'done', error: null });
  } catch (e) {
    markAnalysis(db, id, 'error', e instanceof Error ? e.message : String(e));
    return '';
  }
  // Cards never change the analysis status. A failure only shows on the job message.
  try {
    await buildMistakeCards(db, { ...result, status: 'done', error: null }, deps.pool, { nodes });
    markCardsBuilt(db, id, Date.now());
    return '';
  } catch (e) {
    console.error(`Card building failed for game ${id}:`, e);
    return ' (cards: failed)';
  }
}

/** Sort key that puts newer games first. */
function playedKey(db: DatabaseSync, id: number): [number, number] {
  const row = db.prepare('SELECT played_at FROM games WHERE id = ?').get(id);
  return [(row?.played_at as number | undefined) ?? 0, id];
}

function insertNewestFirst(db: DatabaseSync, list: number[], id: number): void {
  const [at, gid] = playedKey(db, id);
  const index = list.findIndex((other) => {
    const [oat, oid] = playedKey(db, other);
    return oat < at || (oat === at && oid < gid);
  });
  if (index === -1) list.push(id);
  else list.splice(index, 0, id);
}

/**
 * Adds games to the analysis queue. With `priority`, the games run next, in the given order,
 * and games that failed earlier in the running job can be queued again.
 */
export function enqueueAnalysis(
  db: DatabaseSync,
  gameIds: number[],
  deps: QueueDeps,
  opts: { priority?: boolean } = {},
): EnqueueResult {
  const priority = opts.priority === true;
  const run = active.get(db);
  const fresh: number[] = [];
  for (const id of gameIds) {
    if (fresh.includes(id) || isCurrent(db, id)) continue;
    if (run && priority) {
      if (run.current === id) continue;
      const waiting = run.pending.indexOf(id);
      if (waiting !== -1) {
        run.pending.splice(waiting, 1);
        run.priority.push(id);
        continue;
      }
      if (run.priority.includes(id)) continue;
    } else if (run?.seen.has(id)) continue;
    fresh.push(id);
  }
  for (const id of fresh) markAnalysis(db, id, 'pending');

  if (run) {
    for (const id of fresh) {
      run.seen.add(id);
      if (priority) run.priority.push(id);
      else insertNewestFirst(db, run.pending, id);
    }
    run.total += fresh.length;
    return { jobId: run.jobId, queued: fresh.length };
  }
  if (fresh.length === 0) return { jobId: null, queued: 0 };

  const state: ActiveRun = {
    jobId: 0, priority: priority ? [...fresh] : [], pending: priority ? [] : [...fresh],
    seen: new Set(fresh), current: null, total: fresh.length,
  };
  active.set(db, state);
  try {
    const job = runJob(db, 'analysis', async (report) => {
      let processed = 0;
      let cardNote = '';
      try {
        report(0, state.total, `Analysed 0 of ${state.total}`);
        for (let id = state.priority.shift() ?? state.pending.shift(); id !== undefined; id = state.priority.shift() ?? state.pending.shift()) {
          state.current = id;
          cardNote = (await analyseOne(db, id, deps)) || cardNote;
          state.current = null;
          processed += 1;
          report(processed, state.total, `Analysed ${processed} of ${state.total}`);
        }
        return `Analysed ${processed} of ${state.total}${cardNote}`;
      } finally {
        active.delete(db);
      }
    });
    state.jobId = job.id;
    return { jobId: job.id, queued: fresh.length };
  } catch (e) {
    active.delete(db);
    throw e;
  }
}

/** Re-queues games whose analysis was interrupted by a restart. */
export function requeuePending(db: DatabaseSync, deps: QueueDeps): EnqueueResult | null {
  const rows = db.prepare(
    `SELECT a.game_id FROM game_analysis a LEFT JOIN games g ON g.id = a.game_id
     WHERE a.status IN ('pending', 'running') ORDER BY g.played_at DESC, a.game_id DESC`,
  ).all();
  if (rows.length === 0) return null;
  return enqueueAnalysis(db, rows.map((r) => r.game_id as number), deps);
}
