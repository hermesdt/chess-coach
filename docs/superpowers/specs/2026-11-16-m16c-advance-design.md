# M16c: White Advance Repertoire

Proceed inline on the owner's instruction; no subagents. Add one White
repertoire `advance`, named `Advance: French & Caro-Kann`, with distinct
branches after e4 e6 and e4 c6. This keeps one coherent milestone and avoids
confusing it with the existing `caro-kann` Black repertoire. Separate White
repertoires would add unnecessary tabs; replacing the Black repertoire would
contradict the requirement to preserve the existing training.

Use d4 d5 e5 in both branches. French coverage: c5, Nc6 and the immediate f6
challenge. Caro-Kann coverage: Bf5, c5 and e6. Prefer a beginner-friendly c3
response to the French c5 attack and the Short-style Nf3 against Bf5, subject
to engine validation. Do not teach an identical setup against every response.

Target 250-350 move nodes across the two defences, levels 1-3, comparable with
the preceding milestone parts. One own recommendation per node; deeper moves
and representative opponent branches come from Stockfish, not fabricated
theory. Add a six-section guide and two plans with three exercises each: one
for meeting French central pressure and one for development against the
Caro-Kann bishop. Every example is board-checked and engine-validated.

Keep the existing longest-prefix matcher: French and Caro-Kann games match
the new White repertoire, while the owner's Black games retain `caro-kann`.
Shared opening cards keep IDs and FSRS history, accepting d4/e4 once each.
Tab order: London, Vienna, Grand Prix, Advance, Caro-Kann, Slav. Add the
`advance` plan group. No schema, dependencies, quota changes or unrelated work.

Source identities: [French Advance](https://lichess.org/opening/French_Defense_Advance_Variation)
and [Caro-Kann Advance](https://lichess.org/opening/Caro-Kann_Defense_Advance_Variation).
Original prose must distinguish the French bishop behind the e6 pawn from
the Caro-Kann bishop developed before that pawn. No promised attacks or wins.

Full tests, typecheck/lint/build, content and sequence validation, isolated
browser checks, self-review and verified SQLite backup precede merge/push.
Tests never use real engines or network. Authoring uses million-node searches
with a durable cache; verification-only timeout extensions leave production
settings unchanged. Preserve the native managed worktree.
