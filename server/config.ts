import type { DatabaseSync } from 'node:sqlite';
import { CHAT_MODEL_DEFAULTS, DEEP_MODEL_DEFAULTS, type AiProviderSetting, type ProviderId, type SettingsDTO } from '../shared/types.js';
import { PROVIDER_IDS } from './ai/types.js';
import { getSetting } from './db/settings-repo.js';

export type ResolvedSettings = SettingsDTO & {
  lichessToken: string | null;
  openrouterApiKey: string | null;
  anthropicApiKey: string | null;
};

export { CHAT_MODEL_DEFAULTS, DEEP_MODEL_DEFAULTS };
const DEFAULT_SYNC_MONTHS = 12;
export const DEFAULT_ENGINE_NODES = 400_000;
export const DEFAULT_REVIEW_DAILY_LIMIT = 20;
export const DEFAULT_REVIEW_NEW_PER_DAY = 10;

function pick(db: DatabaseSync, key: string, envName: string): string | null {
  const stored = getSetting(db, key);
  if (stored !== null && stored !== '') return stored;
  const env = process.env[envName];
  return env ? env : null;
}

export function isAiProviderSetting(value: unknown): value is AiProviderSetting {
  return value === 'auto' || value === 'none' || (PROVIDER_IDS as readonly unknown[]).includes(value);
}

/** The model for a normal chat question: the setting, else the default, else null (provider default). */
export const resolveChatModel = (s: Pick<SettingsDTO, 'aiChatModels'>, id: ProviderId): string | null => s.aiChatModels[id] || CHAT_MODEL_DEFAULTS[id] || null;
export const resolveDeepModel = (s: Pick<SettingsDTO, 'aiDeepModels'>, id: ProviderId): string | null => s.aiDeepModels[id] || DEEP_MODEL_DEFAULTS[id] || null;
/** True when a deep model is known (setting or default) and differs from the chat model. */
export const hasStrongerModel = (s: Pick<SettingsDTO, 'aiChatModels' | 'aiDeepModels'>, id: ProviderId): boolean => {
  const deep = resolveDeepModel(s, id);
  return deep !== null && deep !== resolveChatModel(s, id);
};

export function getSettings(db: DatabaseSync): ResolvedSettings {
  const openrouterApiKey = pick(db, 'openrouter_api_key', 'OPENROUTER_API_KEY');
  const anthropicApiKey = pick(db, 'anthropic_api_key', 'ANTHROPIC_API_KEY');
  const storedProvider = getSetting(db, 'ai_provider');
  const aiModels = Object.fromEntries(
    PROVIDER_IDS.map((id) => [id, getSetting(db, `ai_model_${id}`) || null]),
  ) as Record<ProviderId, string | null>;
  const storedModels = (prefix: string) =>
    Object.fromEntries(PROVIDER_IDS.map((id) => [id, getSetting(db, `${prefix}${id}`) || null])) as Record<ProviderId, string | null>;
  const lichessToken = pick(db, 'lichess_token', 'LICHESS_TOKEN');
  const months = Number(getSetting(db, 'sync_initial_months'));
  const nodes = Number(pick(db, 'engine_nodes', 'ENGINE_NODES'));
  const daily = Number(getSetting(db, 'review_daily_limit'));
  const newPerDay = getSetting(db, 'review_new_per_day');
  const newCount = Number(newPerDay);
  const storedLevel = getSetting(db, 'level_override');
  return {
    chesscomUsername: pick(db, 'chesscom_username', 'CHESSCOM_USERNAME'),
    lichessUsername: pick(db, 'lichess_username', 'LICHESS_USERNAME'),
    lichessToken,
    lichessTokenSet: lichessToken !== null,
    openrouterApiKey,
    anthropicApiKey,
    openrouterKeySet: openrouterApiKey !== null,
    anthropicKeySet: anthropicApiKey !== null,
    aiProvider: isAiProviderSetting(storedProvider) ? storedProvider : 'auto',
    aiModels,
    aiChatModels: storedModels('ai_chat_model_'),
    aiDeepModels: storedModels('ai_deep_model_'),
    syncInitialMonths: Number.isInteger(months) && months >= 1 ? months : DEFAULT_SYNC_MONTHS,
    engineNodes: Number.isInteger(nodes) && nodes >= 10_000 && nodes <= 5_000_000 ? nodes : DEFAULT_ENGINE_NODES,
    reviewDailyLimit: Number.isInteger(daily) && daily >= 1 && daily <= 200 ? daily : DEFAULT_REVIEW_DAILY_LIMIT,
    levelOverride: storedLevel === '1' ? 1 : storedLevel === '2' ? 2 : storedLevel === '3' ? 3 : null,
    reviewNewPerDay:
      newPerDay !== null && newPerDay !== '' && Number.isInteger(newCount) && newCount >= 0 && newCount <= 100
        ? newCount
        : DEFAULT_REVIEW_NEW_PER_DAY,
  };
}

const DEFAULT_DB_PATH = 'data/chess.db';

export function resolveDbPath(): string {
  return process.env.CHESS_DB_PATH || DEFAULT_DB_PATH;
}

/** Same rule as server/main.ts: BACKUP_DIR, else data/backups for the default DB, else none. */
export function resolveBackupsDir(): string | null {
  const dbPath = resolveDbPath();
  return process.env.BACKUP_DIR || (dbPath === DEFAULT_DB_PATH ? 'data/backups' : null);
}
