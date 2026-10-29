import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { GamePlanDTO, PlanFile, PlanGamesDTO, PlanMoment } from '../../shared/plans.js';
import type { Color } from '../../shared/types.js';
import { matchGame } from './match.js';

interface GameRow {
  id: number; pgn: string; userColor: Color; result: 'win' | 'loss' | 'draw' | null;
  white: string; black: string; playedAt: number; repertoireId: string | null;
}

const SELECT = `SELECT g.id, g.pgn, g.user_color, g.result, g.white, g.black, g.played_at,
  (SELECT e.repertoire_id FROM opening_events e WHERE e.game_id = g.id) AS repertoire_id FROM games g`;

const toRow = (r: Record<string, unknown>): GameRow => ({
  id: r.id as number, pgn: r.pgn as string, userColor: r.user_color as Color,
  result: (r.result as GameRow['result']) ?? null, white: r.white as string, black: r.black as string,
  playedAt: r.played_at as number, repertoireId: (r.repertoire_id as string | null) ?? null,
});

/** Changes when a plan changes in a way that moves a plan moment: id, group, side, level or trigger. */
export function plansHash(plans: readonly PlanFile[]): string {
  const key = plans.map((p) => ({ id: p.id, group: p.group, side: p.side, level: p.level, trigger: p.trigger }));
  return createHash('sha1').update(JSON.stringify(key)).digest('hex');
}

const cache = new Map<string, PlanMoment[]>();

export function clearPlanMatchCache(): void {
  cache.clear();
}

function moments(row: GameRow, plans: readonly PlanFile[], hash: string): PlanMoment[] {
  const key = `${row.id}:${row.repertoireId ?? ''}:${hash}`;
  let found = cache.get(key);
  if (!found) {
    found = matchGame({ pgn: row.pgn, userColor: row.userColor, repertoireId: row.repertoireId }, plans);
    cache.set(key, found);
  }
  return found;
}

/** The owner's games that count: a user colour is known and the game is not a duplicate copy. Newest first. */
function ownerGames(db: DatabaseSync): GameRow[] {
  return db.prepare(`${SELECT} WHERE g.user_color IS NOT NULL AND g.duplicate_of IS NULL ORDER BY g.played_at DESC, g.id DESC`)
    .all().map(toRow);
}

export function gamePlans(db: DatabaseSync, gameId: number, plans: readonly PlanFile[]): GamePlanDTO[] {
  const raw = db.prepare(`${SELECT} WHERE g.id = ? AND g.user_color IS NOT NULL`).get(gameId);
  if (!raw) return [];
  const hash = plansHash(plans);
  const titles = new Map(plans.map((p) => [p.id, p.title]));
  return moments(toRow(raw), plans, hash).map((m) => ({ planId: m.planId, title: titles.get(m.planId) ?? m.planId, ply: m.ply }));
}

export function planGames(db: DatabaseSync, plans: readonly PlanFile[], planId: string): PlanGamesDTO | null {
  if (!plans.some((p) => p.id === planId)) return null;
  const hash = plansHash(plans);
  const hits = ownerGames(db).flatMap((row) => {
    const moment = moments(row, plans, hash).find((m) => m.planId === planId);
    return moment ? [{ row, ply: moment.ply }] : [];
  });
  return {
    total: hits.length,
    wins: hits.filter((h) => h.row.result === 'win').length,
    draws: hits.filter((h) => h.row.result === 'draw').length,
    losses: hits.filter((h) => h.row.result === 'loss').length,
    games: hits.slice(0, 5).map(({ row, ply }) => ({ id: row.id, ply, result: row.result, white: row.white, black: row.black, playedAt: row.playedAt })),
  };
}

/** For each plan, the number of the owner's games where it fits. */
export function planGameCounts(db: DatabaseSync, plans: readonly PlanFile[]): Map<string, number> {
  const hash = plansHash(plans);
  const counts = new Map(plans.map((p): [string, number] => [p.id, 0]));
  for (const row of ownerGames(db)) {
    for (const m of moments(row, plans, hash)) counts.set(m.planId, (counts.get(m.planId) ?? 0) + 1);
  }
  return counts;
}
