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
| M2 | Engine analysis + review screen + level | done | `docs/superpowers/plans/2026-10-18-m2-engine-analysis.md` |
| M3 | SRS core + mistake cards + dashboard v1 | done | `docs/superpowers/plans/2026-10-18-m3-srs-mistake-cards.md` |
| M4 | Openings: London, Caro-Kann, Slav/anti-London; validator, explorer, drill, leaks; levels | done | `docs/superpowers/plans/2026-10-18-m4-openings.md` |
| M5 | AI coach (claude-cli, codex-cli, opencode-cli, openrouter, anthropic-api) | done | `docs/superpowers/plans/2026-10-18-m5-ai-coach.md` |
| M6 | Principles course (12 level-1 lessons) | done | `docs/superpowers/plans/2026-10-18-m6-course.md` |
| M7 | Insights + polish + README | planned | `docs/superpowers/plans/2026-10-18-m7-insights-polish.md` |
| M8 | Level 2–3 content (lessons, tags, deeper repertoire) | todo | — (write when M1–M7 are done) |

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
- 2026-10-18 — Owner: the app should adapt as they improve; free choice of openings. Added spec §18 (levels 1–3 from rating; level-gated repertoire depth, lessons, key moments, AI tone) and the Slav/anti-London repertoire for Black vs 1.d4. M8 added for level 2–3 content.
- 2026-10-18 — **M2 done.** 259 tests. Smoke: real sync → 50 newest games
  auto-analysed in ~410 s (~8 s per long blitz game, 400k nodes, 8 engines),
  0 errors; Légal's-mate test game classified correctly. Final review (opus)
  fixes applied: no `hung_piece` on even trades, on-demand analysis jumps the
  queue, key moments show human reasons (tags), key moments follow the
  current level.
- M2 rulings (review these):
  - A move that allows a forced mate is always a blunder (lichess rule),
    even when the win-% loss is below 30.
  - Failed analyses are not retried automatically; the game page has "Try again".
  - Key moments are recomputed at the current level when read.
  - `bad_trade` may fire on an even trade when the eval still drops ≥ 1.5
    (spec definition). Check tag precision on the owner's real games once
    usernames are set.
  - Settings UI for the engine budget comes in M7 (API setting exists).
- 2026-10-18 — **M3 done.** 339 tests. Daily review with mistake cards from
  the owner's games (FSRS, day intervals; Again cards repeat once at the end of
  the session), dashboard v1 with level and level-up banner, card backfill for
  older analyses. Final review fixes: session size drives "Start review",
  tag severity order, promotion test.
- 2026-10-18 — **Incident:** a controller smoke test deleted the owner's live
  `data/chess.db` (shared path and port with the owner's `pnpm dev`). Data was
  not recoverable; the owner must re-enter usernames/lichess token and re-sync.
  Fixes: `CHESS_DB_PATH` / `PORT`, `pnpm smoke:start|stop` on a temp DB and
  port 8788, port bound before any DB work, daily backups in `data/backups/`
  (7 kept), safety rule in CLAUDE.md.
- M3 rulings (review these): FSRS short-term steps off; card explanations use
  only material tags in severity order; DrillBoard always shows a promotion
  picker; per-level new-card mix deferred to M8.
- 2026-10-18 — **M4 done.** 432 tests. Three repertoires, each written by an
  agent, validated by Stockfish (1M nodes) and checked by a separate content
  reviewer who replayed positions with chess.js: London (White, 131 moves),
  Caro-Kann (vs 1.e4, 134), Slav + anti-London (vs 1.d4/1.c4/1.Nf3, 117);
  about half at level 1. Opening cards join the daily review (repertoires
  alternate; leak positions get priority). Leak detection against the owner's
  games, Openings page with explorer, line drill and leaks. Content reviews
  found and fixed ~30 false or misleading comments before merge.
  Also fixed: Stockfish multipv line selection (affected M3 mistake-card answers).
- M4 rulings (review these): opening cards alternate between repertoires;
  leak positions become priority cards (up to 3 extra new cards per day);
  only leaks from the last 30 days flag cards on the first scan; a content
  change triggers a rescan without re-flagging old leaks.
- Note: commit 409272d (README + MIT license) came from another session; M7
  updates that README instead of creating one.
- 2026-10-19 — **M5 done.** 599 tests. AI coach with five providers:
  claude CLI, codex CLI, opencode CLI (subscriptions; all three verified with
  real calls), OpenRouter and Anthropic API (need a key in Settings). Per-game
  coach notes and a weakness report; every answer is validated (strict JSON)
  and grounded: it may only name moves that Stockfish or the game produced,
  per key moment. Notes are cached per provider, requested model and level.
- M5 rulings (review these): `auto` order claude → codex → anthropic →
  openrouter → opencode; CLI runs drop ANTHROPIC_API_KEY / OPENAI_API_KEY so
  subscriptions are used; coach notes depend on the level; the Anthropic
  adapter uses claude-opus-5-5 at low effort with server-side refusal fallbacks.
- Known minor gaps: lowercase "bb5" style moves are not caught by grounding;
  some descriptive phrases ("Knight f3 is nice") can trigger a retry.
- 2026-10-19 — **M6 done.** 652 tests; `pnpm validate:content` → content OK
  (37 accepted warnings). 12 level-1 lessons (blunder check, free material,
  centre, develop, castle, trades, bishop pair, castling sides, tactics, mates,
  Caro-Kann + Slav plans, London plans), 52 exercises. Each batch: author with
  board fact-checks + validator, then a separate content reviewer with chess.js
  and Stockfish; ~25 content problems fixed (e.g. an exercise that marked the
  owner's own 1...c6 wrong). Course and lesson pages; completing a lesson adds
  its exercises to the daily review. `pnpm validate:lessons` validates lessons
  only (fast).
- M6 rulings (review these): "principle" exercises (centre, develop, castle,
  bishop pair, castling sides) accept every on-idea move within 5 win % of the
  best; the validator warns (`weak-alternative`) when an accepted move is
  further away; dashboard focus links to both the lesson and the coach report.
- Known gaps for later: no "Report a problem" button on the lesson page itself
  (only on review cards); lesson 5 has five similar castling exercises.

## Next session

- Start with M7 (insights + polish + README update): plan
  `docs/superpowers/plans/2026-10-18-m7-insights-polish.md`. Then M8 (level 2–3
  content) needs a plan.
- Branches are stacked and not merged: `m1-foundation` → `m2-engine-analysis` →
  `m3-srs` → `m4-openings` → `m5-ai-coach` → `m6-course`. Each fast-forwards
  onto the previous one; merging `m6-course` into `main` brings everything.
  Merging is the owner's decision.
- Owner setup after the lost DB: enter chess.com / lichess usernames and the
  lichess token in Settings, then Sync (analysis, mistake cards and opening
  leaks follow automatically).
