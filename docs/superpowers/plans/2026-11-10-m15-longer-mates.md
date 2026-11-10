# M15 Longer Mates Implementation Plan

> **For the implementer:** the main session implements this plan itself, task by task, with TDD. No subagents (owner instruction). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Mate cards for mate in 3 and 4 from the owner's games; the owner plays the whole mate against the longest defence, from a precomputed, chess.js-proven answer tree.

**Architecture:** A proof module (`server/srs/long-mates.ts`) finds the misses in stored analysis and builds the answer tree: Stockfish proposes owner moves, chess.js enumerates every defence, `findMates` closes the last two moves. A builder (`server/srs/long-mate-cards.ts`) writes `mate` cards with a `tree`. Queue and a start-up job call it. The review page gets a multi-move mate board.

**Tech Stack:** TypeScript, node:sqlite, chess.js, Stockfish via `EnginePool`, React 19, react-chessboard, vitest.

**Spec:** `docs/superpowers/specs/2026-11-10-m15-longer-mates-design.md`

## Global Constraints

- Moves come only from Stockfish proposals that chess.js proves, or from `findMates`. No AI text.
- Tests never hit the network or a real engine. Fake pool; positions proven in the test with chess.js.
- Work in a worktree `../chess-m15` on branch `m15-longer-mates`. Never write to `data/chess.db`.
- Mate lengths: 3 and 4. Engine steps: MultiPV **5**. Budget per position: **60** engine calls and **20 s** of chess.js work.
- Longest defence; tie → the reply in the stored `pvSan`, else the first in chess.js move order.
- After a wrong move only Again (existing rule). `answerUci` = the owner's first move.
- Precedence at a ply: mate (any length) > threat > mistake.
- `buildMateCards` (M13) drops refs only of mate cards with `mateIn` 1 or 2; the long builder only of 3 or 4.
- Before each commit: `pnpm typecheck && pnpm lint` and the touched tests pass.

Test positions (Stockfish depth 24; the tests prove them with chess.js):
- `L3 = '8/7k/8/8/8/8/R7/1R4K1 w - - 0 1'` — mate in 3.
- `L4 = '8/8/7k/8/8/8/R7/1R4K1 w - - 0 1'` — mate in 4.

## Review Focus

1. **A start with only M13 code** (`syncMateCards` at server start) must not suspend long mate cards → Task 2 test `syncMateCards keeps long mate cards`.
2. **A defence that stalemates or has no legal reply** is not a mate step → Task 1 test `a move that stalemates is not accepted`.
3. **The engine claims mate but chess.js disagrees** (fake pool lies) → the move is not accepted; a root without an exact proof is skipped → Task 1 tests.
4. **Budget exceeded** → null, no partial card → Task 1 test.
5. **The owner plays a different accepted move than the main line** → the board follows that branch of the tree → Task 4 test.

---

### Task 1: Proof module

**Files:** Create `server/srs/long-mates.ts`, `server/srs/long-mates.test.ts`.

**Interfaces (produces):**
```ts
export interface MateStep { uci: string; san: string; defence: { uci: string; san: string } | null; next: MateNode | null }
export interface MateNode { mateIn: number; accepted: MateStep[] } // accepted[0] is the main line
export interface LongMateMiss { ply: number; fen: string; color: Color; mateIn: 3 | 4; playedSan: string; playedUci: string; pvSan: string[] }
export function findLongMateMisses(moves: MoveAnalysis[]): LongMateMiss[];
export async function proveMate(fen: string, k: number, pool: Pick<EnginePool, 'analyse'>, opts: { nodes: number; maxEngineCalls?: number; maxMs?: number; pvSan?: string[] }): Promise<MateNode | null>;
export function mainLine(node: MateNode): string[]; // SAN, owner and defence moves, ends with the mating move
```
Rules (spec "Proof and the answer tree"): `k ≤ 2` uses `findMates` (accepted = its moves; a node's `mateIn` = `findMates().mateIn`). `k ≥ 3`: engine MultiPV 5, candidates = lines with `0 < score.mate <= k` (the engine only proposes; chess.js decides the exact length); a candidate is accepted when after it the opponent has ≥ 1 legal move and every reply has a proven mate, and 1 + the longest remaining equals `k`. The defence stored per accepted step = the longest reply (tie rule). Main line: put the engine's first candidate first when accepted. `findLongMateMisses`: `isUserMove`, stored `evalBefore.mate` 3 or 4, `evalAfter.mate !== -(n-1)`, `findMates(fenBefore) === null`. Defaults: `maxEngineCalls` 60, `maxMs` 20 000.

Fake pool for tests: returns every legal move as a line with `score: { cp: null, mate: 1 }` (a "lying" engine that claims a mate for every move), so only chess.js decides.

- [ ] **Step 1: Failing tests:** `proves mate in 3 on L3` (root `mateIn 3`, every accepted move followed by a defence; replaying `mainLine` with chess.js ends in checkmate after 5 plies); `proves mate in 4 on L4` (9 plies); `every defence is covered` (for each accepted root step, enumerate the replies with chess.js and check each has a proven mate ≤ 2 via `findMates` or the tree); `picks the longest defence` (on L3, the stored defence leaves mate in 2, not 1); `tie rule prefers the pvSan reply`; `rejects a lying engine claim` (fake claims mate in 3 on a position with no mate → `null`); `a move that stalemates is not accepted`; `returns null when the root is faster than k` (L3 with k=4 → null); `returns null over budget` (`maxEngineCalls: 0` with k=3 → null); `findLongMateMisses` filters (mate 3/4 only, user moves only, fastest played → none, `findMates` hit → none).
- [ ] **Step 2: Run** `pnpm vitest run server/srs/long-mates.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Track the budget with a counter and `Date.now()`; throw an internal `BudgetError` and return `null` at the top.
- [ ] **Step 4: Run** → PASS (check the test time stays under 5 s).
- [ ] **Step 5: Commit** "Prove longer mates with chess.js".

### Task 2: Long mate cards, ownership of lengths, migration

**Files:** Create `server/srs/long-mate-cards.ts`, `server/srs/long-mate-cards.test.ts`, `server/db/migrations/018_long_mate_cards_built.sql`. Modify `shared/types.ts` (`mateIn?: 1 | 2 | 3 | 4`, `tree?: MateNode`; move the `MateStep`/`MateNode` types to `shared/types.ts` and re-export from `long-mates.ts`), `server/srs/mate-cards.ts` (drop only `mateIn` ≤ 2), `server/srs/cards-repo.ts` (`longMatePlies(db, gameId): Set<number>` — active mate cards with `mateIn` ≥ 3), `server/srs/threat-cards.ts` and `server/srs/mistake-cards.ts` (skip those plies), `server/analysis/analysis-repo.ts` (`markLongMateCardsBuilt`, reset in `saveAnalysis`).

**Interfaces (produces):** `export async function buildLongMateCards(db, analysis, pool, opts: { nodes: number }): Promise<{ created; updated; suspended; skipped }>`.

Card: kind `mate`, prompt `` `${White|Black} to move. You played ${playedSan} in a game. Find the mate in ${n}.` ``, solution `{ accepted: tree.accepted.map(uci), best: tree.accepted[0].uci, mateIn: n, played, tree, explanation: `Mate in ${n}: ${mainLine(tree).join(' ')}.` }`, refs `[{ gameId, ply }]`, `lastMove: null`. After the loop: drop this builder's refs (mate cards with `mateIn` ≥ 3 not built now), and suspend threat and mistake refs at its plies (`dropRefs`).

- [ ] **Step 1: Failing tests:** builds one card for an L3 miss (fake pool) with the prompt, `tree`, explanation; idempotent; suspends the mistake and the threat card at that ply; `syncMateCards keeps long mate cards` (build long card, then `syncMateCards` → still active); `buildMateCards still drops its own stale mate-in-1 refs`; threat and mistake builders skip a long-mate ply; a dropped long mate lets the mistake card come back; skipped when the proof fails; analysis-repo marker set/cleared.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** the files, then `pnpm test` → PASS.
- [ ] **Step 5: Commit** "Build long mate cards".

### Task 3: Queue and start-up job

**Files:** Modify `server/analysis/queue.ts` (order: mate, long mate, threat, mistake; own try/catch, note `(long mate cards: failed)`, mark after success), `server/srs/backfill.ts` (`backfillLongMateCards`, kind `long-mate-backfill`, column `long_mate_cards_built_at`; share the loop with `backfillThreatCards` through one private helper), `server/main.ts` (call after `backfillThreatCards`). Tests: `server/analysis/queue-long-mate.test.ts`, `server/srs/backfill.test.ts`.

- [ ] **Step 1: Failing tests:** queue builds a long mate card and no threat/mistake card at that ply; a long-mate failure does not stop threat and mistake cards; backfill builds once and leaves a failed game unmarked.
- [ ] **Steps 2–4:** RED, implement, GREEN + `pnpm test`.
- [ ] **Step 5: Commit** "Build long mate cards after each analysis and once at start".

### Task 4: Review board for long mates

**Files:** Create `web/src/components/MateLine.tsx`, `web/src/components/MateLine.test.tsx`. Modify `web/src/pages/ReviewPage.tsx`, `web/src/pages/ReviewPage.test.tsx`.

**Interfaces:** `MateLine({ card, onDone }: { card: CardWithState; onDone: (r: { firstUci: string; correct: boolean }) => void })`. Shows `Move i of n.`; on an accepted move, after 400 ms plays `defence` and continues with `next`; on mate calls `onDone({ correct: true })` with feedback `Correct. This is the fastest mate.`; on a wrong move locks the board, shows a green arrow for the main move at this node and the text `` `Not quite. The fastest mate is ${mainLine(node).join(' ')}.` `` (a web copy of `mainLine` in `web/src/lib/drill.ts`), and calls `onDone({ correct: false })`. ReviewPage: a mate card with `solution.tree` renders `MateLine` in place of `DrillBoard`; the answer is set from `onDone` (`uci: firstUci`, rating `good` or `again`); ratings follow the existing failure rule. Mate cards without `tree` are unchanged.

- [ ] **Step 1: Failing tests** (fake timers for the 400 ms): plays the full L3 mate with defences and ends `Correct…`; follows a non-main accepted branch (Review Focus 5); wrong move at move 2 shows the line from that node and only Again; submit sends the first move; a mate-in-1 card still uses the old board.
- [ ] **Steps 2–4:** RED, implement, GREEN + typecheck, lint, `pnpm test`.
- [ ] **Step 5: Commit** "Play long mates move by move on the review page".

### Task 5: Verification, real data, roadmap, merge

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm validate:content`.
- [ ] Real data: `sqlite3 data/chess.db ".backup $TMP/chess.db"`; server from the worktree on port 8788 against the copy; wait for `long-mate-backfill`; count `mate` cards with `mateIn` 3 and 4; check every tree with chess.js (each main line ends in checkmate; every defence is legal). Record cards, skipped, and the node limit used.
- [ ] Browser (Chrome via Playwright from a scratch dir): one long mate played to the end, one wrong move. No page errors. Stop the server; delete temp files.
- [ ] Roadmap: M15 `done`, M15 log, Next session → M16a.
- [ ] Backup `data/backups/pre-m15-2026-11-10.db`, fast-forward merge to `main`, push, remove the worktree.
