# M11 audit protocol

Every batch task reads this note first. It binds the auditor, the fixer and the re-check.
The spec is `docs/superpowers/specs/2026-10-20-content-audit-design.md`. This note does not repeat it.
Read spec §1 (error table), §4 (anti-goals) and §5 (method).

## Files

- One report per batch: `docs/superpowers/notes/2026-10-22-m11-audit-<batch-id>.md`.
- Sections, in this order: "Scope", "Claims", "For the owner", "Re-check".
- The fixer appends a "Fixes" section (see Fixer rules).

## Before you start (known claims)

Check these first. Put each one in the Claims table, even if it is fine.

1. The owner's reported problems for your scope: `docs/superpowers/notes/2026-10-22-m11-reported-problems.md`.
2. The section "Content notes for the M11 audit" in `docs/ROADMAP.md` (M10 and M9 notes).
3. The output of `pnpm check:sequences content/repertoires/<file>.json` (or a lesson file) for your scope.
   - `illegal-sequence` errors are real problems. Verify each one.
   - `skipped-move` warnings are sentences that look true but skip one move. Check that the sentence is still true and clear.
   - The tool finds sequences only. It does not check any other claim.

## Claim types

`line-open/blocked`, `attack/guard`, `pin`, `count`, `geometry`, `reason`, `plan`, `sequence`, `evaluation`, `trade-or-sacrifice`, `general-rule`, `other`.

## Verdicts

- `ok`: the sentence is true and clear, and the evidence is in the table.
- `false`: the sentence states something untrue.
- `misleading`: the sentence is true in part, but the learner will get a wrong idea.
- `unverifiable`: no tool can confirm the sentence. Fix it or delete it.

## Check rules by type (spec §5)

- line-open/blocked: check the line square by square, in the position before and after the move.
- attack/guard: use chess.js `attackers()`. Then test pins with legal moves, because `attackers()` ignores pins.
- pin: show that the pinned piece has no legal move off the line (or only with a loss).
- count: count the items. Write the count in the evidence.
- geometry: check files, ranks and diagonals. "In front" means the same file, one side ahead.
- reason: name the alternative move. Show why it fails, or the reason is `misleading`.
- sequence: replay every quoted sequence to its end. Then play the opponent's best reply.
- evaluation: use Stockfish with 1M nodes or more (endgames deeper). Send `ucinewgame` before each search.
- trade-or-sacrifice: count the material after the full exchange.
- general-rule: test the rule in every position where the text states it.

## Auditor rules

- Throwaway scripts go under `/tmp` only. Never run an interpreter from a planted directory.
- Use the strongest model.
- List EVERY sentence with a factual claim. Do not list only the suspicious ones.
- No verdict without evidence in the table.
- For each non-`ok` verdict, write a proposed sentence or "delete". Do not rewrite correct sentences.
- Do not propose a change to a move, a solution or an id. Put such a case in "For the owner".

## Fixer rules

- Fix only `false`, `misleading` and `unverifiable` claims.
- Keep the Global Constraints (length rules, no exact engine numbers, no "The engine line is").
- Edit text fields only.
- Record `old → new` for each fix, by claim id, in a "Fixes" section of the report.
- Make one commit per batch.

## Re-check rules

- The auditor checks each changed sentence again, from its position. The verdict is `ok` or the item is reopened.
- The auditor also reads the diff. A sentence that changed without a record is a finding.
- The fixer gets one more round. After that, the item goes to "For the owner".

## Report template

```markdown
# M11 audit: <batch-id>

## Scope
<files, node ids or lesson ids; counts of nodes and sentences; date; tool versions>

## Claims

| id | location (file + node id / lesson id + field) | position (FEN) | sentence | claim type | check (tool and evidence) | verdict | fix |
|---|---|---|---|---|---|---|---|
| <batch>-01 | | | | | | | |

## For the owner
<one line per item: a move or solution chosen for a false reason, or an item still open after the re-check. Write "None" if empty.>

## Re-check
<per changed claim id: new sentence, check, verdict (`ok` or reopened)>
```

### Worked example (a real case, already fixed)

| id | location | position (FEN) | sentence | claim type | check | verdict | fix |
|---|---|---|---|---|---|---|---|
| ex-01 | `caro-kann.json`, node `e4 c6 d4 d5 Nc3 dxe4`, comment | `rnbqkbnr/pp2pppp/2p5/3p4/3PP3/2N5/PPP2PPP/R1BQKBNR b KQkq - 1 3` | "Take the pawn. You open the c8 bishop." | line-open/blocked | chess.js: d7, e6, f5, g4, h3 are all empty before 3...dxe4. The c8 bishop already has Bd7, Be6, Bf5, Bg4 and Bh3. The line was open since 2.d4 d5. The capture changes nothing for this bishop. | `false` | "Take the pawn. After Nxe4 you play ...Bf5: your light bishop comes out before ...e6 shuts it in." (commit `963d710`) |

## Rulings from the pilot batch (ck-advance), binding for all batches

- **Position column:** write `before` or `after` next to the FEN. Use the position before the move for instructions and for reasons for choosing the move; use the position after it for claims about the result.
- **Rows:** one row per factual claim. Pure instructions ("Take it.", "Play ...c5.") and sentences with no chess fact get no row; merge a short pair into the claim it supports.
- **Positional words** ("solid", "active", "safe", "loose", "weakens", "easy game", "better game"): `ok` when the board facts behind the word hold and Stockfish (≥ 1M nodes) does not disagree; `misleading` when the engine disagrees or the word has no support; an unsupported evaluation phrase such as "an easy game" is `misleading`.
- **Unnamed threats:** for every move that attacks a piece, list the target piece and its guards; a text that names one threat but leaves out a second, bigger one is `misleading`.
- **Fix length:** a fix may replace the whole comment (repertoire: one or two sentences) when a true reason and a second fact do not fit; keep every correct fact the old text had.
- **Engine numbers:** may appear in the report's check column; never in the content text.
- **Engine use:** Stockfish ≥ 1M nodes, `ucinewgame` before each search, MultiPV 3 for "best move" claims, `searchmoves` to test an alternative. The shared helper is in `docs/superpowers/notes/m11-audit-helpers/` (README there: attackers batch, pins, open lines, SAN replay, Stockfish wrapper, node loader); run it from that folder, and write your own throwaway scripts under `/tmp`.
- **Sequence check:** `pnpm check:sequences <file>` prints totals only; zero issues means no sequence problem was found, not that no sequence exists. Find the sequences yourself (SAN tokens in order) as part of "every sentence".
- **Report footer:** end each report with `Protocol feedback` only if you hit something new; otherwise write "none".
