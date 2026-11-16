# Vienna Tree Review

Task 2, implemented inline without subagents. This is an author self-review.

## Tree

303 move nodes: 29 level 1, 146 level 2, 128 level 3. Six second-move defences:
Nf6, Nc6, Bc5, d6, Bb4 and c6. The Nf6 gambit covers the d5 counterstrike,
acceptance, d6 and Nc6. No other first Black reply is claimed to be covered.

Beyond the explicit opening recommendations, White continuations come from
Stockfish. Black continuations use its first two choices at selected branch
points and its first choice elsewhere. These are sound representative replies,
not claims about their frequency in beginner games. All moves replay in chess.js.

## Checks

- The standard repertoire validator reports content OK, no warnings, using
  recorded results from real million-node searches from the same authoring run.
- Every own move passes the existing loss threshold. Search cache records are
  ignored scratch under `.superpowers/vienna-authoring/`, not test fixtures.
- Sequence check: no issues.
- 36 targeted tests and 1491 full-suite tests pass. Typecheck and lint pass.
- Tests assert one White recommendation, level inheritance, six defences,
  central counterstrike coverage, and no London/Vienna cross-classification.

## Content Review

Early comments explain the purpose and risk of the f-pawn offer. Later comments
state board-verified attacks, central control, captures or support, without
promising material wins. They are intentionally modest where a concrete tactic
has not been exhaustively proved. Piece attacks/support are read from chess.js.

The first engine draft chose a king walk after the accepted Nc6 gambit and an
early rook manoeuvre against d6. Replaced those recommendations with Nf3 and
Bc4 respectively, regenerated their branches and repeated engine validation.

Ruling: retain recorded million-node results for validation rather than repeat
identical searches. Cost: a fresh engine run is still needed if any moves change.
Ruling: engine-ranked opponent branches are representative, not popularity
rankings. Cost: unusual practical replies remain out of book until expanded.

Guide and two middlegame plans are still Task 3. This tree is not merged to main.
