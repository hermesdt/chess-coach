import type { DatabaseSync } from 'node:sqlite';
import type { AiProviderSetting, ProviderId, SettingsDTO } from '../shared/types.js';
import { PROVIDER_IDS } from './ai/types.js';
import { getSetting } from './db/settings-repo.js';

export type ResolvedSettings = SettingsDTO & {
  lichessToken: string | null;
  openrouterApiKey: string | null;
  anthropicApiKey: string | null;
};

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

export function getSettings(db: DatabaseSync): ResolvedSettings {
  const openrouterApiKey = pick(db, 'openrouter_api_key', 'OPENROUTER_API_KEY');
  const anthropicApiKey = pick(db, 'anthropic_api_key', 'ANTHROPIC_API_KEY');
  const storedProvider = getSetting(db, 'ai_provider');
  const aiModels = Object.fromEntries(
    PROVIDER_IDS.map((id) => [id, getSetting(db, `ai_model_${id}`) || null]),
  ) as Record<ProviderId, string | null>;
  const lichessToken = pick(db, 'lichess_token', 'LICHESS_TOKEN');
  const months = Number(getSetting(db, 'sync_initial_months'));
  const nodes = Number(pick(db, 'engine_nodes', 'ENGINE_NODES'));
  const daily = Number(getSetting(db, 'review_daily_limit'));
  const newPerDay = getSetting(db, 'review_new_per_day');
  const newCount = Number(newPerDay);
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
    syncInitialMonths: Number.isInteger(months) && months >= 1 ? months : DEFAULT_SYNC_MONTHS,
    engineNodes: Number.isInteger(nodes) && nodes >= 10_000 && nodes <= 5_000_000 ? nodes : DEFAULT_ENGINE_NODES,
    reviewDailyLimit: Number.isInteger(daily) && daily >= 1 && daily <= 200 ? daily : DEFAULT_REVIEW_DAILY_LIMIT,
    reviewNewPerDay:
      newPerDay !== null && newPerDay !== '' && Number.isInteger(newCount) && newCount >= 0 && newCount <= 100
        ? newCount
        : DEFAULT_REVIEW_NEW_PER_DAY,
  };
}
