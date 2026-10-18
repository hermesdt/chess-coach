import type { DatabaseSync } from 'node:sqlite';
import type { SettingsDTO } from '../shared/types.js';
import { getSetting } from './db/settings-repo.js';

export type ResolvedSettings = SettingsDTO & { lichessToken: string | null };

const DEFAULT_SYNC_MONTHS = 12;
export const DEFAULT_ENGINE_NODES = 400_000;

function pick(db: DatabaseSync, key: string, envName: string): string | null {
  const stored = getSetting(db, key);
  if (stored !== null && stored !== '') return stored;
  const env = process.env[envName];
  return env ? env : null;
}

export function getSettings(db: DatabaseSync): ResolvedSettings {
  const lichessToken = pick(db, 'lichess_token', 'LICHESS_TOKEN');
  const months = Number(getSetting(db, 'sync_initial_months'));
  const nodes = Number(pick(db, 'engine_nodes', 'ENGINE_NODES'));
  return {
    chesscomUsername: pick(db, 'chesscom_username', 'CHESSCOM_USERNAME'),
    lichessUsername: pick(db, 'lichess_username', 'LICHESS_USERNAME'),
    lichessToken,
    lichessTokenSet: lichessToken !== null,
    syncInitialMonths: Number.isInteger(months) && months >= 1 ? months : DEFAULT_SYNC_MONTHS,
    engineNodes: Number.isInteger(nodes) && nodes >= 10_000 && nodes <= 5_000_000 ? nodes : DEFAULT_ENGINE_NODES,
  };
}
