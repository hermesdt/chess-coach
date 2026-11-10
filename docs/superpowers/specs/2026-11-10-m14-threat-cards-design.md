# M14 — Threat cards (design)

Date: 2026-11-10. Status: draft, waits for owner approval.

## Intent

The owner (chess.com ~550) loses most games by a blunder. In the owner's words: "usually I tunnel focus". The owner
looks at the own plan and does not check what the opponent threatens.

The data agrees. The owner's 207 blunders in 116 analysed games (read-only scan, 2026-11-10):

| Cause | Blunders |
|---|---|
| A threat existed before the move, and the move did not answer it | 73 (35%) |
| The move put the moved piece on a square where it was lost | 45 (22%) |
| The move allowed a mate | 14 (7%) |
| Other (missed wins, forks, slow loss) | 75 (36%) |

"Threat existed" means: the opponent's best reply after the blunder was a capture, and the same capture was legal for
the opponent in the position before the blunder (with the opponent to move).

M14 trains one habit: **before you move, ask what the opponent threatens.** The positions come from the owner's own
games, so they are the threats the owner really misses.

## Goals

- A new card kind `threat`, one card for each position where a threat existed and the owner's move did not answer it.
- The card has two steps:
  1. "What does it threaten?" The owner plays the opponent's threat on the board.
  2. "Now find your answer." The owner plays the own move.
- The threat card replaces the mistake card at the same position (owner's choice). The mistake card is suspended.
- New cards appear without a manual step: after each game analysis, and once for games already analysed.
- No AI text. Every move comes from Stockfish or chess.js.

## Non-goals

- The 45 "moved into danger" blunders. No threat existed before the move, so step 1 does not fit. A later "is this
  move safe?" card can cover them.
- Positions outside the owner's games (puzzle sets).
- Fork and pin pattern training.
- Threats in the coach chat or on the game page.
- A fix for the classifier that marks some missed mates as `good`.

## Anti-goals

- A step 1 answer that chess.js and Stockfish do not both support.
- A card that shows the threat before the owner answers step 1.
- Two active cards for one position (a `mistake` card and a `threat` card).
- A card that rejects a correct threat because the owner found a different threat than the game had.

## Approaches

- **A. New card kind `threat`, built from stored analysis (chosen by the owner).** Same shape as M13 mate cards. A scan
  reads finished analyses. Stockfish runs only for short checks of the candidate positions.
- B. Add a threat step to the existing mistake cards. Rejected: the owner chose a separate two-step card, and the owner
  wants the old mistake card suspended.
- C. Find threats during game analysis. Rejected: it needs a new `ANALYSIS_VERSION` and a new analysis of all games,
  and gives nothing extra for this goal.

Card format: the owner chose the two-step card over a "safe / not safe" question (a guess can be right by luck) and
over a threat step inside the mistake cards.

Overlap: the owner chose "the threat card replaces the mistake card" over "keep both" and over "move the schedule to
the new card" (that needs a migration and more work). The old review history stays in the database.

## Design

### Words

- `fenBefore`: the position before the owner's move. The owner is to move.
- **Null-move position:** `fenBefore` with the side to move changed to the opponent and the en passant square cleared.
  It answers "what could the opponent do if it were their turn?".
- **Threat move:** a move of the opponent in the null-move position.

### Finding the candidates (chess.js only)

For each owner move `m` (row at ply `p`) with classification `blunder` or `mistake`, and the next row `o` (ply `p+1`):

1. Skip if `m` has a mate card (mate cards win).
2. Skip if the owner is in check at `fenBefore` (the null-move position is not legal).
3. Let `T = o.bestUci`, the opponent's best reply after the blunder.
4. The position is a candidate when one of these holds:
   - **Capture threat:** `T` is a capture, and `T` is a legal move in the null-move position.
   - **Mate threat:** the opponent has a mate in 1 or 2 after `m` (stored `o.evalBefore.mate` is 1 or 2), and
     `findMates(null-move position)` finds a mate in 1 or 2.
5. The owner's own move `m` must not be one of the accepted step 2 moves (below).

Expected size: about 73 capture threats and up to 14 mate threats. Confirmation removes some.

### Step 1 accepted moves (chess.js proves, Stockfish confirms)

Run Stockfish on the null-move position (MultiPV 3, the owner's `engineNodes` setting).

- **Mate threat:** step 1 accepts every move that `findMates` returns for the null-move position. No engine needed.
- **Capture threat:** a line is a threat when:
  - its first move is within 5 win % of the top line, and
  - chess.js replays the line for 4 plies and the opponent gains at least 2 pawns of material (P1 N3 B3 R5 Q9). This
    is the same rule as `tags-tactics.ts` (`MIN_BEST_GAIN`, `GAIN_PLIES`).
- Step 1 accepts the first move of each threat line.
- The card is made only when `T` is accepted. Otherwise the scan makes no card and counts it as `skipped`.

The step 1 explanation names the threat in SAN and the material, from chess.js only. Example:
"Bxf7+ takes a pawn and attacks your king." The builder chooses the exact wording, but every fact in it must come from
chess.js.

### Step 2 accepted moves

The same rule as mistake cards: Stockfish at `fenBefore`, MultiPV 3, `acceptedMoves(lines, played)` (within 5 win %
of the best line; the played move is never accepted). If the played move is within the margin, there is no card (same
as `buildMistakeCards`).

The step 2 explanation says what the owner played in the game and what the opponent did next. Example:
"In the game you played h6. White played Bxf7+."

### Card

- Kind `threat`, key `positionKey(fenBefore)`, `fen = fenBefore`, `sideToMove` = owner's colour.
- `lastMove` = the opponent's move before `fenBefore` (ply `p-1`), so the board highlights it.
- `refs: [{ gameId, ply: p }]`.
- Prompt: "Black to move. Your opponent just played Bc4. What does it threaten?"
- Solution (step 2 fields keep the names of the other cards):
  `accepted`, `best`, `explanation`, `played` (SAN), and
  `threat: { fen (null-move position), accepted: uci[], best: uci, explanation }`.

### Review flow

```
Step 1  Board: null-move position, owner's orientation. The opponent's pieces move.
        Prompt: "Your opponent just played Bc4. What does it threaten?"
        Right → "Yes. Bxf7+ takes a pawn and attacks your king." + arrow.
        Wrong → "The threat is Bxf7+. ..." + arrow.
        Button: "Now find your answer".
Step 2  Board: fenBefore. The owner's pieces move.
        Right / wrong feedback as for a mistake card, plus the game line.
        Rating buttons.
```

- Default rating: both steps right → Good. One step wrong → Hard. Both wrong → Again. The owner can change it.
- "See the game" opens `/games/:id?ply=<p-1>` (the position before the owner's move).
- "Report a problem" works as for other cards.

### Sync

- `buildThreatCards(db, analysis, pool, { nodes })` builds the cards of one game. It is idempotent.
- Order in the analysis queue: `buildMateCards`, then `buildThreatCards`, then `buildMistakeCards`.
- `buildMistakeCards` makes no mistake card at a ply that has a threat card for that game (as for mate cards).
- `buildThreatCards` suspends the mistake card at the same ply (reuse the `dropRefs` rule from `mate-cards.ts`).
- Re-run of a game: a threat card whose position is no longer a candidate loses the ref. A card with no refs is
  suspended.
- Games already analysed: a background job at start (like `backfillMistakeCards`) builds the threat cards once per
  analysis. It must not run the engine again at each start for games that are done.

### Session

- `CardKind` gains `'threat'`.
- New-card quota: 15 % at every level, taken from `mistake` (the threat cards replace mistake cards).
  Level 1: mistake 0.20, threat 0.15. Level 2: mistake 0.15, threat 0.15. Level 3: mistake 0.10, threat 0.15.
- Kind order and quota order: `mistake`, `mate`, `threat`, then the others.
- No level gate.

## Constraints

- Tests never use the network or a real engine. Use a fake pool and recorded positions in `__fixtures__/`.
- The builder must take a SQLite backup of `data/chess.db` before the first checkout of the branch, because this
  milestone changes start-up code (`CLAUDE.md`).
- Manual runs use `pnpm smoke:start` or a temp copy of the database. Never write to `data/chess.db` in a test.

## Decisions I made (the owner can change them)

- Classifications `blunder` and `mistake` are both scanned. The recon counted only blunders.
- The 45 "moved into danger" blunders are out of M14.
- The step 1 rule: within 5 win % and at least 2 pawns gained in 4 plies (the existing tactic-tag rule).
- The default ratings for the two steps.
- The 15 % quota and its source (`mistake`).
- The step 1 board keeps the owner's orientation.

## Builder check answers (my calls, 2026-11-10)

1. **T outside the top 3 lines.** If `T` is not one of the MultiPV lines, run the engine once more on the position
   after `T` (null-move position, then `T`). The opponent's win % for `T` is 100 minus the owner's win % there. `T` is
   accepted when it is within 5 win % of the top line and passes the 4-ply material rule. The pool needs no
   `searchmoves`. Report the real yield (cards, `skipped`) in the milestone log. If fewer than 40 cards come from the
   owner's database, stop and ask the owner before the threshold changes.
2. **Mate sign.** The mate threat needs `o.evalBefore.mate > 0` (the opponent mates). A position that is both a capture
   threat and a mate threat is a mate threat.
3. **Answer check.** Both steps are checked in the browser against `accepted`, as for mistake and mate cards. No server
   check and no "loss %" line. Each step has one try. After a wrong try the answer shows, and the card goes on to
   step 2 (or to the ratings).
4. **`answerUci`.** Store the step 2 move.
5. **Backfill marker.** Add a column `threat_cards_built_at` on `game_analysis` with a migration. A new analysis of a
   game clears it, as for `cards_built_at`. Take a backup before the merge (roadmap rule for migrations).
6. **Mistake and threat cards out of sync.** Yes: when a threat card is dropped on a re-run, the next
   `buildMistakeCards` makes the mistake card again, and `upsertCard` un-suspends it. That is the intent.
7. **Step 1 board.** The front end shows `threat.fen` (the opponent is to move) in the owner's orientation. Any legal
   opponent move can be played. Only moves in `threat.accepted` are right.

## Left to the builder

- How the start-up job remembers which analyses are done (for example a column on `game_analysis` with a migration,
  or a stored set of game ids).
- The exact explanation wording, inside the rule "facts from chess.js only".
- Shared helpers with `mate-cards.ts` and `mistake-cards.ts`.
