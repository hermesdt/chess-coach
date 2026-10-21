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
6. When a milestone is done, merge it into `main` and push (owner instruction,
   2026-10-19). The owner's `pnpm dev` may restart or fail during development;
   that is fine. Before a merge that adds migrations, back up `data/chess.db`
   to `data/backups/pre-<milestone>-<date>.db` (the name must not start with
   `chess-`, because the keep-7 cleanup sorts those by name).

## Milestones

| # | Milestone | Status | Plan |
|---|-----------|--------|------|
| M1 | Foundation + sync + games list/viewer | done | `docs/superpowers/plans/2026-10-18-m1-foundation-sync.md` |
| M2 | Engine analysis + review screen + level | done | `docs/superpowers/plans/2026-10-18-m2-engine-analysis.md` |
| M3 | SRS core + mistake cards + dashboard v1 | done | `docs/superpowers/plans/2026-10-18-m3-srs-mistake-cards.md` |
| M4 | Openings: London, Caro-Kann, Slav/anti-London; validator, explorer, drill, leaks; levels | done | `docs/superpowers/plans/2026-10-18-m4-openings.md` |
| M5 | AI coach (claude-cli, codex-cli, opencode-cli, openrouter, anthropic-api) | done | `docs/superpowers/plans/2026-10-18-m5-ai-coach.md` |
| M6 | Principles course (12 level-1 lessons) | done | `docs/superpowers/plans/2026-10-18-m6-course.md` |
| M7 | Insights + polish + README | done | `docs/superpowers/plans/2026-10-18-m7-insights-polish.md` |
| M8a | Coach chat: chat, engine lines as branches, own moves on the board, add to review | done | `docs/superpowers/plans/2026-10-19-m8a-coach-chat.md` |
| M8b | Coach chat: streaming, fast model, live Stockfish eval, "Go deeper", attack facts | done | `docs/superpowers/plans/2026-10-19-m8b-coach-chat-speed.md` |
| M9 | Level 2–3 content (lessons, tags, deeper repertoire) | done | `docs/superpowers/plans/2026-10-20-m9-level-2-3-content.md` |
| M10 | Opening guides: per repertoire why, strengths, target set-up, plans, typical mistakes | planned | spec `docs/superpowers/specs/2026-10-21-opening-guides-design.md`, plan `docs/superpowers/plans/2026-10-21-m10-opening-guides.md` |
| M11 | Content quality audit: every repertoire comment, lesson and guide claim checked with chess.js + Stockfish | todo | spec `docs/superpowers/specs/2026-10-20-content-audit-design.md` |

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

- 2026-10-19 — **M7 done.** 701 tests; `pnpm validate:content` → content OK.
  Insights page (results by opening and colour with the repertoires pinned,
  mistake tags per month, accuracy, rating per platform + time class,
  recommended focus; 30/90/365 days/all), duplicate games (an imported copy of
  a synced game is linked via `games.duplicate_of` and left out of every
  count), Settings completeness (engine, review limits, reported problems with
  "Restore card", data info, ".env" notes), chess.com retry on 429/5xx
  (1 s / 3 s / 9 s, Retry-After), README update. Migrations 012 (per-game user
  tag counts, backfilled) and 013 (duplicate_of). Smoke: a copy of the live DB
  on port 8788 — real sync, an imported copy counted as a duplicate, all pages
  screenshotted. Final review (opus) fixes: two platform games never link (a
  rematch with the same moves stays separate), rating series cut by size with a
  note, heatmap at natural size, text contrast ≥ 4.5:1.
- M7 rulings (review these):
  - Only an imported game can be a duplicate. Same players (case-insensitive),
    same UTC day, same SAN moves. A synced copy beats an imported one.
    A game that crosses midnight UTC between the two time stamps is not linked.
  - The insights rating chart excludes imported games and shows at most 4
    series (the ones with the most games) with a "N more series" note.
  - Insights has a "Recommended focus" card (spec §2.8) that reuses the
    dashboard's top tag.
  - The Engine nodes setting has no ".env" note: a stored value cannot be cleared.
- Known gaps for later: chess.com "Undefined" opening names form their own
  group; the Review page says "Nothing to review" when the daily new-card limit
  is reached; flags list shows a raw FEN, not a board; the same opening can get
  different names on chess.com and lichess; `.env.example` still lists unused
  AI_PROVIDER / AI_MODEL / AI_EFFORT; cards from a game that later becomes a
  duplicate stay (cards merge by position, so nothing is counted twice).
- 2026-10-19 — Owner asked for a coach chat on the game page: the owner
  explains a move or plan, the AI judges it, and better ideas come back as
  lines the owner can play on the board. Moves in those lines must come from
  Stockfish / chess.js (project rule), the AI only selects and explains. This
  is M8; level 2–3 content moves to M9.

- 2026-10-19 — **M8a done.** 801 tests; `pnpm validate:content` → content OK.
  Coach chat on the game page ("Moves | Coach chat" tabs): the owner asks about
  the position on the board (main line or a side branch they made by moving
  pieces); the server builds a fact pack (Stockfish MultiPV 3, the refutation
  of the played move, the opponent's threat, moves the owner names, material /
  captures / checks, repertoire moves, game key moments); the AI answers with
  a first-sentence verdict, attaches engine lines by id only, a rule and a
  lesson link; every move in the answer is grounded (one retry, then "Try
  again"). Line buttons play on the board as branches. "Add to review" makes a
  card (engine moves within 5 win %). Migration 014 (`chat_messages`).
  Smoke on a copy of the live DB with claude-cli (Sonnet 5.5): the Bh6
  question answered in 9 s; follow-ups 17–20 s; whole-game question 17 s.
  Token use: about 5–6k input tokens for a first question, about 9–10k with a
  full 10-turn history, about 0.4k output.
- M8a rulings (review these):
  - The web computes the context line itself (`describeNode`), with the same
    wording as the server.
  - The `chat_messages` status CHECK already allows 'streaming' (M8b), so the
    table needs no rebuild later.
  - A chat card for a position where the owner erred is a normal mistake card
    (move ply, no source); other chat cards carry `source: 'chat'` and the
    mistake-card cleanup leaves them alone.
  - The owner's named moves (also illegal ones) are in the grounding set, so
    the coach can say "Qh5 is illegal"; it could in theory recommend one.
- Known gaps for later:
  - **Wrong non-move facts are possible.** Grounding checks moves only. In the
    smoke run the coach said "Bh6 attacked the rook on f8" (the g7 pawn blocks
    that diagonal). M8b candidate: add per-position attacked / hanging pieces
    to the fact pack and allow attack claims only from those facts.
  - On a duplicate game's page the chat checks the duplicate's own analysis;
    if the canonical game changes, older chats stay in the DB but drop from view.
  - "Add to review" is hidden when the coach attached no lines; at a final
    position the owner's named moves are dropped; "Line 1" labels repeat in
    the Moves tab; numbers in the coach's text are not checked.
- 2026-10-19 — Owner set the claude-cli model to `claude-sonnet-5-5` in
  Settings (used for coach notes and chat until M8b adds a chat model setting).

- 2026-10-19 — **M8b done.** 910 tests; `pnpm validate:content` → content OK.
  Speed spike (`docs/superpowers/notes/2026-10-19-chat-speed-spike.md`):
  claude-cli Sonnet 5.5 is the fastest (first words 1.8 s, full 5.8 s);
  only claude-cli streams text deltas; codex and opencode answer whole.
  Streamed answers over SSE ("checking…" until validated; "correcting…" on a
  retry); chat model and deep model settings per provider (defaults: claude
  and anthropic-api Sonnet → Opus; codex gpt-5.6-luna; opencode
  z-ai/glm-5.3-flash); "Go deeper" (migration 015); live Stockfish eval under
  the board (700 ms, MultiPV 3, best-move arrow) with an engine cache shared
  with the chat; attack facts in the fact pack (attacked / defended /
  hanging, pins ignored, prompt says so); prefetch of the anchor's engine
  facts when the chat tab opens. Smoke on a copy of the live DB: Bh6 question
  first words 3.6 s, full 7.8 s; "Go deeper" (Opus) 23 s; whole-game question
  8 s; the Bh6 attack fact is now right ("the bishop on h6 is attacked by the
  g7 pawn"); a real codex coach note still works with the new `--json`
  parsing; live eval 0.8 s per position.
- M8b rulings (review these):
  - "Go deeper" shows only when the provider has a deep model (setting or
    default) that differs from its chat model: claude-cli and anthropic-api
    by default; codex, opencode and openrouter only after you set a deep model.
  - A message can be deepened once (the button hides when a deeper answer exists).
  - The engine cache serves the chat only results at least as deep as the
    engine budget setting.
  - A deep answer's history includes the fast answer before it.
- Known gaps for later: a rare second structured block (claude) or Anthropic
  fallback text can show a rejected first attempt with "checking…" but without
  "correcting…"; the live eval keeps the previous values dimmed for about
  1 s; prefetch searches cannot be cancelled; codex drops a valid answer if an
  error event follows it.
- 2026-10-20 — Owner asked to fix the opencode model: Settings now use
  `openrouter/z-ai/glm-5.3-flash` (provider test passed, 10 s).

- 2026-10-20 — Owner reported that opening cards said "Not quite — the best
  move was Nf3" for a sound non-repertoire move (Nc3). Fix: opening cards now
  say "Your <repertoire> move here is <SAN>."; Stockfish checks the played
  move (200k nodes): within 5 win % → "…is also a good move (Stockfish), but
  your <repertoire> plays <SAN> here." and default rating Hard; else the loss
  in % and default Again. Mistake and lesson cards unchanged.

- 2026-10-21 — **M9 done.** 1010 tests; `pnpm validate:content` → content OK
  (65 warnings, now identical between runs: the validator starts every search
  with `ucinewgame`). 13 new lessons (level 2: pawn structures, outposts, good
  and bad bishops, rook endgames, king activity, prophylaxis, calculation;
  level 3: minority attack, pawn breaks, trades by plan, converting, defence,
  opposite-colour bishops). Level-3 repertoire depth: London +54 nodes,
  Caro-Kann +103 (incl. Fantasy and Two Knights 3.Nf3), Slav +152. New tags
  `missed_fork`, `missed_pin`, `weak_back_rank`, `bad_bishop` (level 2+),
  analysis version 2 (old games re-analysed in the background, the v1 analysis
  stays visible until replaced; cards, reviews and coach notes kept; old coach
  notes show "Based on an older analysis"). Daily review mix by level, level-up
  message ("Level 2 unlocked: N new lessons and M new opening moves."), AI
  lesson links capped at the current level, `levelOverride` in PUT
  /api/settings (no Settings UI field yet). Every lesson and repertoire batch
  had a separate content review with chess.js + Stockfish; reviews found and
  fixed about 45 false or misleading texts before merge.
  Smoke on a copy of the live DB: 20 games re-analysed to v2 in < 10 min,
  cards/reviews/notes kept, level 1 shows nothing new, level 2/3 unlock works.
- M9 rulings (review these):
  - Content first, then tags and mix (the tag → lesson map needs the lessons).
  - Opening cards and the drill are level-gated; the course and the openings
    tree still show higher-level titles as locked.
  - Pawns are not fork targets or pinned pieces; the back-rank "no flight
    square" rule accepts any own piece blocking.
  - `bad_bishop` fires only on the move that brings 5 own pawns onto the
    bishop's colour.
  - No fixed text says "The engine line is …"; texts say "One line is …".
  - A failed analysis gets the current version, so it is not retried
    automatically (M2 rule).
  - Review mix quotas use largest-remainder rounding (ties mistake → lesson →
    opening); unused quota passes on in that order.
- Known gaps for later: no Settings UI field for the level override; a
  failed re-analysis replaces the v1 analysis with an error (Try again
  recovers); review stats `dueNow`/`dueToday` count hidden lesson cards (not
  shown in the UI); the weakness prompt still lists locked lessons (they become
  null); opening-move feedback (`check-move.ts`) does not use `newGame` yet.
  Content notes for the audit are in the M9 ledger summary below.
- Content notes for the audit milestone (deferred minors from M9 reviews):
  prophylaxis body still mentions a mate-threat rule no exercise uses;
  "about 69 %" style numbers left in some lesson texts; london-e4 "threatens
  Bxc4" holds only while the knight is on c6; Slav "the e6 pawn blocks your c8
  bishop for now" (Bd7 is possible) and the Bxc3 "so" wording; existing Slav
  comments "White must move the knight" (5.Ne5 Nbd7 6.Nxc4 b5) and "you win a
  pawn" (4.Nd2 cxd4) are unverified; level-1/2 "king is safe / solid" phrases
  were never engine-checked; internal exercise id `queen-sacrifice-mate`
  misnamed (rename changes card refs).
- 2026-10-21 — Owner asked for opening guides: per repertoire, why the
  opening, its strengths, the target set-up ("final form"), plans and pawn
  breaks, typical mistakes. Order confirmed by the owner: M10 = opening
  guides, M11 = content audit (so the audit also checks the guide texts).

## Next session

- M10 opening guides: owner confirmed the order (2026-10-21). Start with
  `superpowers:brainstorming`. Then M11 content audit (spec
  `docs/superpowers/specs/2026-10-20-content-audit-design.md`; it also audits the guide texts).
- All milestones through M9 are merged into `main`.
