import type { DatabaseSync } from 'node:sqlite';
import type { Source } from '../../shared/types.js';
import { getSettings } from '../config.js';
import { insertGames, latestPlayedAt } from '../db/games-repo.js';
import type { Report } from '../jobs.js';
import { fetchChesscomGames } from './chesscom.js';
import { LichessTokenRequiredError, SyncError } from './errors.js';
import { fetchLichessGames } from './lichess.js';

export interface SyncSummary {
  chesscom: number | null;
  lichess: number | null;
  errors: string[];
}

export interface SyncDeps {
  fetchFn?: typeof fetch;
  now?: () => number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function getLastSyncedAt(db: DatabaseSync, source: Source): number | null {
  const row = db.prepare('SELECT last_synced_at AS t FROM sync_state WHERE source = ?').get(source);
  return row && row.t !== null ? Number(row.t) : null;
}

function recordSync(db: DatabaseSync, source: Source, at: number): void {
  db.prepare(
    'INSERT INTO sync_state (source, last_synced_at) VALUES (?, ?) ON CONFLICT(source) DO UPDATE SET last_synced_at = excluded.last_synced_at',
  ).run(source, at);
}

export async function syncAll(db: DatabaseSync, deps: SyncDeps, report: Report): Promise<SyncSummary> {
  const now = deps.now ?? Date.now;
  const settings = getSettings(db);
  const summary: SyncSummary = { chesscom: null, lichess: null, errors: [] };
  const sinceFor = (source: Source): number => {
    const latest = latestPlayedAt(db, source);
    return latest !== null ? latest + 1 : now() - settings.syncInitialMonths * 30 * DAY_MS;
  };

  const sources: { key: 'chesscom' | 'lichess'; label: string; run: (username: string) => Promise<void> }[] = [];
  let inserted = 0;
  const store = (source: 'chesscom' | 'lichess') => (games: Parameters<typeof insertGames>[1]) => {
    const res = insertGames(db, games);
    inserted += res.inserted;
    summary[source] = (summary[source] ?? 0) + res.inserted;
    report(inserted, null, `${source === 'chesscom' ? 'chess.com' : 'lichess'}: ${summary[source]} new`);
  };

  if (settings.chesscomUsername) {
    sources.push({
      key: 'chesscom',
      label: 'chess.com',
      run: async (username) => {
        await fetchChesscomGames(username, { sinceMs: sinceFor('chesscom'), fetchFn: deps.fetchFn, onMonth: store('chesscom') });
      },
    });
  }
  if (settings.lichessUsername) {
    sources.push({
      key: 'lichess',
      label: 'lichess',
      run: async (username) => {
        await fetchLichessGames(username, {
          sinceMs: sinceFor('lichess'),
          token: settings.lichessToken,
          fetchFn: deps.fetchFn,
          onBatch: store('lichess'),
        });
      },
    });
  }
  if (sources.length === 0) throw new SyncError('No usernames configured');

  let failed = 0;
  for (const source of sources) {
    summary[source.key] = 0;
    const username = (source.key === 'chesscom' ? settings.chesscomUsername : settings.lichessUsername)!;
    try {
      await source.run(username);
      recordSync(db, source.key, now());
    } catch (e) {
      failed += 1;
      summary.errors.push(`${source.label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (failed === sources.length) throw new SyncError(summary.errors.join(' | '));
  return summary;
}

export function summaryMessage(summary: SyncSummary): string {
  const tokenMessage = new LichessTokenRequiredError().message;
  const parts: string[] = [];
  for (const [key, label] of [['chesscom', 'chess.com'], ['lichess', 'lichess']] as const) {
    const count = summary[key];
    if (count === null) continue;
    const error = summary.errors.find((e) => e.startsWith(`${label}: `));
    if (!error) parts.push(`${label}: ${count} new`);
    else if (error.endsWith(tokenMessage)) parts.push(`${label}: token needed`);
    else parts.push(`${label}: failed (${count} new)`);
  }
  return parts.join(' · ');
}
