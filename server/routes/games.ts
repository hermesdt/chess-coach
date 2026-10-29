import type { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import type { Color, GameDetail, GameRepertoireRef, GameListQuery, GameResult, Source } from '../../shared/types.js';
import { parsePgn } from '../chess/pgn.js';
import { getGameRow, listGames } from '../db/games-repo.js';
import type { PlanFile } from '../../shared/plans.js';
import { gamePlans } from '../plans/game-plans.js';

const SOURCES: readonly string[] = ['chesscom', 'lichess', 'import'];
const COLORS: readonly string[] = ['white', 'black'];
const RESULTS: readonly string[] = ['win', 'loss', 'draw'];

const oneOf = <T extends string>(allowed: readonly string[], v: string | undefined): T | undefined =>
  v !== undefined && allowed.includes(v) ? (v as T) : undefined;

function intOr(v: string | undefined, fallback: number, min: number, max: number): number {
  if (v === undefined || !/^\d+$/.test(v)) return fallback;
  return Math.min(max, Math.max(min, Number(v)));
}

/**
 * The opening event of a game, as a link target for the guide. A leak or out-of-book event gives its node;
 * an end-of-book event gives an empty node, so the link opens the guide at its intro. No event, or a game
 * of another opening, gives no link.
 */
function repertoireRef(db: DatabaseSync, gameId: number): GameRepertoireRef | null {
  const e = db.prepare(`SELECT repertoire_id, node_id, kind FROM opening_events
    WHERE game_id = ? AND kind IN ('leak', 'out_of_book', 'end_of_book')`).get(gameId) as unknown as
    { repertoire_id: string; node_id: string | null; kind: GameRepertoireRef['kind'] } | undefined;
  if (!e) return null;
  if (e.kind === 'end_of_book') return { id: e.repertoire_id, nodeId: '', kind: e.kind };
  return e.node_id === null ? null : { id: e.repertoire_id, nodeId: e.node_id, kind: e.kind };
}

export function gamesRoutes(db: DatabaseSync, getPlans: () => PlanFile[] = () => []): Hono {
  return new Hono()
    .get('/games', (c) => {
      const p = c.req.query();
      const query: GameListQuery = {
        source: oneOf<Source>(SOURCES, p.source),
        color: oneOf<Color>(COLORS, p.color),
        result: oneOf<GameResult>(RESULTS, p.result),
        q: p.q || undefined,
        includeDuplicates: p.includeDuplicates === '1' || undefined,
        limit: intOr(p.limit, 50, 1, 200),
        offset: intOr(p.offset, 0, 0, Number.MAX_SAFE_INTEGER),
      };
      return c.json(listGames(db, query));
    })
    .get('/games/:id', (c) => {
      const id = c.req.param('id');
      const row = /^\d+$/.test(id) ? getGameRow(db, Number(id)) : null;
      if (!row) return c.json({ error: 'not found' }, 404);
      const { startFen, moves } = parsePgn(row.pgn);
      const detail: GameDetail = { ...row, startFen, moves, repertoire: repertoireRef(db, row.id) };
      return c.json(detail);
    })
    .get('/games/:id/plans', (c) => {
      const id = c.req.param('id');
      const row = /^\d+$/.test(id) ? getGameRow(db, Number(id)) : null;
      if (!row) return c.json({ error: 'not found' }, 404);
      return c.json(gamePlans(db, row.id, getPlans()));
    });
}
