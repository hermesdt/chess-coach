// M12: middlegame plans (content files and API shapes)

export type PlanGroup = 'london' | 'caro-kann' | 'slav' | 'general';
export type PlanSide = 'white' | 'black';

export interface PlanArrow { from: string; to: string; kind: 'move' | 'attack' | 'route' }

export interface PlanBoard {
  fromNode?: { repertoireId: string; nodeId: string };
  /** SAN from the start position. */
  moves: string[];
  arrows?: PlanArrow[];
  /** Squares to highlight. */
  marks?: string[];
}

export interface PlanStep { text: string; board?: PlanBoard }

export interface PlanMistake { moves: string[]; text: string; bad: string; good: string[] }

export interface PlanModel {
  title: string;
  moves: string[];
  startPly: number;
  kind: 'plan' | 'trap';
  source: 'tree' | 'stockfish';
  comments: { ply: number; text: string }[];
}

export interface PlanExercise {
  id: string;
  /** The owner is to move at the end of `moves`. */
  board: PlanBoard;
  prompt: string;
  /** Shown as arrows A, B, C, D. */
  choices: { san: string; why: string }[];
  /** SAN; a subset of the choice moves. The first is the answer shown. */
  accepted: string[];
  explanation: string;
}

export type Condition =
  | { type: 'piece'; side: 'own' | 'opp'; piece: 'K' | 'Q' | 'R' | 'B' | 'N' | 'P'; on: string[] }
  | { type: 'pawns'; side: 'own' | 'opp'; on: string[] }
  | { type: 'noPawn'; side: 'own' | 'opp'; file: string }
  | { type: 'castled'; side: 'own' | 'opp'; wing: 'short' | 'long' }
  | { type: 'queensOn' }
  | { type: 'minPieces'; count: number };

export interface Trigger { all: Condition[]; none?: Condition[] }

export interface PlanFile {
  id: string;
  title: string;
  group: PlanGroup;
  side: PlanSide;
  level: 1 | 2 | 3;
  summary: string;
  guideLinks: { repertoireId: string; variation: string }[];
  lessons: string[];
  position: PlanBoard;
  trigger: Trigger | null;
  goal: string;
  steps: PlanStep[];
  jobs: { square: string; text: string }[];
  breaks: { from: string; to: string; text: string }[];
  opponent: { text: string; board?: PlanBoard }[];
  notNow: string[];
  mistakes: PlanMistake[];
  models: PlanModel[];
  exercises: PlanExercise[];
}

// --- API shapes ---

export interface PlanIndexEntry {
  id: string; title: string; group: PlanGroup; side: PlanSide; level: 1 | 2 | 3;
  locked: boolean; summary: string; trained: boolean; exercises: number;
  /** The position of the main board, for the small board in the list. */
  fen: string;
}

export interface ResolvedBoard {
  fen: string;
  moves: string[];
  lastMove: { from: string; to: string } | null;
  arrows: PlanArrow[];
  marks: string[];
}

export interface PlanMoveDTO { san: string; from: string; to: string }

export interface PlanDTO {
  id: string; title: string; group: PlanGroup; side: PlanSide; level: 1 | 2 | 3;
  locked: boolean; trained: boolean; summary: string; goal: string;
  position: ResolvedBoard;
  triggerLabels: string[];
  steps: { text: string; board: ResolvedBoard }[];
  jobs: { square: string; text: string }[];
  breaks: { from: string; to: string; text: string }[];
  opponent: { text: string; board: ResolvedBoard | null }[];
  notNow: string[];
  mistakes: { moves: string[]; fen: string; text: string; bad: PlanMoveDTO; good: PlanMoveDTO[] }[];
  models: (Omit<PlanModel, 'comments'> & { comments: { ply: number; text: string }[]; startFen: string })[];
  lessons: { id: string; title: string; locked: boolean }[];
  guideLinks: { repertoireId: string; variation: string }[];
  /** The answer is not in the exercise DTO. Choices are labelled A to D. */
  exercises: { id: string; board: ResolvedBoard; prompt: string; choices: { label: string; san: string; uci: string }[] }[];
}
