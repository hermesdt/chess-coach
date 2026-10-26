# M11 audit: ck-advance

## Scope

- File: `content/repertoires/caro-kann.json`.
- Subtrees: `e4 c6 d4 d5 e5` (Advance), `e4 c6 d4 d5 Nf3`, `e4 c6 d4 d5 Bd3`.
- Nodes: 78 in the three subtrees, 59 with a comment. All 59 comments are in the table.
- Claims: 87 rows (one row per sentence with a chess fact; two short sentences share a row when they state one fact).
- Date: 2026-10-22. Worktree `chess-m11`, branch `m11-content-audit`.
- Tools: chess.js 1.4.0 (repo `node_modules`), `attackers()` plus legal-move tests; Stockfish 19 (Homebrew), 2M nodes per search, Threads 4, Hash 256, MultiPV 3, `ucinewgame` before each search. Engine scores below are from White's side (+ = White better), in pawns.
- Known claims:
  - Owner's Report 1 (node `... Be3 cxd4`): rows ck-adv-08 and ck-adv-09.
  - ROADMAP "Content notes for the M11 audit": no note is about these subtrees.
  - `pnpm check:sequences content/repertoires/caro-kann.json`: "5 clause(s) with 2+ moves, 0 error(s), 0 warning(s)". No error or warning in this scope.
- Guide cross-check: `content/guides/caro-kann.json`, variation `advance`. One tree comment contradicts it (see "For the owner").
- Position column: for a Black move, the FEN before the move (the card position) unless the sentence is about the position after the move; for a White move, the FEN after the move.

## Claims

| id | location (file + node id / lesson id + field) | position (FEN) | sentence | claim type | check (tool and evidence) | verdict | fix |
|---|---|---|---|---|---|---|---|
| ck-adv-01 | `caro-kann.json`, node `e4 c6 d4 d5 e5`, comment | `rnbqkbnr/pp2pppp/2p5/3pP3/3P4/8/PPP2PPP/RNBQKBNR b KQkq - 0 3` | "The Advance Variation." | other | 1.e4 c6 2.d4 d5 3.e5 is the Advance Variation (same name as the guide variation `advance`, "Advance (3.e5)"). | `ok` | |
| ck-adv-02 | same node | same | "White gains space." | plan | The e5 pawn is on the fifth rank and attacks d6 and f6 (both empty). | `ok` | |
| ck-adv-03 | node `e4 c6 d4 d5 e5 Bf5`, comment | `rnbqkbnr/pp2pppp/2p5/3pP3/3P4/8/PPP2PPP/RNBQKBNR b KQkq - 0 3` | "Bring the bishop out before you play ...e6." | reason | chess.js: d7, e6, f5, g4, h3 are empty, so ...Bf5 is legal now. Alternative 3...e6: then the c8 bishop has only Bd7 (legal-move list `[Bd7]`). | `ok` | |
| ck-adv-04 | same node | same | "This is the key Caro-Kann idea." | other | Same idea in the guide route ("Bring the bishop out now. After ...e6 it would be shut in"). | `ok` | |
| ck-adv-05 | node `... e5 Bf5 Nf3 e6`, comment | after: `rn1qkbnr/pp3ppp/2p1p3/3pPb2/3P4/5N2/PPP2PPP/RNBQKB1R w KQkq - 0 5` | "Now the bishop is outside your pawns." | geometry | The bishop is on f5, in front of the c6-d5-e6 chain, not behind it. | `ok` | |
| ck-adv-06 | same node | same | "Close the centre and stay solid." | plan | After ...e6 the pawns d4, e5, d5, e6 are all blocked (each front square is occupied). The e6 pawn guards d5 and f5 (`attackers`: d5 B[d8,c6,e6], f5 B[e6]). | `ok` | |
| ck-adv-07 | node `... Nf3 e6 Be2 c5`, comment | after: `rn1qkbnr/pp3ppp/4p3/2ppPb2/3P4/5N2/PPP1BPPP/RNBQK2R w KQkq - 0 6` | "Hit the centre with a pawn. ...c5 attacks d4 and fights their space." | attack/guard | `attackers(d4,'b')` = [c5]. d4 is the pawn that guards e5 (base of the chain, as in the guide). | `ok` | |
| ck-adv-08 | node `... Be2 c5 Be3 cxd4`, comment (owner Report 1) | `rn1qkbnr/pp3ppp/4p3/2ppPb2/3P4/4BN2/PPP1BPPP/RN1QK2R b KQkq - 1 6` | "Take the pawn." | other | The c5 pawn takes the d4 pawn (`attackers(d4,'b')` = [c5]). The sentence does not say which pawn; the owner did not understand it. Covered by the fix of ck-adv-09. | `ok` | (rewritten with ck-adv-09) |
| ck-adv-09 | same node | after: `rn1qkbnr/pp3ppp/4p3/3pPb2/3p4/4BN2/PPP1BPPP/RN1QK2R w KQkq - 0 7` | "If they take back, you play on with an easy game." | evaluation, reason | (1) "If" is wrong: the new d4 pawn attacks the e3 bishop (`attackers(e3,'b')` = [d4]). White's three best moves at 3M nodes all take back or check first: Nxd4 +0.32, Bb5+ 0.00 (then Nxd4), Qxd4 -0.15, Bxd4 -0.26. A bishop retreat loses the pawn (Bf4 -1.07, Bc1 -1.08). (2) "Easy game" has no support: after Nxd4 White keeps a small edge (+0.3 to +0.45). (3) The true gain: after the trade no white pawn guards e5 (`attackers(e5,'w')` after Nxd4 = []; d4 pawn gone), which is the guide's middlegame idea. | `misleading` | Whole comment: "Take on d4. Then no white pawn guards e5, and your d4 pawn attacks the e3 bishop, so White takes back." |
| ck-adv-10 | node `... Be3 cxd4 Nxd4 Ne7`, comment | after: `rn1qkb1r/pp2nppp/4p3/3pPb2/3N4/4B3/PPP1BPPP/RN1QK2R w KQkq - 1 8` | "Develop and get ready to castle." | plan | Ne7 develops and empties g8; f8 bishop still to move before O-O. True as a step. | `ok` | |
| ck-adv-11 | same node | same | "The knight guards your bishop on f5 and can go to c6 next." | attack/guard, plan | Guard: `attackers(f5,'b')` = [e7,e6]; the Nd4 attacks f5 (W[d4]), so the guard matters. "Can go to c6 next": legal, but the tree plays ...Nbc6 (the b8 knight) next, and the guide says the b8 knight goes to c6. After O-O, ...Nec6 is a mistake: Stockfish searchmoves e7c6 gives +2.14 (line Nxf5 exf5 f4); ...Nbc6 gives +0.28. | `misleading` | "Develop and get ready to castle. The knight guards your f5 bishop, and the b8 knight goes to c6 next." |
| ck-adv-12 | node `... Nxd4 Ne7 O-O Nbc6`, comment | after: `r2qkb1r/pp2nppp/2n1p3/3pPb2/3N4/4B3/PPP1BPPP/RN1Q1RK1 w kq - 3 9` | "Hit the d4 knight." | attack/guard | `attackers(d4,'b')` = [c6]. | `ok` | |
| ck-adv-13 | same node | same | "Now every piece fights for the centre." | count, general-rule | Black pieces that attack d4, e4, d5 or e5: Nc6 (d4, e5), Ne7 (d5), Qd8 (d5), Bf5 (e4) = 4 of 8. Ra8, Rh8, Bf8 (blocked by Ne7 and g7) and Ke8 attack no centre square. | `false` | "Hit the d4 knight. Now both your knights fight for the centre." |
| ck-adv-14 | node `... Nbc6 Bb5`, comment | after: `r2qkb1r/pp2nppp/2n1p3/1B1pPb2/3N4/4B3/PPP2PPP/RN1Q1RK1 b kq - 4 9` | "White attacks your c6 knight a second time and pins it to your king." | attack/guard, pin | `attackers(c6,'w')` = [b5,d4] (2). d7 is empty, king on e8; legal moves of the c6 knight = [] (pinned). | `ok` | |
| ck-adv-15 | same node | same | "The b7 pawn and the e7 knight guard it." | attack/guard | `attackers(c6,'b')` = [b7,e7]. | `ok` | |
| ck-adv-16 | node `... Bb5 a6`, comment | after: `r2qkb1r/1p2nppp/p1n1p3/1B1pPb2/3N4/4B3/PPP2PPP/RN1Q1RK1 w kq - 0 10` | "Attack the bishop with the pawn." | attack/guard | `attackers(b5,'b')` = [a6]. | `ok` | |
| ck-adv-17 | same node | same | "The d4 knight guards it, so White can take on c6 or move the bishop." | reason | Guard true: `attackers(b5,'w')` = [d4]. The "so" is wrong: the guard does not help, because a pawn takes a bishop. Test: 10.a3 (ignore) axb5 Nxb5 = -6.69. White's choices: Bxc6+ +0.34, Nxc6 -0.30, Be2 -0.78. White must take or retreat whatever the guard. | `misleading` | "Attack the bishop with the pawn. A bishop is worth more than a pawn, so White takes on c6 or moves the bishop." |
| ck-adv-18 | node `... a6 Bxc6+`, comment | after: `r2qkb1r/1p2nppp/p1B1p3/3pPb2/3N4/4B3/PPP2PPP/RN1Q1RK1 b kq - 0 10` | "White takes the knight with check." | other | chess.js `inCheck()` = true (d7 empty). | `ok` | |
| ck-adv-19 | node `... Bxc6+ bxc6`, comment | after: `r2qkb1r/4nppp/p1p1p3/3pPb2/3N4/4B3/PPP2PPP/RN1Q1RK1 w kq - 0 11` | "Retake with the b-pawn. The new pawn on c6 guards your d5 pawn." | attack/guard | `attackers(d5,'b')` = [d8,e7,c6,e6]. | `ok` | |
| ck-adv-20 | node `... bxc6 c4`, comment | after: `r2qkb1r/4nppp/p1p1p3/3pPb2/2PN4/4B3/PP3PPP/RN1Q1RK1 b kq - 0 11` | "White attacks your d5 pawn." | attack/guard | `attackers(d5,'w')` = [c4]. | `ok` | |
| ck-adv-21 | node `... c4 c5`, comment | after: `r2qkb1r/4nppp/p3p3/2ppPb2/2PN4/4B3/PP3PPP/RN1Q1RK1 w kq - 0 12` | "Attack the d4 knight with the pawn." | attack/guard | `attackers(d4,'b')` = [c5]. | `ok` | |
| ck-adv-22 | same node | same | "Your d5 pawn stays guarded by the e6 pawn and the e7 knight." | attack/guard | `attackers(d5,'b')` = [d8,e7,e6]. True (the queen also guards it; the sentence does not say "only"). | `ok` | |
| ck-adv-23 | node `... c5 Nxf5`, comment | after: `r2qkb1r/4nppp/p3p3/2ppPN2/2P5/4B3/PP3PPP/RN1Q1RK1 b kq - 0 12` | "White takes your bishop with the knight." | other | Move d4xf5 captures the f5 bishop. | `ok` | |
| ck-adv-24 | node `... Nxf5 Nxf5`, comment | after: `r2qkb1r/5ppp/p3p3/2ppPn2/2P5/4B3/PP3PPP/RN1Q1RK1 w kq - 0 13` | "Retake with the knight from e7. Material is level" | trade-or-sacrifice, count | Material count (P1 N3 B3 R5 Q9): White 32, Black 32. | `ok` | |
| ck-adv-25 | same node | same | "and your f5 knight attacks the e3 bishop." | attack/guard | `attackers(e3,'b')` = [f5]. | `ok` | |
| ck-adv-26 | node `... Be2 c5 dxc5 Bxc5`, comment | `rn1qkbnr/pp3ppp/4p3/2PpPb2/8/5N2/PPP1BPPP/RNBQK2R b KQkq - 0 6` | "Take the pawn back and develop your dark bishop." | other | dxc5 took the c5 pawn; Bxc5 takes back. chess.js `squareColor`: f8 dark, c5 dark. | `ok` | |
| ck-adv-27 | node `... dxc5 Bxc5 c4`, comment | after: `rn1qk1nr/pp3ppp/4p3/2bpPb2/2P5/5N2/PP2BPPP/RNBQK2R b KQkq - 0 7` | "White attacks your d5 pawn." | attack/guard | `attackers(d5,'w')` = [c4,d1]. | `ok` | |
| ck-adv-28 | node `... Bxc5 c4 Ne7`, comment | after: `rn1qk2r/pp2nppp/4p3/2bpPb2/2P5/5N2/PP2BPPP/RNBQK2R w KQkq - 1 8` | "Guard d5 once more with a developing move." | count | Guards of d5 before: [d8,e6] (2); after: [d8,e7,e6] (3). | `ok` | |
| ck-adv-29 | same node | same | "Now the e6 pawn, the queen and the e7 knight all guard it." | attack/guard | `attackers(d5,'b')` = [d8,e7,e6]. | `ok` | |
| ck-adv-30 | node `... Ne7 cxd5`, comment | after: `rn1qk2r/pp2nppp/4p3/2bPPb2/8/5N2/PP2BPPP/RNBQK2R b KQkq - 0 8` | "White takes the d5 pawn." | other | c4xd5. | `ok` | |
| ck-adv-31 | node `... cxd5 Nxd5`, comment | after: `rn1qk2r/pp3ppp/4p3/2bnPb2/8/5N2/PP2BPPP/RNBQK2R w KQkq - 0 9` | "Retake with the knight. From d5 it attacks the squares c3, e3 and f4." | attack/guard | `attackers(c3/e3/f4,'b')` all include d5 (it also attacks b4; the sentence does not say "only"). | `ok` | |
| ck-adv-32 | node `... Nxd5 Nc3`, comment | after: `rn1qk2r/pp3ppp/4p3/2bnPb2/8/2N2N2/PP2BPPP/R1BQK2R b KQkq - 1 9` | "White develops and attacks your knight on d5." | attack/guard | `attackers(d5,'w')` = [c3,d1]. | `ok` | |
| ck-adv-33 | node `... Nc3 Nc6`, comment | after: `r2qk2r/pp3ppp/2n1p3/2bnPb2/8/2N2N2/PP2BPPP/R1BQK2R w KQkq - 2 10` | "Develop your last knight." | count | Before ...Nc6 the only knight on its home square was b8. | `ok` | |
| ck-adv-34 | same node | same | "The d5 knight stays guarded by the e6 pawn and the queen." | attack/guard | `attackers(d5,'b')` = [d8,e6]. | `ok` | |
| ck-adv-35 | node `... Nf3 e6 Bd3 Bxd3`, comment | `rn1qkbnr/pp3ppp/2p1p3/3pPb2/3P4/3B1N2/PPP2PPP/RNBQK2R b KQkq - 1 5` | "Trade their active bishop." | trade-or-sacrifice | Bxd3 Qxd3: bishop for bishop. Stockfish: Bxd3 best (+0.14), Ne7 +0.25, Bg6 +0.43. | `ok` | |
| ck-adv-36 | same node | same | "Then hit the centre with ...c5." | sequence | Replayed: Bxd3 Qxd3 c5 legal (tree node exists). After ...c5 White's top replies keep a normal game (c3 in the engine line). | `ok` | |
| ck-adv-37 | node `... Bxd3 Qxd3 c5`, comment | after: `rn1qkbnr/pp3ppp/4p3/2ppP3/3P4/3Q1N2/PPP2PPP/RNB1K2R w KQkq - 0 7` | "Hit the centre with a pawn. ...c5 attacks d4." | attack/guard | `attackers(d4,'b')` = [c5]. | `ok` | |
| ck-adv-38 | node `... Qxd3 c5 c3`, comment | after: `rn1qkbnr/pp3ppp/4p3/2ppP3/3P4/2PQ1N2/PP3PPP/RNB1K2R b KQkq - 0 7` | "White guards the d4 pawn once more with the c-pawn." | count | Guards of d4: before [d3,f3] (2); after [c3,d3,f3] (3). | `ok` | |
| ck-adv-39 | node `... c3 Nd7`, comment | after: `r2qkbnr/pp1n1ppp/4p3/2ppP3/3P4/2PQ1N2/PP3PPP/RNB1K2R w KQkq - 1 8` | "Attack the e5 pawn with a developing move." | attack/guard | `attackers(e5,'b')` = [d7]. | `ok` | |
| ck-adv-40 | same node | same | "The knight also guards your c5 pawn." | attack/guard | `attackers(c5,'b')` = [f8,d7]. | `ok` | |
| ck-adv-41 | node `... Nd7 O-O`, comment | after: `r2qkbnr/pp1n1ppp/4p3/2ppP3/3P4/2PQ1N2/PP3PPP/RNB2RK1 b kq - 2 8` | "White castles." | other | Move O-O. | `ok` | |
| ck-adv-42 | node `... O-O Ne7`, comment | after: `r2qkb1r/pp1nnppp/4p3/2ppP3/3P4/2PQ1N2/PP3PPP/RNB2RK1 w kq - 3 9` | "Develop the g8 knight." | other | Move g8-e7. | `ok` | |
| ck-adv-43 | same node | same | "Next it goes to c6 and attacks d4 together with the c5 pawn." | plan, attack/guard | Tree next Black move ...Nc6 can only be the e7 knight (d7 knight cannot reach c6). After it: `attackers(d4,'b')` = [c6,c5]. | `ok` | |
| ck-adv-44 | node `... Ne7 Na3`, comment | after: `r2qkb1r/pp1nnppp/4p3/2ppP3/3P4/N1PQ1N2/PP3PPP/R1B2RK1 b kq - 4 9` | "White heads for c2 with the b1 knight." | plan | a3 knight reaches c2 (c2 empty); tree plays Nc2 next. | `ok` | |
| ck-adv-45 | same node | same | "From c2 it guards the d4 pawn." | attack/guard | After Nc2: `attackers(d4,'w')` = [c3,d3,f3,c2]. | `ok` | |
| ck-adv-46 | node `... Na3 Nc6`, comment | after: `r2qkb1r/pp1n1ppp/2n1p3/2ppP3/3P4/N1PQ1N2/PP3PPP/R1B2RK1 w kq - 5 10` | "Bring the knight to c6 and attack d4 a second time." | count | `attackers(d4,'b')` = [c6,c5] (2). | `ok` | |
| ck-adv-47 | node `... Nc6 Nc2`, comment | after: `r2qkb1r/pp1n1ppp/2n1p3/2ppP3/3P4/2PQ1N2/PPN2PPP/R1B2RK1 b kq - 6 10` | "The knight reaches c2 and guards d4." | attack/guard | `attackers(d4,'w')` includes c2. | `ok` | |
| ck-adv-48 | node `... Nc2 Be7`, comment | after: `r2qk2r/pp1nbppp/2n1p3/2ppP3/3P4/2PQ1N2/PPN2PPP/R1B2RK1 w kq - 7 11` | "Develop the dark bishop. Now you can castle." | other, general-rule | e7 is a dark square. With Black to move in this position, `moves()` includes O-O (f8, g8 empty and not attacked). | `ok` | |
| ck-adv-49 | node `... Nf3 e6 c3 c5`, comment | after: `rn1qkbnr/pp3ppp/4p3/2ppPb2/3P4/2P2N2/PP3PPP/RNBQKB1R w KQkq - 0 6` | "Hit d4 at once." | attack/guard | `attackers(d4,'b')` = [c5]. | `ok` | |
| ck-adv-50 | same node | same | "It holds their pawns together." | reason | "It" = d4. `attackers(e5,'w')` = [d4,f3]: d4 is the only pawn that guards e5; c3 guards d4. | `ok` | |
| ck-adv-51 | node `... c3 c5 Be2 Nc6`, comment | after: `r2qkbnr/pp3ppp/2n1p3/2ppPb2/3P4/2P2N2/PP2BPPP/RNBQK2R w KQkq - 2 7` | "Develop and add a second attacker on d4." | count | `attackers(d4,'b')` = [c6,c5] (2). | `ok` | |
| ck-adv-52 | node `e4 c6 d4 d5 e5 Bf5 Nc3 e6`, comment | after: `rn1qkbnr/pp3ppp/2p1p3/3pPb2/3P4/2N5/PPP2PPP/R1BQKBNR w KQkq - 0 5` | "Solid again. Keep the bishop outside." | plan, geometry | Bishop on f5, outside the c6-d5-e6 chain; centre pawns blocked as in ck-adv-06. | `ok` | |
| ck-adv-53 | node `... Nc3 e6 g4 Bg6`, comment | `rn1qkbnr/pp3ppp/2p1p3/3pPb2/3P2P1/2N5/PPP2P1P/R1BQKBNR b KQkq - 0 5` | "Retreat to the safe square." | reason | Bishop moves: Bg6, Bxg4 (Qxg4), Be4, Bd3 (3 white attackers, 0 guards), Bxc2 (Qxc2). Be4 Nxe4 dxe4: Stockfish +1.63 vs Bg6 +0.08. g6 is the only good square. | `ok` | |
| ck-adv-54 | same node | after: `rn1qkbnr/pp3ppp/2p1p1b1/3pP3/3P2P1/2N5/PPP2P1P/R1BQKBNR w KQkq - 1 6` | "The bishop is still active." | line-open/blocked | From g6 the diagonal f5, e4, d3 is empty up to the c2 pawn. | `ok` | |
| ck-adv-55 | node `... g4 Bg6 Nge2 c5`, comment | after: `rn1qkbnr/pp3ppp/4p1b1/2ppP3/3P2P1/2N5/PPP1NP1P/R1BQKB1R w KQkq - 0 7` | "Hit d4." | attack/guard | `attackers(d4,'b')` = [c5]. | `ok` | |
| ck-adv-56 | same node | same | "It holds their pawns together." | reason | `attackers(e5,'w')` = [d4]: d4 is the only guard of e5. | `ok` | |
| ck-adv-57 | node `... Nge2 c5 h4`, comment | after: `rn1qkbnr/pp3ppp/4p1b1/2ppP3/3P2PP/2N5/PPP1NP2/R1BQKB1R b KQkq - 0 7` | "White threatens h5, which would attack your bishop on g6." | attack/guard | h5 empty, push legal. Test (…Nc6 h5): `attackers(g6,'w')` = [h5]. | `ok` | |
| ck-adv-58 | node `... h4 h5`, comment | after: `rn1qkbnr/pp3pp1/4p1b1/2ppP2p/3P2PP/2N5/PPP1NP2/R1BQKB1R w KQkq - 0 8` | "Stop that push with your own pawn." | line-open/blocked | h5 is now occupied; h4-h5 is not possible. | `ok` | |
| ck-adv-59 | same node | same | "It attacks the g4 pawn." | attack/guard | `attackers(g4,'b')` = [h5]. | `ok` | |
| ck-adv-60 | node `... h5 Nf4`, comment | after: `rn1qkbnr/pp3pp1/4p1b1/2ppP2p/3P1NPP/2N5/PPP2P2/R1BQKB1R b KQkq - 1 8` | "White attacks the bishop on g6 and the h5 pawn." | attack/guard | `attackers(g6,'w')` = [f4]; `attackers(h5,'w')` = [f4,g4]. | `ok` | |
| ck-adv-61 | node `... Nf4 Bh7`, comment | after: `rn1qkbnr/pp3ppb/4p3/2ppP2p/3P1NPP/2N5/PPP2P2/R1BQKB1R w KQkq - 2 9` | "Retreat to h7. The bishop is safe there and looks at the c2 pawn." | attack/guard, line-open/blocked | `attackers(h7,'w')` = []. `attackers(c2,'b')` = [h7] (g6, f5, e4, d3 empty). Stockfish: Bh7 best (+0.03). | `ok` | |
| ck-adv-62 | same node | same | "Your h5 pawn has no guard now, so White can take it." | attack/guard | `attackers(h5,'b')` = [] (the h7 bishop blocks the h8 rook); `attackers(h5,'w')` = [f4,g4]. | `ok` | |
| ck-adv-63 | node `... Bh7 Nxh5`, comment | after: `rn1qkbnr/pp3ppb/4p3/2ppP2N/3P2PP/2N5/PPP2P2/R1BQKB1R b KQkq - 0 9` | "White takes the h5 pawn with the knight." | other | f4xh5. | `ok` | |
| ck-adv-64 | node `... Nxh5 Nc6`, comment | `rn1qkbnr/pp3ppb/4p3/2ppP2N/3P2PP/2N5/PPP2P2/R1BQKB1R b KQkq - 0 9` | "Give up the pawn for quick play." | trade-or-sacrifice | No black piece attacks the h5 knight (`attackers(h5,'b')` = []), so the pawn is not won back. Stockfish: ...Nc6 best (-0.08). | `ok` | |
| ck-adv-65 | same node | after: `r2qkbnr/pp3ppb/2n1p3/2ppP2N/3P2PP/2N5/PPP2P2/R1BQKB1R w KQkq - 1 10` | "You attack d4 and develop, and the game is about equal." | attack/guard, evaluation | `attackers(d4,'b')` = [c6,c5]. Stockfish after ...Nc6: -0.20 (best dxc5). About equal. | `ok` | |
| ck-adv-66 | node `... Nc6 dxc5`, comment | after: `r2qkbnr/pp3ppb/2n1p3/2PpP2N/6PP/2N5/PPP2P2/R1BQKB1R b KQkq - 0 10` | "White takes the c5 pawn." | other | d4xc5. | `ok` | |
| ck-adv-67 | node `... dxc5 Bxc5`, comment | after: `r2qk1nr/pp3ppb/2n1p3/2bpP2N/6PP/2N5/PPP2P2/R1BQKB1R w KQkq - 0 11` | "Retake on c5 with the bishop. It develops and looks at the f2 pawn." | line-open/blocked | d4, e3 empty; `attackers(f2,'b')` = [c5]. | `ok` | |
| ck-adv-68 | node `e4 c6 d4 d5 e5 Bf5 Bd3`, comment | after: `rn1qkbnr/pp2pppp/2p5/3pPb2/3P4/3B4/PPP2PPP/RNBQK1NR b KQkq - 2 4` | "They offer a bishop trade." | attack/guard (unnamed threat) | `attackers(f5,'w')` = [d3]; `attackers(f5,'b')` = [] (no ...e6 yet). If Black ignores it (test ...Nf6), Bxf5 wins a bishop. The text names a trade but not the threat. | `misleading` | "White's bishop attacks your f5 bishop, and nothing guards it. White offers a trade." |
| ck-adv-69 | node `... Bd3 Bxd3`, comment | `rn1qkbnr/pp2pppp/2p5/3pPb2/3P4/3B4/PPP2PPP/RNBQK1NR b KQkq - 2 4` | "Take it. Trade your active bishop for theirs and stay safe." | trade-or-sacrifice | Bxd3 Qxd3: bishop for bishop. Stockfish: Bxd3 best (+0.07); Qd7 or Qc8 +0.55. | `ok` | |
| ck-adv-70 | node `... Bxd3 Qxd3 e6`, comment | after: `rn1qkbnr/pp3ppp/2p1p3/3pP3/3P4/3Q4/PPP2PPP/RNB1K1NR w KQkq - 0 6` | "Solid. Next you play ...c5 to hit their centre." | plan, evaluation | Stockfish +0.36 (normal); its line has ...c5 next (Ne2 c5). ...c5 attacks d4. | `ok` | |
| ck-adv-71 | node `e4 c6 d4 d5 e5 Bf5 g4`, comment | after: `rn1qkbnr/pp2pppp/2p5/3pPb2/3P2P1/8/PPP2P1P/RNBQKBNR b KQkq - 0 4` | "A loose attack. It weakens their own king." | evaluation, attack/guard | "Loose" has no support: Stockfish gives 4.g4 +0.19 after Black's best, the same as 4.Nf3 (+0.23); 4.h4 is +0.46. The sentence does not say that g4 attacks the f5 bishop (`attackers(f5,'w')` = [g4]), the fact the next card needs. "Weakens their own king": the king is still on e1; what is true is that f3 and h3 have no pawn guard now (e2 and g2 empty). | `misleading` | "The g-pawn attacks your bishop. The pawn leaves g2, so no pawn guards f3 and h3 now." (check: after g4, f3 W[d1,g1], h3 W[f1,g1]: pieces only, no pawn) |
| ck-adv-72 | node `... g4 Bg6`, comment | `rn1qkbnr/pp2pppp/2p5/3pPb2/3P2P1/8/PPP2P1P/RNBQKBNR b KQkq - 0 4` | "Just retreat. Pawns do not move back, so their weaknesses stay." | general-rule | Pawns never move backwards (rule of chess, true in every position). Safe retreats exist (Bg6, Be6, Bd7, Bc8: no white attacker). | `ok` | |
| ck-adv-73 | node `... g4 Bg6 h4 h5`, comment | after: `rn1qkbnr/pp2ppp1/2p3b1/3pP2p/3P2PP/8/PPP2P2/RNBQKBNR w KQkq - 0 6` | "Hit the g4 pawn and stop h5." | attack/guard | `attackers(g4,'b')` = [h5]; h5 occupied. | `ok` | |
| ck-adv-74 | same node | same | "Your bishop keeps its square on g6." | plan | No pawn can push to h5 now. After 6.gxh5 the h5 pawn attacks g6, but Black takes it back (Bxh5 or Rxh5); Stockfish gxh5 Bxh5 -0.22. Best is 6.e6 (-0.04), the bishop stays on g6. | `ok` | |
| ck-adv-75 | node `e4 c6 d4 d5 e5 Bf5 h4`, comment | after: `rn1qkbnr/pp2pppp/2p5/3pPb2/3P3P/8/PPP2PP1/RNBQKBNR b KQkq - 0 4` | "They want to chase your bishop." | plan | Test 4...e6 5.g4: Stockfish +4.79 (g4 and h4-h5 trap the bishop); 4...Nd7 5.g4 +1.49. The chase is real. | `ok` | |
| ck-adv-76 | node `... h4 h5`, comment | after: `rn1qkbnr/pp2ppp1/2p5/3pPb1p/3P3P/8/PPP2PP1/RNBQKBNR w KQkq - 0 5` | "Stop White's h-pawn from reaching h5." | line-open/blocked | h5 occupied. | `ok` | |
| ck-adv-77 | same node | same | "Your bishop keeps the f5 square." | plan | Only a pawn on g4 could attack f5; after g4, `attackers(g4,'b')` = [f5,h5]. `attackers(f5,'w')` = []. Stockfish +0.24 (c4, Bd3, Nc3: none attacks f5 at once). | `ok` | |
| ck-adv-78 | node `e4 c6 d4 d5 Nf3 Bg4`, comment | `rnbqkbnr/pp2pppp/2p5/3p4/3PP3/5N2/PPP2PPP/RNBQKB1R b KQkq - 1 3` | "Develop the bishop before ...e6." | reason | After ...e6 the c8 bishop would have only d7 (e6 blocks c8-h3). | `ok` | |
| ck-adv-79 | same node | after: `rn1qkbnr/pp2pppp/2p5/3p4/3PP1b1/5N2/PPP2PPP/RNBQKB1R w KQkq - 2 4` | "White may trade; that is fine." | attack/guard, evaluation | `attackers(g4,'w')` = []: White cannot take the bishop. The trade in the tree is Black's choice: 4.h3 Bxf3. After 4.h3, Bxf3 is best (+0.29), Bh5 +0.79. "Fine" is true for that trade. "White may trade" gives the wrong actor. | `misleading` | "Develop the bishop before ...e6. If White plays h3, you can take the knight." |
| ck-adv-80 | node `... Bg4 h3 Bxf3`, comment | `rn1qkbnr/pp2pppp/2p5/3p4/3PP1b1/5N1P/PPP2PP1/RNBQKB1R b KQkq - 0 4` | "Take the knight. You do not need to retreat." | reason | Stockfish: Bxf3 +0.29, Bh5 +0.79, dxe4 +1.09. Retreat is worse. | `ok` | |
| ck-adv-81 | node `... h3 Bxf3 Qxf3 e6`, comment | after: `rn1qkbnr/pp3ppp/2p1p3/3p4/3PP3/5Q1P/PPP2PP1/RNB1KB1R w KQkq - 0 6` | "Solid and safe. Your pawns are healthy." | evaluation, other | Stockfish +0.35 (exd5, Qb3, c3 near equal). Black pawns a7 b7 c6 d5 e6 f7 g7 h7: no doubled or isolated pawn. | `ok` | |
| ck-adv-82 | same node | same | "Next play ...Nf6 and ...Nd7." | plan | Both legal next (test with Black to move). Engine line after 6.c3: dxe4 Qxe4 Nf6, then ...Nd7 (b8d7). | `ok` | |
| ck-adv-83 | node `e4 c6 d4 d5 Bd3`, comment | after: `rnbqkbnr/pp2pppp/2p5/3p4/3PP3/3B4/PPP2PPP/RNBQK1NR b KQkq - 1 3` | "They defend e4 with the bishop." | attack/guard | `attackers(e4,'w')` = [d3]. | `ok` | |
| ck-adv-84 | node `... Bd3 dxe4`, comment | `rnbqkbnr/pp2pppp/2p5/3p4/3PP3/3B4/PPP2PPP/RNBQK1NR b KQkq - 1 3` | "Take the free pawn." | trade-or-sacrifice | The e4 pawn is guarded (`attackers(e4,'w')` = [d3]). After dxe4 Bxe4 (best, +0.08; other moves -1.2) each side has lost one pawn: a trade, not a free pawn. The sentence contradicts the next one. | `false` | Whole comment: "Take on e4. White takes back with the bishop, so the pawns are traded." |
| ck-adv-85 | same node | after: `rnbqkbnr/pp2pppp/2p5/8/3Pp3/3B4/PPP2PPP/RNBQK1NR w KQkq - 0 4` | "They take it back." | sequence | Bxe4 legal and best (+0.08). | `ok` | (rewritten with ck-adv-84) |
| ck-adv-86 | node `... dxe4 Bxe4 Nf6`, comment | after: `rnbqkb1r/pp2pppp/2p2n2/8/3PB3/8/PPP2PPP/RNBQK1NR w KQkq - 1 5` | "Hit the bishop and develop." | attack/guard | `attackers(e4,'b')` = [f6]; `attackers(e4,'w')` = [] (bishop has no guard). | `ok` | |
| ck-adv-87 | same node | same | "You gain time." | reason | The unguarded bishop must move or get a guard; Stockfish best Bf3 (0.00). | `ok` | |

Totals: 87 claims; 79 `ok`, 2 `false` (ck-adv-13, ck-adv-84), 6 `misleading` (ck-adv-09, -11, -17, -68, -71, -79), 0 `unverifiable`.

## For the owner

- ck-adv-11: the tree comment on `... Nxd4 Ne7` says the e7 knight "can go to c6 next". The guide `advance` says the b8 knight goes to c6 and the e7 knight can go to g6. After O-O, Stockfish finds ...Nec6 about two pawns worse than ...Nbc6. The proposed fix follows the guide.
- Task 21 note: the guide route text on `... Be3 cxd4` ("Take on d4. White can retake on d4.") has the same weak reason as the tree comment the owner reported. Align it with the ck-adv-09 fix.
- No move in this scope was chosen for a false reason. All repertoire moves checked here are the engine's best or close to it.

## Re-check

(Empty until the fixer's round.)

## Protocol feedback (pilot)

- Position column: the protocol does not say which FEN to use. For a Black move the card shows the position before the move, but many sentences describe the position after it. I used "before" for instructions and "after" for claims about the result. Write this rule into the protocol.
- Granularity: "every sentence" is clear, but short pairs ("Take it. Trade your bishop...") made rows with no fact. I merged such pairs. Say whether pure instructions ("Take it.") need a row.
- Positional words ("solid", "active", "safe", "loose", "weakens", "easy game") have no check rule. I set them `ok` when the board facts behind them hold and Stockfish does not disagree, and `misleading` when the engine disagrees (ck-adv-71, ck-adv-09). Add this rule, or the batches will differ.
- Fix length: the 1-2 sentence rule sometimes forces a choice between a true reason and a second fact. Say whether a fix may replace the whole comment (I did that for ck-adv-09 and ck-adv-84).
- `pnpm check:sequences` prints only totals. With 0 issues the auditor cannot see which clauses it found in the scope. A `--verbose` flag that lists node id and clause would help.
- Unnamed threats: the spec table lists this type, but the protocol "Check rules by type" has no rule. I used: for every move that attacks a piece, list the target and its guards. Add it.
- Engine settings: "1M nodes" is clear. MultiPV, threads and how to test an alternative (`searchmoves`) are not. A shared helper (attackers batch + Stockfish wrapper) in the brief would save about 15 minutes per batch.
- Report language: the protocol does not say whether engine numbers may appear in the report (they may not appear in content). I used them in the evidence column only.
- Time: about 50 minutes of agent time (reading 10, tools 15, checks 15, report 10).
- Density: 87 claims on 59 commented nodes, about 1.5 claims per node. 8 non-ok claims (14 % of nodes). White-move comments ("White takes ...") were all ok; the problems were in reasons ("so", "if") and in evaluation words.

## Fixes

File: `content/repertoires/caro-kann.json` (comment fields only). 8 comments changed, using the auditor text except ck-adv-09 (owner ruling: which pawn, why White takes back, what Black gets). New sentences re-checked with chess.js facts from the table (c5xd4 pawn attacks e3; no white pawn guards e5 after the trade; Ne7 attacks d5, Nc6 attacks d4).

- ck-adv-09: "Take the pawn. If they take back, you play on with an easy game." -> "Take the d4 pawn with your c-pawn. It attacks the e3 bishop, so White must take back, and then no white pawn guards e5."
- ck-adv-11: "Develop and get ready to castle. The knight guards your bishop on f5 and can go to c6 next." -> "Develop and get ready to castle. The knight guards your f5 bishop, and the b8 knight goes to c6 next."
- ck-adv-13: "Hit the d4 knight. Now every piece fights for the centre." -> "Hit the d4 knight. Now both your knights fight for the centre."
- ck-adv-17: "Attack the bishop with the pawn. The d4 knight guards it, so White can take on c6 or move the bishop." -> "Attack the bishop with the pawn. A bishop is worth more than a pawn, so White takes on c6 or moves the bishop."
- ck-adv-68: "They offer a bishop trade." -> "White's bishop attacks your f5 bishop, and nothing guards it. White offers a trade."
- ck-adv-71: "A loose attack. It weakens their own king." -> "The g-pawn attacks your bishop. The pawn leaves g2, so no pawn guards f3 and h3 now."
- ck-adv-79: "Develop the bishop before ...e6. White may trade; that is fine." -> "Develop the bishop before ...e6. If White plays h3, you can take the knight."
- ck-adv-84: "Take the free pawn. They take it back." -> "Take on e4. White takes back with the bishop, so the pawns are traded."

Not changed (out of scope): the transposed node `e4 c6 Nf3 d5 d4 Bg4` has the same old text as ck-adv-79 ("White may trade; that is fine."). The guide text on `cxd4` (Task 21) is untouched.
