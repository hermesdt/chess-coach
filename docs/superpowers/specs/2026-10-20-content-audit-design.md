# Content Quality Audit — Design (M10)

Date: 2026-10-20
Status: approved by the owner (2026-10-20).
Parent spec: `docs/superpowers/specs/2026-10-18-chess-coach-design.md` (§9 content
and validation; project rule "the AI never invents moves, lines or evaluations").

## 1. Why

`pnpm validate:content` checks moves: legality, and that own repertoire moves and
lesson solutions are not much worse than the engine's best. It does **not** check
the words. Comments and explanations are written by agents, and some are false.
The owner learns from these texts, so a false sentence teaches a false idea.

### The example that started M10 (found by the owner, 2026-10-20)

In the daily review, an opening card from the Caro-Kann showed:

- Position (Black to move): `rnbqkbnr/pp2pppp/2p5/3p4/3PP3/2N5/PPP2PPP/R1BQKBNR b KQkq - 1 3`
  (after 1.e4 c6 2.d4 d5 3.Nc3).
- Repertoire move: 3...dxe4.
- Comment: **"Take the pawn. You open the c8 bishop."**

This is false. The pawn on d5 came from d7 on move 2, so the diagonal
c8–d7–e6–f5–g4–h3 was already open before 3...dxe4. Capturing on e4 changes
nothing for the c8 bishop. The same sentence (or "You open the road for your
bishop.") was on three nodes: after 3.Nc3, 3.Nd2 and in the Two Knights order
(2.Nc3 d5 3.d4). Fixed in commit `963d710` to: "Take the pawn. After Nxe4 you
play ...Bf5: your light bishop comes out before ...e6 shuts it in."

The owner found it by reading the card, not by a tool. M4's content review had
checked these moves with Stockfish, but nobody checked this sentence against the
board.

### Error types already seen (from the M4, M6 and M9 content reviews)

Each is a real case; the audit must look for all of them.

| Type | Real example | Why it is wrong |
|---|---|---|
| "Opens / frees / blocks" a line that was already open or still blocked | "dxe4 opens the c8 bishop" (above); "Bb7 aims at the kingside" with a pawn on c6 blocking the long diagonal (M9 lesson draft) | check the line square by square |
| A move line that stops one move too early | "Rxg2+ Qxg2 loses a rook" — but ...Nxg2 then wins the queen back (M9 lesson 19) | always check the reply to the last quoted move |
| A capture called a sacrifice | "dxc4 gives up the d5 pawn" — it is a trade, White takes back (M9 lesson 15) | material stays equal |
| A general rule that is false in some cases | "Squares next to each other have different colours" — diagonal neighbours share a colour (M9 lesson 15) | rules must hold everywhere they are stated |
| Wrong geometry words | "Kf5 goes in front of the e-pawn" — f5 is beside e5 (M9 lesson 17) | in front = same file, ahead |
| A reason that does not explain the choice | "Kd5 puts the king in the centre" — Ke5 is also central but only draws (M9 lesson 17) | say why the alternative fails |
| A sequence that cannot happen | "If Black checks from the side, the king steps out..." — after Rb4 Black's only check is Rxb4+ (M9 lesson 16) | replay the sequence |
| Unnamed threats | an exercise named the mate threat but not the queen attacked by two pawns (M9 lesson 18) | list every attacked piece |
| Wrong counts | "the exercises show four shapes" when they show three (M9 lesson 13) | count |
| Exact engine numbers in text | "the edge falls from 69 %" (engine values move between runs) | write "about" |
| Wrong attack claim from the AI coach | "Bh6 attacked the rook on f8" with the g7 pawn blocking (M8a chat) | already fixed by attack facts in M8b; out of scope here, listed so the audit does not re-open it |

## 2. Goals

1. Every sentence in `content/repertoires/*.json` comments and in
   `content/lessons/*.json` (summary, body, prompts, explanations) that states a
   chess fact is checked against the board with chess.js and, where it claims an
   evaluation or a result, with Stockfish.
2. Every false or misleading sentence is fixed (or deleted when no true short
   sentence fits). Correct sentences are not rewritten for style.
3. An audit report lists every claim checked, its verdict and the evidence, so
   the owner can spot-check.
4. A repeatable check: a script that replays every move sequence written in a
   comment or explanation and fails on an illegal one, added to
   `pnpm validate:content` (cheap, catches the "sequence that cannot happen" type
   for good).

## 3. Non-goals

- Changing repertoire moves or lesson solutions (the validator already covers
  them), unless a fixed text shows that the move itself was chosen for a false
  reason — then report it to the owner instead of changing it.
- Style rewrites, new content, or translating texts.
- AI coach answers at runtime (covered by grounding and attack facts).

## 4. Anti-goals

- A "fix" that makes a true sentence false or vaguer.
- Texts that grow long; keep the M4/M6 length rules (one or two sentences per
  repertoire comment; lesson body 150–400 words).
- Claims in the audit report without evidence.

## 5. Method (decided)

- Scope: 3 repertoires (about 760 nodes today; M9 adds level-3 nodes) and 25 lessons (12 level 1 from M6,
  13 level 2–3 from M9).
- Split the work into batches small enough for one agent each (for example one
  repertoire subtree or four lessons). Each batch: an auditor (strongest model)
  lists every factual claim with the position, checks it with throwaway scripts
  using the repo's chess.js and the `stockfish` binary, and writes verdicts; a
  separate fixer applies the fixes; a re-check confirms each new sentence.
- Claim checks by type: lines and diagonals square by square; "attacks /
  defends / guards" with chess.js attackers (note: pins are ignored by chess.js);
  "wins / draws / loses / is better" with Stockfish at ≥ 1M nodes (endgames
  deeper); every quoted move sequence replayed to its end plus the opponent's
  best reply.
- The audit report goes to `docs/superpowers/notes/` (one file per batch or one
  combined file), linked from the ROADMAP.

## 6. Done when

- Every batch has an audit report with zero open "false" verdicts.
- `pnpm validate:content` passes, including the new sequence-replay check.
- The owner's example above is in the report as checked (fixed in `963d710`).

## 7. Left to the planner

Batch sizes, model choice per role, the exact claim-report format, and how the
sequence-replay check finds move sequences in prose (SAN tokens in order).
