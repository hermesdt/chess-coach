# M13 — Missed-mate cards (design)

Date: 2026-10-29. Status: draft, waits for owner approval.

## Intent

The owner (chess.com ~550) often does not see a checkmate in 1 or 2 moves. The app turns each such miss in the
owner's own games into a review card. The owner plays the mate on the board. The owner sees the move that was
played in the game.

## Goals

- One `mate` card for each position where the owner could mate in 1 or 2 and did not play the fastest mate.
- A slower mate is a miss. The owner's rule: mate must happen as soon as possible.
- The card shows the move played in the game: "You played Rb1. Find the mate."
- New cards appear without a manual step: after each game analysis, and once at start for games already analysed.
- No AI text and no new engine run. Every fact comes from stored analysis and chess.js.

## Non-goals

- Mate in 3 or more.
- Drills from positions outside the owner's games.
- A fix for the classifier, which marks some missed mates as `good` (separate roadmap item; it needs a new
  `ANALYSIS_VERSION` and a re-analysis of all games).
- Coach chat or game-page links to the card (candidate for M12b).

## Anti-goals

- A card for a mate that chess.js cannot confirm. Stockfish text in the stored analysis is a hint, not proof.
- A card that shows the answer before the owner moves.
- Two cards for one position (a `mistake` card and a `mate` card).

## Approaches

- **A. New card kind `mate` (chosen by the owner).** Scan stored analysis. No re-analysis. Same pattern as `plan` cards.
- B. Reuse the `mistake` kind. Rejected: many missed mates are classed `good`, so no mistake card exists, and the
  unique key (kind, position) would collide.
- C. Make a missed mate a blunder in the classifier. Rejected for now: it needs re-analysis of 88 games and changes
  accuracy and key moments. Kept as a roadmap item.

## Design

**Finding the misses.** Input is `move_analysis` rows of finished analyses. A row qualifies when:
`isUserMove`, `evalBefore.mate` is 1 or 2, and the played move is not a fastest mate.
Today this gives about 25 positions in 88 games (about 12 mate in 1 and 13 mate in 2).

**Proof with chess.js.** A pure function `findMates(fen)` returns `{ mateIn, moves }`. `moves` is every legal move that
mates in `mateIn` (1 or 2), found by exhaustive search (no engine). The scan makes a card only when:
- `findMates(fenBefore).mateIn` equals the stored mate distance, and
- the played move is not in `moves`.
If chess.js disagrees with Stockfish, the scan makes no card and counts it as `skipped`.

**Card.** Kind `mate`, key `positionKey(fenBefore)`, `refs: [{ gameId, ply }]`.
Solution: `accepted` (all UCI moves in `moves`), `best` (the stored `bestUci` when it is in `moves`, else the first),
`mateIn`, `played` (SAN of the owner's move), and an explanation. For mate in 2 the explanation shows the line from
`pvSan`, only when chess.js replays it to mate. Prompt: "White to move. You played Rb1 in a game. Find the mate in 1."
The owner sees the played move as text. A red arrow for it is a nice extra; the builder may skip it.

**Answering.** The accepted list is complete, so the check needs no engine. A move in `accepted` is right.
Any other move is wrong. After the answer the card shows the mate line and the game link.
For mate in 2 the owner plays only the first move.

**Sync.**
- `syncMateCards(db)` scans all finished analyses at the current version. It is idempotent.
  Runs at server start (like `syncPlanCards`) and from the analysis queue after each game.
- Re-run of a game: refs that are no longer a miss are removed. A card with no refs is suspended
  (same rule as `buildMistakeCards`).
- `buildMistakeCards` makes no `mistake` card at a ply that has a `mate` card. The `mate` card wins.

**Session.** `CardKind` gains `'mate'`. New-card mix gives `mate` a quota of 10 % at every level.
The share comes from `opening` (5 points) and `mistake` (5 points). Unused quota goes to other kinds (the
existing redistribution). The mate card needs no level gate.

## Decisions I made (owner can change)

- Mate in 3 or more is out. The owner asked for 1 or 2.
- The `mate` card replaces the `mistake` card at the same ply.
- The mix quota of 10 %, and its sources.
- No engine in the scan or in the answer check.
- Stats and dashboard count the new kind with the others.

## Left to the builder

Exact UI of the card (text layout, optional red arrow), file names, the DTO shape, test fixtures built from
positions in the owner's games (recorded, not read live from `data/chess.db`).

## Tests

- `findMates`: mate in 1, mate in 2, no mate, two mating moves, stalemate trap (no card).
- Scan: a fixture of 4 analysed moves (fastest mate played, slower mate played, mate missed, chess.js disagrees).
- Sync: idempotent; a changed analysis removes the ref and suspends the card.
- Session: `mate` quota, redistribution with few cards.
- Review route: answer right, answer wrong, the answer is not in the card before the owner moves.
- Real content check on a copy of the owner's data: about 25 cards, zero cards that chess.js rejects.
