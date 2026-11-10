# M15 — Longer mates (design)

Date: 2026-11-10. Status: draft, waits for owner approval.

## Intent

The owner (chess.com ~550) finds mates in 1 and 2 with the M13 mate cards. In the owner's words: "I usually have a hard
time finding mates beyond 2 moves". The games agree (read-only scan, 2026-11-10): the owner had a mate in 3 in 40
positions and did not play the fastest mate in 26; a mate in 4 in 28 positions and missed the fastest in 13. The mate
was lost completely 16 times across mate in 3 to 8.

M15 extends the mate cards to **mate in 3 and mate in 4**. The owner plays the whole mate; the app plays the
opponent's longest defence after each owner move.

## Goals

- A `mate` card for each position where the owner had a mate in 3 or 4 and did not play a fastest mate.
- A slower mate is a miss (M13 owner rule: mate as soon as possible).
- The owner plays every own move of the mate. After each right move the app plays the longest defence.
- Every move on the card is proven: Stockfish proposes the owner's moves, chess.js checks **every** defence.
- New cards appear after each game analysis and once for games already analysed.

## Non-goals

- Mate in 5 or more.
- Positions outside the owner's games.
- A live engine during review (owner's choice: precomputed).
- A change to the classifier or to `ANALYSIS_VERSION`.

## Anti-goals

- A card whose mate chess.js has not proven against every defence.
- A defence that is not the longest one (the owner would get an easier mate than the position gives).
- A card that shows the answer before the owner moves.
- Two active cards for one position.

## Approaches

The owner chose **precomputed** (approach 1):

1. **Precomputed (chosen).** Solve each mate once when a game is analysed. Store the answer tree on the card: the
   owner's accepted moves at each step and the defence after each one. No engine during review. Trade-off: at steps
   that need the engine, the app accepts only proven moves among the top 5 Stockfish lines; a rare equally fast mate
   outside them counts as wrong.
2. Live engine. Every equally fast mate is accepted, but each move waits for the engine and review needs it running.
3. Mix: the stored tree plus a live engine check for unknown moves. Most code.

Earlier owner decisions: mate in 3 and 4 (not 3 only, not 5+); M15 comes before the 1.e4 repertoire (M16a–d).

## Design

### Words

- **Owner node:** a position where the owner is to move and has a forced mate in `k` moves.
- **Defence node:** the position after an owner move; the opponent is to move.
- **Proven mate in k:** `k ≤ 2` — `findMates` (M13, exhaustive chess.js) returns `mateIn === k` and lists every
  move. `k ≥ 3` — an owner move M such that, after M, the opponent has at least one legal move and **every** legal
  reply leads to a proven mate in `k-1` or less.

### Finding the misses

For each owner move `m` (finished analysis, current `ANALYSIS_VERSION`):

- `m.isUserMove`, stored `m.evalBefore.mate` is 3 or 4.
- The played move is not a fastest mate: stored `m.evalAfter.mate !== -(n-1)` (opponent's view).
- `findMates(m.fenBefore)` is null (no mate in 1 or 2; otherwise M13 owns the position).

Expected: about 26 mate in 3 and 13 mate in 4. The proof removes some.

### Proof and the answer tree (Stockfish proposes, chess.js proves)

`proveMate(fen, k, pool, budget)` returns a tree node or null:

- `k ≤ 2`: use `findMates`. Accepted = all its moves (complete list). After each accepted move, the defence is the
  reply with the longest remaining mate (mate in 1 after a mate-in-2 move: any reply; pick per the tie rule).
- `k ≥ 3`: `pool.analyse(fen, { nodes, multipv: 5 })`. Candidates = lines whose score is mate in exactly `k` for the
  side to move. For each candidate M: play M; enumerate every legal reply with chess.js; each reply must give a
  proven mate in `k-1` or less (recursive). The candidate is accepted when all replies pass. Accepted is never empty
  for a stored card.
- **Exact distance:** the distance of an owner move M is 1 + the longest proven remaining mate over all replies. M is
  accepted only when this equals `k` (a fastest move). A root whose best proven distance is not exactly the stored
  `n` is skipped.
- **Longest defence:** after an accepted owner move, the app plays the reply whose proven remaining mate is longest.
  Ties: the reply in the stored engine line (`pvSan`) if it is one of them, else the first in chess.js move order.
- **Budget:** at most 60 engine calls and 20 s of chess.js work per position. Over budget → the position is skipped
  (`skipped` count).
- The tree stores, per owner node: `accepted: { uci, san, defence: { uci, san } | null, next: Node | null }[]`.
  `defence: null` and `next: null` mean the move is checkmate.
- The stored engine line is only a hint. If chess.js does not prove a mate in exactly `n` (the stored distance), the
  position is skipped.

### Card

- Kind `mate` (the M13 kind). `mateIn` widens to `1 | 2 | 3 | 4`.
- Key `positionKey(fenBefore)`, `refs: [{ gameId, ply }]`, `lastMove: null` (as M13).
- Prompt: "White to move. You played Qd2 in a game. Find the mate in 3."
- Solution: `accepted` (root accepted moves), `best` (root move of the main line), `mateIn`, `played`, `tree`
  (the node above), `explanation`: the main line in SAN, from the tree only, e.g.
  "Mate in 3: Qh7+ Kf8 Qh8+ Ke7 Qxg7#." Main line = at each owner node the first accepted move (the engine's best when
  it is accepted), then the stored defence.
- Mate in 1 and 2 cards stay as they are (no `tree`; one move).

### Review flow

```
Board: fenBefore, owner's orientation. "Find the mate in 3. Move 1 of 3."
Owner move → in tree accepted?
  yes, mate      → "Correct. This is the fastest mate."
  yes, not mate  → app plays the defence (short delay), "Move 2 of 3", continue
  no             → board locks; the main line from this node shows as arrows and text
                   ("Not quite. The fastest mate is Qh7+ Kf8 Qh8+ Ke7 Qxg7#.")
Ratings: all four after a full mate; only Again after a wrong move (owner rule).
```

- `answerUci` stores the owner's first move.
- "See the game" opens `/games/:id?ply=<ply-1>` (as for other mate cards).

### Sync and precedence

- New `buildLongMateCards(db, analysis, pool, { nodes })` in its own module. Idempotent.
- Queue order: `buildMateCards` (1–2), `buildLongMateCards` (3–4), `buildThreatCards`, `buildMistakeCards`.
- A long mate card replaces the threat card and the mistake card at the same ply (suspends them; the threat and the
  mistake builders skip its plies). Precedence: mate (any length) > threat > mistake.
- Re-run: a long mate card whose position is no longer a proven miss loses the ref; without refs it is suspended.
- **Each builder owns its own lengths.** `buildMateCards` (M13, runs at every start through `syncMateCards`) must
  drop refs only of mate cards with `mateIn` 1 or 2. `buildLongMateCards` drops refs only of mate cards with `mateIn`
  3 or 4. Today `buildMateCards` drops every `mate` ref it did not build; without this change every start would
  suspend all long mate cards.
- Games already analysed: a start-up job `long-mate-backfill` builds once per analysis. Marker: column
  `game_analysis.long_mate_cards_built_at` (migration 018), cleared by `saveAnalysis`.

### Session

- No quota change. Long mates share the 10 % `mate` quota.

## Constraints

- Tests never use the network or a real engine. Use a fake pool and positions proven in the test with chess.js.
- Take a backup of `data/chess.db` before the merge (migration 018).
- Manual runs use a temp copy of the database. Never write to `data/chess.db`.
- The main session implements the plan itself, without subagents (owner instruction).

## Decisions I made (the owner can change them)

- Top 5 Stockfish lines at engine steps; 60 engine calls per position at most.
- Both positions of one attack (a mate in 4, then a mate in 3 in the same game) become cards.
- The longest-defence tie rule.
- Mate cards keep the 10 % quota.
- A wrong move shows the main line from that point.
- 20 s chess.js limit per position.

## Left to the builder

- The node limit for the engine calls (the owner's `engineNodes` setting unless it is too low to find mates; then a
  fixed higher value, recorded in the log).
- How the board waits before it plays the defence (a short delay so the owner sees it).
- Shared helpers with `mate-cards.ts`, `threat-cards.ts` and `backfill.ts`.
