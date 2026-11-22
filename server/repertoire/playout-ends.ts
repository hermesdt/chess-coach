import type { DatabaseSync } from 'node:sqlite';
import { Chess } from 'chess.js';
import { playUci } from '../analysis/tags-material.js';
import { flip, winPct } from '../analysis/winpct.js';
import { getSetting, setSetting } from '../db/settings-repo.js';
import type { EngineCache } from '../engine/cache.js';
import type { EnginePool } from '../engine/pool.js';
import { findActiveJob, runJob } from '../jobs.js';
import { currentLevel, type Level } from '../level.js';
import { positionKey, upsertCard } from '../srs/cards-repo.js';
import { analyseCached } from '../srs/check-move.js';
import { PLAYOUT_PROMPT } from '../srs/playout-cards.js';
import type { RepNode, Repertoire } from './types.js';

/** Ends already checked with the engine (a card or a skip), as "repertoire|nodeId". */
const CHECKED_KEY = 'playout_repertoire_checked';
const MIN_WIN = 25;
const MAX_WIN = 75;
/** Repertoire-end cards come after own-game cards (sort order 0). */
const SORT_ORDER = 1;
const JOB_KIND = 'playout-repertoire';

/** Nodes at or below `level` that have no child at or below `level`: the last move of each line the owner knows. */
export function repertoireEnds(rep: Repertoire, level: Level): RepNode[] {
  const ends: RepNode[] = [];
  const walk = (node: RepNode) => {
    if (node.level > level) return;
    const open = node.children.filter((c) => c.level <= level);
    if (open.length === 0) ends.push(node);
    for (const c of open) walk(c);
  };
  for (const root of rep.roots) walk(root);
  return ends;
}

const endKey = (rep: Repertoire, node: RepNode): string => `${rep.id}|${node.id}`;

function readChecked(db: DatabaseSync): Set<string> {
  const raw = getSetting(db, CHECKED_KEY);
  return new Set(raw ? (JSON.parse(raw) as string[]) : []);
}

function pendingEnds(db: DatabaseSync, reps: Repertoire[], level: Level): { rep: Repertoire; node: RepNode }[] {
  const checked = readChecked(db);
  return reps.flatMap((rep) => repertoireEnds(rep, level).map((node) => ({ rep, node })))
    .filter(({ rep, node }) => !checked.has(endKey(rep, node)));
}

/** The start of the card and the owner's win %. When the owner moved last, Stockfish plays the reply first. */
async function startOf(
  rep: Repertoire, node: RepNode, pool: Pick<EnginePool, 'analyse'>, cache: EngineCache | undefined,
): Promise<{ fen: string; lastMove: string; win: number } | null> {
  if (new Chess(node.fenAfter).isGameOver()) return null;
  const line = (await analyseCached(node.fenAfter, pool, cache))[0]!;
  if (node.mover !== rep.color) return { fen: node.fenAfter, lastMove: node.uci, win: winPct(line.score) };
  const reply = line.pv[0];
  if (!reply) return null;
  const chess = new Chess(node.fenAfter);
  playUci(chess, reply);
  if (chess.isGameOver()) return null;
  return { fen: chess.fen(), lastMove: reply, win: winPct(flip(line.score)) };
}

/** Builds a play-it-out card for each repertoire end not checked yet. Each end is checked with the engine once. */
export async function buildRepertoirePlayoutCards(
  db: DatabaseSync,
  reps: Repertoire[],
  level: Level,
  pool: Pick<EnginePool, 'analyse'>,
  cache?: EngineCache,
): Promise<{ created: number; skipped: number }> {
  const result = { created: 0, skipped: 0 };
  for (const { rep, node } of pendingEnds(db, reps, level)) {
    const start = await startOf(rep, node, pool, cache);
    if (start && start.win >= MIN_WIN && start.win <= MAX_WIN) {
      upsertCard(db, {
        kind: 'playout', positionKey: positionKey(start.fen), fen: start.fen, sideToMove: rep.color, prompt: PLAYOUT_PROMPT,
        solution: { accepted: [], best: '', explanation: null }, refs: [{ repertoire: rep.id, nodeId: node.id }],
        lastMove: { uci: start.lastMove }, sortOrder: SORT_ORDER,
      });
      result.created += 1;
    } else {
      result.skipped += 1;
    }
    const checked = readChecked(db);
    checked.add(endKey(rep, node));
    setSetting(db, CHECKED_KEY, JSON.stringify([...checked]));
  }
  return result;
}

/** Runs the repertoire-end build as a background job at the current level. Null when nothing is left or a job runs. */
export function backfillRepertoirePlayoutCards(
  db: DatabaseSync,
  reps: Repertoire[],
  pool: Pick<EnginePool, 'analyse'>,
): { jobId: number | null } {
  if (findActiveJob(db, JOB_KIND)) return { jobId: null };
  const level = currentLevel(db).level;
  if (pendingEnds(db, reps, level).length === 0) return { jobId: null };
  const job = runJob(db, JOB_KIND, async () => {
    const { created, skipped } = await buildRepertoirePlayoutCards(db, reps, level, pool);
    return `Play-it-out cards from repertoire ends: ${created} built, ${skipped} skipped`;
  });
  return { jobId: job.id };
}
