# Roadmap

Source of truth for project status across sessions.
Design: `docs/superpowers/specs/2026-10-18-chess-coach-design.md`.

## How to continue (for any new session)

1. Read this file and the design doc.
2. Pick the first milestone that is not `done`.
3. If it has no plan file, write one with `superpowers:writing-plans` into
   `docs/superpowers/plans/` and link it here.
4. Execute the plan with `superpowers:subagent-driven-development`:
   - implementers: `model: sonnet` (use `haiku` for mechanical tasks such as
     fixtures, config, copy, simple components), reviewed by a `sonnet`
     reviewer;
   - the main session supervises, runs verification, and commits.
5. Before marking a milestone `done`: `pnpm typecheck && pnpm lint && pnpm test`
   (plus `pnpm validate:content` once it exists) are green, and a smoke run of
   the app works. Update this file and commit.

## Milestones

| # | Milestone | Status | Plan |
|---|-----------|--------|------|
| M1 | Foundation + sync + games list/viewer | done | `docs/superpowers/plans/2026-10-18-m1-foundation-sync.md` |
| M2 | Engine analysis + review screen | planned | `docs/superpowers/plans/2026-10-18-m2-engine-analysis.md` |
| M3 | SRS core + mistake cards + dashboard v1 | todo | — |
| M4 | Openings: repertoires, validator, explorer, drill, leaks | todo | — |
| M5 | AI coach (claude-cli, codex-cli, opencode-cli, openrouter, anthropic-api) | todo | — |
| M6 | Principles course (12 lessons) | todo | — |
| M7 | Insights + polish + README | todo | — |

## Log

- 2026-10-18 — Design written. Stockfish 19 installed via Homebrew.
  Lichess export needs a personal token (anonymous returns 404).
- 2026-10-18 — Owner asked for several AI providers. M5 now covers claude-cli, codex-cli, opencode-cli, openrouter, anthropic-api (no LiteLLM).
- 2026-10-18 — **M1 done.** 99 tests. Smoke: chess.com sync of a public
  account (822 games in ~10 s), incremental re-sync adds 0, viewer renders
  (headless Chrome screenshots). Final review (opus) fixes applied: lichess
  oldest-first sync, per-username start point, job recovery after restart,
  one sync at a time, local-only Host/Content-Type guard, SAVEPOINT
  `transaction()` helper.
- M1 rulings (decisions taken without the owner; review these):
  - Lichess `since` uses a 14-day overlap window (lichess filters by game
    start time). Cost if wrong: a few seconds of extra download per sync.
  - Lichess `clocks=true` (spec wins over the plan).
  - Imported and synced copies of the same game are not deduplicated yet.
    Revisit in M7 insights (risk: double counting).
  - Large PGN imports run synchronously (UI blocks for very large files).
  - Extra shared component `SyncButton`; chess.com fixture uses real 2024-01
    data.
- Known minor gaps carried forward: chess.com has no 429 retry; LIKE search
  is case-insensitive for ASCII only; a cleared setting falls back to `.env`.
