# M12a Middlegame Plans Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (the owner said: no subagents for the implementation). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Plans" section: six validated level-1 middlegame plans, a Plans page, and a "find the plan move" card kind in the daily review.

**Architecture:** Plans are authored JSON in `content/plans/`, loaded and validated like guides (`server/plans/`). One trigger format drives the "When" list and the validator. Boards are SAN move lists from the start position. Cards of kind `plan` are created by "Train this plan" and use the existing FSRS session with a new quota. The web adds two pages and a choice quiz on the review page.

**Tech Stack:** TypeScript, Hono, node:sqlite, chess.js, Stockfish (pool), React 19, react-chessboard, vitest, zod is NOT used for content (hand-written shape checks, as guides).

**Spec:** `docs/superpowers/specs/2026-10-29-middlegame-plans-design.md` (M12a scope only: §2–§6, §10 M12a row, §11). The owner accepted all five default answers in §13.

## Global Constraints

- The AI never invents moves, lines or evaluations. Every plan move is checked with chess.js; every evaluation word with Stockfish 1M nodes after `ucinewgame`.
- Content passes `pnpm validate:content`. Tests never hit the network or need Stockfish (fake engine); one engine test is skipped when Stockfish is missing.
- Plan texts: short plain sentences, no "engine line", no "%", never "the best plan" (use "a good plan"). Every claim about a square, piece or line is verified.
- Own moves in boards, models and mistake `good`: lose < 15 win %. Accepted quiz moves: lose < 10 (hard), warn from 5. Wrong quiz choices: lose ≥ 10 (`ambiguous-choice`).
- Counts: steps 3–5, jobs 3–6, breaks 0–3, opponent 1–3, notNow 1–3, mistakes 1–4, models 0–2, exercises 3–6, choices 2–4.
- New-card mix (quota order mistake → lesson → plan → opening): L1 .4/.3/.1/.2, L2 .35/.25/.1/.3, L3 .3/.15/.15/.4.
- Never touch `data/chess.db`. Smoke runs use `pnpm smoke:start` / `pnpm smoke:stop <pid>`. Back up before merge: `data/backups/pre-m12a-2026-10-29.db` (migration 016).
- Gates before a task counts as done: `pnpm typecheck && pnpm lint && pnpm test`. Content tasks also `pnpm validate:content`.
- Branch: `m12a-middlegame-plans`. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

Failure modes the spec implies but no task would test by itself (each has a test in the owning task):

1. A plan file with a bad shape or unknown id must be skipped with a log line, not crash the server (Task 3).
2. A trigger that matches the `position` board but not an exercise board, or matches both colours' positions wrongly (Task 2, Task 4).
3. "Train this plan" pressed twice, or for a locked plan (Task 7, Task 8).
4. A plan card whose plan file changed or was removed: cards are suspended, FSRS state kept (Task 7).
5. A free board move that is not one of the arrows, and an engine that is down (503) on a plan card (Task 8, Task 10).

## File Structure

| File | Responsibility |
|------|----------------|
| `shared/plans.ts` | Types `PlanFile`, `PlanBoard`, `Trigger`, DTOs `PlanIndexEntry`, `PlanDTO`. Re-exported from `shared/types.ts`. |
| `server/plans/trigger.ts` | `matchTrigger`, `triggerLabels` |
| `server/plans/board.ts` | `replayBoard`: SAN list → FEN and checked moves |
| `server/plans/load.ts` | Shape checks, `loadPlan`, `listPlanFiles`, `loadPlans` |
| `server/plans/validate.ts` | `validatePlan` (chess rules + engine rules) |
| `server/content/bad-good.ts` | Shared `checkBadGood` (moved out of `server/guides/validate.ts`) |
| `server/plans/plan-cards.ts` | `trainPlan`, `syncPlanCards`, `plannedIds` |
| `server/db/migrations/016_plan_progress.sql` | `plan_progress` table |
| `server/routes/plans.ts` | `GET /plans`, `GET /plans/:id`, `POST /plans/:id/train` |
| `scripts/plan-probe.ts` | Prints FEN and MultiPV evaluations for a move list (authoring aid) |
| `web/src/pages/PlansPage.tsx`, `PlanPage.tsx` | List and article |
| `web/src/components/plan/PlanBoard.tsx` | Board with arrows and marks |
| `content/plans/*.json` | The six plans |

---

### Task 1: Types and shared bad/good check

**Files:**
- Create: `shared/plans.ts`, `server/content/bad-good.ts`, `server/content/bad-good.test.ts`
- Modify: `shared/types.ts` (re-export), `server/guides/validate.ts` (use the shared function)

**Interfaces:**
- Produces: all types of spec §4.2 verbatim in `shared/plans.ts` (`PlanFile`, `PlanBoard`, `PlanStep`, `PlanMistake`, `PlanModel`, `PlanExercise`, `Trigger`, `Condition`). `Arrow = { from: string; to: string; kind: 'move' | 'attack' | 'route' }`.
- Produces: `checkBadGood(game: Chess, m: { moves: string[]; bad?: string; good?: string[] }, report: (rule: string, detail: string) => void, where: string): { san: string; uci: string; fenAfter: string }[]` — runs the existing rules (`bad-good-pair`, `good-count` ≤ `MAX_GOOD` 3, `illegal-bad`, `illegal-good`, `duplicate-good`, `bad-in-good`) and returns the legal good moves. `game` stands after the mistake line.

- [ ] **Step 1: Write `bad-good.test.ts`** with one test per rule (name = rule), e.g. `bad-in-good`: game after `e4 e5`, `{bad:'Nf3', good:['Nf3']}` reports `bad-in-good`; and `returns legal good moves`: good `['Nf3','Nc3']` returns two entries with `uci` `g1f3`, `b1c3`.
- [ ] **Step 2: Run** `pnpm vitest run server/content/bad-good.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** `checkBadGood` by moving the body of `checkBadGood` from `server/guides/validate.ts:149-182` (closure → parameters). Export `MAX_GOOD` from the new file and re-export it from `server/guides/validate.ts`.
- [ ] **Step 4: Update `validateGuide`** to call the shared function and push the returned moves into `goodMoves` with `key: \`${v.key}: ${line}\``. Add `shared/plans.ts` types and the re-export.
- [ ] **Step 5: Run** `pnpm vitest run server/content server/guides && pnpm typecheck` → all PASS (the existing guide tests prove no behaviour change).
- [ ] **Step 6: Commit** `refactor: share the bad/good mistake check; add plan types`.

### Task 2: Trigger engine

**Files:** Create `server/plans/trigger.ts`, `server/plans/trigger.test.ts`.

**Interfaces:**
- Produces: `matchTrigger(fen: string, side: 'white' | 'black', t: Trigger): boolean` — `own` = `side`, `opp` = the other colour. `all` must all hold; no `none` may hold.
- Produces: `triggerLabels(t: Trigger): string[]` — one English label per condition of `all` ("Their king is on g8 or h8."), `none` conditions labelled "Not: …".

Condition semantics (spec §4.3): `piece` — a piece of that type and side on one of `on`; `pawns` — a pawn on every square; `noPawn` — no pawn of that side on the file; `castled` — king on f–h file (short) or a–c file (long) of its own back rank; `queensOn` — both queens on the board; `minPieces` — each side has at least `count` rooks and minor pieces.

- [ ] **Step 1: Write tests.** For each of the six condition types one positive and one negative FEN. Plus: `side: 'black'` swaps own/opp; `none` blocks a match; labels: `piece` K opp on `['g8','h8']` → `"Their king is on g8 or h8."`, `pawns` own `['c3','d4','e3']` → `"You have pawns on c3, d4 and e3."`, `noPawn` own `h` → `"You have no h-pawn."`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** with chess.js `board()`. **Step 4: Run** → PASS. **Step 5: Commit** `feat(plans): trigger conditions`.

### Task 3: Board replay and loader

**Files:** Create `server/plans/board.ts`, `server/plans/load.ts`, `server/plans/load.test.ts`, fixtures in `content/plans/__test__/` (`sample.json` valid, plus one small invalid file per test under the same folder).

**Interfaces:**
- Produces: `replayBoard(moves: string[]): { fen: string; sans: string[]; lastMove: { from: string; to: string } | null } | null` — null on an illegal SAN. `fromNode` is handled by the validator, not here.
- Produces: `class PlanError extends Error { file: string }`; `loadPlan(json: unknown, reps: Repertoire[], lessonIds: readonly string[]): PlanFile`; `listPlanFiles(dir = 'content/plans'): string[]` (top-level `*.json` only); `loadPlans(dir?, reps?, onError?): PlanFile[]` (skips and reports a bad file, as `loadGuides`).
- Shape errors (all `PlanError`): wrong types, counts from Global Constraints, `id` ≠ file name is NOT checked here (loader sees no file name) but `loadPlans` checks it, `trigger: null` only when `group === 'general'`, unknown lesson id, unknown `guideLinks` repertoire id.

- [ ] **Step 1: Tests:** valid sample loads; each count limit (steps 2 and 6, choices 1 and 5, exercises 2 and 7) throws `PlanError`; `trigger: null` with group `london` throws; unknown lesson id throws; `loadPlans` skips a malformed file and calls `onError` once (Review Focus 1); `loadPlans` skips a file whose `id` differs from the file name; `listPlanFiles` ignores `__test__/`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (follow `server/guides/load.ts` helpers `isString`, `isObject`). **Step 4: Run** → PASS. **Step 5: Commit** `feat(plans): loader`.

### Task 4: Validator, chess rules

**Files:** Create `server/plans/validate.ts`, `server/plans/validate.test.ts`.

**Interfaces:**
- Produces: `validatePlan(plan: PlanFile, reps: Repertoire[], engine?: Pick<EnginePool, 'analyse'>, opts?: { nodes?: number }): Promise<ValidationIssue[]>`. `file` of each issue is `${plan.id}.json`. Without `engine` only the rules below run.
- Consumes: `replayBoard`, `matchTrigger`, `checkBadGood`.

Hard-error rules (rule id → condition), from spec §5.2: `illegal-san` (any board, mistake, model, choice), `bad-from-node` (unknown `fromNode` or moves not starting with its path), `job-square` (no own-side piece on `position` board), `duplicate-job`, `arrow-move` (a `move` arrow is not legal on its board), `arrow-attack` (chess.js `attackers(to, color)` lacks `from`), `arrow-route` (no own piece on `from`), `break-pawn` (no own pawn on `from`) and `break-step` (`to` is not a pawn push or capture square from `from`), `trigger-mismatch` (trigger does not match `position` or an exercise board; `nodeId` names which), `exercise-turn` (not the owner's turn, or `prompt` not starting with `"White to move."`/`"Black to move."`), `accepted-subset`, `unknown-guide-variation` (no `guideLinks` target in the repertoire — reps only know ids, so check that the node `roots` file is not available: skip, covered by the real-content test in Task 11), `engine-line-text`, `percent-text`, `the-best-plan-text` (regex `/\bthe (best|only) plan\b/i`). Also `duplicate-exercise`.

- [ ] **Step 1: Tests** (one per rule, using small inline plans built by a helper `makePlan(overrides)` that starts from the valid sample): positive plan → `[]`; each rule above; arrow tests use the start position and `e2e4` (legal), `e2e5` (not), a bishop attack, an empty `route` square.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** Boards for jobs/arrows/breaks are the `position` board; each `PlanStep.board`, `opponent[].board`, mistake line, model line and exercise board is replayed. **Step 4: Run** → PASS. **Step 5: Commit** `feat(plans): chess-rule validator`.

### Task 5: Validator, engine rules

**Files:** Modify `server/plans/validate.ts`, `server/plans/validate.test.ts`.

Engine rules (spec §5.3), with a fake engine `{ analyse }` returning scripted `EngineLine[]` per FEN (as `server/guides/validate.test.ts`): own move in a `PlanBoard`, model, or mistake `good` loses ≥ 15 → `engine-loss`; opponent move in a `plan` model loses ≥ 15 → `engine-loss-opp` (not for `trap`); an accepted exercise move loses ≥ 10 → `accepted-loss`, 5–10 → warning `weak-alternative`; a wrong choice (in `choices`, not `accepted`) loses < 10 vs the best → `ambiguous-choice`; a legal move outside `choices` within 5 of the best → warning `missed-good-move`. Loss = `winPct(best.score) - moverWinAfter(after[0].score)` as in `guides/validate.ts`; every search passes `newGame: true`; cache by FEN. `missed-good-move` needs a MultiPV 4 search at the exercise board (`multipv: 4`).

- [ ] **Step 1: Tests** for each rule, one pass case and one fail case; plus `trap` model opponent blunder is allowed. **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `feat(plans): engine-rule validator`.

### Task 6: Scripts and sequence check

**Files:** Modify `scripts/validate-content.ts`, `scripts/validate-args.ts`, `package.json`, `server/content/sequences.ts`, `server/content/sequences.test.ts`, `scripts/validate-args.test.ts` (create if absent). Create `scripts/plan-probe.ts`.

**Interfaces:**
- `ValidateArgs` gains `plans: boolean`. `--plans` validates only plans. No flag = lessons + repertoires + plans. A file with a `steps` key is a plan file (`isPlanFile`).
- `ContentSources` gains `plans: { file: string; plan: PlanFile }[]`; `SequenceScope` gains `plans: boolean` in the non-file variant; `sequenceIssues` scans: `goal`, `summary`, each step text, job text, break text, opponent text, notNow, mistake text (starts: board after the line and before its last move), model comments (start: the board at that ply), exercise `explanation` and each choice `why` (start: exercise board). Starts for the other texts: the `position` board and the step's own board.
- `package.json`: `"validate:plans": "tsx scripts/validate-content.ts --plans"`.
- `scripts/plan-probe.ts <san...>`: replays the moves, prints the FEN and a MultiPV 4 search at 1M nodes (`ucinewgame` first) as `move  score  win%`. Used to author content; exempt from tests.

- [ ] **Step 1: Tests:** `parseValidateArgs(['--plans'])` → `{plans:true, lessons:false, repertoires:false, file:null}`; default includes plans; a sequence-check test with a fixture plan whose `goal` names an illegal line gives one `illegal-sequence` error and a legal line none.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (plans also in `countSequenceSentences`). **Step 4: Run** `pnpm test && pnpm validate:content` → PASS (no real plans yet: the plans folder is absent, the loader returns `[]`). **Step 5: Commit** `feat(plans): validate and sequence scripts`.

### Task 7: Migration, plan cards, session mix

**Files:** Create `server/db/migrations/016_plan_progress.sql`, `server/plans/plan-cards.ts`, `server/plans/plan-cards.test.ts`. Modify `shared/types.ts` (`CardKind` + `'plan'`; `CardRef.planId?`; `Card.solution` gains `choices?: { uci: string; san: string; why: string }[]`), `server/srs/session.ts`, `server/srs/session.test.ts`, `server/srs/stats.ts`, `server/main.ts`.

**Interfaces:**
- SQL: `CREATE TABLE plan_progress (plan_id TEXT PRIMARY KEY, started_at INTEGER NOT NULL);`
- `plannedIds(db: DatabaseSync): Set<string>`.
- `trainPlan(db: DatabaseSync, plan: PlanFile, now: number): { created: number }` — inserts `plan_progress` (first time kept), one `plan` card per exercise: `positionKey(fen)`, `fen` of the exercise board, `sideToMove`, `prompt`, `solution: { accepted: UCI[], best: UCI of accepted[0], explanation, choices }`, `refs: [{ planId, exerciseId }]`, `lastMove` from `replayBoard`, `sortOrder = plan index × 100 + i` where plan index is the file order given by `loadPlans` (pass `order: number` as a fourth parameter). `mergeRefs: false`.
- `syncPlanCards(db, plans: PlanFile[]): void` — for every started plan, upsert its cards and suspend orphans (as `suspendOrphans` in `server/course/lesson-cards.ts`); a started plan whose file is gone has its cards suspended (Review Focus 4).
- Session: `NEW_MIX` becomes `Record<Level, Record<CardKind, number>>` with the Global Constraints values; `QUOTA_ORDER = ['mistake','lesson','plan','opening']`; `KIND_ORDER = ['mistake','opening','lesson','plan']`; `SessionLimits.planLevels?: ReadonlyMap<string, number>`; a `plan` card whose plan level > level is hidden (same `hidden()` as lessons); `sessionLimits(db, lessons, plans: readonly PlanFile[] = [])`. Update every caller that has plans (`tsc` lists them; callers without plans keep the default).

- [ ] **Step 1: Tests (`plan-cards.test.ts`):** train creates N cards with refs, `choices` and UCI `accepted`; second call creates 0 (Review Focus 3); FSRS state survives `syncPlanCards` after a prompt edit; removing an exercise suspends its card; a missing plan suspends all its cards. **Session tests:** `newQuotas(1, 20)` → `{mistake:8, lesson:6, plan:2, opening:4}`; levels 2 and 3 sum to 20; a plan card above the level is not served; zero plan cards pass the quota on in order lesson → opening. Fix the existing `newQuotas` expectations for the new mix.
- [ ] **Step 2: Run** `pnpm vitest run server/plans server/srs` → FAIL. **Step 3: Implement.** In `server/main.ts` call `syncPlanCards(db, loadPlans())` next to `syncLessonCards`, in its own try/catch. **Step 4: Run** → PASS, plus `pnpm typecheck`. **Step 5: Commit** `feat(plans): plan cards, migration 016, review mix`.

### Task 8: Routes

**Files:** Create `server/routes/plans.ts`, `server/routes/plans.test.ts`. Modify `server/app.ts` (`deps.plans?: PlanFile[]`, `getPlans = () => (plans ??= loadPlans(undefined, getReps(), LESSON_IDS))`, mount `plansRoutes`), `server/routes/review.ts`, `server/routes/review-check.test.ts`.

**Interfaces:**
- `plansRoutes(db, getPlans: () => PlanFile[], getReps, getLessons: () => Lesson[], now: () => number): Hono`.
- `GET /plans` → `PlanIndexEntry[]`: `{ id, title, group, side, level, locked, summary, trained: boolean, exercises: number, fen }` (`fen` of `position` for the small board), in file order.
- `GET /plans/:id` → `PlanDTO`: the plan with every board resolved to `{ fen, moves, lastMove, arrows, marks }`, `triggerLabels`, jobs, breaks (with resolved `from`/`to`), mistakes (`bad`/`good` resolved to `{san, from, to}` as in `guides.ts` `resolveMove`), models, `lessons: { id, title, locked }[]`, `guideLinks: { repertoireId, variation, name }[]` (variation name unknown here: send `variation` only), `locked`, `trained`, and exercises WITHOUT `accepted` or `why` (the answer must not leak): `{ id, fen, prompt, choices: [{label, san, uci}] }`. 404 for an unknown id.
- `POST /plans/:id/train` → `{ created }`; 409 `plan is locked` when `plan.level > level`; idempotent.
- Review check route: allow `card.kind === 'plan'`; `best` is `card.solution.best` (UCI); the response `repertoireName` carries the plan title (find by `refs[].planId`). Opening behaviour unchanged.

- [ ] **Step 1: Tests:** index lists the fixture plan, `locked` for level above current; detail hides `accepted` and `why`; unknown id 404; train twice → `created` N then 0; train on a locked plan → 409; the check route on a plan card with a fake pool returns `{playedSan, repertoireSan, repertoireName: <plan title>, loss}`; the engine throwing → 503 (Review Focus 5); a mistake card still gets 400.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm vitest run server` + `pnpm typecheck` → PASS. **Step 5: Commit** `feat(plans): API routes`.

### Task 9: Links on guides and lessons (server side)

**Files:** Modify `server/routes/guides.ts` (+ test), `server/routes/course.ts` (+ test), `shared/types.ts`, `server/app.ts` (pass `getPlans`).

**Interfaces:** `GuideVariationDTO.plans: { id: string; title: string }[]` — plans whose `guideLinks` has this `repertoireId` and `variation` key. `CourseLessonDetail.relatedPlans: { id: string; title: string }[]` — plans whose `lessons` includes the lesson id. `guidesRoutes` and `courseRoutes` take a new last parameter `getPlans: () => PlanFile[] = () => []` so existing tests keep compiling.

- [ ] **Step 1: Tests:** a fixture plan with `guideLinks: [{repertoireId:'london', variation:'vs-d5'}]` appears in that variation only; a lesson id appears in `relatedPlans`. **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `feat(plans): plan links in guide and course API`.

### Task 10: Web — Plans pages and review quiz

**Files:**
- Create: `web/src/components/plan/PlanBoard.tsx`, `web/src/pages/PlansPage.tsx`, `web/src/pages/PlanPage.tsx` (+ `.test.tsx` for each), `web/src/components/plan/PlanQuiz.tsx` (+ test).
- Modify: `web/src/api.ts` (`getPlans`, `getPlan`, `trainPlan`), `web/src/App.tsx` (nav "Plans" after Openings; routes `/plans`, `/plans/:id`), `web/src/pages/ReviewPage.tsx` (+ test), `web/src/pages/GuidePage.tsx` ("Plans for this set-up" list under the middlegame part), `web/src/pages/LessonPage.tsx` ("Related plans"), `web/src/lib/drill.ts` if the answer check needs it.

**Interfaces:**
- `PlanBoard({ fen, orientation, arrows, marks, lastMove? })`: read-only board; arrows by kind (move blue, attack red, route green `#1a7f37`/`#cf222e`/`#0969da` as `DrillBoard`), marks as square highlights. Reuse `FinalFormBoard` for jobs and `RouteStepper` for the model line (read their props first).
- `PlansPage`: groups "London (White)", "Caro-Kann (Black)", "Both colours"; each entry shows a small board, title, summary, level badge, "unlocks at level N" when locked, "Training" badge when trained.
- `PlanPage`: sections with ids `when`, `goal`, `steps`, `breaks`, `watch`, `mistakes`, `model`, `train`; mistakes show `bad` red and `good` green arrows (M10 look); the Train button is disabled with a reason when locked, calls `trainPlan`, then shows "N cards added".
- `PlanQuiz`: choices A–D as buttons below the board; blue arrows labelled with the letters. Clicking a button or playing a legal move on the board calls `onAnswer(uci)`.
- `ReviewPage`: for `card.kind === 'plan'` it renders `PlanQuiz` instead of the plain board; answer rules from spec §6.2: in `accepted` → "Good." + explanation, rating Good; a choice not in `accepted` → its `why`, accepted move arrow green, rating Again; a board move outside the choices → `api.checkOpeningMove` (the route now accepts plan cards), within 5 win % → "…is also a good move, but this plan plays <SAN>.", rating Hard, else Again; the card shows a "Plan" link to `/plans/<planId>`. Other kinds do not change. Plan cards must not show choice `why` text before the answer (it leaks the answer? `why` of wrong choices does not leak the right one, but keep it hidden until answered).

- [ ] **Step 1: Tests** (React Testing Library, mock `api`, follow `GuidePage.test.tsx`): PlansPage shows three groups and a locked badge; PlanPage shows all anchors and the Train flow incl. disabled state; PlanQuiz: clicking "B" calls `onAnswer` with its uci; ReviewPage with a plan card: accepted choice → "Good.", wrong choice → its `why` and "Plan" link, outside move → mocked check result shows the "also a good move" text, check rejecting → shows the existing "Engine not available" style message and lets the owner continue (Review Focus 5); GuidePage lists plans; LessonPage lists related plans.
- [ ] **Step 2: Run** `pnpm vitest run web` → FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint` → PASS. **Step 5: Commit** `feat(plans): Plans pages, quiz card, links`.

### Task 11: Real-content test

**Files:** Create `server/plans/real-content.test.ts` (follow `server/guides/real-content.test.ts`).

- [ ] **Step 1: Write the test:** every file in `content/plans/` loads with `loadPlans`; `validatePlan(plan, reps)` without engine returns no error; `guideLinks` variation keys exist in the real guides; lesson ids exist; ids are unique; exactly the six MVP ids exist (skip this assertion until Task 14 ends: write it as `it.todo` first, enable in Task 14).
- [ ] **Step 2: Run** → PASS with an empty folder. **Step 3: Commit** `test(plans): real-content test`.

### Task 12: Content — London plans (`london-kingside-attack`, `london-h-file`, `london-e4-break`)

**Files:** Create the three files in `content/plans/`.

Procedure for every content task (spec §9, done by the main session, no subagents):

1. Read `content/guides/london.json`, lessons 8, 12, 20, 21 for the real wording and the validated lines.
2. For each position, run `pnpm tsx scripts/plan-probe.ts <moves>`; write a claim only when chess.js or the probe shows it. Spec Appendix A holds two verified positions (A: London `…Bb7`; B: Caro-Kann Advance `…O-O`). Anything marked "to verify" in spec §2.3 is verified now or left out.
3. Write the JSON. Quiz exercises: at least two wrong choices per exercise that lose ≥ 10 win %, all accepted moves within 10.
4. Run `pnpm validate:plans` and `pnpm check:sequences` until clean.
5. **Review pass:** re-read every sentence against the probe output, square by square; write the ledger to `docs/superpowers/notes/2026-10-29-m12a-plans-review.md` (claim, check, verdict). Fix and re-verify each false or misleading claim.
6. Commit `content: <plan ids>`.

Plan-specific notes:
- `london-kingside-attack` (level 1, white): trigger from spec §2.3 item 1; one exercise from Appendix A position A (accepted Re1, Qe2, Qc2, Ne5; wrong Bxh7+, b4); the `notNow` says Bxh7+ fails while a knight on f6 and the king guard h7.
- `london-h-file` (level 1 unless the check needs castling long → set level 2 and tell the owner in the roadmap): verify the h-file claim with chess.js on `…Bxg3 hxg3`.
- `london-e4-break` (level 1): order Re1, Qe2, e4; mistake "e4 too early" must be a line where `…dxe4` wins a pawn (probe).
- [ ] Steps 1–6 above for each of the three plans (three commits).

### Task 13: Content — `caro-advance-d4` and `opposite-castling-race`

Follow the Task 12 procedure.

- `caro-advance-d4` (level 1, black): exercise from Appendix A position B (accepted `…Nbc6`; wrong `…Qd7`, `…Nd7`, `…Qb6`; mistake `…Qb6` loses the queen after Nxf5 Nxf5 Bxb6). The c-file rook idea ships only if verified.
- `opposite-castling-race` (level 1, trigger: kings on opposite wings; side `white`, `notNow` covers "do not stop halfway"). Exercises come from the five validated lesson-8 positions; re-probe them for this plan's own accepted/wrong sets.
- [ ] Steps 1–6 for each plan (two commits).

### Task 14: Content — `no-clear-plan`, link-up, full gates

**Files:** `content/plans/no-clear-plan.json`; modify the `guideLinks` of the five other plans if a variation key was missing; enable the exact-six-ids assertion in `real-content.test.ts`.

- `no-clear-plan` (group `general`, `trigger: null`, side `white`): the six-step checklist of spec §2.3 item 6; exercises are positions where one piece move is clearly best (search the repertoire lines with the probe; accepted within 10, wrong choices ≥ 10).
- [ ] **Step 1:** write and verify as in Task 12. **Step 2:** `pnpm typecheck && pnpm lint && pnpm test && pnpm validate:content` → all green. **Step 3:** commit `content: no-clear-plan; plans complete`.

### Task 15: Smoke run, docs, merge

- [ ] **Step 1: Smoke:** `pnpm smoke:start` (temp DB, port 8788; remember the pid). With a headless browser or `curl`: `/plans` lists six plans, each `/plans/:id` loads, train one plan → cards appear in `/api/review/session` (new quota 2 per day at the cap of 20), the guide page and a lesson page show their plan links. Then `pnpm smoke:stop <pid>`. Report any failure; do not mark done on a failure.
- [ ] **Step 2: Docs:** `docs/ROADMAP.md`: M12 row → `M12a done`, a log entry (tests count, six plans, review ledger path, rulings, known gaps), "Next session" → M12b. Update the README feature list by one line.
- [ ] **Step 3: Back up** `cp data/chess.db data/backups/pre-m12a-2026-10-29.db` (a read-only copy; never overwrite an existing file).
- [ ] **Step 4:** run the full gates once more, commit `docs: roadmap M12a done`, merge `m12a-middlegame-plans` into `main`, push (roadmap rule 6). Ask the owner before the push if the remote state is unclear.

## Self-review notes

- Spec coverage (M12a row of §10): schema/loader/validator (T1–5), `validate:plans` + sequences (T6), six plans with review (T12–14), pages (T10), guide/lesson links (T9–10), `plan` cards and quiz (T7–8, T10), migration 016 (T7), mix (T7). M12b and M12c items are out of scope.
- Known deferral: the `unknown-guide-variation` check lives in the real-content test, because the plan validator receives no guides.
- Types are consistent across tasks: `PlanFile`, `PlanBoard`, `Trigger`, `replayBoard`, `matchTrigger`, `checkBadGood`, `trainPlan`, `syncPlanCards`, `plannedIds`, `plansRoutes`.
