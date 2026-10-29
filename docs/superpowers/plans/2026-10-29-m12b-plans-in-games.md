# M12b Part 1 — Plans in the Owner's Games Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Find the first move in each of the owner's games where a plan fits, and show it on the game page, in key moments and in a "Your games" box on the plan page.

**Architecture:** A pure chess.js matcher (`matchGame`) uses the M12a triggers. A small service caches the result in memory, keyed by game id and a hash of the plan content. Two read-only routes and one extra field serve the web pages. No engine, no AI, no migration, no database write.

**Tech Stack:** TypeScript, chess.js, Hono, node:sqlite, React 19, vitest.

**Spec:** `docs/superpowers/specs/2026-10-29-m12b-plans-in-games-design.md` (approved by the owner). Parent: `2026-10-29-middlegame-plans-design.md` §7.

## Global Constraints

- The matcher is pure chess.js. No engine. No AI text.
- Ply window 16 to 60, owner's turn only; at most 2 plans per game; one moment per plan.
- A `london`, `caro-kann` or `slav` plan fits only a game whose opening event has that repertoire id. A `general` plan with a trigger fits every game. A plan with `trigger: null` never matches.
- "Your games" box shows only when `total >= 3`. It lists at most five games ("and N more"). Duplicate games (`duplicate_of IS NOT NULL`) are excluded.
- Tests never hit the network and never read `data/chess.db`. Dry runs use a copy made with `sqlite3 data/chess.db ".backup /tmp/x.db"` (a plain `cp` misses the WAL file).
- No migration and no database write, so no backup is needed. State this in the final message.
- Write user-facing text (UI, roadmap, final message) in ASD-STE100 Simplified Technical English.
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Branch `m12b-plans-in-games`. At the end: gates, merge into `main` with `--no-ff`, push (ROADMAP rule 6).

## Review Focus

- A trigger that matches before ply 16 or after ply 60 must not count (Task 1).
- White-only plan in a game where the owner played Black (Task 1).
- Slav game must get no London plan; a game with no opening event gets only `general` plans (Task 1).
- A changed plan file must drop cached results (Task 2).
- Three tied plans: only two are kept, ordered by level then catalogue order (Task 1).
- Duplicate games and games without a user colour are not counted (Task 2).
- A key moment 21 plies after the plan moment gets no link (Task 4).

## File map

- Modify `shared/plans.ts`: `PlanMoment`, `GamePlanDTO`, `PlanGamesDTO`; `PlanIndexEntry.gameCount`.
- Create `server/plans/match.ts` (+ test), `server/plans/game-plans.ts` (+ test).
- Modify `server/routes/games.ts`, `server/routes/plans.ts`, `server/app.ts` (+ route tests).
- Modify `web/src/api.ts`, `web/src/pages/GameViewerPage.tsx`, `web/src/components/KeyMoments.tsx`, `web/src/pages/PlanPage.tsx` (+ tests).
- Docs: `docs/ROADMAP.md`, `README.md`.

---

### Task 1: Matcher

**Files:**
- Modify: `shared/plans.ts` (add `PlanMoment { planId: string; ply: number }`)
- Create: `server/plans/match.ts`
- Test: `server/plans/match.test.ts`

**Interfaces:**
- Consumes: `matchTrigger(fen, side, trigger)` from `server/plans/trigger.ts`; `parsePgn` from `server/chess/pgn.ts`; `PlanFile`.
- Produces:
  ```ts
  export const PLAN_FROM_PLY = 16; export const PLAN_TO_PLY = 60; export const MAX_PLANS_PER_GAME = 2;
  export interface MatchGame { pgn: string; userColor: Color | null; repertoireId: string | null }
  export function matchGame(game: MatchGame, plans: readonly PlanFile[]): PlanMoment[]
  ```
  `ply` is the ply after which the position fits (the owner is to move next). Result is ordered by plan level, then by the index in `plans`, and holds at most 2 moments.

- [ ] **Step 1: Write the failing tests** (`match.test.ts`). Build small plan objects with a helper `plan(over)` that fills a `PlanFile` cast with `id`, `group`, `side`, `level`, `trigger`. Use a 40-ply PGN built from SAN moves in the test. Cases:
  - `a trigger that holds from ply 16 gives that ply`: trigger `pawns own e4` fits after White's e4; game where White plays `e4` on move 10, so the first owner's-turn position with the pawn is after Black's reply. Assert the exact ply.
  - `ply window`: a trigger true from ply 6 is reported at ply 16 or later (first owner turn at ply ≥ 16), never earlier; a trigger true only after ply 62 gives no moment.
  - `colour`: a `side: 'white'` plan gives nothing in a game where `userColor` is `'black'`.
  - `no user colour`: `userColor: null` gives `[]`.
  - `repertoire filter`: a `group: 'london'` plan fits `repertoireId: 'london'`, not `'slav'` and not `null`; a `group: 'general'` plan with a trigger fits `null`.
  - `no trigger`: a plan with `trigger: null` never matches.
  - `one moment per plan`: the trigger holds at many plies; only the first is returned.
  - `at most two, by level then order`: three matching plans with levels 2, 1, 1 (in that file order) give the two level-1 plans in file order.
- [ ] **Step 2: Run** `pnpm vitest run server/plans/match.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement `matchGame`.** Replay with chess.js from `parsePgn(...).startFen`. After each ply in `[16, 60]` where `chess.turn()` equals the owner's colour, test every still-open eligible plan with `matchTrigger(chess.fen(), plan.side, plan.trigger)`. Stop early when all eligible plans have a moment. Skip plans by the Global Constraints rules. A PGN that does not parse gives `[]` (catch `PgnError`).
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(plans): matcher for plan moments in games`. Add the spec and this plan file to this commit.

---

### Task 2: Cached service and plan-games stats

**Files:**
- Modify: `shared/plans.ts` (add `GamePlanDTO { planId: string; title: string; ply: number }`, `PlanGamesDTO`, `PlanIndexEntry.gameCount: number`)
- Create: `server/plans/game-plans.ts`
- Test: `server/plans/game-plans.test.ts`

**Interfaces:**
- Consumes: `matchGame` (Task 1); `getGameRow` from `server/db/games-repo.ts`; table `opening_events (game_id, repertoire_id, kind)`; table `games (id, user_color, result, white, black, played_at, duplicate_of)`.
- Produces:
  ```ts
  export function plansHash(plans: readonly PlanFile[]): string          // sha1 of JSON of id + group + side + level + trigger for each plan
  export function gamePlans(db: DatabaseSync, gameId: number, plans: readonly PlanFile[]): GamePlanDTO[]
  export function planGames(db: DatabaseSync, plans: readonly PlanFile[], planId: string): PlanGamesDTO | null   // null for an unknown id
  export function planGameCounts(db: DatabaseSync, plans: readonly PlanFile[]): Map<string, number>
  export function clearPlanMatchCache(): void
  ```
  `PlanGamesDTO = { total, wins, draws, losses, games: { id, ply, result, white, black, playedAt }[] }`. `games` holds the five newest games (by `played_at`, then id, descending). The repertoire id of a game is `repertoire_id` of its `opening_events` row (null when none). `wins/draws/losses` count the owner's `result`.
  The cache is a module-level `Map` keyed `${gameId}:${plansHash}`.

- [ ] **Step 1: Write the failing tests** (in-memory DB as in `server/routes/games.test.ts`; insert games with `insertGames` and event rows with plain SQL):
  - `plansHash changes when a trigger changes, not when a summary changes`.
  - `gamePlans returns the plan title and ply for a matching game` and `[]` for an unknown game id.
  - `gamePlans does not replay twice` (spy on `parsePgn` via `vi.mock` of `../chess/pgn.js` with a counting wrapper, or count through an exported counter; the test must fail if the cache is removed).
  - `a changed plan hash recomputes`.
  - `planGames counts total, W/D/L and returns five games newest first`: seven matching games give `total` 7 and `games.length` 5.
  - `planGames excludes duplicate games and games of the other colour`.
  - `planGames returns null for an unknown plan id`.
  - `planGameCounts gives the total for each plan with a trigger, 0 for none`.
- [ ] **Step 2: Run** `pnpm vitest run server/plans/game-plans.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the five functions. `planGames` and `planGameCounts` loop over games with `user_color = plan.side AND duplicate_of IS NULL`, call the cached per-game matcher, and keep games whose moments include the plan id.
- [ ] **Step 4: Run** the test and `pnpm typecheck`. Expected: PASS and clean (typecheck errors from `gameCount` in `plans.ts` are fixed in Task 3; add `gameCount: 0` placeholder now if you commit before Task 3).
- [ ] **Step 5: Commit** `feat(plans): cached game matches and plan-games stats`.

---

### Task 3: Routes

**Files:**
- Modify: `server/routes/games.ts` (`gamesRoutes(db, getPlans)`; new `.get('/games/:id/plans')`)
- Modify: `server/routes/plans.ts` (new `.get('/plans/:id/games')`; `gameCount` in the index)
- Modify: `server/app.ts` (`gamesRoutes(deps.db, getPlans)`; `getPlans` is already defined before the route list, move the line up if needed)
- Test: `server/routes/games.test.ts`, `server/routes/plans.test.ts`

**Interfaces:** Consumes Task 2. Produces `GET /api/games/:id/plans → GamePlanDTO[]` (404 for an unknown game), `GET /api/plans/:id/games → PlanGamesDTO` (404 for an unknown plan), and `gameCount` on each `GET /api/plans` entry.

- [ ] **Step 1: Write failing tests:** `GET /games/:id/plans returns the moments`, `404 for a missing game`, `GET /plans/:id/games returns the stats`, `404 for a missing plan`, `GET /plans lists gameCount`. Reuse the fixtures of the existing route tests; give `gamesRoutes` a `() => plans` argument (update existing calls in tests).
- [ ] **Step 2: Run** the two test files. Expected: FAIL.
- [ ] **Step 3: Implement** the routes and the wiring. Remove placeholders from Task 2.
- [ ] **Step 4: Run** the two files, `pnpm typecheck`, `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(plans): routes for plan moments and plan games`.

---

### Task 4: Game page and key moments

**Files:**
- Modify: `web/src/api.ts` (`getGamePlans(gameId): Promise<GamePlanDTO[]>`, `getPlanGames(id): Promise<PlanGamesDTO>`)
- Modify: `web/src/pages/GameViewerPage.tsx`, `web/src/components/KeyMoments.tsx`
- Test: `web/src/components/KeyMoments.test.tsx` (create), `web/src/pages/GameViewerPage.test.tsx` (extend if it exists, else create a focused test)

Behaviour:
- `GameViewerPage` loads `api.getGamePlans(id)` (ignore errors, show nothing). For each plan moment it shows `Middlegame plan: <title> (move N)` above the key moments (also when the game is not analysed). N is `Math.ceil(ply / 2)`. A button "Show the move" calls `setCurrent(mainNode(ply))`. A link "Plan" goes to `/plans/<planId>`.
- `KeyMoments` gets an optional prop `plans?: GamePlanDTO[]`. A key moment with `0 < k.ply - p.ply <= 20` for some plan shows a link `Plan: <title>` to `/plans/<planId>` (first matching plan only).

- [ ] **Step 1: Write failing tests:** `shows the plan box with the move number`, `Show the move selects the ply`, `no box when the game has no plan moment`, `key moment 20 plies after the plan moment shows the link`, `key moment 21 plies after shows no link`, `key moment before the plan moment shows no link`.
- [ ] **Step 2: Run** the web tests. Expected: FAIL.
- [ ] **Step 3: Implement** api calls, page box and `KeyMoments` prop. Reuse the `learn-link` CSS class for the link.
- [ ] **Step 4: Run** the tests, `pnpm typecheck`, `pnpm lint`. Expected: PASS and clean.
- [ ] **Step 5: Commit** `feat(plans): plan moment on the game page and in key moments`.

---

### Task 5: "Your games" box on the plan page

**Files:**
- Modify: `web/src/pages/PlanPage.tsx` (new section `id="games"`, entry in the contents list when shown)
- Test: `web/src/pages/PlanPage.test.tsx` (extend)

Behaviour: load `api.getPlanGames(id)` with the plan (ignore errors). Show the section only when `total >= 3`: `<total> games reach this plan. You won <wins>, drew <draws> and lost <losses>.` then up to five links `<white> - <black>, move N` to `/games/<id>`, and `and <total - 5> more` when `total > 5`. Use the plural helper already in the file.

- [ ] **Step 1: Write failing tests:** `shows the count, W/D/L and five links`, `says "and 2 more" for seven games`, `hidden for two games`, `the contents list links to #games only when shown`.
- [ ] **Step 2: Run** `pnpm vitest run web/src/pages/PlanPage.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the section.
- [ ] **Step 4: Run** the test, `pnpm typecheck`, `pnpm lint`. Expected: PASS and clean.
- [ ] **Step 5: Commit** `feat(plans): your games box on the plan page`.

---

### Task 6: Real-data dry run, docs, gates, merge

**Files:** `docs/ROADMAP.md` (M12 row: "M12a and M12b part 1 done; M12b part 2 and M12c planned"; an "M12b log" with rulings; new "Next session"), `README.md` (one line).

- [ ] **Step 1: Dry run on a copy.** `sqlite3 data/chess.db ".backup /tmp/m12b-copy.db"`. Run `planGameCounts` and `gamePlans` on the copy with a throwaway script placed in `scripts/_m12b-dry.ts` (delete it afterwards; a script in `/tmp` cannot resolve `chess.js`). Expected: about 14 moments in 88 games (repertoire filter lowers the count). Hand-check two games with chess.js: print the FEN at the moment ply and confirm the trigger labels on the board.
- [ ] **Step 2: Gates.** `pnpm typecheck`, `pnpm lint`, `pnpm test`. Read the output. Expected: clean and passing.
- [ ] **Step 3: Smoke.** `pnpm smoke:start`; request `/api/plans` and `/api/games/1/plans` on the temp DB (it holds no games unless imported: import one PGN through `/api/import` first); then `pnpm smoke:stop <pid>`. Look at the game page and a plan page in a browser if a browser tool is available; otherwise say that tests cover the screens.
- [ ] **Step 4: Self-review** of the branch diff against the spec; ledger line `Final review: self-review (no reviewer subagent)`; say it in the final message.
- [ ] **Step 5: Docs** in STE English, with the rulings (3-game minimum, matcher on unanalysed games, repertoire filter, cache) and the open items (Part 2: coach; link to the move from the plan page).
- [ ] **Step 6: Merge.** Commit docs, `git checkout main && git merge --no-ff m12b-plans-in-games`, rerun `pnpm test`, `git push`. No backup: this milestone writes nothing to the database.
