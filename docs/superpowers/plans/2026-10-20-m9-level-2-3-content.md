# M9 Level 2–3 Content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app grow with the owner past level 1: new tactic and structure tags, 13 level-2/3 lessons, level-3 repertoire depth, a daily review mix that follows the level, and a level-up message that says what was unlocked.

**Architecture:** Tags are new deterministic detectors next to the M2 ones (chess.js + stored engine output), with an analysis-version bump so old games get them. Lessons and repertoire lines are data files in `content/`, written by agents and gated by `pnpm validate:content` and a separate content review with chess.js + Stockfish (the M4/M6 process). The review session picks new cards per kind with level-based quotas.

**Tech Stack:** as before. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-18-chess-coach-design.md` §18.1 (levels: course, analysis emphasis, daily review mix, level-up message), §18.2, §9 (content format and validation rules), §8 (tag rule style). Status: `docs/ROADMAP.md`.

## Global Constraints

- Project rule: the AI never invents moves, lines or evaluations; content moves are validated with chess.js and Stockfish (`pnpm validate:content` must pass; new warnings need a reason in the content review report).
- Lesson format (existing JSON in `content/lessons/<nn>-<id>.json`): `id, order, level, title, summary, tags, body, exercises[{id, fen, prompt, solution (UCI[]), explanation}], links`. Body 150–400 words of plain, short sentences; 3–6 exercises per lesson.
- Level 2 lessons (order 13–19, `level: 2`): `pawn-structures` (isolated pawn, Carlsbad, Caro/Slav structures), `outposts` (outposts and weak squares), `good-bad-bishop`, `rook-endgames` (Lucena, Philidor), `king-activity`, `prophylaxis` ("what does my opponent want?"), `calculation` (checks-captures-threats, candidate moves).
- Level 3 lessons (order 20–25, `level: 3`): `minority-attack`, `pawn-breaks`, `trades-by-plan`, `converting` (converting an advantage), `defence` (defensive technique), `opposite-bishops` (opposite-colour bishops).
- Exercise rules (§9 + M6): FEN valid and the stated side to move; each accepted solution legal and within 10 win % of the engine best (tactic exercises) or within 5 win % for "principle" exercises (M6 rule, validator warns `weak-alternative`); explanations name only moves that are legal in the position.
- Where possible, use positions from the owner's repertoires (London, Caro-Kann, Slav) and plain words a 900–1400 player understands.
- New tags (§18.1 names; definitions are this plan's, in the §8 style): `missed_fork`, `missed_pin`, `weak_back_rank`, `bad_bishop`. Tag → lesson: `missed_fork` → `tactics`, `missed_pin` → `tactics`, `weak_back_rank` → `mates`, `bad_bishop` → `good-bad-bishop`.
- New tags appear in key moments and insights only from level 2 (level 1 keeps the M2 tag set, as §18.1 "tag set grows" with the level).
- Daily review new-card quotas by level (share of `reviewNewPerDay`): level 1 mistake 40 % / lesson 40 % / opening 20 %; level 2 35 / 30 / 35; level 3 30 / 20 / 50. Unused quota of a kind flows to the other kinds; leak priority extra cards (M4) stay as they are.
- Repertoire level 3: each repertoire gains ≥ 40 new `level: 3` nodes (main lines deepened to about move 12–14 and the most common sidelines), every own move within 15 win % (validator rule), every node with a one- or two-sentence "why" comment.
- Safety: never touch `data/chess.db` or port 8787; smoke runs on port 8788 with `pnpm smoke:start`.

## Review Focus

1. A level-1 owner must see no level-2/3 lesson, tag or repertoire node anywhere (course, review cards, drill, key moments, insights, coach facts) — tests in Tasks 1, 2 and 6.
2. A level drop (rating falls back under 900) must not delete progress or cards; content above the level is hidden again, not removed — test in Task 2.
3. The analysis-version bump re-analyses old games without duplicating mistake cards or losing review history — test in Task 1.
4. A lesson exercise whose solution is one of several equal moves: every move within the rule's window must be accepted, or the prompt must make the answer unique — checked by the validator and the content review in Tasks 3–5.
5. A quota of 0 for a kind (e.g. `reviewNewPerDay` = 2 at level 3 → lesson share rounds to 0) still lets that kind appear when the other kinds run out — test in Task 2.

---

### Task 1: New tags and analysis version 2  *(model: sonnet)*

**Files:** Create `server/analysis/tags-tactics.ts`, `server/analysis/tags-tactics.test.ts`; Modify `shared/types.ts` (Tag), `shared/lessons.ts` (TAG_TO_LESSON), `shared/tag-text.ts`, `server/analysis/analyse-game.ts`, `server/analysis/analysis-repo.ts` (ANALYSIS_VERSION 2), `server/analysis/key-moments.ts`, `server/insights/insights.ts` (level filter for tags)

**Interfaces — Produces:**
- `Tag` gains `'missed_fork' | 'missed_pin' | 'weak_back_rank' | 'bad_bishop'`; `LEVEL_TAGS: Record<1 | 2 | 3, Tag[]>` in `shared/lessons.ts` (level 1 = the M2 tags; level 2 and 3 = all).
- `tacticTags(input: { fenBefore: string; played: string /*uci*/; best: string /*uci*/; bestPv: string[] /*uci*/; replyPv: string[] /*uci, opponent's best line after the played move*/; winLoss: number; userColor: Color; ply: number }): Tag[]`
- Definitions (each needs a unit test with a real position reached by legal moves, verified with chess.js):
  - `missed_fork` — the engine best move is a non-pawn or pawn move after which the moved piece attacks ≥ 2 enemy pieces (king counts) that are each worth more than the mover or undefended; the best line wins ≥ 2 pawns of material within 4 plies; the user played something else and lost ≥ 10 win %.
  - `missed_pin` — the engine best move creates a pin (an enemy piece on a line between the moved bishop/rook/queen and the enemy king or a higher-value enemy piece); the best line wins ≥ 2 pawns within 4 plies; the user played something else and lost ≥ 10 win %.
  - `weak_back_rank` — after the user's move, the user's king is on its first rank with no flight square off that rank (own pawns block), and the opponent's best line starts with a check on that rank and mates or wins ≥ 3 pawns.
  - `bad_bishop` — tag only (never a classification): between move 10 and 40, the user's move puts a pawn on the square colour of the user's only bishop and then ≥ 5 own pawns stand on that colour.
- Key moments and insights use `LEVEL_TAGS[currentLevel]` to drop tags above the level (Review Focus 1).
- `ANALYSIS_VERSION = 2`; analyses of an older version are re-queued (low priority, after unanalysed games) and their mistake cards are rebuilt through the existing upsert, keeping FSRS state and reviews (Review Focus 3).
- [ ] Step 1: failing tests: one positive and one negative real position per tag; level-1 key moments of a game with a `missed_fork` do not show it, level 2 does; a version-1 analysis is re-queued and re-analysis keeps the same card id and its reviews.
- [ ] Step 2: run → FAIL. Step 3: implement. Step 4: pass + full gate.
- [ ] Step 5: commit `feat: tactic and structure tags, analysis v2`.

### Task 2: Level-based review mix and unlock message  *(model: sonnet)*

**Files:** Modify `server/srs/session.ts`, `server/srs/session.test.ts`, `server/routes/dashboard.ts`, `web/src/pages/DashboardPage.tsx`, `server/course/*` (lesson status by level) as needed; Test `server/routes/dashboard.test.ts`, `web/src/pages/DashboardPage.test.tsx`

**Interfaces — Produces:**
- `NEW_MIX: Record<1 | 2 | 3, Record<CardKind, number>>` with the Global Constraints shares; `newQuotas(level, newPerDay): Record<CardKind, number>` (largest-remainder rounding, sum = newPerDay); session picks new cards per quota, then fills from any kind if a kind runs out (Review Focus 5).
- Lesson cards and opening cards above the current level are never served (they already have levels; verify and test); a level drop hides them without deleting rows (Review Focus 2).
- AI answers (coach notes, weakness report, chat) may name only lessons at or below the current level: a `lessonId` above the level is replaced by null after validation (the schema enum stays static). Test with a fake provider.
- Level-up banner text: "Level 2 unlocked: 7 new lessons and N new opening lines." (counts from the content at the new level; opening lines = repertoire nodes newly within the level); one-time as today.
- [ ] Step 1: failing tests: quotas for (1, 10) = mistake 4 / lesson 4 / opening 2; (3, 10) = 3 / 2 / 5; (3, 2) gives lesson 0 but a lesson card still appears when no mistake/opening card is new; level drop hides level-2 lesson cards and keeps their rows; banner text with counts.
- [ ] Step 2: run → FAIL. Step 3: implement. Step 4: pass + full gate + build.
- [ ] Step 5: commit `feat: level-based review mix and unlock message`.

### Task 3: Level-2 lessons, part A  *(author model: sonnet; content review: opus with chess.js + Stockfish)*

**Files:** Create `content/lessons/13-pawn-structures.json`, `14-outposts.json`, `15-good-bad-bishop.json`, `16-rook-endgames.json`; Modify `shared/lessons.ts` (LESSON_IDS, LESSON_TITLES for these four)

- [ ] Step 1: write each lesson per Global Constraints (format, length, 3–6 exercises). Rook endgames: Lucena (building a bridge) and Philidor (third-rank defence) with exact positions.
- [ ] Step 2: for every exercise, check FEN, side to move and each solution with chess.js and Stockfish (`pnpm validate:lessons`); fix and re-run until it passes; record every accepted warning with a reason.
- [ ] Step 3: full gate (the AI schema enum now has the new ids) + `pnpm validate:content`.
- [ ] Step 4: commit `content: level-2 lessons 13-16`.

### Task 4: Level-2 lessons, part B  *(author: sonnet; content review: opus)*

**Files:** Create `content/lessons/17-king-activity.json`, `18-prophylaxis.json`, `19-calculation.json`; Modify `shared/lessons.ts`
- [ ] Steps as Task 3. Calculation: exercises that need checks-captures-threats to find the only good move. Commit `content: level-2 lessons 17-19`.

### Task 5: Level-3 lessons  *(author: sonnet; content review: opus)*

**Files:** Create `content/lessons/20-minority-attack.json`, `21-pawn-breaks.json`, `22-trades-by-plan.json`, `23-converting.json`, `24-defence.json`, `25-opposite-bishops.json`; Modify `shared/lessons.ts`
- [ ] Steps as Task 3; minority attack and pawn breaks in Carlsbad / Caro / Slav / London structures. Commit `content: level-3 lessons 20-25`.

### Task 6: Level-3 repertoire depth  *(author: sonnet; content review: opus)*

**Files:** Modify `content/repertoires/london.json`, `caro-kann.json`, `slav.json`
- [ ] Step 1: per repertoire, add ≥ 40 `level: 3` nodes (Global Constraints), each with a "why" comment; choose them from common theory and the existing level-2 tree (do not read the owner's DB).
- [ ] Step 2: `pnpm validate:content` passes; record the engine eval of each new own move in the report.
- [ ] Step 3: test (or extend the existing repertoire tests) that a level-1 and level-2 owner get no level-3 node in opening cards and the drill (Review Focus 1).
- [ ] Step 4: commit `content: level-3 repertoire depth`.

### Task 7: Smoke run and close  *(main session)*

- [ ] Full gate + `pnpm validate:content`. On a temp copy of the live DB (port 8788): re-analysis to version 2 runs and keeps cards; at the owner's level (1) nothing new is visible; with `level_override = 2` (temp DB only) the course shows lessons 13–19, the banner text is right, the review mix follows level 2, and a game with a new tag shows it. Screenshots of the course page at levels 1, 2 and 3.
- [ ] ROADMAP: M9 done, rulings; back up `data/chess.db`; merge to `main` and push.
