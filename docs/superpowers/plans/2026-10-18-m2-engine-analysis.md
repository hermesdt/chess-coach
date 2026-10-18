# M2 Engine Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every synced game gets a Stockfish analysis (per-move eval, best move, classification, accuracy, beginner pattern tags, key moments), shown on a review screen with an eval graph.

**Architecture:** A UCI wrapper drives native Stockfish processes; a pool runs positions in parallel. Pure modules turn engine output into win %, classifications, accuracy and tags. An analysis service stores results in two new tables and runs as background jobs (one queue, newest games first). The web game viewer becomes the review screen.

**Tech Stack:** as M1 (Node 26, TS, Hono, node:sqlite, chess.js, React, react-chessboard, Vitest). Native Stockfish 19 at `STOCKFISH_PATH` (default: `stockfish` on PATH; installed at `/opt/homebrew/bin/stockfish`). No new runtime dependencies; the eval graph is plain SVG.

**Spec:** `docs/superpowers/specs/2026-10-18-chess-coach-design.md` (§4, §7 `game_analysis`/`move_analysis`, §8, §12 screen 3, §17.2)

## Global Constraints

- Engine options: `Threads=1`, `Hash=64` per engine; pool size `min(os.availableParallelism() - 2, 8)`, at least 1. Search budget default `nodes=400000` (setting key `engine_nodes`, env `ENGINE_NODES`).
- Win % from the mover's view: `win = 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1)`; mate for the mover → 100, mate against → 0. `cp` clamped to ±1000 before the formula.
- Classification by win % lost by the mover (`loss = winBefore - winAfter`, both from the mover's view): `>= 30` blunder, `>= 20` mistake, `>= 10` inaccuracy, else `good`; the engine's best move is always `best`. Never a mistake class when `winBefore < 5` or when `winAfter > 95`.
- Move accuracy: `clamp(103.1668 * Math.exp(-0.04354 * loss) - 3.1669, 0, 100)`; game accuracy per side = arithmetic mean of that side's move accuracies (documented choice; spec §15 allows it).
- Tags exactly: `hung_piece`, `missed_capture`, `missed_mate`, `allowed_mate`, `bad_trade`, `early_queen`, `slow_development`, `no_castle`, `same_piece_twice` — definitions in Task 4/5, copied from spec §8.
- Tags and classifications apply only to the user's moves, except `missed_capture`/`missed_mate` key moments come from the user's moves after an opponent blunder (the user failed to punish it).
- Key moments: user blunders and mistakes, plus user moves tagged `missed_capture` or `missed_mate`; deduplicated by ply, ordered by win % lost descending, max 6.
- `ANALYSIS_VERSION = 1` constant; stored with every analysis.
- Analysis eligibility: `user_color IS NOT NULL` and the user made ≥ 6 moves. After a sync, queue the newest 50 eligible unanalysed games, newest first. One analysis worker job runs at a time; queued requests append to it.
- Reuse M1 infrastructure: multi-statement writes go through `transaction(db, fn)` (SAVEPOINT-based, `server/db/db.ts`); background work goes through `runJob` (`server/jobs.ts`) — jobs interrupted by a restart are marked `error` at startup, so the analysis queue must re-derive pending work from `game_analysis` rows (status `pending`/`running` → re-queue on startup) rather than from job state. Mutating API routes require `Content-Type: application/json` (local-only guard middleware).
- Engine integration tests run only when Stockfish is available (`describe.skipIf(!stockfishAvailable)`); all other tests use fakes.

## Review Focus

1. Games that end in checkmate or stalemate: the final position has no legal moves; do not send it to the engine — score it directly (mate = side to move lost; stalemate = 0 cp) — test in Task 6.
2. Games from a custom start FEN (imported) analyse from `startFen`, not the initial position — test in Task 6.
3. A Stockfish process that crashes or hangs (no `bestmove` within 30 s) rejects that analysis, marks the game analysis `error`, restarts that engine, and the queue continues with the next game — test in Task 2 with a fake engine.
4. Promotions and castling in UCI ↔ SAN conversion (`e7e8q`, `e1g1`) round-trip correctly for best-move display — test in Task 6.
5. Mate scores near the edge (mate in 1 for the mover, being mated) classify correctly: missing a mate-in-1 when winning anyway (winAfter > 95) is not a blunder but is tagged `missed_mate` — test in Task 3/4.

---

## File Structure

```
server/engine/uci.ts              UciEngine: one Stockfish process, UCI protocol
server/engine/uci-parse.ts        parseInfoLine / parseBestMove (pure)
server/engine/pool.ts             EnginePool: N engines, FIFO queue, restart on failure
server/engine/stockfish-path.ts   resolve STOCKFISH_PATH, availability check
server/analysis/winpct.ts         winPct, classification, accuracy (pure)
server/analysis/tags-material.ts  hung_piece, missed_capture, bad_trade, missed_mate, allowed_mate
server/analysis/tags-opening.ts   early_queen, slow_development, no_castle, same_piece_twice
server/analysis/key-moments.ts    selectKeyMoments
server/analysis/analyse-game.ts   analyseGame: engine + pure modules → rows
server/analysis/analysis-repo.ts  save/load analysis rows
server/analysis/queue.ts          analysis queue job (newest first)
server/db/migrations/002_analysis.sql
server/routes/analysis.ts
shared/types.ts                   (+ analysis DTOs, appended)
web/src/components/EvalGraph.tsx, KeyMoments.tsx
web/src/pages/GameViewerPage.tsx  (becomes review screen)
web/src/pages/GamesPage.tsx       (+ accuracy / blunders columns, "Analyse more")
```

## Shared types (append to `shared/types.ts`)

```ts
export type Classification = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';
export type Tag = 'hung_piece' | 'missed_capture' | 'missed_mate' | 'allowed_mate' | 'bad_trade'
  | 'early_queen' | 'slow_development' | 'no_castle' | 'same_piece_twice';
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
```
`GameSummary` gets `analysis?: AnalysisBadge`.

---

### Task 1: UCI parsing + UciEngine  *(model: sonnet)*

**Files:** Create `server/engine/uci-parse.ts`, `server/engine/uci.ts`, `server/engine/stockfish-path.ts`; Test `server/engine/uci-parse.test.ts`, `server/engine/uci.integration.test.ts`

**Interfaces — Produces:**
- `parseInfoLine(line: string): { multipv: number; depth: number; score: EngineScore; pv: string[] } | null` (null for info lines without `score` or `pv`; handles `lowerbound`/`upperbound` by ignoring those lines)
- `parseBestMove(line: string): string | null` (`bestmove (none)` → null)
- `class UciEngine { static start(path: string): Promise<UciEngine>; setOptions(o: Record<string, string | number>): Promise<void>; analyse(fen: string, opts: { nodes: number; multipv?: number; timeoutMs?: number }): Promise<EngineLine[]>; quit(): Promise<void>; readonly alive: boolean }` where `EngineLine = { multipv: number; score: EngineScore; pv: string[] }`, result sorted by `multipv`, taken from the last complete info per multipv before `bestmove`. Uses `isready`/`readyok` handshakes, `ucinewgame` not required per position. Timeout default 30 000 ms → rejects with `EngineTimeoutError` and kills the process.
- `resolveStockfishPath(): string` (env `STOCKFISH_PATH` or `'stockfish'`), `isStockfishAvailable(path?): boolean` (spawnSync `--help`-free check: run with `uci\nquit\n` input, look for `uciok`).

- [ ] Step 1: failing tests — `parseInfoLine('info depth 20 seldepth 28 multipv 1 score cp 34 nodes 1 nps 1 pv e2e4 e7e5')` → `{ multipv: 1, depth: 20, score: { cp: 34, mate: null }, pv: ['e2e4','e7e5'] }`; `score mate -3` → `{ cp: null, mate: -3 }`; `info string ...` → null; `parseBestMove('bestmove e7e8q ponder a1a2')` → `'e7e8q'`. Integration (skipIf): start position at `nodes 50000` returns 1 line whose pv[0] is legal; `multipv: 3` returns 3 lines; mate-in-1 FEN `6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1` → `score.mate === 1`, pv[0] `d1d8`.
- [ ] Step 2: run → FAIL. Step 3: implement. Step 4: tests + typecheck + lint pass. Step 5: commit `feat: uci engine wrapper`.

### Task 2: Engine pool  *(model: sonnet)*

**Files:** Create `server/engine/pool.ts`; Test `server/engine/pool.test.ts`

**Interfaces — Produces:** `interface Engine { analyse: UciEngine['analyse']; quit(): Promise<void>; readonly alive: boolean }`; `class EnginePool { constructor(opts: { size: number; create: () => Promise<Engine> }); analyse(fen: string, opts: { nodes: number; multipv?: number }): Promise<EngineLine[]>; close(): Promise<void> }` — lazy start, FIFO queue, at most `size` concurrent; on a rejected analyse (timeout/crash) the engine is quit and replaced, the error is propagated to that caller only. `defaultPoolSize(): number` per Global Constraints. `getEnginePool(db)` singleton built from settings (`engine_nodes` not needed here).

- [ ] Step 1: failing tests with a fake `create` (controllable promises): never more than `size` concurrent calls; FIFO order; a fake engine that rejects once → caller gets the error, next call uses a new engine (`create` called again), queue continues.
- [ ] Steps 2–5 as usual. Commit `feat: engine pool`.

### Task 3: Win %, classification, accuracy  *(model: haiku — formulas fully specified)*

**Files:** Create `server/analysis/winpct.ts`; Test `server/analysis/winpct.test.ts`

**Interfaces — Produces:** `winPct(score: EngineScore): number` (from side-to-move view; `{mate: 0}` means the side to move is checkmated → 0); `moverWinAfter(evalAfter: EngineScore): number` = `100 - winPct(evalAfter)` (never negate a mate score to change view — `-0` is ambiguous); `flip(score: EngineScore): EngineScore` (negate cp / mate; `{mate: 0}` stays `{mate: 0}` and callers must not flip it); `classify(winBefore: number, winAfter: number, isBest: boolean): Classification`; `moveAccuracy(winLoss: number): number`; `meanAccuracy(values: number[]): number | null`.

- [ ] Step 1: failing tests — `winPct({cp:0,mate:null})` = 50; `winPct({cp:100,...})` ≈ 59.1 (±0.1); `cp 5000` same as `cp 1000`; `{mate:3}` = 100; `{mate:-1}` = 0; `{mate:0}` = 0; `moverWinAfter({cp:null,mate:0})` = 100; `classify(60, 25, false)` = blunder; `classify(60, 39, false)` = mistake; `classify(60, 49, false)` = inaccuracy; `classify(60, 55, false)` = good; `classify(60, 20, true)` = best; `classify(3, 0, false)` = good (already lost); `classify(100, 96, false)` = good (still winning); `moveAccuracy(0)` ≈ 100; `moveAccuracy(100)` = 0; `meanAccuracy([])` = null.
- [ ] Steps 2–5. Commit `feat: win percentage, classification and accuracy`.

### Task 4: Material tags  *(model: sonnet)*

**Files:** Create `server/analysis/tags-material.ts`; Test `server/analysis/tags-material.test.ts` (positions as FEN constants in the test)

**Interfaces — Consumes:** chess.js; `EngineScore`, `EngineLine`. **Produces:** `materialTags(input: MaterialTagInput): Tag[]` where
```ts
interface MaterialTagInput {
  fenBefore: string; playedUci: string;
  bestBefore: EngineLine;          // engine best line at fenBefore (mover to play)
  bestAfter: EngineLine | null;    // engine best line at fenAfter (opponent to play); null if game over
  evalBeforeMover: EngineScore;    // mover's view
  evalAfterMover: EngineScore;     // mover's view (flipped from bestAfter)
}
```
Definitions (cp in mover's view; mate converted to ±10000 for differences). If `playedUci` delivers checkmate (check with chess.js), return `[]`; when `bestAfter` is null for any other reason (stalemate), skip `hung_piece`/`allowed_mate`:
- `hung_piece`: `bestAfter.pv[0]` is a capture of a mover's piece (not a pawn-for-pawn trade: captured piece value ≥ 3) and `cpBefore - cpAfter >= 200`.
- `missed_capture`: `bestBefore.pv[0]` is a capture, `playedUci !== bestBefore.pv[0]`, and `cpBefore - cpAfter >= 200`.
- `bad_trade`: `playedUci` is a capture and `cpBefore - cpAfter >= 150`.
- `missed_mate`: `evalBeforeMover.mate` in 1..3 and `evalAfterMover.mate` is null or ≤ 0.
- `allowed_mate`: `evalAfterMover.mate` in −3..−1 (opponent mates in ≤ 3) and `evalBeforeMover.mate` was not already ≤ 0.

- [ ] Step 1: failing tests — one positive and one negative real position per tag, plus: missing mate-in-1 while +15 still tags `missed_mate`; a knight-for-knight recapture does not tag `hung_piece` or `bad_trade`.
- [ ] Steps 2–5. Commit `feat: material pattern tags`.

### Task 5: Opening-behaviour tags  *(model: sonnet)*

**Files:** Create `server/analysis/tags-opening.ts`; Test `server/analysis/tags-opening.test.ts`

**Interfaces — Produces:** `openingTags(moves: MoveInfo[], userColor: Color): Map<number, Tag[]>` (ply → tags; each tag at most once per game, on the ply where it first becomes true):
- `early_queen`: user moves the queen before their move 6 while ≥ 2 of their minor pieces are on starting squares. Tag that ply.
- `slow_development`: at the user's move 10 (after it), ≥ 2 minor pieces still on starting squares. Tag the user's 10th move.
- `no_castle`: after the user's move 12, the user has not castled and their king is on its start square or the e/d file. Tag the user's 12th move.
- `same_piece_twice`: in the user's first 8 moves, a non-pawn, non-king piece moves again (same piece, tracked by square) when the move is not a capture and does not give check. Tag that ply.
Games shorter than the threshold move simply do not get that tag.

- [ ] Step 1: failing tests from real PGN openings: `1.e4 e5 2.Qh5 Nc6 3.Bc4` as White → `early_queen` at ply 3; a 10-move game with knights still home → `slow_development` at the 10th user move; Scholar-mate defence game where Black castles at move 8 → no `no_castle`; `1.Nf3 d5 2.Ng5` → `same_piece_twice` at ply 3; same for Black side.
- [ ] Steps 2–5. Commit `feat: opening behaviour tags`.

### Task 6: Analysis service, storage, key moments, API  *(model: sonnet)*

**Files:** Create `server/db/migrations/002_analysis.sql`, `server/analysis/analysis-repo.ts`, `server/analysis/key-moments.ts`, `server/analysis/analyse-game.ts`, `server/analysis/queue.ts`, `server/routes/analysis.ts`; Modify `shared/types.ts` (append contract above), `server/db/games-repo.ts` (`listGames` fills `analysis` badge via LEFT JOIN), `server/sync/sync-service.ts` (enqueue after sync), `server/app.ts` (`AppDeps` gains `pool?: EnginePool`); Test `server/analysis/analyse-game.test.ts`, `server/analysis/key-moments.test.ts`, `server/routes/analysis.test.ts`

**Interfaces — Produces:**
- Tables: `game_analysis(game_id PK FK, version, status, error, accuracy_user, accuracy_opp, counts_json, analysed_at)`, `move_analysis(game_id FK, ply, data_json, PRIMARY KEY(game_id, ply))` (one JSON blob per `MoveAnalysis` keeps the schema simple).
- `selectKeyMoments(moves: MoveAnalysis[]): KeyMoment[]` per Global Constraints.
- `analyseGame(game: GameDetail, pool: Pick<EnginePool, 'analyse'>, opts: { nodes: number }): Promise<Omit<GameAnalysis, 'status' | 'error'>>` — analyses every position from `startFen` through the final position (final position not sent to the engine when checkmate/stalemate), all positions in parallel through the pool, `multipv: 1`; builds `MoveAnalysis[]` with `pvSan` converted via chess.js; applies tags only to user moves.
- `saveAnalysis(db, a: GameAnalysis)`, `getAnalysis(db, gameId): GameAnalysis | null`, `markAnalysis(db, gameId, status, error?)`.
- `enqueueAnalysis(db, gameIds: number[]): Job` — one `analysis` job processes its queue sequentially, newest first; ids already queued or analysed at `ANALYSIS_VERSION` are skipped; errors on one game are recorded on that game and the job continues; `message` = `"Analysed N of M"`.
- `eligibleUnanalysed(db, limit: number): number[]`.
- Routes: `GET /api/games/:id/analysis` → `GameAnalysis | { status: 'none' }`; `POST /api/games/:id/analyse` → `{ jobId }` (400 if not eligible, with reason); `POST /api/analysis/queue` body `{ limit?: number }` (default 20) → `{ jobId, queued }`.
- Sync: after a successful `syncAll`, call `enqueueAnalysis(db, eligibleUnanalysed(db, 50))`.

- [ ] Step 1: failing tests with a fake pool returning scripted lines per FEN: a 4-ply game where the user's 2nd move drops a piece → classification `blunder`, tag `hung_piece`, key moment at that ply, `counts.blunder === 1`; a game ending in checkmate does not call the pool for the final FEN and `evalAfter` of the last move is `{ mate: 0 }`-equivalent (mover delivered mate → winAfter 100 for mover); an imported game from a custom FEN analyses from it; `pvSan` for a promotion line shows `e8=Q`; `selectKeyMoments` caps at 6 and sorts by `winLoss`; route returns 400 for a game with `userColor null`; queue continues after one game's analysis throws.
- [ ] Steps 2–5. Commit `feat: game analysis service and API`.

### Task 7: Review screen  *(model: sonnet)*

**Files:** Create `web/src/components/EvalGraph.tsx`, `web/src/components/KeyMoments.tsx`, `web/src/lib/eval.ts`; Modify `web/src/pages/GameViewerPage.tsx`, `web/src/components/MoveList.tsx`, `web/src/pages/GamesPage.tsx`, `web/src/api.ts`; Test `web/src/lib/eval.test.ts`

**Interfaces — Produces:** `whiteWinSeries(moves: MoveAnalysis[]): number[]` (white's win % after each ply, index 0 = start) for the graph; `glyph(c: Classification): '' | '?!' | '?' | '??'`.
- Review screen: if no analysis → "Analyse this game" button (shows job progress, then reloads). With analysis: accuracy for both sides, counts; EvalGraph (SVG 100 % width × 120 px, white area above / black below, click → jump to ply, current ply marker, dots on user blunders/mistakes); MoveList shows glyphs coloured (blunder red, mistake orange, inaccuracy yellow); KeyMoments list (ply, move, reason in plain words from a fixed map, e.g. `hung_piece` → "You left a piece undefended", `missed_capture` → "You missed free material", `bad_trade` → "This capture lost material", `missed_mate` → "You missed a checkmate", `allowed_mate` → "This allowed a checkmate", `early_queen` → "Queen out too early", `slow_development` → "Pieces still at home", `no_castle` → "King still in the centre", `same_piece_twice` → "Same piece moved twice"); clicking a moment jumps to the position before the move and draws the engine best move as a green arrow and the played move as a red arrow.
- Games page: columns Accuracy and `??/?` counts; button "Analyse more" (POST queue, limit 20) with job progress.

- [ ] Step 1: failing tests for `whiteWinSeries` (black-to-move eval flips correctly) and `glyph`.
- [ ] Steps 2–5 (+ `pnpm build`). Commit `feat: game review screen with eval graph and key moments`.

### Task 8: Smoke run and close  *(main session)*

- [ ] `pnpm typecheck && pnpm lint && pnpm test` green (integration tests ran, not skipped).
- [ ] Import one PGN with a known blunder, `POST /api/games/:id/analyse`, poll the job, `GET /api/games/:id/analysis` shows the blunder with a tag and a key moment; time one full game analysis and log it in ROADMAP.
- [ ] Update `docs/ROADMAP.md` (M2 → done), commit.
