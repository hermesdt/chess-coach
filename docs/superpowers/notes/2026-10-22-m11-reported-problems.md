# M11 intake: problems the owner reported with "Report a problem"

Read on 2026-10-22 from a read-only `.backup` copy of the live database (`card_flags` joined to `cards`). Two reports. No card was restored (both cards stay suspended). The copy was deleted after reading.

## Report 1 — opening card, content error (batch `ck-advance`, Task 5)

- Date: 2026-10-21. Card kind: opening (Caro-Kann). Position (Black to move, move 6): `rn1qkbnr/pp3ppp/4p3/2ppPb2/3P4/4BN2/PPP1BPPP/RN1QK2R b KQkq - 1 6`. Node id: `e4 c6 d4 d5 e5 Bf5 Nf3 e6 Be2 c5 Be3 cxd4`. Repertoire move: `cxd4`.
- Shown text: "Take the pawn. If they take back, you play on with an easy game."
- Owner's note: "Take the pawn. If they take back, you play on with an easy game.. I dont undestand why this message"
- Sort: **content error (misleading / unclear).** The sentence gives no reason for the move and "an easy game" is an evaluation claim that nothing supports. The auditor of `ck-advance` checks this node first: which pawn is taken (the d4 pawn, which the c5 pawn attacks), what White's recaptures are (Nxd4, Bxd4), what ...cxd4 achieves, and what the true short reason is.

## Report 2 — mistake card, app issue (not a content batch)

- Date: 2026-10-22. Card kind: mistake from game 11, ply 41 (`7r/p1B1bkpp/4p1b1/8/P1BP2n1/2P2p2/1P3P2/R4RK1 w - - 1 21`, White to move; the owner played a5; accepted answers c4a6, b2b3, a1e1).
- Shown text: "Blunder. b3 would have protected your bishop on c4."
- Owner's note: "why protect if nothing is attacking it?"
- Check (chess.js): no black piece attacks the c4 bishop in this position (the only white piece under attack is the f2 pawn, by the g4 knight). A black move such as ...Bd3, ...Ne5 or ...Ne3 would attack c4 later. The owner's question is fair: the text names a defence but not the threat.
- Source: the text is not in `content/`. `server/srs/mistake-cards.ts` builds the card text from the classification label and material tags, and adds the AI coach's "why it matters" line (`applyCoachExplanations`). Here no tag was added ("Blunder." only), so the sentence after it is the coach's own text. Grounding checks moves only (a known M5/M8a gap), so a wrong or empty non-move claim passes.
- Sort: **app issue, follow-up item** ("coach 'why it matters' text on mistake cards is not checked against attack facts"). Out of scope for M11 (spec §3: AI coach answers at runtime are not covered). Listed in the ROADMAP for a later milestone.
