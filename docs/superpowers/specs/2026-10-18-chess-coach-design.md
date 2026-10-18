# Chess Coach — Design

Date: 2026-10-18
Status: approved by owner delegation ("build all automated, I leave you in charge")

## 1. Intent

The owner is a beginner (chess.com ~550, also plays on lichess). They want a
personal, local web app that makes them better at chess. The things that help
them most, in their words:

- Short, concrete principles of the kind YouTubers teach: "two bishops
  together are powerful", "taking is not always good", "go for the center",
  "if the opponent castles on one side, you too", "develop fast".
- Opening knowledge they can actually *remember* — they forget openings, so
  they want something like Anki (spaced repetition).
- Their own games, synced from chess.com and lichess, analysed by an engine and
  explained in plain language by AI.

Repertoire: **Caro-Kann with Black**, **London System with White** (White
results are worse lately — the app must make that visible and train it).

Why it matters: at 550 most games are decided by hanging pieces, missed free
material, and poor opening play. The app must turn the owner's *own* mistakes
into practice, and connect each mistake to a principle they can learn.

## 2. Goals

1. Sync games from chess.com and lichess (incremental, on demand).
2. Analyse every game with Stockfish: per-move eval, accuracy, move
   classification (blunder / mistake / inaccuracy), and beginner-relevant
   pattern tags (hung piece, missed free capture, missed mate, early queen,
   late castling, …).
3. Game review screen: board, move list, eval graph, key moments, plain-language
   AI explanation for each key moment, grounded in engine facts.
4. One spaced-repetition review queue ("Daily review") that mixes three card
   kinds:
   - **Opening cards** — from the Caro-Kann and London repertoires.
   - **Mistake cards** — positions from the owner's own games where they
     blundered; the task is to find a good move.
   - **Lesson cards** — exercises from the principles course.
5. Opening trainer: browse each repertoire as a tree with a short "why" for
   every move; drill lines by playing the moves on the board.
6. Repertoire leak detection: for each synced game, find where the owner (or
   the opponent) left the repertoire; owner deviations become priority opening
   cards.
7. Principles course: an ordered set of short lessons (text + interactive
   positions) covering the beginner principles above, each with exercises.
8. Insights: results per opening and colour (e.g. London as White vs Caro-Kann
   as Black), most frequent mistake tags, trend over time, and a recommended
   lesson for the top weakness.
9. Dashboard: due reviews, sync status, recent games with blunder counts, top
   weakness with a link to its lesson.

## 3. Non-goals

- Playing live games or playing against the engine (the owner plays on
  chess.com / lichess).
- Multi-user, login, cloud deployment, mobile app.
- Hosting or transcribing YouTube videos. A lesson may hold optional external
  links the owner adds by hand.
- Openings beyond the two repertoires (the data format must allow adding more
  later, but no content is required).

## 4. Anti-goals (would make it a failure even if it "works")

- **AI inventing chess.** The AI must never be the source of a move, a line, or
  an evaluation. All moves, lines and evals come from Stockfish, chess.js, or
  validated content files. The AI only explains facts it is given.
- **Wrong content.** A lesson exercise with an illegal FEN, or a "correct"
  answer that Stockfish says is bad, is worse than no exercise. All authored
  positions are machine-validated.
- **Engine noise.** Showing a 550 player "+0.37, best was Nf3" with no reason.
  Every surfaced mistake must carry a short human reason (tag + explanation).
- **Overload.** Daily review defaults to a small session (default limit 20 new
  + due cards, configurable). The dashboard shows *one* recommended focus, not
  ten.

## 5. Constraints and environment

- Runs locally on macOS (arm64, 16 cores). Node 26, pnpm 10.
- Stockfish 19 is installed natively (`/opt/homebrew/bin/stockfish`).
  Path is configurable with `STOCKFISH_PATH`.
- **Lichess** game export (`GET /api/games/user/{username}`) returns 404 for
  anonymous requests (verified 2026-10-18). It works with a personal access
  token (no scopes needed). The app must accept `LICHESS_TOKEN` and must show a
  clear message when the token is missing. The spec for the endpoint is at
  `https://raw.githubusercontent.com/lichess-org/api/master/doc/specs/tags/games/api-games-user-username.yaml`.
  Use `Accept: application/x-ndjson` with `pgnInJson=true&opening=true&clocks=true&since=<ms>`.
- **chess.com** public API works without auth (verified): 
  `GET https://api.chess.com/pub/player/{user}/games/archives` then each
  monthly archive. Send a descriptive `User-Agent`. Archives are monthly; only
  re-fetch the current month and months not yet stored.
- **PGN import** (paste or file) is a fallback for both platforms.
- **AI providers** (owner request, 2026-10-18: "multiple options, not just
  Claude"; subscriptions preferred, OpenRouter credits also fine). Installed:
  `claude` CLI 2.1.x (logged in), `codex` CLI 0.163 (logged in), `opencode`
  CLI 1.19. No `ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY` in the env today.
  One interface, five adapters (`server/ai/providers/`):

  | id | How | Credentials | Default model |
  |---|---|---|---|
  | `claude-cli` | `claude -p --output-format json`, prompt on stdin | Claude subscription | CLI default (override `--model`) |
  | `codex-cli` | `codex exec` non-interactive, read-only sandbox, `--skip-git-repo-check`; JSON via `--output-schema`/`--output-last-message` if the installed version supports them, else prompt instruction | ChatGPT subscription | CLI default |
  | `opencode-cli` | `opencode run --format json -m <provider/model>` | whatever opencode is configured with | opencode default |
  | `openrouter` | HTTPS `POST https://openrouter.ai/api/v1/chat/completions` with `response_format: {type: "json_schema", ...}` | `OPENROUTER_API_KEY` (env or Settings) | configurable; default an Anthropic Claude model slug (verify the slug via `GET /api/v1/models` at build time) |
  | `anthropic-api` | `@anthropic-ai/sdk` `client.messages.parse()` + `zodOutputFormat`, top-level `cache_control`, check `stop_reason` | `ANTHROPIC_API_KEY` | `claude-opus-5-5`, `output_config.effort: "low"`; never send `thinking: disabled` or `budget_tokens` |

  - Every adapter returns text that is parsed as JSON and validated with the
    same zod schema; one retry on parse/validation failure with the error
    appended. CLI adapters run with a timeout (default 180 s), no tools, and
    in a temp working directory.
  - **Selection:** Settings has a default provider (`auto` or an id) and an
    optional model per provider. `auto` picks the first available in this
    order: `claude-cli`, `codex-cli`, `anthropic-api`, `openrouter`,
    `opencode-cli` (subscriptions first). Availability = binary on PATH /
    key present; Settings shows each provider's status and a "Test" button.
  - The review screen has "Explain with ▾" to run another provider on the
    same game; results from several providers show as tabs.
  - LiteLLM is not used: it needs a separate Python proxy, and OpenRouter +
    opencode already give access to many models.
  - If no provider is available, AI features show "AI not configured" and
    everything else still works.
- AI output is cached in the DB keyed by (game id, analysis version, prompt
  version, provider id, model). Never re-call the AI for the same inputs.
- Single user, single process. No auth on the local server; bind to
  `127.0.0.1` only.

## 6. Architecture (decided)

One pnpm package, TypeScript everywhere, ESM.

```
chess/
  server/        Hono on Node (@hono/node-server), REST JSON API, port 8787
    db/          node:sqlite (built-in), SQL migrations, repositories
    sync/        chesscom.ts, lichess.ts, pgn-import.ts
    engine/      UCI wrapper around native Stockfish, engine pool, analysis jobs
    analysis/    move classification, accuracy, pattern tags, key moments
    repertoire/  repertoire loading, leak detection
    srs/         scheduling (ts-fsrs), card generation
    ai/          provider interface, adapters (claude-cli, codex-cli,
                 opencode-cli, openrouter, anthropic-api), prompts, zod schemas
  web/           Vite + React + React Router, react-chessboard, chess.js
  shared/        types shared by server and web (API DTOs)
  content/       authored data: repertoires (JSON), lessons (Markdown + JSON)
  scripts/       content validation, dev helpers
  data/          runtime SQLite db (gitignored)
```

- Dev: `pnpm dev` runs server (tsx watch) and Vite (proxy `/api` → 8787)
  together. `pnpm test` runs Vitest. `pnpm typecheck`, `pnpm lint`.
- `pnpm validate:content` validates every repertoire and lesson file (see §9).
- Long work (sync, analysis) runs as background jobs in the server process,
  stored in a `jobs` table; the web polls `GET /api/jobs/:id` (polling is
  fine; no websockets needed).
- Config from `.env` (gitignored) with `.env.example` committed:
  `CHESSCOM_USERNAME`, `LICHESS_USERNAME`, `LICHESS_TOKEN`, `STOCKFISH_PATH`,
  `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `AI_PROVIDER`
  (`auto|claude-cli|codex-cli|opencode-cli|openrouter|anthropic-api|none`),
  `AI_MODEL`, `AI_EFFORT`. Usernames are also editable on a Settings page (stored in DB,
  DB wins over `.env`).

## 7. Data model (outline — builder refines columns)

- `settings(key, value)`
- `games(id, source[chesscom|lichess|import], source_id UNIQUE per source,
  played_at, time_class, rated, white, black, white_elo, black_elo,
  user_color, result[win|loss|draw], termination, eco, opening_name, pgn,
  url, imported_at)`
- `game_analysis(game_id, version, status, accuracy_user, accuracy_opp,
  counts json, analysed_at)`
- `move_analysis(game_id, ply, san, uci, fen_before, eval_before_cp,
  mate_before, eval_after_cp, mate_after, best_uci, best_san, pv json,
  win_pct_loss, classification, tags json)`
- `ai_notes(game_id, ply NULL for whole game, prompt_version, provider, model, json)`
- `cards(id, kind[opening|mistake|lesson], ref json, fen, side_to_move,
  solution json, prompt text, created_at, suspended)`
- `card_state(card_id, fsrs state json, due, last_review)`
- `reviews(id, card_id, rating, reviewed_at, duration_ms, answer_uci)`
- `lesson_progress(lesson_id, status, completed_at)`
- `jobs(id, kind, status, progress, total, error, created_at, finished_at)`

The user's colour in a game is found by matching configured usernames
(case-insensitive) against the White/Black players.

## 8. Analysis rules (decided)

- Engine: native Stockfish via UCI, `Threads=1` per engine, a pool of
  `min(cpus-2, 8)` engines, `Hash=64`. Each position searched to a fixed
  budget (default `nodes=400000`, configurable). Positions with an opening
  book move from the repertoire still get analysed.
- Win % (lichess formula): `win = 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)`,
  from the mover's view; mate scores map to ±100 %.
- Classification by win % lost by the mover: ≥ 30 blunder, ≥ 20 mistake,
  ≥ 10 inaccuracy. Never call a move a mistake if it is the engine's best move
  or if the position was already completely lost (win < 5 %) or completely won
  and stays won (win > 95 % after).
- Accuracy per side: lichess accuracy formula (per-move
  `103.1668 * exp(-0.04354 * winLoss) - 3.1669`, clamped 0–100, then the
  lichess harmonic/weighted mean, or a plain mean if simpler — builder's call,
  document it).
- **Pattern tags** (deterministic, computed with chess.js + engine output).
  Initial set — each needs a unit test with a real position:
  - `hung_piece` — after the user's move, the opponent's best reply captures a
    piece of the user's that is defended insufficiently, and the eval swing is
    ≥ 2 pawns.
  - `missed_capture` — the best move was a capture that wins material
    (≥ 2 pawns swing) and the user did not play it.
  - `missed_mate` — engine had mate in ≤ 3 for the user and the user's move
    lost it.
  - `allowed_mate` — after the user's move the opponent has mate in ≤ 3.
  - `bad_trade` — user captured, and the exchange sequence loses material
    (eval drop ≥ 1.5 pawns on a capture move). ("Taking is not always good.")
  - `early_queen` — user moved the queen before move 6 while minor pieces are
    undeveloped.
  - `slow_development` — by move 10, user has ≥ 2 minor pieces on their
    starting squares.
  - `no_castle` — by move 12 the user has not castled and the king is still in
    the centre.
  - `same_piece_twice` — in the first 8 moves, user moved the same non-pawn
    piece twice without a capture or threat (engine-neutral heuristic; tag
    only, never a classification).
  - `missed_fork` / tactic tags are **not** required in v1.
- **Key moments** for review: all user blunders and mistakes, plus the
  opponent's blunders the user did not punish (`missed_capture` /
  `missed_mate`), capped at 6 per game, ordered by win % lost.
- Each tag maps to a lesson id (§10) so insights can recommend a lesson.

## 9. Content and validation (decided)

All authored content lives in `content/` as data files, written at build time
(by the implementing agents) — not generated at runtime.

**Repertoires** (`content/repertoires/caro-kann.json`, `london.json`): a move
tree. Each node: `san`, `comment` (one or two plain sentences: the *why*),
optional `children`, optional `tags` (e.g. `trap`, `main`). Coverage target:

- Caro-Kann (Black), 8–12 moves deep in main lines: Advance (3.e5 Bf5),
  Exchange (3.exd5 cxd5), Classical (3.Nc3/3.Nd2 dxe4 4.Nxe4 Bf5), Panov
  (4.c4 Nf6), Two Knights (2.Nc3 d5 3.Nf3), Fantasy (3.f3), plus beginner
  tries at this level: 2.Bc4, 2.Nf3, 2.d3, early Qf3 / Bc4 attacks on f7, and
  2.c4. For each, the reply and the plan idea.
- London (White), 8–12 moves deep: vs …d5 with …Nf6/…e6/…c5, vs …Nf6 + …g6
  (King's Indian setups), vs …c5 early, vs early …Qb6 hitting b2, vs …Bf5
  mirror, vs …e5 (gambit-ish tries), vs 1…d5 2.Bf4 c5 3.e3 Nc6 4.c3 Qb6.
  Keep it to one consistent system (d4, Bf4, e3, Nf3, c3, Bd3, Nbd2, O-O).

**Lessons** (`content/lessons/<nn>-<slug>.md` + front-matter, or JSON —
builder's call): 12 lessons, each 150–400 words of plain text plus 3–6
exercises. Each exercise: `fen`, `prompt` ("White to move. Win material."),
`solution` (one or more UCI moves accepted), `explanation`.

Ordered course:
1. Blunder check: before you move, ask "what can they take?" (`hung_piece`)
2. Free stuff: checks, captures, threats — take what is free (`missed_capture`)
3. Take the centre (pawns on e4/d4 or e5/d5)
4. Develop fast: knights and bishops before the queen (`early_queen`,
   `slow_development`, `same_piece_twice`)
5. Castle early; king safety (`no_castle`)
6. Taking is not always good: count attackers and defenders (`bad_trade`)
7. The bishop pair: why two bishops are strong in open positions
8. Opposite-side vs same-side castling: when "castle where they castle" is a
   good rule, and when pawn storms decide
9. Basic tactics: forks, pins, skewers
10. Mating patterns: back rank, queen + king, two rooks (`missed_mate`,
    `allowed_mate`)
11. Caro-Kann plans: the light-squared bishop outside the chain, …c5 breaks
12. London plans: the Bf4/e3/c3 setup, Ne5, kingside attack ideas

**Validation script** (`pnpm validate:content`) fails the build if:
- any repertoire move is illegal from its parent position;
- any repertoire move for the repertoire's side loses ≥ 15 win % per
  Stockfish (at the analysis budget) — opponent moves may be bad (they are
  what beginners play);
- any lesson FEN is invalid, or it is not the stated side to move;
- any accepted solution move is illegal, or loses ≥ 10 win % versus the
  engine best move.
The validator prints the engine best move for failing items so content can be
fixed.

## 10. SRS (decided)

- Library: `ts-fsrs` (FSRS). Ratings: Again / Hard / Good / Easy, but the
  board answer drives a default: wrong move → Again; right move → Good, with
  buttons to adjust.
- **Opening cards**: one card per repertoire node where it is the owner's move
  (position before the move, answer = repertoire move). Drill shows the
  opponent's last move animated. New opening cards are introduced line by line
  (depth-first), max N new per day (default 10).
- **Mistake cards**: created automatically after analysis for each user
  blunder/mistake: position before the user's move; accepted answers = engine
  best move plus any move whose win % is within 5 % of best (computed at card
  creation with multipv 3). After answering, show the AI explanation if
  present, else the tag explanation.
- **Lesson cards**: each lesson exercise becomes a card after the lesson is
  completed.
- Daily review: due cards first (mixed kinds), then new cards, total capped
  (default 20).

## 11. AI coaching (decided)

AI calls receive *only facts*: PGN header summary, the move list in SAN, and
for each key moment: FEN, the move played, the engine best move and PV (SAN),
win % before/after, tags, and the user's colour and rating. Output is
zod-validated JSON:

- **Game review**: `{ summary (≤ 3 sentences), opening_note, moments: [{ ply,
  what_happened, why_it_matters, principle (one short rule), lesson_id? }],
  one_thing_to_practice }`. Language: simple English, short sentences, no
  engine numbers unless asked, encouraging but honest.
- **Weakness report** (on demand, from the last N analysed games' tag counts,
  per-opening results, and a sample of key moments): top 3 weaknesses with a
  rule, a lesson id, and a concrete exercise focus.

The system prompt is fixed text (prompt-cacheable); variable content goes in
the user message. Prompt text lives in `server/ai/prompts/` with a version
constant. Lesson ids passed to the AI are restricted to the known list (enum
in the schema).

## 12. Screens (decided)

1. **Dashboard** — due cards count + "Start review", sync button + last sync
   time, recent 10 games (result, opening, blunders count, accuracy), the one
   recommended focus (top tag → lesson).
2. **Games** — list with filters (platform, colour, opening, result), "Sync
   now", "Import PGN". Row → Game review.
3. **Game review** — board (orientation = user colour), move list with
   classification glyphs (??, ?, ?!), eval graph (clickable), key-moment list
   with AI notes, "Explain this game" button if no AI note yet, "Add to review"
   for any position.
4. **Review** (SRS session) — board, prompt, user plays a move by drag/click;
   feedback; rating buttons; progress bar.
5. **Openings** — choose repertoire; tree explorer with comments; "Drill this
   line"; leak list ("In 7 games you played 4…e6 instead of 4…Bf5").
6. **Course** — lesson list with progress; lesson page (text + interactive
   exercises).
7. **Insights** — results by opening & colour, tag frequency over time,
   accuracy trend.
8. **Settings** — usernames, lichess token status, AI provider status, engine
   budget, daily limits.

Visual style: clean, light, readable; board ~560 px; no heavy design system.
Builder chooses CSS approach (plain CSS modules or Tailwind).

## 13. Quality bar

- Vitest unit tests for: PGN parsing and user colour, chess.com/lichess
  response mapping (with recorded fixture files, no network in tests), win %
  and classification, every pattern tag, leak detection, SRS card generation,
  AI output schema handling (provider mocked).
- One engine integration test (skipped if Stockfish missing).
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm validate:content` all green
  before a milestone is marked done.
- Each milestone ends with a manual smoke run of the app (start server + web,
  load the key screen).

## 14. Delivery plan (milestones)

Work is split across sessions. `docs/ROADMAP.md` is the source of truth for
status; each milestone gets its own plan in `docs/superpowers/plans/`.

- **M1 Foundation + sync + game list/viewer** — scaffold, DB, settings,
  chess.com + lichess + PGN import, games list, basic game viewer.
- **M2 Engine analysis** — engine pool, analysis jobs, classification,
  accuracy, tags, key moments, review screen with eval graph.
- **M3 SRS core + mistake cards** — ts-fsrs, card store, review screen,
  mistake cards from analysis, dashboard v1.
- **M4 Openings** — repertoire content (Caro-Kann, London) + validator,
  tree explorer, opening cards + drill, leak detection.
- **M5 AI coach** — provider interface + 5 adapters, game review notes,
  weakness report, caching.
- **M6 Course** — 12 lessons with validated exercises, lesson pages, lesson
  cards, tag → lesson links.
- **M7 Insights + polish** — insights page, dashboard focus, settings page
  completeness, empty states, README.

## 15. Left to the builder

- Exact SQL columns and indexes, API route shapes, component structure.
- CSS approach; chart library for the eval graph and insights (or plain SVG).
- Accuracy mean variant (document the choice).
- How the CLI provider passes the schema (prompt instruction vs flag), as
  long as output is zod-validated and retried once on parse failure.

## 16. Calls made without the owner (review these)

- Local-only app, no deployment, no auth.
- Stack: TypeScript, Hono, Vite + React, node:sqlite, native Stockfish 19
  (installed with Homebrew during setup).
- Lichess needs a personal token (their API now refuses anonymous export).
- AI: five provider adapters; `auto` prefers subscriptions (claude CLI, then
  codex CLI). No LiteLLM.
- Course list of 12 lessons and the repertoire coverage above.
- Daily review cap 20, new opening cards 10/day.

## 17. Settled after the builder check (all are my calls)

1. **Plan scope.** One plan per milestone. The data model in §7 is the shared
   contract; later milestones add tables with new migrations.
2. **First sync and analysis order.**
   - First sync fetches the last 12 months only (`sync.initialMonths`,
     default 12). Later syncs are incremental.
   - After a sync, analysis jobs queue automatically for the newest 50
     unanalysed games, newest first. Older games are analysed on demand
     (opening a game, or "Analyse more" on the Games page).
   - Games with fewer than 6 moves by the user (aborts) are stored but never
     analysed. All time classes are analysed.
3. **Unknown user colour.** `games.user_color` is nullable. Sync requires a
   configured username, so synced games always resolve it. If both players
   match, or a PGN import matches nobody, the import UI asks "Which side did
   you play?" (White / Black / Neither). Games with a null colour can be
   viewed but are excluded from analysis, cards, and insights.
4. **Mistake cards vs re-analysis.**
   - Card identity is the position key (FEN without move counters) plus kind.
     The same position from two games is one card; `ref` keeps a list of
     game ids/plies.
   - Re-analysis updates the accepted answers of existing cards and keeps
     their FSRS state. If a position is no longer a mistake, its card is
     suspended, not deleted.
5. **Prose quality.** No human gate. Each content file gets (a) the machine
   validator from §9 and (b) a separate reviewer agent that checks every
   comment/explanation against the engine output for that position. The app
   adds a "Report a problem" button on cards and lesson exercises that stores
   a flag and suspends the card; flags show on the Settings page.
