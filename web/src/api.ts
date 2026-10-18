import type {
  Color,
  GameAnalysis,
  GameDetail,
  GameList,
  GameListQuery,
  ImportPreviewItem,
  ImportRequest,
  ImportResult,
  Job,
  SettingsDTO,
  SettingsUpdate,
} from '../../shared/types';

export type AnalysisResponse = GameAnalysis | { status: 'none' } | { status: 'pending' | 'running' | 'error'; error?: string | null };

export interface SyncStatus {
  chesscom: number | null;
  lichess: number | null;
  runningJobId: number | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    // The server requires a JSON content type on every write, even without a body.
    headers: init?.method && init.method !== 'GET' ? { 'Content-Type': 'application/json' } : undefined,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

function queryString(q: GameListQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(q)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

export const api = {
  getSettings: () => request<SettingsDTO>('/settings'),
  putSettings: (update: SettingsUpdate) =>
    request<SettingsDTO>('/settings', { method: 'PUT', body: JSON.stringify(update) }),
  listGames: (q: GameListQuery = {}) => request<GameList>(`/games${queryString(q)}`),
  getGame: (id: number) => request<GameDetail>(`/games/${id}`),
  getAnalysis: (id: number) => request<AnalysisResponse>(`/games/${id}/analysis`),
  analyseGame: (id: number) => post<{ jobId: number }>(`/games/${id}/analyse`),
  queueAnalysis: (limit: number) => post<{ jobId: number; queued: number }>('/analysis/queue', { limit }),
  startSync: () => post<{ jobId: number; alreadyRunning?: boolean }>('/sync'),
  getJob: (id: number) => request<Job>(`/jobs/${id}`),
  getSyncStatus: () => request<SyncStatus>('/sync/status'),
  previewImport: (pgn: string) => post<ImportPreviewItem[]>('/import/preview', { pgn }),
  importPgn: (pgn: string, colors?: (Color | null)[]) =>
    post<ImportResult>('/import', { pgn, colors } satisfies ImportRequest),
};
