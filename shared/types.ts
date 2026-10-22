import type { LessonId } from './lessons';
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
export interface GameSummary extends Omit<NewGame, 'pgn'> { id: number; analysis?: AnalysisBadge }
export interface MoveInfo { ply: number; san: string; uci: string; fenBefore: string; fenAfter: string }
/** M10: the opening event of a game, when it has a node a guide can link to. */
export interface GameRepertoireRef { id: string; nodeId: string; kind: 'leak' | 'out_of_book' | 'end_of_book' }
export interface GameDetail extends GameSummary { pgn: string; startFen: string; moves: MoveInfo[]; /** Set by GET /api/games/:id. */ repertoire?: GameRepertoireRef | null }
export interface GameListQuery { source?: Source; color?: Color; result?: GameResult; q?: string; limit?: number; offset?: number; includeDuplicates?: boolean }
export interface GameList { items: GameSummary[]; total: number }
// M5: AI coach providers
/** Single source of truth for provider ids; the order is the `auto` order. */
export const PROVIDER_IDS = ['claude-cli', 'codex-cli', 'anthropic-api', 'openrouter', 'opencode-cli'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];
/** Default chat and deep model per provider. null = the provider's own default. */
export const CHAT_MODEL_DEFAULTS: Record<ProviderId, string | null> = {
  'claude-cli': 'claude-sonnet-5-5', 'codex-cli': 'gpt-5.6-luna', 'opencode-cli': 'openrouter/z-ai/glm-5.3-flash', openrouter: null, 'anthropic-api': 'claude-sonnet-5-5',
};
export const DEEP_MODEL_DEFAULTS: Record<ProviderId, string | null> = {
  'claude-cli': 'claude-opus-5-5', 'codex-cli': null, 'opencode-cli': null, openrouter: null, 'anthropic-api': 'claude-opus-5-5',
};
export type AiProviderSetting = 'auto' | ProviderId | 'none';
export interface SettingsDTO { chesscomUsername: string | null; lichessUsername: string | null; lichessTokenSet: boolean; syncInitialMonths: number; engineNodes: number; reviewDailyLimit: number; reviewNewPerDay: number; aiProvider: AiProviderSetting; aiModels: Record<ProviderId, string | null>; aiChatModels: Record<ProviderId, string | null>; aiDeepModels: Record<ProviderId, string | null>; openrouterKeySet: boolean; anthropicKeySet: boolean; levelOverride: 1 | 2 | 3 | null }
export interface SettingsUpdate { chesscomUsername?: string; lichessUsername?: string; lichessToken?: string; syncInitialMonths?: number; engineNodes?: number; reviewDailyLimit?: number; reviewNewPerDay?: number; aiProvider?: AiProviderSetting; aiModels?: Partial<Record<ProviderId, string>>; aiChatModels?: Partial<Record<ProviderId, string>>; aiDeepModels?: Partial<Record<ProviderId, string>>; openrouterApiKey?: string; anthropicApiKey?: string; levelOverride?: 1 | 2 | 3 | null }
// M5: AI game review
export interface GameReviewMoment { ply: number; whatHappened: string; whyItMatters: string; principle: string; lessonId: LessonId | null }
export interface GameReview { summary: string; openingNote: string; moments: GameReviewMoment[]; oneThingToPractice: string }
/** `olderAnalysis` is set when the note was written for an older analysis version of the game. */
export interface GameReviewNote { provider: ProviderId; model: string; createdAt: number; review: GameReview; olderAnalysis?: true }
// M5: AI weakness report
export interface WeaknessItem { title: string; rule: string; lessonId: LessonId | null; focus: string }
export interface WeaknessReport { headline: string; weaknesses: WeaknessItem[]; encouragement: string }
export interface WeaknessReportNote { provider: ProviderId; model: string; createdAt: number; report: WeaknessReport }
export type JobStatus = 'queued' | 'running' | 'done' | 'error';
export interface Job { id: number; kind: string; status: JobStatus; progress: number; total: number | null; message: string | null; error: string | null; createdAt: number; finishedAt: number | null }
export interface ImportPreviewItem { index: number; white: string; black: string; date: string | null; detectedColor: Color | null; skippedReason: string | null }
export interface ImportRequest { pgn: string; colors?: (Color | null)[] } // colors[i] overrides detection for game i
export interface ImportResult { inserted: number; duplicates: number; skipped: number }

export type Classification = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';
export type Tag = 'hung_piece' | 'missed_capture' | 'missed_mate' | 'allowed_mate' | 'bad_trade'
  | 'early_queen' | 'slow_development' | 'no_castle' | 'same_piece_twice'
  // Level 2 and 3 tags (M9):
  | 'missed_fork' | 'missed_pin' | 'weak_back_rank' | 'bad_bishop';
export interface LiveLineDTO { san: string[]; uci: string[]; evalCp: number | null; evalMate: number | null } // from the side to move's view
/** A newer search replaced this one: the client keeps its previous values. */
export interface LiveSupersededDTO { superseded: true }
export interface LiveEvalDTO { fen: string; sideToMove: Color; lines: LiveLineDTO[] }
export interface EngineScore { cp: number | null; mate: number | null } // from side-to-move view; exactly one non-null
export interface MoveAnalysis {
  ply: number; san: string; uci: string; color: Color; fenBefore: string;
  evalBefore: EngineScore; // side to move at fenBefore
  evalAfter: EngineScore;  // side to move at fenAfter (the opponent)
  bestUci: string; bestSan: string; pvSan: string[]; // engine best line from fenBefore, max 8 plies
  winBefore: number; winAfter: number; winLoss: number; // mover's view
  classification: Classification; tags: Tag[]; isUserMove: boolean;
}
export interface KeyMoment { ply: number; reason: Classification | Tag; winLoss: number }
export interface GameAnalysis {
  gameId: number; version: number; status: 'pending' | 'running' | 'done' | 'error'; error: string | null;
  accuracyUser: number | null; accuracyOpp: number | null;
  counts: { blunder: number; mistake: number; inaccuracy: number }; // user's moves only
  moves: MoveAnalysis[]; keyMoments: KeyMoment[]; analysedAt: number | null;
}
// GameSummary gains (optional, filled by listGames when analysed):
export interface AnalysisBadge { accuracyUser: number | null; blunders: number; mistakes: number; status: GameAnalysis['status'] }

// M3: spaced-repetition cards
export type CardKind = 'opening' | 'mistake' | 'lesson';
export type Rating = 'again' | 'hard' | 'good' | 'easy';
export interface CardRef { gameId?: number; ply?: number; repertoire?: string; nodeId?: string; lessonId?: string; exerciseId?: string; source?: 'chat' }
export interface Card {
  id: number; kind: CardKind; positionKey: string; fen: string; sideToMove: Color;
  prompt: string; solution: { accepted: string[]; best: string; explanation: string | null };
  refs: CardRef[]; suspended: boolean; createdAt: number;
  lastMove?: { uci: string } | null; // opponent's move leading to fen, for animation (openings)
}
// M8a: coach chat
export interface ChatLineDTO { id: string; label: string; san: string[]; uci: string[]; startFen: string; winPctForUser: number; why: string }
export interface ChatMessageDTO {
  id: number; turn: number; question: string;
  anchor: { ply: number; path: string[]; describe: string };
  status: 'pending' | 'done' | 'error'; error: string | null;
  deep: boolean; parentId: number | null; deeperAvailable: boolean;
  answer: { text: string; lines: ChatLineDTO[]; rule: string; lessonId: LessonId | null } | null;
  provider: ProviderId | null; model: string | null; createdAt: number;
}
export interface CardWithState extends Card { due: number | null; isNew: boolean; repertoireName?: string }
export interface ReviewSubmit { rating: Rating; answerUci: string | null; durationMs: number }
export interface OpeningMoveCheck { playedSan: string; repertoireSan: string; repertoireName: string; loss: number }
export interface ReviewResult { cardId: number; nextDue: number }
export interface ReviewSession { cards: CardWithState[]; dueCount: number; newAvailable: number }
export interface CardFlag { id: number; cardId: number; note: string; createdAt: number }
export interface FlagDetail { id: number; cardId: number; kind: string; fen: string; prompt: string; note: string; createdAt: number }
export interface DataInfo { dbPath: string; games: number; duplicateGames: number; cards: number; backupsDir: string | null }

export interface RepNodeDTO {
  id: string; san: string; uci: string; comment: string | null; tags: string[];
  level: 1 | 2 | 3; ply: number; mover: Color; fenAfter: string;
  locked: boolean; // level is above the user's current level
  children: RepNodeDTO[];
}
export interface OpeningSummary {
  id: string; name: string; color: Color; nodeCount: number; cardCount: number;
  stats: { games: number; win: number; draw: number; loss: number };
  /** The variations of the guide of this repertoire, or null when it has no guide. */
  variationIndex: GuideIndexEntry[] | null;
}
export interface OpeningDetail { id: string; name: string; color: Color; level: 1 | 2 | 3; roots: RepNodeDTO[] }
export interface OpeningLeakGroup { nodeId: string; expectedSan: string; playedSan: string; count: number; gameIds: number[] }

// M6: course
export interface Exercise { id: string; fen: string; prompt: string; solution: string[]; explanation: string }
export interface Lesson {
  id: string; order: number; level: 1 | 2 | 3; title: string; summary: string; tags: Tag[];
  body: string; exercises: Exercise[]; links: { title: string; url: string }[];
}
export type LessonStatus = 'new' | 'done' | 'locked';
export interface CourseLesson { id: string; order: number; level: 1 | 2 | 3; title: string; summary: string; status: LessonStatus; exercises: number }
export type CourseLessonDetail = Lesson & { status: LessonStatus };

// M7: insights
export type InsightsWindow = '30d' | '90d' | '365d' | 'all';
export interface Insights {
  byOpening: { group: string; color: Color; games: number; win: number; draw: number; loss: number; avgAccuracy: number | null }[];
  tagsByMonth: { month: string; tag: Tag; perGame: number }[];
  accuracyByMonth: { month: string; avg: number; games: number }[];
  rating: { series: string; points: { t: number; elo: number }[] }[];
  summary: { games: number; analysed: number; winRate: number | null };
}

// M10: opening guides (content files in content/guides/). Paragraphs in text fields are separated by "\n\n".
export interface GuideJob { square: string; text: string }
export interface GuideVariation {
  key: string; name: string;
  /** Repertoire node ids; a node belongs to the variation whose root is its longest prefix. */
  roots: string[];
  finalForm: { nodeId: string; jobs: GuideJob[] };
  /** Own-side moves on the final-form line, in order. */
  route: { nodeId: string; why: string }[];
  /** nodeId is an opponent move; showNodeId is a deeper node that shows the plan. */
  deviations: { nodeId: string; plan: string; showNodeId?: string }[];
  middlegame: string;
  /**
   * moves: SAN list from the start; it may leave the repertoire tree.
   * bad: SAN of the move to avoid; good: SAN of 1 to 3 moves to play. Both are legal after `moves`, and they come as a pair.
   */
  mistakes: { moves: string[]; text: string; bad?: string; good?: string[] }[];
}
export interface GuideFile { repertoireId: string; why: string; variations: GuideVariation[] }

// M10: guide API (GET /api/openings/:id/guide). Node ids are resolved to moves, positions and levels.
export interface VariationPersonal {
  games: number; win: number; draw: number; loss: number;
  /** gameIds holds the latest games only (at most 5); moreGames counts the others. */
  leaks: { nodeId: string; expectedSan: string; playedSan: string; count: number; gameIds: number[]; moreGames: number }[];
  /** nodeId is the last book node before the opponent left the book. */
  opponentMoves: { nodeId: string; playedSan: string; count: number; gameIds: number[]; moreGames: number }[];
  /** Key moments of the 5 latest games at most, oldest game first. */
  mistakes: { gameId: number; ply: number; san: string; reason: string }[];
}
/** Light view of a guide variation for "Plan" links: node ids map to a variation by longest root prefix. */
export interface GuideIndexEntry { key: string; roots: string[] }
export interface GuideVariationDTO {
  key: string; name: string; roots: string[];
  finalForm: { nodeId: string; moves: string[]; fen: string; jobs: GuideJob[]; level: 1 | 2 | 3 };
  route: { nodeId: string; san: string; why: string; level: 1 | 2 | 3 }[];
  /** showMoves: SAN list from the start to the deeper node that shows the plan. */
  deviations: { nodeId: string; san: string; plan: string; showMoves?: string[]; level: 1 | 2 | 3 }[];
  middlegame: string;
  mistakes: { moves: string[]; fen: string; text: string; bad?: GuideMove; good?: GuideMove[] }[];
  locked: boolean; requiredLevel: 1 | 2 | 3;
  personal: VariationPersonal | null;
}
/** A move resolved on the server: SAN plus the squares to draw an arrow. */
export interface GuideMove { san: string; from: string; to: string }
export interface GuideDTO {
  repertoireId: string; name: string; color: Color; level: 1 | 2 | 3; why: string; variations: GuideVariationDTO[];
}
