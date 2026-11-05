# M12c Plan Review

Date: 2026-11-04. The plans were authored with chess.js and Stockfish 19 and independently reviewed by a separate reviewer using chess.js and targeted one-million-node Stockfish searches. All boards use legal SAN from the start position.

## Findings And Fixes

- The Slav trigger originally matched with a piece blocking the rook on the a-file. Added the `clearFile` condition and a regression test. The target a2 pawn is defended; neither the plan nor its quiz promises a free pawn.
- The minority-attack trigger originally matched after the b-pawn or a-pawn was lost. It now requires both white pawns, Black's a- and b-pawns, and the Carlsbad centre. Regression tests cover both captures.
- A model incorrectly said no black pawn was on a file adjacent to c6. The d5 pawn is on an adjacent file but cannot defend c6. Corrected the comment.
- Plan steps enter the coach's fact pack at every matching anchor, not just the illustrated board. The example-specific steps now identify themselves as examples rather than claims about the current board.
- The opposite-castling trigger originally allowed a blocker on a6. It now requires a clear a6. A piece on a5 can still prevent an immediate advance: this is a strategic trigger, not a legal-move guarantee, and the example steps say to calculate each advance.
- After `...axb2`, `Kxb2` is a serious mistake, not a forced response. A separate model labelled as a trap shows `...Ra3`, attacking the queen on d3 while the bishop on e7 defends the rook. At 1M nodes White's `Kxb2` lost 50.7 win percentage points against the best reply. The primary model stops before that error and the text explicitly says White has a stronger reply.

## Engine Evidence

- Slav setup: `...b5` lost 0.3 win points, `...Bf5` 2.0, and `...e5` 14.8. In the next two examples, `...Rxa2` lost 47.9 and 48.7 points because White's rook can recapture.
- Minority attack: `Rab1` lost 1.7 points; `b4` was the top move in the next position; `b5` lost 0.3 in the later position. Capturing on d5 with the knight lost 43.4.
- Opposite castling: `...a5` lost 4.8 points, `...a4` 1.8 and `...a3` 7.8. In the model position `...axb2` lost 6.1 points. These are playable examples, not a forced win; the plan explicitly warns of White's strong kingside attack and says central or defensive moves can be preferable.
- The initial one-million-node plan-specific checks reported no errors and nine, nine and eight warnings respectively. The warnings identify other close moves and one accepted move more than five points behind the best; free board moves still receive engine feedback. The final content validation reruns these checks after the fixes.
