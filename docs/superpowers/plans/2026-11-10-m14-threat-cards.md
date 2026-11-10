# M14 Threat Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new review card kind `threat`: from the owner's own games, step 1 "play the opponent's threat", step 2 "play your answer". It replaces the mistake card at the same position.

**Architecture:** A pure finder (`server/srs/threats.ts`) reads stored move analysis and proves candidates with chess.js. A builder (`server/srs/threat-cards.ts`) confirms them with the engine pool and writes cards, as `mate-cards.ts` does. The analysis queue and a one-time start-up job call the builder. The review page gets a step 1 component before the normal board.

**Tech Stack:** TypeScript, node:sqlite, chess.js, Stockfish via `EnginePool`, Hono, React 19, react-chessboard, vitest + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-11-10-m14-threat-cards-design.md` (read it with this plan; section "Builder check answers" holds rulings).

## Global Constraints

- The AI never invents moves. Every move comes from Stockfish (the pool) or chess.js. No AI text on threat cards.
- Tests never hit the network or a real engine. Use a fake `Pick<EnginePool, 'analyse'>` and in-memory `openDb(':memory:')` as `mate-cards.test.ts` does.
- Work in a git worktree at `../chess-m14` on branch `m14-threat-cards` (pattern of `../chess-m10`). Do not check out the branch in the owner's working copy: the owner's `tsx watch` restarts on start-up code changes.
- Never write to `data/chess.db`. Manual runs use `pnpm smoke:start` or a `sqlite3 .backup` copy in a temp dir.
- Step 1 rule: a threat line is within **5** win % of the top line and gains at least **2** pawns (P1 N3 B3 R5 Q9) within **4** plies, counted from the null-move position (the first move counts).
- Engine calls use MultiPV **3** and the owner's `engineNodes` setting.
- Quota: `threat` **0.15** at every level, taken from `mistake` (level 1 mistake 0.20, level 2 0.15, level 3 0.10).
- Default rating: both steps right `good`, one wrong `hard`, both wrong `again`. One try per step.
- Precedence at a ply: mate card > threat card > mistake card.
- User-facing copy is short and plain (ASD-STE100 style): short sentences, active voice.
- Before each commit: `pnpm typecheck && pnpm lint` and the touched tests pass.

## Review Focus

1. **Threat move is a promotion** (`T = 'e2e1q'`): the finder and `confirmThreat` compare full UCI, lowercased → Task 1 test `accepts a promotion capture threat`.
2. **Owner is in check at `fenBefore`**: no null-move position exists → no candidate, no crash → Task 1 test `skips a position where the owner is in check`.
3. **The blunder is the first ply of the game, or the next row is missing (last move)**: no previous or next row → no candidate → Task 1 test `skips the first and the last ply`.
4. **Re-analysis drops a threat**: the threat card is suspended and the mistake card comes back un-suspended → Task 2 test `a dropped threat brings back the mistake card`.
5. **Owner drags an own piece in step 1**: the board must not let it move → Task 5 test `step 1 lets only the opponent's pieces move`.

---

### Task 1: Threat finder (pure, chess.js only)

**Files:**
- Create: `server/srs/threats.ts`
- Test: `server/srs/threats.test.ts`

**Interfaces:**
- Consumes: `MoveAnalysis`, `Color` (`shared/types.ts`); `findMates(fen): Mates | null` (`server/srs/mates.ts`); `PIECE_VALUE`, `playUci` (`server/analysis/tags-material.ts`); `winPct` (`server/analysis/winpct.ts`); `EngineLine` (`server/engine/uci.ts`).
- Produces:
  ```ts
  export function nullMoveFen(fen: string): string | null; // side flipped, en passant '-'; null when the side to move is in check
  export function lineGain(fen: string, line: string[], plies: number): number; // material gain for the side to move at `fen`, start → after `plies` (stops at the first illegal move)
  export interface ThreatCandidate {
    ply: number; color: Color; fenBefore: string; nullFen: string;
    playedUci: string; playedSan: string;
    lastMove: { uci: string; san: string };   // opponent move at ply-1
    replySan: string;                         // opponent move actually played at ply+1
    threat: string;                           // T = next row's bestUci
    kind: 'capture' | 'mate';
    mateMoves: string[];                      // kind 'mate': every findMates move in nullFen; else []
  }
  export function findThreatCandidates(moves: MoveAnalysis[], skipPlies: Set<number>): ThreatCandidate[];
  export function confirmThreat(nullFen: string, threat: string, lines: EngineLine[], threatLine: EngineLine | null): { accepted: string[]; best: string } | null;
  export function threatText(nullFen: string, uci: string, mate: boolean): string;
  ```

Test positions (checked with chess.js):
- `A = '4k3/8/1b6/8/3Q4/8/8/4K3 w - - 0 1'` — owner White; the black bishop on b6 attacks the queen on d4. Owner played `Ke2` (`e1e2`); next row `bestUci: 'b6d4'`. `nullMoveFen(A) === '4k3/8/1b6/8/3Q4/8/8/4K3 b - - 0 1'`.
- `B = '6k1/1p3ppp/8/8/8/8/8/4R1K1 b - - 0 1'` — owner Black; White threatens `Re8#`. Owner played `b6` (`b7b6`); next row `evalBefore: { cp: null, mate: 1 }`, `bestUci: 'e1e8'`.
- `C = '4k3/8/8/8/8/8/4r3/4K3 w - - 0 1'` — owner White in check.

- [ ] **Step 1: Write the failing tests** (`threats.test.ts`, with a `move(over)` row builder like `mate-cards.test.ts`; rows for ply p-1, p, p+1)
  - `nullMoveFen flips the side and clears en passant` → `nullMoveFen(A)` equals the FEN above; `nullMoveFen(C)` is `null`.
  - `lineGain counts the first capture` → `lineGain(nullMoveFen(A)!, ['b6d4'], 4) === 9`; a recapture trade gives `0`.
  - `finds a capture threat` → one candidate `{ ply, kind: 'capture', threat: 'b6d4', playedSan: 'Ke2', lastMove.san, replySan, mateMoves: [] }`.
  - `finds a mate threat` (position B) → `kind: 'mate'`, `mateMoves` contains `'e1e8'`.
  - `prefers mate when a threat is both` → `kind: 'mate'`.
  - `needs a positive opponent mate` → next row `mate: -1` gives no mate candidate.
  - `skips a capture that was not legal before the move` → T not legal in `nullFen` gives no candidate.
  - `skips plies in skipPlies` (mate-card plies).
  - `skips non-mistakes and opponent moves` → classification `good`/`inaccuracy`, or `isUserMove: false`, gives none.
  - `skips a position where the owner is in check` (position C).
  - `skips the first and the last ply`.
  - `accepts a promotion capture threat` → `confirmThreat` with `threat: 'e2e1q'` and a line whose `pv[0]` is `'E2E1Q'` lowercased matches.
  - `confirmThreat keeps lines within 5 win % that gain 2 pawns` → given 3 fake lines for position A's nullFen, returns `{ accepted: ['b6d4'], best: 'b6d4' }`; a line at 6 win % below the top is not accepted.
  - `confirmThreat uses the extra line when T is outside the top 3` → T not in `lines`, `threatLine` within 5 % and gaining → accepted includes T; `threatLine: null` → `null`.
  - `confirmThreat returns null when T fails the rule`.
  - `threatText` → mate: `'Re8# is checkmate.'`; capture: `'Bxd4 takes your queen.'`; capture with check: `'Bxf7+ takes your pawn with check.'`; other: `'Nf5 wins material.'`.

- [ ] **Step 2: Run** `pnpm vitest run server/srs/threats.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `server/srs/threats.ts`.**
  Candidate rule for a row `m` at index i (`moves` sorted by ply): `m.isUserMove`, classification `blunder` or `mistake`, `!skipPlies.has(m.ply)`, rows at ply-1 and ply+1 exist, `nullMoveFen(m.fenBefore)` is not null. Let `o` = row ply+1, `T = o.bestUci.toLowerCase()`. Mate if `o.evalBefore.mate > 0 && o.evalBefore.mate <= 2` and `findMates(nullFen)` is non-null (`mateMoves = mates.moves`). Else capture if `T` is legal in `nullFen` and is a capture there. `confirmThreat`: `top = winPct(lines[0].score)`; accept `l.pv[0]` when `top - winPct(l.score) <= 5` and `lineGain(nullFen, l.pv, 4) >= 2`; if T is not among the lines, test `threatLine` the same way; return `null` unless T is accepted; `best = T`. Piece names for `threatText`: pawn, knight, bishop, rook, queen.

- [ ] **Step 4: Run** the test file → PASS.

- [ ] **Step 5: Commit** `git add server/srs/threats.ts server/srs/threats.test.ts && git commit -m "Find threat candidates in stored analysis"`

---

### Task 2: Threat cards (build, replace mistake cards, migration)

**Files:**
- Create: `server/srs/threat-cards.ts`, `server/db/migrations/017_threat_cards_built.sql`
- Modify: `shared/types.ts` (`CardKind`, `Card.solution`), `server/srs/mate-cards.ts` (export `dropRefs`, widen `kind` to `CardKind`), `server/srs/mistake-cards.ts` (export `playedWithinMargin`; skip threat plies), `server/analysis/analysis-repo.ts` (reset and mark the new column)
- Test: `server/srs/threat-cards.test.ts`, `server/srs/mistake-cards.test.ts`, `server/analysis/analysis-repo.test.ts`

**Interfaces:**
- Consumes: Task 1 exports; `acceptedMoves`, `playedWithinMargin` (`mistake-cards.ts`); `dropRefs` (`mate-cards.ts`); `findMateMisses`; `upsertCard`, `positionKey`, `listCardsByRef` (`cards-repo.ts`).
- Produces:
  ```ts
  // shared/types.ts
  export type CardKind = 'opening' | 'mistake' | 'lesson' | 'plan' | 'mate' | 'threat';
  // Card.solution gains:
  threat?: { fen: string; accepted: string[]; best: string; explanation: string };
  // server/srs/threat-cards.ts
  export async function buildThreatCards(db: DatabaseSync, analysis: GameAnalysis, pool: Pick<EnginePool, 'analyse'>, opts: { nodes: number }): Promise<{ created: number; updated: number; suspended: number; skipped: number }>;
  export function threatPlies(db: DatabaseSync, gameId: number): Set<number>; // plies of this game with an active threat card
  // server/analysis/analysis-repo.ts
  export function markThreatCardsBuilt(db: DatabaseSync, gameId: number, at: number): void;
  ```
- Migration `017_threat_cards_built.sql`: `ALTER TABLE game_analysis ADD COLUMN threat_cards_built_at INTEGER;`. `saveAnalysis` sets it to `NULL` next to `cards_built_at = NULL`.

Card written per confirmed candidate:
- `kind: 'threat'`, `positionKey(fenBefore)`, `fen: fenBefore`, `sideToMove: color`, `refs: [{ gameId, ply }]`, `lastMove: { uci: lastMove.uci }`.
- Prompt: `` `${White|Black} to move. Your opponent just played ${lastMove.san}. What does it threaten?` ``
- `solution`: `accepted` and `best` from step 2 (`acceptedMoves(lines, playedUci)`, best = first line unless it is the played move, as in `buildMistakeCards`), `played: playedSan`, `explanation: `In the game you played ${playedSan}. ${Opponent colour} played ${replySan}.``, `threat: { fen: nullFen, accepted, best, explanation: threatText(...) }`.
- Step 1 for `kind: 'mate'`: `accepted = mateMoves`, `best = T` if in `mateMoves`, else `mateMoves[0]`; no engine call.
- Engine calls for `kind: 'capture'`: `pool.analyse(nullFen, { nodes, multipv: 3 })`; if T is not a `pv[0]`, `pool.analyse(fen after T in nullFen, { nodes, multipv: 1 })` and build `threatLine = { multipv: 1, score: flip(score), pv: [T, ...pv] }` (`flip` from `winpct.ts`). Step 2: `pool.analyse(fenBefore, { nodes, multipv: 3 })`; skip when `playedWithinMargin(lines, playedUci)`.
- Not confirmed → `skipped += 1`, no card.
- After the loop: `dropRefs(db, gameId, 'threat', plies, true)` and `dropRefs(db, gameId, 'mistake', plies, false)`.
- `buildMistakeCards` skips plies in `threatPlies(db, analysis.gameId)` (as it skips mate plies).

- [ ] **Step 1: Write the failing tests** (`threat-cards.test.ts`, fake pool keyed by FEN)
  - `builds a capture threat card` → one `threat` card with the prompt, `lastMove`, `solution.threat.accepted` `['b6d4']`, `solution.accepted` from the fake step 2 lines, `refs [{ gameId, ply }]`.
  - `builds a mate threat card without asking the engine for step 1` → the fake pool never sees `nullFen`.
  - `suspends the mistake card at the same ply` → after `buildMistakeCards` then `buildThreatCards`, the mistake card is suspended; the threat card is active.
  - `buildMistakeCards makes no card at a threat ply`.
  - `a mate miss wins over a threat` → a ply with a mate card gets no threat card.
  - `skips when the engine does not confirm T` → `skipped: 1`, no card.
  - `skips when the played move is within the step 2 margin`.
  - `is idempotent` → second run: `created 0`, `updated 1`, one card.
  - `a dropped threat brings back the mistake card` → re-run with T no longer confirmed: threat card suspended; next `buildMistakeCards` un-suspends the mistake card.
  - `analysis-repo`: `saveAnalysis clears threat_cards_built_at`; `markThreatCardsBuilt sets it`.

- [ ] **Step 2: Run** `pnpm vitest run server/srs/threat-cards.test.ts server/srs/mistake-cards.test.ts server/analysis/analysis-repo.test.ts` → new tests FAIL.

- [ ] **Step 3: Implement** the migration, the type changes, `threat-cards.ts`, the `mistake-cards.ts` skip, the `analysis-repo.ts` changes. Fix any type errors that the new `CardKind` member causes (for example `Record<CardKind, …>` in `session.ts`: add `threat: 0` there for now; Task 4 sets the real mix).

- [ ] **Step 4: Run** the three test files, then `pnpm test` → PASS.

- [ ] **Step 5: Commit** `git commit -m "Build threat cards and let them replace mistake cards"`

---

### Task 3: Wire into the queue and a start-up backfill

**Files:**
- Modify: `server/analysis/queue.ts` (`analyseOne`), `server/srs/backfill.ts`, `server/main.ts`
- Test: `server/analysis/queue-threat.test.ts` (new), `server/srs/backfill.test.ts`

**Interfaces:**
- Consumes: `buildThreatCards`, `markThreatCardsBuilt` (Task 2).
- Produces: `export function backfillThreatCards(db: DatabaseSync, pool: Pick<EnginePool, 'analyse'>, opts?: { nodes?: number }): { jobId: number | null }` in `backfill.ts`, job kind `'threat-backfill'`. It processes done analyses at `ANALYSIS_VERSION` with `threat_cards_built_at IS NULL`, newest first, and marks each game.

- [ ] **Step 1: Write the failing tests**
  - `queue builds threat cards between mate and mistake cards` → after a queued analysis with a threat position: one active `threat` card, no active mistake card at that ply, `threat_cards_built_at` set.
  - `a threat card failure does not stop mistake cards` → a pool that throws for `nullFen`: mistake cards still built; job message contains `(threat cards: failed)`.
  - `backfillThreatCards builds once` → first call returns a job id and builds; second call (after the job ends) returns `{ jobId: null }`.
  - `backfillThreatCards runs while the mistake backfill runs` → `runJob` allows two kinds at once (`findActiveJob` is per kind), so both calls return a job id. When both jobs end, no active mistake card shares a ply with an active threat card (either order).

- [ ] **Step 2: Run** the two test files → FAIL.

- [ ] **Step 3: Implement.** In `analyseOne`: after `buildMateCards`, `try { await buildThreatCards(db, done, deps.pool, { nodes }); markThreatCardsBuilt(db, id, Date.now()); } catch { note += ' (threat cards: failed)'; }`, then the mistake build. In `main.ts`: call `backfillThreatCards(db, lazyEnginePool)` right after `backfillMistakeCards(db, lazyEnginePool)`.

- [ ] **Step 4: Run** the files, then `pnpm test` → PASS.

- [ ] **Step 5: Commit** `git commit -m "Build threat cards after each analysis and once at start"`

---

### Task 4: Session mix

**Files:**
- Modify: `server/srs/session.ts:30-55`
- Test: `server/srs/session.test.ts`

**Interfaces:**
- Produces: `KIND_ORDER = ['mistake', 'mate', 'threat', 'opening', 'lesson', 'plan']`, `QUOTA_ORDER = ['mistake', 'mate', 'threat', 'lesson', 'plan', 'opening']`, mix:
  - 1: `{ mistake: 0.20, mate: 0.1, threat: 0.15, lesson: 0.3, plan: 0.1, opening: 0.15 }`
  - 2: `{ mistake: 0.15, mate: 0.1, threat: 0.15, lesson: 0.25, plan: 0.1, opening: 0.25 }`
  - 3: `{ mistake: 0.10, mate: 0.1, threat: 0.15, lesson: 0.15, plan: 0.15, opening: 0.35 }`

- [ ] **Step 1: Update and add tests**: quotas for `newPerDay` 20 at each level (level 1: mistake 4, mate 2, threat 3, lesson 6, plan 2, opening 3); each mix sums to 1; unused threat quota passes on in quota order; new threat cards appear in the session.
- [ ] **Step 2: Run** `pnpm vitest run server/srs/session.test.ts` → FAIL.
- [ ] **Step 3: Implement** the constants and the comments that list the kinds.
- [ ] **Step 4: Run** the file, then `pnpm test` → PASS.
- [ ] **Step 5: Commit** `git commit -m "Give threat cards 15 percent of new cards"`

---

### Task 5: Board mover and the step 1 component

**Files:**
- Modify: `web/src/components/DrillBoard.tsx` (new prop), `web/src/lib/drill.ts`
- Create: `web/src/components/ThreatStep.tsx`
- Test: `web/src/components/ThreatStep.test.tsx`, `web/src/components/DrillBoard.test.tsx` (create if missing), `web/src/lib/drill.test.ts`

**Interfaces:**
- Consumes: `Card.solution.threat` (Task 2).
- Produces:
  ```ts
  // DrillBoardProps gains: mover?: Color  — colour whose pieces can move; default `orientation`.
  // web/src/lib/drill.ts
  export function threatRating(step1: boolean, step2: boolean): Rating; // both → 'good', one → 'hard', none → 'again'
  // web/src/components/ThreatStep.tsx
  export interface ThreatStepProps { card: CardWithState; onDone: (result: { uci: string; correct: boolean }) => void }
  export function ThreatStep(props: ThreatStepProps): JSX.Element;
  ```
- `ThreatStep` UI: `DrillBoard` with `fen = solution.threat.fen`, `orientation = card.sideToMove`, `mover` = the other colour, `lastMove = card.lastMove?.uci`. After one move the board locks and shows a green arrow for `threat.best` and a red arrow for a wrong move. Feedback: right → `Yes. ${threat.explanation}`; wrong → `Not quite. ${threat.explanation}`. Button `Now find your answer` calls `onDone`. The step heading is `Step 1 of 2`.

- [ ] **Step 1: Write the failing tests**
  - `threatRating` → the 4 combinations.
  - `step 1 lets only the opponent's pieces move` (DrillBoard with `mover`; mock `react-chessboard` and assert `canDragPiece` returns false for an own piece and true for an opponent piece).
  - `ThreatStep shows Yes and the explanation for an accepted move`.
  - `ThreatStep shows the threat for a wrong move and locks the board`.
  - `ThreatStep calls onDone with the move and the result` after the button click.
- [ ] **Step 2: Run** the three files → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `pnpm typecheck && pnpm lint`.
- [ ] **Step 5: Commit** `git commit -m "Add the threat step to the drill board"`

---

### Task 6: Review page flow

**Files:**
- Modify: `web/src/pages/ReviewPage.tsx`
- Test: `web/src/pages/ReviewPage.test.tsx`

**Interfaces:**
- Consumes: `ThreatStep`, `threatRating` (Task 5); `checkAnswer` (`drill.ts`).
- Behavior:
  - New state `threatResult: { uci: string; correct: boolean } | null`, reset in `next()`.
  - For `card.kind === 'threat'` and `threatResult === null`: render `ThreatStep` in place of the `DrillBoard`.
  - After step 1: show `Step 2 of 2. Now find your answer.`, the normal `DrillBoard` on `card.fen` with `lastMove`. `onMove` judges locally (no `checkOpeningMove`) and sets `rating: threatRating(threatResult.correct, correct)`.
  - Step 2 feedback: right → `Correct`; wrong → `` `Not quite. The best move was ${bestSan(card)}.` ``; then `solution.explanation`.
  - `submitReview` sends `answerUci` = the step 2 move.
  - "See the game" shows for `mistake`, `mate` and `threat` cards and links to `` `/games/${gameId}?ply=${ply - 1}` `` (ply from the same ref). This also improves the mistake and mate links (owner rule from the plan-link fix: open the position before the move).

- [ ] **Step 1: Write the failing tests** (mock `api.getReviewSession` with one threat card)
  - `a threat card starts with step 1 on the null-move position` → board FEN is `solution.threat.fen`.
  - `step 2 shows the card position after the button` → board FEN is `card.fen`.
  - `both steps right default to Good; one wrong defaults to Hard` → the default rating button has class `default`.
  - `submits the step 2 move` → `submitReview` called with `answerUci` = step 2 UCI.
  - `See the game opens the position before the move` → href `/games/5?ply=11` for a ref `{ gameId: 5, ply: 12 }`.
- [ ] **Step 2: Run** `pnpm vitest run web/src/pages/ReviewPage.test.tsx` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `pnpm test`.
- [ ] **Step 5: Commit** `git commit -m "Run threat cards in two steps on the review page"`

---

### Task 7: Verification, real-data yield, roadmap, merge

**Files:**
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1:** `pnpm typecheck && pnpm lint && pnpm test && pnpm validate:content` → all pass.
- [ ] **Step 2: Real-data yield.** Copy the owner's database: `sqlite3 data/chess.db ".backup $TMP/chess.db"` (read-only on the original). Start a server on port 8788 against the copy, from the worktree: `CHESS_DB_PATH=$TMP/chess.db PORT=8788 node --import tsx server/main.ts`. Wait for the `threat-backfill` job to finish. Count: `SELECT count(*) FROM cards WHERE kind='threat' AND suspended=0`. **If fewer than 40, stop and ask the owner** (spec ruling 1). Record cards, skipped and suspended mistake cards.
- [ ] **Step 3: Check 3 cards by hand** with chess.js: the step 1 threat is legal in `threat.fen` and wins material or mates; the step 2 best move is legal in `fen`.
- [ ] **Step 4: Browser check** (`pnpm build` first; Chrome via Playwright from a scratch dir outside the repo): one threat card through both steps, one right and one wrong step 1. No page errors. Stop the server you started; delete the temp dir.
- [ ] **Step 5: Roadmap.** M14 row → `done`, plan link; add an "M14 log" with date, test count, yield, rulings, and the backfill note. Update "Next session" (M15 Vienna next).
- [ ] **Step 6: Backup and merge.** The branch adds migration 017: `sqlite3 data/chess.db ".backup data/backups/pre-m14-2026-11-10.db"` (name must not start with `chess-`). Then merge `m14-threat-cards` into `main` and push (owner instruction for milestones). Remove the worktree.
