import type {
  CardFlag,
  ChatMessageDTO,
  CourseLesson,
  CourseLessonDetail,
  Color,
  ReviewResult,
  ReviewSession,
  ReviewSubmit,
  GameAnalysis,
  GameDetail,
  GameList,
  GameSummary,
  GameReviewNote,
  LiveEvalDTO,
  ProviderId,
  WeaknessReportNote,
  GameListQuery,
  ImportPreviewItem,
  ImportRequest,
  ImportResult,
  Insights,
  InsightsWindow,
  Job,
  OpeningDetail,
  OpeningLeakGroup,
  OpeningSummary,
  SettingsDTO,
  DataInfo,
  FlagDetail,
  SettingsUpdate,
  Tag,
} from '../../shared/types';

export type AnalysisResponse = GameAnalysis | { status: 'none' } | { status: 'pending' | 'running' | 'error'; error?: string | null };

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  ok: boolean;
  reason: string | null;
  model: string | null;
}

export type ProviderTestResult = { ok: true; model: string; ms: number } | { ok: false; error: string };

export interface ReviewStats {
  dueNow: number;
  dueToday: number;
  totalCards: number;
  reviewedToday: number;
  /** Cards in today's session: due cards plus new cards within the daily limits. */
  sessionSize: number;
}

export interface SyncStatus {
  chesscom: number | null;
  lichess: number | null;
  runningJobId: number | null;
}

export interface DashboardData {
  review: ReviewStats;
  sync: { chesscom: number | null; lichess: number | null };
  recentGames: GameSummary[];
  topTag: { tag: Tag; count: number; games: number } | null;
  level: { level: number; rating: number | null; source: 'override' | 'games' | 'default' };
  levelUp: { from: number; to: number } | null;
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
  getDataInfo: () => request<DataInfo>('/settings/data'),
  getFlags: () => request<FlagDetail[]>('/flags'),
  restoreFlag: (id: number) => post<{ ok: true }>(`/flags/${id}/restore`, {}),
  listGames: (q: GameListQuery = {}) => request<GameList>(`/games${queryString(q)}`),
  getGame: (id: number) => request<GameDetail>(`/games/${id}`),
  getAnalysis: (id: number) => request<AnalysisResponse>(`/games/${id}/analysis`),
  getLive: (fen: string, signal?: AbortSignal) => request<LiveEvalDTO>(`/live?fen=${encodeURIComponent(fen)}`, { signal }),
  getChat: (gameId: number) => request<ChatMessageDTO[]>(`/games/${gameId}/chat`),
  sendChat: (gameId: number, body: { question: string; anchor: { ply: number; path: string[] }; provider?: ProviderId }) =>
    post<{ messageId: number; jobId: number }>(`/games/${gameId}/chat`, body),
  deeperChat: (messageId: number) => post<{ messageId: number; jobId: number }>(`/chat/${messageId}/deeper`, {}),
  /** Warms the engine cache for the anchor. Fire and forget. */
  prefetchChat: (gameId: number, anchor: { ply: number; path: string[] }) => post<{ started: boolean }>(`/games/${gameId}/chat/prefetch`, { anchor }),
  retryChat: (messageId: number) => post<{ jobId: number }>(`/chat/${messageId}/retry`, {}),
  chatReviewCard: (messageId: number, lineId?: string) =>
    post<{ cardId: number }>(`/chat/${messageId}/review-card`, lineId ? { lineId } : {}),
  analyseGame: (id: number) => post<{ jobId: number | null }>(`/games/${id}/analyse`),
  queueAnalysis: (limit: number) => post<{ jobId: number | null; queued: number }>('/analysis/queue', { limit }),
  startSync: () => post<{ jobId: number; alreadyRunning?: boolean }>('/sync'),
  getJob: (id: number) => request<Job>(`/jobs/${id}`),
  getSyncStatus: () => request<SyncStatus>('/sync/status'),
  previewImport: (pgn: string) => post<ImportPreviewItem[]>('/import/preview', { pgn }),
  getDashboard: () => request<DashboardData>('/dashboard'),
  getInsights: (window: InsightsWindow) => request<Insights>(`/insights?window=${window}`),
  markLevelSeen: () => post<{ ok: true }>('/dashboard/level-seen', {}),
  getReviewSession: () => request<ReviewSession>('/review/session'),
  getReviewStats: () => request<ReviewStats>('/review/stats'),
  submitReview: (cardId: number, body: ReviewSubmit) => post<ReviewResult>(`/review/${cardId}`, body),
  flagCard: (cardId: number, note: string) => post<CardFlag>(`/cards/${cardId}/flag`, { note }),
  listOpenings: () => request<OpeningSummary[]>('/openings'),
  getOpening: (id: string) => request<OpeningDetail>(`/openings/${encodeURIComponent(id)}`),
  getOpeningLeaks: (id: string) => request<OpeningLeakGroup[]>(`/openings/${encodeURIComponent(id)}/leaks`),
  listProviders: () => request<ProviderInfo[]>('/ai/providers'),
  testProvider: (id: ProviderId) => post<ProviderTestResult>(`/ai/providers/${id}/test`),
  getCoachNotes: (gameId: number) => request<GameReviewNote[]>(`/games/${gameId}/coach`),
  coachGame: (gameId: number, provider?: ProviderId) => post<{ jobId: number }>(`/games/${gameId}/coach`, { provider }),
  getWeakness: () => request<WeaknessReportNote | null>('/coach/weakness'),
  makeWeakness: (provider?: ProviderId) => post<{ jobId: number }>('/coach/weakness', { provider }),
  listCourse: () => request<CourseLesson[]>('/course'),
  getLesson: (id: string) => request<CourseLessonDetail>(`/course/${encodeURIComponent(id)}`),
  completeLesson: (id: string) => post<{ created: number }>(`/course/${encodeURIComponent(id)}/complete`),
  importPgn: (pgn: string, colors?: (Color | null)[]) =>
    post<ImportResult>('/import', { pgn, colors } satisfies ImportRequest),
};
