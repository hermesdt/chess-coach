import type { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import type { DataInfo, SettingsDTO, SettingsUpdate } from '../../shared/types.js';
import { PROVIDER_IDS } from '../ai/types.js';
import { getSettings, isAiProviderSetting, resolveBackupsDir, resolveDbPath } from '../config.js';
import { setSetting } from '../db/settings-repo.js';

function toDto(db: DatabaseSync): SettingsDTO {
  const s = getSettings(db);
  return {
    chesscomUsername: s.chesscomUsername,
    lichessUsername: s.lichessUsername,
    lichessTokenSet: s.lichessTokenSet,
    syncInitialMonths: s.syncInitialMonths,
    engineNodes: s.engineNodes,
    reviewDailyLimit: s.reviewDailyLimit,
    reviewNewPerDay: s.reviewNewPerDay,
    aiProvider: s.aiProvider,
    aiModels: s.aiModels,
    aiChatModels: s.aiChatModels,
    aiDeepModels: s.aiDeepModels,
    openrouterKeySet: s.openrouterKeySet,
    anthropicKeySet: s.anthropicKeySet,
  };
}

const STRING_FIELDS = [
  ['chesscomUsername', 'chesscom_username'],
  ['lichessUsername', 'lichess_username'],
  ['lichessToken', 'lichess_token'],
  ['openrouterApiKey', 'openrouter_api_key'],
  ['anthropicApiKey', 'anthropic_api_key'],
] as const;

const MODEL_MAPS = [['aiChatModels', 'ai_chat_model_'], ['aiDeepModels', 'ai_deep_model_']] as const;

export function settingsRoutes(db: DatabaseSync): Hono {
  return new Hono()
    .get('/settings', (c) => c.json(toDto(db)))
    .get('/settings/data', (c) => {
      const count = (sql: string) => Number((db.prepare(sql).get() as { n: number }).n);
      const info: DataInfo = {
        dbPath: resolveDbPath(),
        games: count('SELECT COUNT(*) AS n FROM games'),
        duplicateGames: count('SELECT COUNT(*) AS n FROM games WHERE duplicate_of IS NOT NULL'),
        cards: count('SELECT COUNT(*) AS n FROM cards'),
        backupsDir: resolveBackupsDir(),
      };
      return c.json(info);
    })
    .put('/settings', async (c) => {
      const body = (await c.req.json().catch(() => null)) as SettingsUpdate | null;
      if (body === null || typeof body !== 'object') return c.json({ error: 'Invalid body' }, 400);
      const months = body.syncInitialMonths;
      if (months !== undefined && !(Number.isInteger(months) && months >= 1 && months <= 120)) {
        return c.json({ error: 'syncInitialMonths must be an integer from 1 to 120' }, 400);
      }
      const nodes = body.engineNodes;
      if (nodes !== undefined && !(Number.isInteger(nodes) && nodes >= 10_000 && nodes <= 5_000_000)) {
        return c.json({ error: 'engineNodes must be an integer from 10000 to 5000000' }, 400);
      }
      const daily = body.reviewDailyLimit;
      if (daily !== undefined && !(Number.isInteger(daily) && daily >= 1 && daily <= 200)) {
        return c.json({ error: 'reviewDailyLimit must be an integer from 1 to 200' }, 400);
      }
      const newPerDay = body.reviewNewPerDay;
      if (newPerDay !== undefined && !(Number.isInteger(newPerDay) && newPerDay >= 0 && newPerDay <= 100)) {
        return c.json({ error: 'reviewNewPerDay must be an integer from 0 to 100' }, 400);
      }
      if (body.aiProvider !== undefined && !isAiProviderSetting(body.aiProvider)) {
        return c.json({ error: 'aiProvider must be auto, none or a provider id' }, 400);
      }
      const models = body.aiModels;
      if (models !== undefined) {
        if (models === null || typeof models !== 'object') return c.json({ error: 'aiModels must be an object' }, 400);
        for (const [id, model] of Object.entries(models)) {
          if (!(PROVIDER_IDS as readonly string[]).includes(id)) return c.json({ error: `aiModels has an unknown provider: ${id}` }, 400);
          if (typeof model !== 'string') return c.json({ error: `aiModels.${id} must be a string` }, 400);
        }
      }
      for (const [field] of MODEL_MAPS) {
        const map = body[field];
        if (map === undefined) continue;
        if (map === null || typeof map !== 'object') return c.json({ error: `${field} must be an object` }, 400);
        for (const [id, model] of Object.entries(map)) {
          if (!(PROVIDER_IDS as readonly string[]).includes(id)) return c.json({ error: `${field} has an unknown provider: ${id}` }, 400);
          if (typeof model !== 'string') return c.json({ error: `${field}.${id} must be a string` }, 400);
        }
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
      if (body.aiProvider !== undefined) setSetting(db, 'ai_provider', body.aiProvider);
      for (const [id, model] of Object.entries(models ?? {})) setSetting(db, `ai_model_${id}`, model.trim() === '' ? null : model.trim());
      for (const [field, prefix] of MODEL_MAPS) {
        for (const [id, model] of Object.entries(body[field] ?? {})) setSetting(db, `${prefix}${id}`, model.trim() === '' ? null : model.trim());
      }
      if (months !== undefined) setSetting(db, 'sync_initial_months', String(months));
      if (nodes !== undefined) setSetting(db, 'engine_nodes', String(nodes));
      if (daily !== undefined) setSetting(db, 'review_daily_limit', String(daily));
      if (newPerDay !== undefined) setSetting(db, 'review_new_per_day', String(newPerDay));
      return c.json(toDto(db));
    });
}
