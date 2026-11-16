# M16b Grand Prix Implementation Plan

> Execute inline with TDD, without subagents (owner instruction).

**Goal:** Add the Sicilian part of the 1.e4 repertoire alongside Vienna/London.
**Architecture:** Specific shared-root matching plus existing JSON teaching content.
**Tech stack:** TypeScript, chess.js, Stockfish, React, SQLite, Vitest.
**Spec:** `docs/superpowers/specs/2026-11-16-m16b-grand-prix-design.md`.

## Global Constraints

250-350 move nodes, six guide variations, two plans with three exercises each.
No dependencies, migrations or quota changes. No live DB writes in tests.
Engine/board-validated content; preserve existing review history. Work inline.

## Review Focus

1. Shared e4 roots: no order-dependent misclassification or loss of the first leak.
2. Ambiguous/incomplete games remain unassigned; unique old matches retain behavior.
3. Identification ignores level gates but leak training still respects them.
4. Initial cards deduplicate e4 while naming all repertoires and retaining FSRS.
5. New quizzes cannot overwrite existing plan cards at transposed positions.

### Task 1: Shared-root Matching

Files: `server/repertoire/leaks.ts`, `leaks.test.ts`, `refresh.ts`,
`refresh.test.ts`, `opening-cards.test.ts`, `web/src/lib/openings.ts` and its
tests, `web/src/pages/OpeningsPage.tsx`.

- [x] Add failing tests: e4 c5 selects Grand Prix and e4 e5 selects Vienna in
  both list orders; deviation at White's third move is still a leak; bare e4
  and e4 e6 are ambiguous; d4 London and Black repertoires unchanged; selection
  works below locked branches. An actual scan stores the correct repertoire.
- [x] Implement `selectRepertoire(reps: Repertoire[], moves: MoveInfo[],
  userColor: Color): Repertoire | undefined`; use it in scanLeaks. Version the
  matching hash. Add tab label/order. Preserve single-root matches.
- [x] Test three White repertoires sharing the initial card: d4/e4 appear once,
  three refs/names, FSRS preserved. Targeted tests, typecheck, lint; commit.
  Commit `4a9722c`: 52 focused tests and 1508 full-suite tests pass.

### Task 2: Grand Prix Content

Files: `content/repertoires/grand-prix.json`, `content/guides/grand-prix.json`,
two `content/plans/grand-prix-*.json`; `shared/plans.ts`,
`server/plans/load.ts`, `web/src/pages/PlansPage.tsx`; content/group/page tests.

- [x] Failing tests: 250-350 legal move nodes, levels 1-3, six defences, one
  White recommendation per node, six valid guide variations, two valid plans
  and six exercise positions unique across existing content.
- [x] Author concrete early recommendations and engine continuations, with
  board-verified explanations. Retain engine results in ignored scratch. Add
  group/schema/UI support. Create guide, models, examples and plan quizzes.
- [x] Validate all content at one million nodes. Review every claim, inspect
  warnings, run targeted tests/typecheck/lint; commit.
  303 move nodes, six guide variations, six quizzes. Full validator: content
  OK, 176 warnings (17 new quiz alternatives). 1519 tests pass.

### Task 3: Verify And Integrate

- [x] Self-review the whole branch against design and Review Focus.
- [x] Full tests/typecheck/lint/build, content and sequence validation pass.
- [x] Temporary DB/browser: five tabs, Grand Prix drill/guide, plan training,
  shared initial review card and distinct Sicilian/Vienna game attribution.
- [ ] Update README/ROADMAP, take and check SQLite backup, merge main,
  verify merged tests, push. Preserve managed worktree ownership.

Owner delegated remaining choices; do not invent a separate design approval.
