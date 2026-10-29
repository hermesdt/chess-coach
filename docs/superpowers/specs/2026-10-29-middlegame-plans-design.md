# Middlegame Plans — Design (M12)

Date: 2026-10-29
Status: draft, waiting for owner review
Parent specs: `docs/superpowers/specs/2026-10-18-chess-coach-design.md` (§9 content
and validation, §10 SRS, §18 levels), `docs/superpowers/specs/2026-10-21-opening-guides-design.md`
(M10 guides), `docs/superpowers/specs/2026-10-20-content-audit-design.md` (§1 error table).

Marks: **(owner)** = the owner said or approved it. **(my call)** = decided by the
designer; the owner can change it. **(to verify)** = a chess idea that the content
phase must check with chess.js and Stockfish before it goes into a content file.

## 1. Intent

The owner (chess.com ~550, level 1) says **(owner)**:

> I often struggle with the middlegame. Openings are covered, but once I have the
> London set up, now what? How do I start attacking? The opponent castled, and I
> might open their pawn line. How do I attack on the h file? Or the a file?

The owner wants a section like Openings, but for the middlegame **(owner)**.

Today the app has three middlegame sources. None of them answers "now what?" for
one position type:

- Each M10 guide has a short `middlegame` text per variation (three paragraphs).
- Lessons 8, 12, 13, 14, 18, 20 and 21 teach general ideas with FEN exercises.
- The coach chat (M8) answers questions about one position.

Success: the owner looks at a middlegame board in their own game, sees which
plan fits, and can name the first two or three moves of that plan. The daily
review trains this until it is a habit.

## 2. Product shape (recommended)

One new top-level page, **Plans**, next to Openings in the navigation **(my call)**.
A plan is one card for one typical position. Each plan answers four questions:
when do I use it, what is the goal, which moves come first, and what goes wrong.

### 2.1 What the owner sees

1. **Plans list** (`/plans`). Groups: "London (White)", "Caro-Kann (Black)",
   "Both colours". Each entry shows a small board, the title, one goal sentence
   and a level badge. A plan above the owner's level shows "unlocks at level N".
2. **Plan page** (`/plans/:id`). One article, read from top to bottom, with these
   parts and anchors:
   1. **When** (`#when`) — a board and a list of signs the owner can see on the
      board ("Their king is on g8", "Your bishop is on d3"). The board marks
      the squares of each sign.
   2. **Goal** (`#goal`) — one or two sentences.
   3. **Steps** (`#steps`) — three to five steps, each with a board, arrows and
      one to three sentences. Key pieces have a "job" on click or hover (M10
      pattern).
   4. **Pawn breaks** (`#breaks`) — the pawn moves that open lines in this plan,
      and what each one opens.
   5. **Watch out** (`#watch`) — what the opponent does against the plan, and
      when NOT to use it.
   6. **Typical mistakes** (`#mistakes`) — boards with the bad move in red and
      the good moves in green (M10 `bad` / `good` pattern).
   7. **Model line** (`#model`) — one short line the owner can step through on
      the board. The line comes from Stockfish or from the repertoire tree.
   8. **Train** (`#train`) — a "Train this plan" button. It adds the plan's
      exercises to the daily review (like completing a lesson).
   9. **Your games** (`#games`, M12b) — games where this position came up, with
      links to the move.
3. **Daily review** — a new card kind `plan` ("find the plan move"). See §6.
4. **Game page** (M12b) — a "Middlegame plan" link at the first move where a plan
   fits. See §7.

### 2.2 Links to the rest of the app

- **Guide → plans.** The M10 guide part "Middlegame plan" gets a list "Plans for
  this set-up" with links. A plan names its guide variations in `guideLinks`.
- **Plan → guide.** Each plan page has "Back to the opening" to the guide
  variation (`/openings/:id/guide?v=<key>`).
- **Plan ↔ lessons.** A plan names lesson ids in `lessons` (for example
  `castling-sides`, `pawn-breaks`, `outposts`). The plan page shows them as
  links. The lesson page shows "Related plans" from the same field. Locked
  lessons show as locked (M9 rule).
- **Review card → plan.** A `plan` card has a "Plan" link to its plan page, like
  the M10 "Plan" link on opening cards.
- **Coach chat → plan** (M12b). The coach can name a plan id that the server has
  matched for the position. See §8.
- The dashboard does not change in M12. The anti-goal "one recommended focus"
  stays **(my call)**.

### 2.3 The plan catalogue

**MVP (M12a), six plans, all level 1** **(my call; owner question 1)**. They answer
the owner's three questions: attack the castled king, the h-file, and the a-file.

| id | Group | Position | Core idea |
|----|-------|----------|-----------|
| `london-kingside-attack` | London | London set-up, Black castled short, queens on | Bring three pieces to the black king before you push pawns. |
| `london-h-file` | London | After ...Bxg3 hxg3, the h-file is half open | Use the open h-file with a rook and the queen. |
| `london-e4-break` | London | London set-up vs ...d5 | Prepare and play the e4 break. |
| `caro-advance-d4` | Caro-Kann | Advance Caro-Kann after ...c5 | Hit d4 and e5 with pieces; use the c-file. |
| `opposite-castling-race` | Both colours | Kings castled on opposite sides | Storm with the pawns in front of their king; open the a-, b-, g- or h-file. |
| `no-clear-plan` | Both colours | Any quiet position | A checklist when no plan fits. |

Content sketch for each MVP plan. Only items marked "verified" were checked for
this spec (Appendix A). Everything else is **(to verify)**.

1. **`london-kingside-attack`**
   - Signs: own pawns on c3, d4, e3; own bishop on d3; their king on g8 or h8;
     queens on the board.
   - Steps: the d3 bishop aims at h7 (verified in position A). Ne5 with the d4
     pawn and the g3 bishop as guards (verified; also an M10 guide claim). The
     queen joins the attack, for example via e2, f3 or h5 **(to verify)**. The
     f-pawn or a rook lift (Rf3-h3) can follow **(to verify)**.
   - When not: a black knight on f6 guards h7. Then Bxh7+ Nxh7 loses a bishop for
     a pawn (verified in position A). Do not attack with only one piece (lesson 12).
   - Links: guide `london` / `vs-d5`; lessons `london-plans`, `mates`.
2. **`london-h-file`**
   - Signs: own pawn on g3 (from hxg3), no own h-pawn, their king on g8 or h8.
   - The M10 guide states that after ...Bxg3 hxg3 the h-file is half open for
     the white rook (validated content).
   - Steps: keep the rook on h1 or bring a rook to the h-file. Line up the queen
     and the d3 bishop against h7. The plan can mean castling long or castling
     late **(to verify, all)**.
   - If the content check shows that the plan needs castling long, the plan
     becomes level 2 **(my call)**.
   - Links: guide `london` / `vs-d5`; lessons `castling-sides`, `mates`.
3. **`london-e4-break`**
   - Signs: own pawns on c3, d4, e3; own knight on d2; own bishop on d3; a black
     pawn on d5.
   - Steps: Re1, Qe2, then e4 (the order of the M10 guide). In position A, Re1
     and Qe2 are among the top engine moves (verified).
   - Mistake: e4 before it is guarded loses a pawn after ...dxe4 (M10 guide
     mistake, validated).
   - Links: guide `london` / `vs-d5`, `vs-kid`, `vs-early-c5`; lesson `pawn-breaks`.
4. **`caro-advance-d4`**
   - Signs: a white pawn on e5; own pawns on d5 and e6; no own c-pawn.
   - Steps: ...c5 hits the base of the chain (lesson 11, lesson 21). ...Nbc6
     attacks the d4 knight and the e5 pawn (verified in position B). ...Ne7-g6
     attacks e5 (M10 guide claim). A rook on c8 uses the half-open c-file
     **(to verify)**.
   - Mistake: in position B, ...Qb6 loses the queen after Nxf5 Nxf5 Bxb6. The
     knight leaves d4 and the e3 bishop attacks b6 (verified).
   - Links: guide `caro-kann` / `advance`; lessons `caro-kann-plans`, `pawn-breaks`.
5. **`opposite-castling-race`**
   - Signs: one king on g1, h1, g8 or h8; the other king on a1, b1, c1, a8, b8
     or c8.
   - Steps: push the pawns in front of the enemy king. Open a file for your
     rooks (a- or b-file against a long-castled king, g- or h-file against a
     short-castled king). Bring the pieces. Do not stop halfway (lesson 8).
   - Source positions: the five validated exercises of lesson 8, and the
     Caro-Kann Classical move order of the M10 guide, where White castles long
     and Black castles short **(to verify that the plan steps fit there)**.
   - Links: guide `caro-kann` / `classical`; lesson `castling-sides`.
6. **`no-clear-plan`** (no trigger, never matched to games)
   - Steps, as a checklist: (1) Blunder check: what do they attack? (2) King
     safety, yours and theirs. (3) Find your worst piece and improve it. (4) Look
     for a pawn break. (5) Look for a weak square or an outpost. (6) Ask what
     your opponent wants.
   - Links: lessons `blunder-check`, `outposts`, `pawn-breaks`, `prophylaxis`.
   - Exercises: positions where one piece move is clearly the best (engine rule
     §6.2). The content phase finds them in the repertoire lines **(to verify)**.

**Later (M12c), not in the MVP:** `caro-exchange-minority` (level 2; the
reversed Carlsbad structure, ...b5-b4, links lesson 20), `caro-classical-c5`,
`london-vs-kid` (e4 break, Bh2), `london-queenside-a-file` (after ...Qb6 Qb3
...c4 Qxb6 axb6), `greek-gift` (level 2, Bxh7+ only when its conditions hold),
`panov-iqp` (level 2), and Slav plans.

## 3. Non-goals and anti-goals

Non-goals:

- AI-written plan text at runtime. Plans are authored content in `content/plans/`,
  checked like guides and lessons.
- A plan detector that uses the engine to guess the owner's intent.
- New analysis tags in M12 (for example `no_plan`). See §7.3.
- New openings.

Anti-goals:

- A wrong chess fact anywhere in a plan. The M9, M10 and M11 reviews found many
  false texts in new content. The same process applies (§9).
- A vague plan ("play actively") with no squares, pieces or moves.
- A quiz with two good answers where only one counts. Many middlegame moves are
  almost equal (Appendix A). The quiz must accept all good plan moves.
- A "Plan" link on a game where the plan does not fit the board.

## 4. Content model

### 4.1 Files

- One file per plan: `content/plans/<id>.json` **(my call)**. Fixtures for tests go
  in `content/plans/__test__/` (not loaded, as for guides).
- Every board is a SAN move sequence from the start position, replayed with
  chess.js. No free FENs (M10 rule) **(my call)**. A board may name the repertoire
  node its moves start with (`fromNode`). The validator checks that the moves
  start with that node path.
- Plan moves beyond the repertoire tree come from Stockfish play from a tree
  position. The content agent records the source in `source` (`tree` or
  `stockfish`).

### 4.2 Schema (TypeScript view; the builder writes the loader)

```ts
interface PlanFile {
  id: string;                       // kebab-case, equal to the file name
  title: string;                    // "Attack the castled king"
  group: 'london' | 'caro-kann' | 'slav' | 'general';
  side: 'white' | 'black';          // the owner's colour in this plan
  level: 1 | 2 | 3;
  summary: string;                  // max 140 characters
  guideLinks: { repertoireId: string; variation: string }[];  // may be empty
  lessons: string[];                // lesson ids (LESSON_IDS)
  position: PlanBoard;              // the main board for "When" and "Goal"
  trigger: Trigger | null;          // null only for group "general" checklists
  goal: string;
  steps: PlanStep[];                // 3 to 5
  jobs: { square: string; text: string }[];          // 3 to 6, on `position`
  breaks: { from: string; to: string; text: string }[];  // 0 to 3
  opponent: { text: string; board?: PlanBoard }[];   // 1 to 3: what they do
  notNow: string[];                 // 1 to 3: when not to use the plan
  mistakes: PlanMistake[];          // 1 to 4, M10 shape
  models: PlanModel[];              // 0 to 2
  exercises: PlanExercise[];        // 3 to 6
}

interface PlanBoard {
  fromNode?: { repertoireId: string; nodeId: string };
  moves: string[];                  // SAN from the start position
  arrows?: { from: string; to: string; kind: 'move' | 'attack' | 'route' }[];
  marks?: string[];                 // squares to highlight
}

interface PlanStep { text: string; board?: PlanBoard }   // no board = the `position` board

interface PlanMistake { moves: string[]; text: string; bad: string; good: string[] }  // as M10

interface PlanModel {
  title: string;
  moves: string[];                  // from the start position
  startPly: number;                 // the stepper starts here
  kind: 'plan' | 'trap';            // trap = the opponent errs on purpose
  source: 'tree' | 'stockfish';
  comments: { ply: number; text: string }[];
}

interface PlanExercise {
  id: string;
  board: PlanBoard;                 // owner to move at the end of `moves`
  prompt: string;                   // "White to move. Their king is on g8. Start the plan."
  choices: { san: string; why: string }[];   // 2 to 4, shown as arrows A, B, C, D
  accepted: string[];               // SAN; a subset of choices; the first is shown as the answer
  explanation: string;
}
```

### 4.3 Trigger conditions

A trigger is a small set of board conditions. The same data does three jobs:
the "When" list on the plan page, the validator check, and the game matcher in
M12b **(my call)**. The UI writes the label of each condition from its data, so the
label and the check never differ.

```ts
interface Trigger { all: Condition[]; none?: Condition[] }

type Condition =
  | { type: 'piece'; side: 'own' | 'opp'; piece: 'K' | 'Q' | 'R' | 'B' | 'N' | 'P'; on: string[] }  // one such piece on one of the squares
  | { type: 'pawns'; side: 'own' | 'opp'; on: string[] }        // a pawn on every listed square
  | { type: 'noPawn'; side: 'own' | 'opp'; file: string }       // no pawn of that side on the file
  | { type: 'castled'; side: 'own' | 'opp'; wing: 'short' | 'long' }  // king on f-h or a-c of its back rank
  | { type: 'queensOn' }
  | { type: 'minPieces'; count: number };                        // rooks and minor pieces per side, both sides
```

Example labels: "Their king is on g8 or h8." "You have pawns on c3, d4 and e3."
"You have no h-pawn."

### 4.4 Text rules

As for guides and lessons:

- Plain short sentences.
- Every claim is checked: square by square with chess.js, and evaluation words
  with Stockfish at 1M nodes or more.
- No "The engine line is…", no "%", no exact numbers.
- Never write "the best plan" or "the only plan". Write "a good plan" or
  "one plan".
- Every `why` of a wrong choice says what goes wrong, in a line the validator can
  replay ("Bxh7+ Nxh7 and you lose a bishop for a pawn").

## 5. Validation

### 5.1 Reuse

- A new `server/plans/load.ts` (shape checks) and `server/plans/validate.ts` (chess
  rules). They follow `server/guides/load.ts` and `server/guides/validate.ts`.
- Shared code to reuse: the M10 `checkBadGood` logic (move it to a shared module),
  the job-square check, the text-field checks (`engine-line-text`,
  `percent-text`), and the lesson engine rules from `server/course/validate.ts`.
- `pnpm validate:content` validates all plans. A new flag `--plans` and a script
  `pnpm validate:plans` check only plans (like `validate:lessons`).
- `pnpm check:sequences` reads plan texts too. The builder adds `plans` to
  `ContentSources`. The start boards are the same idea as for guides: the board
  of the step, mistake, choice or model comment the text belongs to.
- Every engine search starts with `ucinewgame` (M9 rule) and uses 1M nodes.

### 5.2 Hard errors

- Shape: missing fields, wrong counts (steps 3–5, jobs 3–6, choices 2–4,
  exercises 3–6), duplicate plan or exercise ids, `id` not equal to the file name.
- Unknown lesson id, unknown repertoire id, or unknown guide variation key.
- A `fromNode` that does not exist, or moves that do not start with its path.
- An illegal SAN in any board, mistake, model or choice.
- A job on a square without a piece of the owner's side.
- A `move` arrow that is not a legal move on its board. An `attack` arrow whose
  `from` piece does not attack `to` (chess.js `attackers`). A `route` arrow whose
  `from` square has no own piece.
- A `break` whose `from` square has no own pawn, or whose `to` square is not a
  pawn step or pawn capture from `from`.
- **Trigger checks:** the trigger must match the `position` board and every
  exercise board. A `null` trigger is allowed only in group `general`.
- An exercise board where it is not the owner's turn, or a prompt that does not
  start with "White to move." or "Black to move." (lesson rule).
- `accepted` not a subset of `choices`.

### 5.3 Engine rules

| Item | Rule |
|------|------|
| Own moves in boards, models and mistake `good` | lose < 15 win % (repertoire rule) |
| Opponent moves in a `plan` model | lose < 15 win %, so the model does not rest on a blunder |
| Opponent moves in a `trap` model | free (the trap shows the error) |
| Accepted quiz moves | lose < 10 win % (hard); a warning from 5 win % (lesson rule) |
| Wrong quiz choices | lose ≥ 10 win % against the best move (hard error `ambiguous-choice`) |
| Engine moves the quiz misses | a warning `missed-good-move` when a move outside `choices` is within 5 win % of the best and is not listed |

The `ambiguous-choice` rule is new. Appendix A shows why: in position A, four
plan moves are within 2 win % of each other. A wrong choice must be clearly
wrong, or the quiz teaches noise.

### 5.4 Real-content test

A vitest (no engine) loads every real plan and checks the shape, the trigger
matches, the node ids against the real trees, the lesson ids and the guide
variation keys. It follows `server/guides/real-content.test.ts`.

## 6. Training

### 6.1 Card kind `plan`

- New card kind `plan` **(my call)**. `cards.kind` is plain text, so no table rebuild
  is needed. `refs` gets `{ planId, exerciseId }`.
- A card enters the review when the owner presses "Train this plan" on the
  plan page. Migration 016 adds `plan_progress(plan_id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL)`.
- Card identity stays `(kind, position_key)` (M3 rule).

### 6.2 The quiz ("find the plan move")

One exercise type in M12a **(my call; owner question 4)**:

1. The board shows the position and the opponent's last move.
2. The prompt names the signs ("White to move. Their king is on g8. Start the plan.").
3. Two to four arrows show the choices, labelled A to D, with buttons below the
   board.
4. The owner clicks a button or plays a move on the board.
5. Feedback:
   - An accepted move: "Good." plus the explanation. Default rating Good.
   - A wrong choice: its `why` text, then the accepted moves in green. Default
     rating Again.
   - A move that is not a choice: the M4 opening-card check (`check-move.ts`,
     Stockfish 200k nodes). Within 5 win % of the best: "…is also a good move, but
     this plan plays <SAN>." with default rating Hard. Else: Again.
6. The card has a "Plan" link to the plan page.

The card stores `choices` in its solution. The review page draws them only for
`plan` cards. Other card kinds do not change.

### 6.3 Level gating and the daily mix

- Each plan has `level`. All plans are readable at every level. "Train this plan"
  is active only at `level ≤ currentLevel` **(my call; owner question 2)**. This
  follows the M10 rule ("all text visible, drill gated").
- The owner is level 1. All six MVP plans are level 1.
- A plan board can lie beyond the level-1 tree lines (positions A and B are
  level-2 nodes). The plan level decides the gating, not the node level
  **(my call)**. The opening drill and opening cards keep their own node gating.
- New-card mix by level, with `plan` added **(my call; owner question 5)**:

  | Level | mistake | lesson | plan | opening |
  |-------|---------|--------|------|---------|
  | 1 | 0.4 | 0.3 | 0.1 | 0.2 |
  | 2 | 0.35 | 0.25 | 0.1 | 0.3 |
  | 3 | 0.3 | 0.15 | 0.15 | 0.4 |

- Unused quota passes on (M9 rule). The tie order becomes mistake → lesson →
  plan → opening. With the default cap of 20 new cards, level 1 gives two new
  plan cards per day.

## 7. The owner's games (M12b)

### 7.1 Matcher

- For each analysed game, the server replays the moves. It checks each plan
  trigger on the owner's turns, from ply 16 to ply 60 **(my call)**.
- The matcher uses only plans whose `side` is the owner's colour in the game.
- It uses a `london` or `caro-kann` plan only when the game's opening event has
  that repertoire id. It uses `general` plans with a trigger for all games.
- The first ply where a trigger matches is the "plan moment". At most one moment
  per plan per game, and at most two plans per game, ordered by plan level and
  then by catalogue order.
- The matcher is pure chess.js. It needs no engine and no AI.
- The server computes the results at read time. An in-memory cache keeps them,
  keyed by game id, analysis version and plan-content hash. No schema change.
- If the plans page needs more than 200 ms warm at 300 games, the builder adds a
  table (M10 benchmark).

### 7.2 What the owner sees

- **Game page:** "Middlegame plan: <title> (move N)". The link opens the game at
  that ply. A second link opens the plan page.
- **Key moments:** a key moment within 20 plies after a plan moment shows a
  small "Plan: <title>" link.
- **Plan page "Your games":** the number of games with the plan moment, W/D/L,
  and up to five game links with "and N more" (M10 rule). The box shows only from
  three games (M10 rule).

### 7.3 Deferred

- A new tag such as `no_plan` or `wrong_break`. The engine cannot tell what the
  owner wanted. A false tag is worse than no tag.
- "Did you follow the plan?" checks after the plan moment.
- Plan cards made from the owner's own plan moments.
- A dashboard focus that points to a plan.

## 8. AI coach (M12b)

The coach chat (M8) stays grounded. It may explain plans only with facts from the
fact pack.

New fact-pack items (`server/chat/fact-pack.ts`), all computed with chess.js:

- `structure.kings`: the square of each king and its wing (`short`, `long`,
  `centre`).
- `structure.files`: for each file a–h, `open`, `half-open-white`,
  `half-open-black` or `closed`.
- `structure.pawns`: per side, the isolated, doubled and passed pawns.
- `structure.shield`: per side, the own pawns on the three files around the king,
  on the two ranks in front of it.
- `structure.breaks`: per side, the legal pawn moves that capture a pawn or move
  next to an enemy pawn so that it attacks it.
- `plans`: the plans whose trigger matches the anchor position: id, title, the
  trigger labels and the step texts (validated content).

Prompt and schema changes:

- The answer schema gets an optional `plan_id`. Its enum holds only the matched
  plan ids (as `lesson_id`).
- The prompt says: claims about files, pawns and king safety come only from
  `structure`; plan advice comes only from `plans`; moves still come only from
  the engine lines and the game.
- A new grounding check: a sentence such as "the h-file is open" must match
  `structure.files`. If not, the answer gets the normal single retry.
- Moves in plan texts are not added to the grounding set. They are often not
  legal in the owner's position.

The mistake-card "why it matters" line (2026-10-29 fix) does not change in M12.

## 9. Content quality

Each plan goes through the M10/M11 process **(owner rule for all content)**:

1. An author agent writes the plan with chess.js and Stockfish at hand. It runs
   `pnpm validate:plans` and `pnpm check:sequences` until both pass.
2. A separate content reviewer (strongest model) checks every claim, square by
   square with chess.js and every evaluation word with Stockfish at 1M nodes or
   more. It writes a ledger to `docs/superpowers/notes/`, as in M11.
3. A fixer corrects each false or misleading claim and re-verifies every new
   sentence (M11 ruling).
4. Each item marked **(to verify)** in §2.3 is either verified or removed. Nothing
   unverified ships.

## 10. Sub-milestones and scope

| # | Scope | Done when |
|---|-------|-----------|
| M12a | Schema, loader, validator, `validate:plans`, sequence check for plans; six level-1 plans with content reviews; Plans list and plan page; guide ↔ plan and lesson ↔ plan links; `plan` cards with the choice quiz; migration 016; daily mix | Gates green, smoke run shows all six plans and a plan card in the review |
| M12b | Trigger matcher on the owner's games; game page and key-moment links; "Your games" box; fact-pack `structure` and `plans`; `plan_id` in chat; file-claim grounding check | Gates green, smoke run on a copy of the live DB shows plan links on real games |
| M12c | More plans (§2.3 "Later"), level 2–3 plans | Each new plan passes the §9 process |

M12a alone answers the owner's question. M12b connects it to their games. M12c
adds breadth **(my call)**.

Screens and API (details to the builder):

- `GET /api/plans` returns the index (id, title, group, level, locked, summary,
  and in M12b the game count).
- `GET /api/plans/:id` returns a DTO with resolved boards (FEN, arrows, marks),
  trigger labels and lock state.
- `POST /api/plans/:id/train` adds the cards. It is idempotent.
- `GET /api/games/:id/plans` (M12b) returns `{ planId, ply }[]`.
- Web components reused: `FinalFormBoard` (jobs), `RouteStepper` (model line), the
  M10 red and green mistake arrows, `ExerciseBoard` / `DrillBoard` (quiz).

## 11. Testing plan

Tests never hit the network. Fixtures live in `server/**/__fixtures__/` and
`content/plans/__test__/`.

- Loader: shape errors, counts, unknown ids (fixture plan files).
- Validator with a fake engine (as `server/guides/validate.test.ts`): illegal SAN,
  bad `fromNode`, job squares, each arrow kind, breaks, trigger mismatch,
  `ambiguous-choice`, `missed-good-move`, the model rules for `plan` and `trap`.
- Trigger conditions: one positive and one negative FEN per condition type.
- Sequence check: plan texts with a legal and an illegal line.
- Real-content test (no engine): every real plan against the real trees, lessons
  and guides.
- Cards: "Train this plan" creates one card per exercise, a second press creates
  none, refs and choices are stored, level gating works.
- Session: the new mix, quota pass-on with zero plan cards, the tie order.
- Review route: accepted move, wrong choice, non-choice move (engine mocked).
- Matcher (M12b): recorded PGN fixtures of London and Caro-Kann games, the ply
  window, at most two plans per game, the repertoire filter.
- Fact pack (M12b): `structure` for FEN fixtures (open files, isolated pawns,
  castled wings, breaks); the file-claim grounding check.
- Web: plans list, plan page anchors, the quiz card (choice click and board move),
  "Related plans" on the lesson page, "Plans for this set-up" on the guide page.
- One engine integration test, skipped when Stockfish is missing.
- Gates: `pnpm typecheck && pnpm lint && pnpm test && pnpm validate:content`, then a
  smoke run with `pnpm smoke:start` (temp DB, port 8788) and `pnpm smoke:stop <pid>`.
- Back up `data/chess.db` to `data/backups/pre-m12a-<date>.db` before the merge
  (migration 016).

## 12. Risks

1. **Close engine scores.** Many middlegame moves are almost equal (Appendix A).
   Mitigation: accepted sets, the `ambiguous-choice` rule, and "a good plan"
   wording.
2. **False chess facts.** Middlegame claims are harder to check than opening
   moves. Mitigation: §9, and the rule that an unverified item ships nowhere.
3. **Model lines that mislead.** A line where the opponent blunders looks like
   a plan that always works. Mitigation: the opponent rule for `plan` models;
   `trap` models are labelled.
4. **Loose triggers.** A trigger can match positions where the plan is wrong.
   Mitigation: negative fixtures; triggers must match all exercise boards; the
   link says "a plan that may fit", not "the plan".
5. **Too much at level 1.** Long texts overload a 550 player. Mitigation: 3–5
   steps, short sentences, two new plan cards per day.
6. **Coach over-claims.** Grounding checks moves and, from M12b, file claims
   only. Mitigation: `structure` facts, the prompt rule, and the existing
   word-list filter for attack claims on mistake cards.

## 13. Open questions for the owner

Each question has a default. The build uses the default if the owner does not answer.

1. **MVP plan list.** Are the six plans in §2.3 the right first set?
   Default: yes. The Exchange Caro-Kann minority attack and the Slav come in M12c.
2. **Plans above your level.** Readable with a badge, or hidden?
   Default: readable; only training is locked.
3. **Navigation.** A new top-level "Plans" page, or a tab on the Openings page?
   Default: a new top-level page next to Openings.
4. **Quiz format.** Arrows with A–D choices, or a free move on the board only?
   Default: arrows with choices, and a free board move is also accepted.
5. **Daily share.** Is 10 % of new cards for plans at level 1 right?
   Default: 10 % (two new plan cards a day at the default cap of 20).

## 14. Calls made without the owner (review these)

1. Plans are authored JSON in `content/plans/`, one file per plan; no AI text at
   runtime.
2. Every board is a move sequence from the start position (M10 rule).
3. One trigger format drives the "When" list, the validator and the game matcher.
4. New card kind `plan`; cards only after "Train this plan"; migration 016.
5. Wrong quiz choices must lose 10 win % or more; all good plan moves are accepted.
6. The matcher checks plies 16 to 60, the first match per plan, at most two plans
   per game, no new table unless it is slow.
7. No new analysis tag in M12.
8. Three sub-milestones: M12a (MVP), M12b (games and coach), M12c (more plans).

## Appendix A — Verified facts for this spec

Checked on 2026-10-29 with chess.js 1.4 and Stockfish 19 at 1M nodes after
`ucinewgame` (MultiPV 4, and `searchmoves` for single moves). Scores are in
pawns from the side to move. "Win" is the lichess win % of the side to move.

**Position A** — London node
`d4 d5 Bf4 Nf6 e3 e6 Nf3 Bd6 Bg3 O-O Nbd2 c5 c3 Nc6 Bd3 b6 O-O Bb7` (level 2 in
the tree), White to move,
`r2q1rk1/pb3ppp/1pnbpn2/2pp4/3P4/2PBPNB1/PP1N1PPP/R2Q1RK1 w - - 2 10`.

| Move | Score | Win | One line |
|------|-------|-----|----------|
| Re1 | +0.08 | 50.7 | Re1 Bxg3 hxg3 Rc8 Qa4 g6 |
| Qe2 | +0.07 | 50.6 | Qe2 Ne7 Rad1 Nf5 e4 dxe4 |
| Qc2 | −0.05 | 49.5 | Qc2 Bxg3 |
| Ne5 | −0.06 | 49.4 | Ne5 Qc7 |
| Ng5 | −0.19 | 48.3 | Ng5 Bxg3 |
| e4 | −0.34 | 46.9 | e4 Bxg3 |
| h4 | −0.50 | 45.4 | h4 Bxg3 |
| b4 | −1.51 | 36.4 | b4 cxb4 cxb4 Nxb4 Be2 Bxg3 |
| Bxh7+ | −6.43 | 8.6 | Bxh7+ Nxh7 Bxd6 Qxd6 |

chess.js: the d3 bishop attacks h7; the g8 king and the f6 knight guard h7. White
guards e5 with d4, f3 and g3; Black guards e5 with c6 and d6. g4 is illegal here
(the bishop stands on g3).

Use for the quiz: accepted Re1, Qe2, Qc2, Ne5; valid wrong choices Bxh7+ and
b4. Not valid as wrong choices: e4 and h4 (they lose less than 10 win %).

**Position B** — Caro-Kann node
`e4 c6 d4 d5 e5 Bf5 Nf3 e6 Be2 c5 Be3 cxd4 Nxd4 Ne7 O-O` (level 2), Black to move,
`rn1qkb1r/pp2nppp/4p3/3pPb2/3N4/4B3/PPP1BPPP/RN1Q1RK1 b kq - 2 8`.

| Move | Score | Win | One line |
|------|-------|-----|----------|
| ...Nbc6 | −0.43 | 46.1 | Nbc6 Bb5 a6 Bxc6+ bxc6 c4 |
| ...a6 | −0.68 | 43.8 | a6 g4 Bg6 f4 |
| ...Bg6 | −0.82 | 42.5 | Bg6 c4 |
| ...Qd7 | −1.77 | 34.3 | Qd7 c4 |
| ...h5 | −1.85 | 33.6 | h5 c4 Nbc6 Qa4 |
| ...Nd7 | −2.24 | 30.5 | Nd7 c4 |
| ...Qb6 | −8.73 | 3.9 | Qb6 Nxf5 Nxf5 Bxb6 axb6 |

chess.js: after ...Nbc6 the knight attacks d4 and e5; the e3 bishop and the d1
queen guard d4; no white piece guards e5. After ...Qb6 Nxf5 the e3 bishop
attacks b6.

Use for the quiz: accepted ...Nbc6; valid wrong choices ...Qd7, ...Nd7 and ...Qb6.
