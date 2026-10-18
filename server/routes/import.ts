import type { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import type { Color, ImportPreviewItem, ImportRequest, ImportResult, NewGame } from '../../shared/types.js';
import { gameFromPgn, splitPgn } from '../chess/pgn.js';
import { getSettings } from '../config.js';
import { insertGames } from '../db/games-repo.js';
import { refreshOpenings } from '../repertoire/refresh.js';
import type { Repertoire } from '../repertoire/types.js';

const tag = (pgn: string, name: string): string | null => {
  const v = new RegExp(`^\\[${name}\\s+"([^"]*)"\\]`, 'im').exec(pgn)?.[1];
  return v && v !== '?' ? v : null;
};

function usernamesOf(db: DatabaseSync): (string | null)[] {
  const s = getSettings(db);
  return [s.chesscomUsername, s.lichessUsername];
}

export function importRoutes(db: DatabaseSync, getReps: () => Repertoire[]): Hono {
  return new Hono()
    .post('/import/preview', async (c) => {
      const body = (await c.req.json().catch(() => null)) as { pgn?: unknown } | null;
      if (typeof body?.pgn !== 'string') return c.json({ error: 'pgn must be a string' }, 400);
      const usernames = usernamesOf(db);
      const items: ImportPreviewItem[] = splitPgn(body.pgn).map((pgn, index) => {
        const game = gameFromPgn(pgn, { source: 'import', usernames });
        return {
          index,
          white: tag(pgn, 'White') ?? '?',
          black: tag(pgn, 'Black') ?? '?',
          date: tag(pgn, 'Date'),
          detectedColor: 'skipped' in game ? null : game.userColor,
          skippedReason: 'skipped' in game ? game.skipped : null,
        };
      });
      return c.json(items);
    })
    .post('/import', async (c) => {
      const body = (await c.req.json().catch(() => null)) as Partial<ImportRequest> | null;
      if (typeof body?.pgn !== 'string') return c.json({ error: 'pgn must be a string' }, 400);
      if (body.colors !== undefined && !Array.isArray(body.colors)) return c.json({ error: 'colors must be an array' }, 400);
      const colors: (Color | null | undefined)[] = body.colors ?? [];
      if (!colors.every((v) => v === undefined || v === null || v === 'white' || v === 'black')) {
        return c.json({ error: "colors entries must be 'white', 'black' or null" }, 400);
      }
      const usernames = usernamesOf(db);
      const games: NewGame[] = [];
      let skipped = 0;
      splitPgn(body.pgn).forEach((pgn, i) => {
        const game = gameFromPgn(pgn, { source: 'import', usernames, userColor: colors[i] });
        if ('skipped' in game) skipped += 1;
        else games.push(game);
      });
      const { inserted, duplicates } = insertGames(db, games);
      if (inserted > 0) {
        try {
          refreshOpenings(db, getReps());
        } catch (e) {
          console.error('could not refresh openings after import', e);
        }
      }
      const result: ImportResult = { inserted, duplicates, skipped };
      return c.json(result);
    });
}
