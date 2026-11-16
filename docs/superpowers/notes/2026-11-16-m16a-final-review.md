# M16a Review And Verification

Inline author self-review; no subagents, per owner instruction.

## Review

Reviewed the feature changes against the design and plan, including shared
position ownership, accepted moves, preserved FSRS state, plan-group loading,
UI grouping, guide roots/jobs/routes, game matching and level gates.

No blocking findings or deferred code-review minors. Nothing declined as
outside the specification. This is not an independent review.

- Initial position: one card accepts both White openings and names both.
- Adding/removing Vienna preserves the card ID and complete scheduling row.
- London games are not Vienna leaks; unsupported e4 replies are out of book.
- Vienna plans only match Vienna games; existing groups and page tests remain.
- Real-content tests cover every plan and uniqueness across all quiz positions.
- All guide examples and exercises are legal; the concrete distractor bishop
  sacrifice is capturable by the b7 pawn and was engine-checked as clearly worse.
- Other equally good moves omitted from plan choices are handled by the existing
  free-board engine check. Twelve missed-good-move warnings are accepted.

## Browser

Fresh headless Chrome with a temporary database and level-3 override:
four opening tabs in the intended order; Vienna opening drill; guide; both
plans train, adding six cards. Shared opening card accepts e4 and d4. A Vienna
quiz accepts its solution. No page errors. Review-session routing uses actual
cards from the temporary database to expose the specific cards under test.
Screenshots: `/tmp/chess-vienna-browser-bMxsbR/guide.png` and `quiz.png`.
Temporary server and browser stopped after the check. No live DB used.

## Rulings

- Keep one position-based review card for both White repertoires, rather than
  introducing selection settings. Cost: both opening choices are accepted at
  shared positions; the prompt and explanation explicitly name the repertoires.
- Deeper Black replies come from the engine's leading choices, not popularity
  statistics. Cost: unrepresented practical replies remain out of book.
- Replace the first draft's king walk and rook manoeuvre with validated
  developing moves. Cost: a less engine-preferred but validator-approved route.
- Reuse million-node search recordings from this run in standard validators;
  verification-only search timeout is 120 seconds. Cost: validation proves chess
  content, not completion within the production timeout. Production unchanged.
- Use isolated headless Chrome because no connected browser was available.
  Cost: the owner's signed-in browser/profile is not exercised.

## Verification

Task 2: 303 move nodes, repertoire validator and sequence check report no issues.
Task 3: guide and plans validate, 54 focused tests pass, typecheck/lint pass.
Global sequence check: 0 errors, 18 existing warnings.
Production build passes, with the existing large-bundle warning.
The first full-suite run found the old eight-plan inventory assertion; updated
it to include the two new plans. A known lichess batching timeout also appeared
under engine load and passed when rerun in isolation. Final full suite: 1499
tests pass. Full content validator: content OK, 159 warnings (147 existing and
12 new quiz alternative warnings). All engines used the same million-node
budget; cache warming used the existing pool, not additional dependencies.
Backup `data/backups/pre-m16a-2026-11-16.db` passes SQLite quick_check.
