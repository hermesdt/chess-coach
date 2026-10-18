export type Source = 'chesscom' | 'lichess' | 'import';
export type Color = 'white' | 'black';
export type GameResult = 'win' | 'loss' | 'draw';
export type TimeClass = 'ultrabullet' | 'bullet' | 'blitz' | 'rapid' | 'classical' | 'daily' | 'unknown';

export interface NewGame {
  source: Source; sourceId: string; playedAt: number; // ms epoch (game end)
  timeClass: TimeClass; rated: boolean;
  white: string; black: string; whiteElo: number | null; blackElo: number | null;
  userColor: Color | null; result: GameResult | null; // result from the user's view; null if userColor null
  termination: string | null; eco: string | null; openingName: string | null;
  pgn: string; url: string | null; plyCount: number;
}
export interface GameSummary extends Omit<NewGame, 'pgn'> { id: number }
export interface MoveInfo { ply: number; san: string; uci: string; fenBefore: string; fenAfter: string }
export interface GameDetail extends GameSummary { pgn: string; startFen: string; moves: MoveInfo[] }
export interface GameListQuery { source?: Source; color?: Color; result?: GameResult; q?: string; limit?: number; offset?: number }
export interface GameList { items: GameSummary[]; total: number }
export interface SettingsDTO { chesscomUsername: string | null; lichessUsername: string | null; lichessTokenSet: boolean; syncInitialMonths: number }
export interface SettingsUpdate { chesscomUsername?: string; lichessUsername?: string; lichessToken?: string; syncInitialMonths?: number }
export type JobStatus = 'queued' | 'running' | 'done' | 'error';
export interface Job { id: number; kind: string; status: JobStatus; progress: number; total: number | null; message: string | null; error: string | null; createdAt: number; finishedAt: number | null }
export interface ImportPreviewItem { index: number; white: string; black: string; date: string | null; detectedColor: Color | null; skippedReason: string | null }
export interface ImportRequest { pgn: string; colors?: (Color | null)[] } // colors[i] overrides detection for game i
export interface ImportResult { inserted: number; duplicates: number; skipped: number }
