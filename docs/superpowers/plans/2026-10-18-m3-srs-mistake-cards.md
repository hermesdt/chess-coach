# M3 SRS Core + Mistake Cards + Dashboard v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One spaced-repetition review queue. In this milestone it holds mistake cards made from the owner's own analysed games; M4/M6 add opening and lesson cards to the same store. A dashboard shows what to do today.

**Architecture:** Cards live in SQLite with FSRS state (`ts-fsrs`). Card identity = `(kind, position_key)`. After a game analysis is saved, a card builder turns user blunders/mistakes into cards (engine multipv 3 gives the set of accepted answers). The review API serves a session (due first, then new, capped) and records ratings. The web Review page is an interactive board drill.

**Tech Stack:** as M1/M2 + `ts-fsrs` (latest).

**Spec:** `docs/superpowers/specs/2026-10-18-chess-coach-design.md` (§2.4, §4 "Overload", §10, §12 screens 1 and 4, §17.4, §17.5)

## Global Constraints

- Card kinds: `'opening' | 'mistake' | 'lesson'`. `position_key` = first four FEN fields (placement, side, castling, en passant). `UNIQUE(kind, position_key)`.
- Mistake card source: each user move with classification `blunder` or `mistake` in a `done` analysis. Prompt text: `"{Color} to move. You played {san} here in a game. Find a better move."`
- Accepted answers for a mistake card: engine multipv 3 at the position (`nodes` = analysis budget); accept every line whose win % (mover's view) is within 5 of the best line. The played (mistaken) move is never accepted.
- Re-analysis or a repeated position: the existing card keeps its FSRS state; `solution` is replaced; `ref` (list of `{ gameId, ply }`) is merged without duplicates. A card whose every ref is no longer a blunder/mistake is suspended (not deleted).
- Default ratings: wrong answer → `Again`; right answer → `Good`. The user may change the rating with buttons before continuing (keys 1–4).
- Daily session: due cards first (oldest due first, kinds mixed), then new cards; total cap `review_daily_limit` (default 20); new cards per day cap `review_new_per_day` (default 10), counted from `reviews` today (local day of the server).
- "Report a problem" on a card: stores a flag `{ cardId, note, createdAt }` and suspends the card. Flags are listed via API (Settings page shows them in M7).
- Analysis must never wait on card generation: card building runs after `saveAnalysis` inside the analysis job and its failure is logged on the job message, not on the analysis.

## Review Focus

1. A position where the engine finds only one good move: accepted answers = that move only — test in Task 2.
2. Promotion answers: the board UI sends `e7e8q`; accepted answers store UCI with promotion piece; comparison is exact lower-case — test in Task 2 and Task 4.
3. Same mistake position reached in two games → one card with two refs; reviewing it once updates one card — test in Task 2.
4. Day boundary: "new today" counts reviews of cards whose first review was today (server local time) — test in Task 3 with injected `now`.
5. Empty queue: session returns `[]`, page shows "Nothing to review. Play a game, sync, and come back." — test in Task 3 (API) and checked in Task 4.

---

## Shared types (append to `shared/types.ts`)

```ts
export type CardKind = 'opening' | 'mistake' | 'lesson';
export type Rating = 'again' | 'hard' | 'good' | 'easy';
export interface CardRef { gameId?: number; ply?: number; repertoire?: string; nodeId?: string; lessonId?: string; exerciseId?: string }
export interface Card {
  id: number; kind: CardKind; positionKey: string; fen: string; sideToMove: Color;
  prompt: string; solution: { accepted: string[]; best: string; explanation: string | null };
  refs: CardRef[]; suspended: boolean; createdAt: number;
  lastMove?: { uci: string } | null; // opponent's move leading to fen, for animation (openings)
}
export interface CardWithState extends Card { due: number | null; isNew: boolean }
export interface ReviewSubmit { rating: Rating; answerUci: string | null; durationMs: number }
export interface ReviewResult { cardId: number; nextDue: number }
export interface ReviewSession { cards: CardWithState[]; dueCount: number; newAvailable: number }
export interface CardFlag { id: number; cardId: number; note: string; createdAt: number }
```

---

### Task 1: Card store + FSRS scheduler  *(model: sonnet)*

**Files:** Create `server/db/migrations/003_cards.sql`, `server/srs/cards-repo.ts`, `server/srs/scheduler.ts`; Modify `shared/types.ts`; Test `server/srs/cards-repo.test.ts`, `server/srs/scheduler.test.ts`

**Interfaces — Produces:**
- Tables: `cards(id PK, kind, position_key, fen, side_to_move, prompt, solution_json, refs_json, last_move_uci, suspended, created_at, UNIQUE(kind, position_key))`, `card_state(card_id PK FK, fsrs_json, due, last_review)`, `reviews(id PK, card_id FK, rating, answer_uci, duration_ms, reviewed_at)`, `card_flags(id PK, card_id FK, note, created_at)`.
- `upsertCard(db, c: Omit<Card, 'id' | 'createdAt' | 'suspended'>, opts?: { mergeRefs?: boolean }): Card` — insert, or update `solution`/`prompt`/`fen`, merge refs (dedupe by JSON equality), un-suspend only if it was suspended by re-analysis (keep flags' suspension: a card with a flag stays suspended).
- `getCard(db, id)`, `setSuspended(db, id, suspended)`, `listCardsByRef(db, gameId): Card[]`.
- `schedule(prev: string | null, rating: Rating, now: number): { fsrsJson: string; due: number }` (ts-fsrs `fsrs()` default params, `createEmptyCard` when `prev` null).
- `recordReview(db, cardId, submit: ReviewSubmit, now: number): ReviewResult`.
- `addFlag(db, cardId, note, now): CardFlag` (also suspends), `listFlags(db): CardFlag[]`.

- [ ] Step 1: failing tests — upsert same `(kind, positionKey)` twice → one row, refs merged; `schedule(null,'good',t0).due > t0`; `again` due < `good` due; `easy` due > `good` due; `recordReview` writes a `reviews` row and `card_state.due`; flagged card stays suspended after a later upsert.
- [ ] Steps 2–5. Commit `feat: card store and fsrs scheduler`.

### Task 2: Mistake card builder  *(model: sonnet)*

**Files:** Create `server/srs/mistake-cards.ts`; Modify `server/analysis/queue.ts` (call builder after `saveAnalysis`); Test `server/srs/mistake-cards.test.ts`

**Interfaces — Consumes:** `GameAnalysis`, `MoveAnalysis`, `EnginePool.analyse`, `winPct`, `upsertCard`, `listCardsByRef`, `setSuspended`. **Produces:** `buildMistakeCards(db, analysis: GameAnalysis, pool: Pick<EnginePool, 'analyse'>, opts: { nodes: number }): Promise<{ created: number; updated: number; suspended: number }>`; `acceptedMoves(lines: EngineLine[], played: string): string[]` (pure).
- Explanation text (until AI notes exist) = plain sentence from the move's first tag via the same map used on the review screen (move the map to `shared/tag-text.ts` and import it in both places).

- [ ] Step 1: failing tests (fake pool) — blunder with 3 lines at win 80/78/40 → accepted 2 moves; only-move position (80/40/30) → 1 move; played move excluded even if within 5; second game reaching the same position adds a ref, no new card; re-analysis where the move is now `good` suspends the card; promotion answer stored as `e7e8q`.
- [ ] Steps 2–5. Commit `feat: mistake cards from analysed games`.

### Task 3: Review API  *(model: sonnet)*

**Files:** Create `server/srs/session.ts`, `server/routes/review.ts`; Modify `server/app.ts`, `server/routes/settings.ts` + `server/config.ts` (two new numeric settings `reviewDailyLimit` 1–200 default 20, `reviewNewPerDay` 0–100 default 10, added to `SettingsDTO`/`SettingsUpdate`); Test `server/srs/session.test.ts`, `server/routes/review.test.ts`

**Interfaces — Produces:** `buildSession(db, now: number, limits: { daily: number; newPerDay: number }): ReviewSession`; routes `GET /api/review/session` → `ReviewSession`; `POST /api/review/:cardId` body `ReviewSubmit` → `ReviewResult` (404 unknown, 400 bad rating); `POST /api/cards/:id/flag` body `{ note }` → `CardFlag`; `GET /api/cards/flags` → `CardFlag[]`; `GET /api/review/stats` → `{ dueNow: number; dueToday: number; totalCards: number; reviewedToday: number }`.

- [ ] Step 1: failing tests (injected `now`) — 30 due + 15 new with limits 20/10 → 20 due cards, 0 new; 5 due + 15 new → 5 due + 10 new; 3 new already introduced today → only 7 new offered; suspended cards never appear; empty DB → `cards: []`.
- [ ] Steps 2–5. Commit `feat: review session API`.

### Task 4: Review page  *(model: sonnet)*

**Files:** Create `web/src/pages/ReviewPage.tsx`, `web/src/components/DrillBoard.tsx`, `web/src/lib/drill.ts`; Modify `web/src/App.tsx` (route `/review`, nav link "Review" with due badge), `web/src/api.ts`; Test `web/src/lib/drill.test.ts`

**Interfaces — Produces:** `checkAnswer(card: Card, uci: string): { correct: boolean; defaultRating: Rating }`; `DrillBoard` props `{ fen: string; orientation: Color; lastMove?: string | null; onMove(uci: string): void; arrows?: { from: string; to: string; color: 'green' | 'red' }[]; locked: boolean }` — legal moves only (chess.js), promotion auto-queen unless the user picks (react-chessboard promotion dialog), click-click and drag.
- Flow: show prompt → user moves → board locks, shows green arrow for `solution.best` and red for a wrong move, text "Correct" / "Not quite — the best move was {san}", explanation if any → rating buttons (default highlighted; keys 1–4; Enter = default) → next card. Progress bar `n / total`. "Report a problem" link opens a small note input. Finished screen: counts of again/good/easy and "Back to dashboard". Mistake cards show a link "See the game" (`/games/:gameId`).

- [ ] Step 1: failing tests for `checkAnswer` (accepted list, case-insensitive promotion, default rating).
- [ ] Steps 2–5 (+ build). Commit `feat: review page`.

### Task 5: Dashboard v1  *(model: sonnet)*

**Files:** Modify `web/src/pages/DashboardPage.tsx`; Create `server/routes/dashboard.ts` (`GET /api/dashboard` → `{ review: stats; sync: { chesscom: number | null; lichess: number | null }; recentGames: GameSummary[]; topTag: { tag: Tag; count: number; games: number } | null }`, topTag over the last 30 analysed games, user moves only); Test `server/routes/dashboard.test.ts`

- Layout: card "Today": `{dueNow} cards to review` + big "Start review" button (disabled at 0); card "Games": last sync times + "Sync now" (job progress); list of 10 recent games (date, result badge, opening, `??` count, accuracy, link); card "Your focus": top tag in plain words from `shared/tag-text.ts` + count ("in 7 of your last 30 games"); placeholder link text "Lesson coming soon" until M6 maps tags to lessons.

- [ ] Step 1: failing test for `/api/dashboard` topTag counting (tags only from user moves, last 30 analysed games).
- [ ] Steps 2–5 (+ build). Commit `feat: dashboard v1`.

### Task 6: Smoke run and close  *(main session)*

- [ ] Full gate green. Analyse an imported game with a blunder → a mistake card exists → `GET /api/review/session` returns it → POST a `good` review → `stats.dueNow` drops.
- [ ] ROADMAP: M3 → done; commit.
