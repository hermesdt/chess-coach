import type { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import type { SettingsDTO, SettingsUpdate } from '../../shared/types.js';
import { getSettings } from '../config.js';
import { setSetting } from '../db/settings-repo.js';

function toDto(db: DatabaseSync): SettingsDTO {
  const { chesscomUsername, lichessUsername, lichessTokenSet, syncInitialMonths } = getSettings(db);
  return { chesscomUsername, lichessUsername, lichessTokenSet, syncInitialMonths };
}

const STRING_FIELDS = [
  ['chesscomUsername', 'chesscom_username'],
  ['lichessUsername', 'lichess_username'],
  ['lichessToken', 'lichess_token'],
] as const;

export function settingsRoutes(db: DatabaseSync): Hono {
  return new Hono()
    .get('/settings', (c) => c.json(toDto(db)))
    .put('/settings', async (c) => {
      const body = (await c.req.json().catch(() => null)) as SettingsUpdate | null;
      if (body === null || typeof body !== 'object') return c.json({ error: 'Invalid body' }, 400);
      const months = body.syncInitialMonths;
      if (months !== undefined && !(Number.isInteger(months) && months >= 1 && months <= 120)) {
        return c.json({ error: 'syncInitialMonths must be an integer from 1 to 120' }, 400);
      }
      for (const [field] of STRING_FIELDS) {
        if (body[field] !== undefined && typeof body[field] !== 'string') {
          return c.json({ error: `${field} must be a string` }, 400);
        }
      }
      for (const [field, key] of STRING_FIELDS) {
        const value = body[field];
        if (value !== undefined) setSetting(db, key, value.trim() === '' ? null : value.trim());
      }
      if (months !== undefined) setSetting(db, 'sync_initial_months', String(months));
      return c.json(toDto(db));
    });
}
