# M17 — Play-it-out cards (design)

Date: 2026-11-22. Status: approved by the owner on 2026-11-22.

## Why

The owner stopped training in November. Their words: "I didn't really find I
was improving. I know some openings, but after about 10–15 moves I don't know
what to do and blunder." Chess "requires a lot of memorization and time".

The game data agrees (120 games, July–14 November 2026, read-only check on
2026-11-22):

- About 1.8 blunders per game. Most are on moves 11–20 (87 of 215).
- `hung_piece` (109 blunders) and `missed_capture` (85) cause most of them.
  Opening tags (`no_castle`, `slow_development`) are rare.
- chess.com rapid: 537 average in October, 516 in November.
- Reviews per week: about 185 in mid-October, 74 in early November, 1 in the
  week of 9–15 November. The 46 threat cards were never reviewed.
- M16a–d added four opening parts. The leak is after the opening.

Owner's short-term success signal: **fewer blunders**, even if they lose.

Owner's idea: some cards are playable. A middlegame position without one best
move. The owner plays a few moves, gets live feedback ("you left a piece
undefended"), is blocked when a move is clearly bad, and sees at the end if
the position is better or worse.

## Goals

1. A new card kind, `playout`: the owner plays 5 of their own moves from a
   middlegame position; Stockfish plays the other side.
2. Live feedback after each owner move, from fixed templates built on the
   existing tags (`hung_piece`, `missed_capture`, `bad_trade`, `allowed_mate`,
   `missed_mate`).
3. Blunder handling "show, then rewind" (owner choice B): the blunder is
   played, Stockfish shows the punishing reply, then the board goes back and
   the owner tries again.
4. End-of-card summary: win % at the start and at the end, blunders,
   warnings.
5. Fewer new opening cards in the daily queue; play-it-out cards take part of
   that share.
6. A "blunders per game" chart by week on the dashboard.

## Non-goals

- No free practice page outside the review (owner chose option 1; option 3
  "both" can follow later in a small step).
- No new opening, lesson or plan content.
- No opponent strength setting. Stockfish replies with its best move.
- No AI-written feedback in the card. The coach chat stays as it is.
- No clocks or time pressure.

## Anti-goals (a failure even if it works)

- The card feels like memorization: one "correct" line that the owner must
  repeat. Any move that is not a blunder is accepted.
- A blocked move on a small error. Only blunders rewind; mistakes and
  inaccuracies give a warning and the game goes on.
- Feedback that names a move, square or piece that chess.js or Stockfish did
  not produce.
- Slow cards. Each owner move must get feedback in about 1–2 seconds.
- A daily session that grows longer than today's.

## Constraints

- Project rules: moves come only from Stockfish, chess.js or validated
  `content/`. Tests use fakes or recorded fixtures, never the network or a
  real engine run in unit tests. Server binds to 127.0.0.1.
- No subagents (owner instruction 2026-11-10).
- The owner is level 1 (chess.com ~520).
- `data/chess.db` must not be overwritten. A backup is needed before a merge
  that adds a migration (`data/backups/pre-m17-<date>.db`).

## Approaches considered

| # | Approach | Trade-off | Decision |
|---|----------|-----------|----------|
| 1 | New card kind in the daily review (FSRS) | Reuses queue, scheduler, multi-move board, tags. The same position can come back. | **Chosen by owner** |
| 2 | Separate practice page, random positions, no scheduling | Simpler, but easy to forget; weak positions do not come back. | Rejected |
| 3 | Both, one shared board | Most value, most work. | Later, if wanted |

Blunder handling options: A block before the move, **B show then rewind
(chosen)**, C no block.

## Design

### Card sources

1. **Own games (main source).** For each user blunder or mistake at user
   move 10–25 in an analysed, non-duplicate game, the start position is the
   position two user moves earlier (so the danger comes inside the 5 moves).
   Keep it only when:
   - the user is to move and not in check;
   - stored `winBefore` at the start is 25–75 (a playable position);
   - at most 2 cards per game; `UNIQUE(kind, position_key)` removes repeats.
   The stored `move_analysis` data is enough; no new engine run at build time.
   Refs: `gameId`, `ply` (for "See the game").
2. **Repertoire ends (second source).** The last node of each repertoire line
   at or below the current level, for the colour the owner plays in that
   repertoire. Keep it only when an engine check (`CHECK_NODES`) gives a
   win % of 25–75 for the owner. Refs: `repertoire`, `nodeId`. These cards
   get a later `sort_order` than own-game cards, so own-game cards come
   first.

Builder: follow the existing backfill pattern (`mistake-cards`,
`threat-cards`): build at start-up and after each analysis, with a
`playout_cards_built_at` column on `game_analysis` (migration).

### Playing a card

Card prompt: "Play 5 moves. Before each move: Is my piece safe? Can I take
something for free?" It links to lesson `01-blunder-check`.

Per owner move, the client calls a new endpoint, for example
`POST /review/cards/:id/playout-step` with `{ fen, uci }`. The server:

1. Checks the move with chess.js (illegal → 400).
2. Gets engine lines (multipv 1, `CHECK_NODES`, existing pool and cache) at
   the position before and after the move.
3. Computes win % before/after, the classification (`classify`) and the tags
   (`materialTags`, plus the piece and square details the templates need).
4. Picks the Stockfish reply (`bestAfter.pv[0]`) and returns it with the new
   FEN, so the client can play it.
5. Returns `{ san, classification, tags, details, winBefore, winAfter,
   reply: { uci, san } | null, gameOver }`.

The server keeps no game state; the client sends the FEN each time. Server
work per move must stay near 1 s. The first `fenBefore` can come from the
cache.

Client behaviour (new component, built like `MateLine`):

- **Blunder** (`classification === 'blunder'`): play the move, then play
  Stockfish's reply on the board, show the template text (for example "Your
  knight on e5 was undefended. Bxe5 takes it."), then a "Try again" button
  moves the board back to before the blunder. A blunder does not use one of
  the 5 moves. After a second rewind at the same position, show Stockfish's
  best move as a hint (arrow) before the next try.
- **Mistake or inaccuracy:** keep the move, play the reply, show a short
  warning, continue.
- **Other moves:** play the reply, show nothing or a short "Safe move".
- **End:** after 5 kept owner moves, or when the game ends (mate, stalemate).
  Show win % at the start and the end ("Better", "About the same", "Worse",
  with a 10-point band), number of rewinds and warnings.

Template texts (fixed strings, filled with chess.js data only):

| Tag | Text |
|-----|------|
| `hung_piece` | "Your {piece} on {square} was undefended. {replySan} takes it." |
| `missed_capture` | "You could take the {piece} on {square}: {bestSan}." |
| `bad_trade` | "This trade loses material. Count the pieces before you take." |
| `allowed_mate` | "This move allows mate. {replySan} starts it." |
| `missed_mate` | "You had a mate: {bestSan}." |
| no tag | "This move loses {n} % of your winning chances. Stockfish prefers {bestSan}." |

### Rating

Default rating from the result; the owner can change it as with other cards:

- Good: no rewind, and end win % ≥ start win % − 10.
- Hard: one rewind, or no rewind but end win % fell more than 10.
- Again: two or more rewinds.

### Daily queue

Add `playout` to `CardKind`, `KIND_ORDER`, `QUOTA_ORDER` and `NEW_MIX`.
Proposed mix (opening share goes down, play-it-out takes the space):

| Level | mistake | mate | threat | lesson | plan | opening | playout |
|-------|---------|------|--------|--------|------|---------|---------|
| 1 | 0.15 | 0.1 | 0.1 | 0.2 | 0.1 | 0.05 | 0.3 |
| 2 | 0.15 | 0.1 | 0.1 | 0.2 | 0.1 | 0.15 | 0.2 |
| 3 | 0.1 | 0.1 | 0.1 | 0.15 | 0.15 | 0.25 | 0.15 |

Shares stay multiples of 0.05 (the quota code needs that). Due opening cards
still come back; only new opening cards slow down. Daily and new-card limits
stay as the owner set them.

### Progress view

Dashboard: a weekly line "Blunders per game" (user blunders ÷ analysed
non-duplicate games, by week of `played_at`), with the last 4 weeks against
the 4 weeks before as one number. Reuse `LineSeries`. Optional second line:
play-it-out cards with no rewind, % by week.

## Left to the builder

- Exact engine budget, if `CHECK_NODES` is too slow or too weak for the reply.
- The detail extraction for templates (piece, square) next to `materialTags`.
- Animation timings and the hint arrow style.
- Test fixtures: a fake engine pool that returns fixed lines per FEN.
- Split into M17a (card kind, own-game source, step endpoint, board, rating,
  queue mix) and M17b (repertoire-end source, dashboard chart) if the plan is
  too large for one branch.

## Calls made by the assistant (owner may correct)

- Own games first, repertoire ends second.
- Start two user moves before a real blunder or mistake.
- 5 moves per card; full-strength Stockfish reply.
- The level mix numbers above.
- The 25–75 win % window for a playable start.
- Hint after the second rewind.
