# M16b: Grand Prix Against The Sicilian

Proceeding on the owner's instruction to continue the 1.e4 repertoire.
Inline implementation, no subagents. Existing London and Vienna stay active.

## Scope And Approach

Add `grand-prix`, White, about 300 move nodes (250-350), starting with
e4 c5 Nc3 and f4 against the main second replies. Cover Nc6, d6, e6, g6,
a6 and Nf6, with sound concrete responses rather than a forced identical
setup. Use existing content JSON, six guide variations, drills, leak detection
and two plans with three exercises each. Level 1 teaches a basic route;
levels 2-3 hold branches and deeper continuations. Engine checks decide exact
recommendations; do not advertise forced wins or unconditional pawn attacks.

The alternative Open Sicilian would broaden the theoretical burden and depart
from the roadmap. A single combined 1.e4 tree would erase the existing Vienna
identity and require larger UI/content changes. Separate repertoires plus
specific matching preserves existing formats and also supports later parts.

Opening identity source: [Lichess Closed Sicilian](https://lichess.org/opening/Sicilian_Defense_Closed).
Prose is original. Stockfish proposes moves and chess.js checks boards; neither
the source nor a language model is accepted as proof of a tactical claim.

## Shared-root Matching

Introduce `selectRepertoire(reps, moves, userColor): Repertoire | undefined`.
Among repertoires of the user's colour whose first move matches, choose the
unique longest matching prefix of actual game moves. Stop a prefix at its first
mismatch. Use the full tree for identification, independent of lesson level;
findLeak still enforces the current level when deciding what is trainable.
Ties return undefined. This avoids arbitrarily attributing a bare e4 game or
an unsupported French reply to Vienna or the Sicilian. A uniquely matching
repertoire preserves existing out-of-book/leak behavior. List order cannot
change classification. Include a matcher version in the repertoire hash so
stored events rescan when the matching contract changes. No schema change.

## Content And Integration

Tab order: London, Vienna, Grand Prix, Caro-Kann, Slav. Add `grand-prix` to
the plan group union, loader and page grouping. Keep position-based cards:
the shared initial card names all three repertoires, accepts e4 and d4 once
each, and preserves FSRS history. Sharing a later e4 position with another
repertoire must not duplicate cards or omit their contextual explanations.

The guide explains king safety, development, the central d-pawn counterstrike,
and when an attack is premature. Every piece job, arrow, model and exercise
is validated on its actual position. Exercise distractors must be clearly
worse at the established engine thresholds, not merely off-theme.

## Constraints And Gates

No dependencies, migrations, live DB verification writes, quota changes or
unrelated refactoring. Tests use recorded data, not network or real engines.
Authoring uses million-node Stockfish searches with a durable cache; an extended
verification timeout does not change production settings. Do not pad the tree
with fabricated moves to meet the depth target.

Full suite, typecheck, lint, build, sequence and content validators, isolated
browser smoke, self-review, SQLite backup, merged-result tests and push are
required. Backup before main's startup loads the new repertoire.

## Decisions Delegated To The Builder

Exact levels, branch breadth, move recommendations and two plan positions;
all must be justified by the board and engine, not assumed from a fixed setup.
