# M12a plans — content review ledger

Date: 2026-10-29. Reviewer: the main session (no subagents; owner instruction).
Method: every claim of every plan was checked square by square with chess.js (script kept outside the repo),
and every evaluation word with Stockfish 19 at 1M nodes after `ucinewgame` (`scripts/plan-probe.ts`,
`pnpm validate:plans`). `pnpm check:sequences` replays every line in the texts.

## Result

| Plan | Level | Claims checked | False or misleading found | Fixed |
|------|-------|----------------|---------------------------|-------|
| `london-kingside-attack` | 1 | 15 | 0 | — |
| `london-h-file` | 1 | 14 | 0 | — |
| `london-e4-break` | 1 | 13 | 1 | yes |
| `caro-advance-d4` | 1 | 16 | 2 | yes |
| `no-clear-plan` | 1 | 11 | 1 | yes |

## Errors found by the tools while authoring

- `Qf3` is illegal in the London position A (the knight stands on f3). The validator reports illegal choices.
- Step and summary texts named moves that do not replay from the board they start on (4 sequence errors). Reworded.
- Wrong quiz choices that lose less than 10 win % are not clearly wrong. Replaced:
  `e4` (5 win %) in London position A, `Ne5` and `h4` in other boards, `Qd7`/`Nd7` in Caro position B.

## Claims fixed in the review pass

1. `london-e4-break`, quiz "push-now": "Qe2 adds a guard first". False now: the e3 pawn blocks the queen. New text: "Qe2 gets the queen ready for the push."
2. `caro-advance-d4`, quiz "break": "A knight on f6 or a bishop on c2 is lost." Misleading: `Nf6 exf6 Qxf6` loses a knight for a pawn. New text: "…Nf6 and …Bxc2 lose material."
3. `caro-advance-d4`, notNow: "in the final form" did not name the position. New text: "After …Ne7 and O-O, …".
4. `no-clear-plan`, quiz "king-safety": "Qe2 prepares to castle" is false (castling needs no preparation), and `Qe2` is not king safety. `Qe2` removed; the quiz has two choices.

## Plans from the spec that were NOT written, and why (owner decision needed)

- **`opposite-castling-race`** (Caro-Kann Classical, White castles long, Black short). The pawn storm is not supported by Stockfish.
  In `…O-O Ne4` the storm moves `…c5`, `…a5`, `…b5` lose 1 to 3 win %. After `Nxe4 Qxe4` they lose 8 to 20 win %
  (`…c5` 20.1, `…b5` 16.8, `…a5` 8.7) and `…Nf6` is the move (0.7). `g4` is not even legal for White in that line.
  Lesson 8 uses synthetic positions that no line of the repertoires reaches. A real race plan needs an opening where
  the storm is engine-backed. Candidate for M12c.
- **`london-vs-qb6`** ("play for the c4 pawn", the M10 guide plan for `…Qb6 Qb3 c4 Qxb6 axb6 Be2`). In that position Black's best move
  is `…b5` (+0.49 for Black; `…Bd7` and `…Be7` lose 5 to 6 win %). The guide text "play for the c4 pawn" may promise more than the
  position gives. Candidate for an M10 guide check.

## Engine facts used (1M nodes)

- London A: `Re1` 0.0, `Qe2` 0.6, `Ne5` 1.6 loss; `Bxh7+` 41.9; `b4` 15.6; `e4` 5.2; `h4` 4.9.
- London A + `Ne5 Ne7`: `Qf3` 0.0, `Re1` 0.0; `Qh5` 47.4; `Nxf7` 38.0; `Bxh7+` 41.4.
- London A + `Qe2 Ne7`: `Rad1` 0.3, `Rfd1` 0.6; `Bxh7+` 42.0.
- London h-file C (after `…Bxg3 hxg3 O-O`): `Ne5` 0.8, `Bd3` 2.5, `Nbd2` 0.5; `Rh5` 50.9; `Rxh7` 47.0; `g4` 11.7.
- Caro-Kann P4 (`…e6 Be2`): `c5` 1.3; `Nf6` 37.6; `Bxc2` 38.7. Position B: `Nbc6` 0.0; `Ng6` 38.2 (`Bb5+`); `Qb6` 43.1.
- Checklist boards: `Na3` 1.2 vs `c3` 37.3, `Qd2` 44.3; `O-O` 3.5 vs `Bxh7+` 44.1; `Nbd2` 0.4, `Bd3` 0.0 vs `e4` 23.9.

## Warnings left (36 `missed-good-move`)

Many middlegame moves are within 5 win % of the best move (Appendix A of the spec). The quiz lists the move that fits the plan
and accepts a free board move through the engine check (default rating Hard). The warnings stay as information.
