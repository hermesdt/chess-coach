# Opening Guides — Design (M10)

Date: 2026-10-21
Status: approved by the owner (2026-10-21)
Parent spec: `docs/superpowers/specs/2026-10-18-chess-coach-design.md` (§9 content
and validation, §18 levels and repertoire). Quality rules:
`docs/superpowers/specs/2026-10-20-content-audit-design.md` §1 (error table).

Marks: **(owner)** = the owner said or approved it. **(my call)** = decided by the
designer; the owner can change it.

## 1. Intent

The owner knows the moves of their repertoire "more or less", but not why, and not
the plan. In their words: "I wasn't sure what was the plan or the deviation for
the plan towards what goal. I know the final position but how to navigate
things?" For the Caro-Kann and the Slav they do not know the final form at all;
the London they know better. **(owner)**

Today the Openings page has the move tree with a one- or two-sentence comment per
move. What is missing is the big picture: the target set-up, the route to it, what
to do when the opponent leaves the main line, and what to do after the set-up.

Success: after reading a guide, the owner can say what set-up they aim for in each
main variation, in which order they build it, and how the plan changes against
the deviations they actually meet.

## 2. Goals

1. One guide for each repertoire: London (White), Caro-Kann (Black vs 1.e4), Slav
   (Black vs 1.d4 / 1.c4 / 1.Nf3, incl. anti-London) **(owner: "guide for all")**.
2. Layout A **(owner chose)**: one article per repertoire with a table of contents
   on the left; read it top to bottom or jump to a part. Six parts:
   1. **Why this opening** — strengths, what it asks of you, how it connects to
      the owner's other repertoires (Caro-Kann and Slav share ideas).
   2. **Final form** — a board per main variation (tabs), showing the target
      set-up; the KEY pieces and pawns of the owner's side (3–6 per board) have a
      one-line "job" shown when the owner clicks or hovers them **(my call)**.
   3. **The route** — per variation, the steps in order, each with its reason; a
      button plays the route on the board, another starts the existing line drill
      on it **(my call)**.
   4. **If they do X…** — the common ways the opponent leaves the main line, each
      with "your plan changes to Y" and a "show" button that plays it.
   5. **Middlegame plan** — what to do once the set-up stands (pawn breaks, where
      the pieces go next, typical targets).
   6. **Typical mistakes** at the owner's level, each with a position.
3. Ways in **(owner: "all of those options")**: the guide's own page; a "Plan"
   link on opening review cards, on the Openings tree, and on a game page when the
   game belongs to one of the owner's repertoires. Each link opens the guide at
   the part and variation that fits the position.
4. **The owner's own games** in the guide **(owner: "awesome if it can use my
   games")** — "Your games" boxes built only from existing data (synced games,
   engine analysis, M4 opening events, M7 insights):
   - in the route: where the owner left the route ("In 4 of your games you played
     …e6 here before …Bf5"), with a link to each game (M4 `leak` events);
   - in "If they do X…": which deviations opponents actually played against the
     owner and how often (M4 `out_of_book` events); the deviations the owner meets
     most come first **(my call)**;
   - results per variation ("Advance: 6 games, 2 wins, 4 losses") with a link to
     Insights;
   - in typical mistakes: the owner's own opening mistakes (key moments in the
     opening phase of games in this repertoire) first, then general ones.
   With no or few games the boxes are small or hidden; the general text does not
   depend on them **(my call)**.

## 3. Non-goals

- New repertoire moves. The guide explains the existing repertoire; if a guide
  needs a line the tree lacks, the line is added to the repertoire through the
  normal content rules (validator + content review) in the same milestone.
- AI-written guide text at runtime. Guides are authored content in `content/`,
  checked like lessons. The AI coach may link to guide parts later, not now.
- New openings (an Italian repertoire etc.).

## 4. Anti-goals

- A wrong chess fact anywhere in a guide (project rule; the M9 reviews found
  about 45 false texts in new content — the same process applies here).
- Vague plans ("play actively", "improve your pieces") with no concrete squares,
  breaks or moves.
- Personal boxes that state numbers or moves not in the owner's data.

## 5. Content (decided)

- **Scope:** M10 includes authoring all three guides (not only the system with a
  sample) **(owner: "guide for all")**.
- **Variation = a list of subtree roots.** Each guide variation names one or more
  repertoire node ids (node ids are SAN paths, e.g. `e4 c6 d4 d5 e5`); a tree node
  belongs to the variation whose root is its longest prefix. Node ids are paths,
  so there is no transposition ambiguity. The Slav's three roots (1.d4, 1.c4,
  1.Nf3) are simply separate variations or groups **(my call)**.
- **Final form = one position on a main tree line**, reached by that line's moves
  (both sides); the route is the owner's moves on that line in order, and "Play"
  and "Drill" use that tree line **(my call)**.

- Files: `content/guides/<repertoire-id>.json` **(my call; JSON like lessons)**.
- Every board in a guide is given as a move sequence from the start position (SAN
  list), replayed with chess.js; no free-standing FENs **(my call: makes every
  position reachable and checkable)**. Where possible, sequences follow the
  repertoire tree and name its node ids, so route steps and deviations link to the
  tree and to opening cards.
- Main variations covered (tabs):
  - London: vs ...d5 set-ups, vs ...Nf6/...g6 (King's Indian set-ups), vs early
    ...c5, vs early ...Qb6, and the main deviations the tree already holds.
  - Caro-Kann: Classical (3.Nc3/3.Nd2 dxe4), Advance (3.e5), Exchange (3.exd5),
    Panov (4.c4), Two Knights (2.Nc3 d5 3.Nf3), Fantasy (3.f3); beginner tries
    (2.Bc4, early Qf3/Qh5) under "If they do X…".
  - Slav: main Slav (4.Nc3 / 4.e3), Exchange Slav, anti-London (2.Bf4 c5), vs
    1.c4 and vs 1.Nf3.
- Text rules: plain short sentences; every claim checked (square by square with
  chess.js; evaluation words with Stockfish ≥ 1M nodes); no "The engine line
  is…", no exact percentages; all error types of the audit spec §1 avoided.
- Level: the guide shows all variations and all text; parts that rely on
  level-2/3 tree lines carry an "unlocks at level N" badge, and the "Drill" button
  is disabled for lines above the owner's level (the drill is level-gated
  server-side); "Play on the board" stays available **(my call)**.
- If a guide needs a line the tree lacks, it is added to the repertoire under the
  M9 rules (validator + content review), at most about 20 new nodes per guide;
  more than that is reported to the owner first **(my call)**.

## 6. Validation (decided)

Hard errors (not warnings): illegal move sequence, unknown node id, a node id that
does not match its sequence, a final form not on a tree line, a "job" on a square
without a piece of the owner's side. Engine rule as for repertoires (own move
< 15 win % loss), checked with the same validator and `ucinewgame` per search.

`pnpm validate:content` also checks guides: every move sequence legal; every
referenced node id exists in the repertoire and matches the sequence; every
own move in a guide line is within the repertoire rule (< 15 win % loss); every
"job" refers to a square that holds a piece of the owner's side in that board.
Each guide gets a separate content review (strongest model, chess.js + Stockfish)
before merge, as in M9.

## 7. Screens and data (decided, details to the builder)

- New page per repertoire (route e.g. `/openings/:id/guide`), linked from the
  Openings page; table of contents on the left; tabs for variations; boards use
  the existing board components (read-only boards, the line drill, the "play on
  the board" stepper).
- Server: an endpoint returns the guide content plus the personal boxes for the
  owner, computed at read time from existing data only — no schema change
  **(my call)**:
  - `opening_events` (one row per game: `repertoire_id`, `kind` = `leak` /
    `out_of_book` / `end_of_book` / `not_this_opening`, `node_id`, `ply`,
    `expected_san`, `played_san`) gives "where you left the route" (`leak`,
    grouped by node and played move, with game ids) and "what opponents
    played" (`out_of_book`, grouped by node);
  - results per variation: games whose opening event node lies in the variation
    (longest-prefix rule), with W/D/L from `games`;
  - own opening mistakes: key moments (current level) with ply ≤ 24 in games of
    this repertoire, mapped to the variation by the same rule.
  - Personal boxes show from 3 games in the variation (or 3 events at a node)
    **(my call)**.
- Entry links: opening review card → guide part for the card's node; Openings tree
  node → guide part; game page → guide of the matched repertoire and variation.
  The mapping from a repertoire node to a guide variation uses the
  longest-prefix rule; a game belongs to a repertoire when its opening event has
  that `repertoire_id`.

## 8. Constraints

Local only, tests never hit the network, `data/chess.db` safety rules, smoke runs on
port 8788 with a temp DB, merge to `main` and push when done (owner instruction).

## 9. Left to the builder

The exact JSON schema, component structure, how "jobs" are shown (hover vs click),
how the personal boxes are computed and cached, the mapping algorithm node →
guide part, and the order of authoring the three guides.

## 10. Calls made without the owner (review these)

1. Guides are authored JSON content, checked like lessons; no AI text at runtime.
2. Every board is a move sequence from the start (no free FENs), tied to repertoire
   node ids where possible.
3. Piece "jobs" on the final-form board, shown on click/hover.
4. Route buttons: play on the board and start the existing line drill.
5. Deviations sorted by how often the owner meets them; personal boxes hidden
   when there is too little data.
6. All variations visible; deeper parts badged "unlocks at level N".
7. Lines a guide needs but the tree lacks are added to the repertoire under the
   normal content rules, at most about 20 nodes per guide without asking.
8. Variations are lists of subtree roots (longest-prefix rule); the final form is
   one position on a main tree line.
9. Jobs only for 3–6 key pieces per board.
10. Personal boxes use existing data only, from 3 games or events.
11. Guide validation errors are hard errors; the engine rule matches repertoires.
