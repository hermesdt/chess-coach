# M12b (Part 1) — Plans in the owner's games (design)

Date: 2026-10-29. Status: draft, waits for owner approval.
Parent spec: `2026-10-29-middlegame-plans-design.md` §7. This file fixes what Part 1 builds.

## Intent

The owner wants to see which middlegame plans come up in their own games. The app finds the first move where a
plan fits and links the game page, the key moments and the plan page to it.

## Goals

- A pure chess.js matcher: `matchGame` gives the plan moments of one game.
- Game page: "Middlegame plan: <title> (move N)", a link to that move, a link to the plan page.
- Key moments: a key moment up to 20 plies after a plan moment shows a "Plan" link.
- Plan page: "Your games" box with the count, W/D/L and up to five game links ("and N more"). It shows from 3 games.
- No engine, no AI, no schema change.

## Non-goals (Part 2 and later)

- Coach chat: `structure` facts, `plan_id`, file-claim check.
- New tags such as `no_plan`. "Did you follow the plan?" checks. Cards from the owner's plan moments.
- Dashboard focus.

## Anti-goals

- A plan link in a game that does not fit the plan (wrong colour, wrong opening).
- A wrong "plan moment" because of a loose trigger. The trigger is the validated M12a one. No new matching rules.
- Slow pages. Warm calls must stay fast at 300 games.

## Approaches

- **A. Compute at read time with an in-memory cache (chosen by the owner).** No migration. Cannot go stale.
- B. A stored table `plan_moments`. Rejected: needs migration 017 and a rebuild when a plan file or analysis changes.
- C. Game page only. Rejected: the "Your games" box uses the same matcher and shows which plans the owner reaches.

## Design

**Matcher.** `matchGame(game, plans, repertoireId): PlanMoment[]` where `PlanMoment = { planId, ply }`.
- Replay the PGN (`parsePgn`). Check each position after ply 16 to 60 where it is the owner's turn to move.
- Use plans with a trigger and `side` equal to the owner's colour. A `london` or `caro-kann` plan needs the game's
  opening event `repertoire_id` to be the same id. A `general` plan with a trigger fits every game.
- The first ply where `matchTrigger` is true is the moment. One moment for each plan. At most two plans for each
  game, ordered by plan level, then by catalogue order (file order).
- Games without a user colour give no moments. The matcher works on every game, analysed or not (my call).

**Cache.** An in-memory map keyed by `gameId`, the analysis version (or 0) and a hash of the plan files. A reload of
plans changes the hash and drops old entries.

**API.**
- `GET /api/games/:id/plans` returns `{ planId, title, ply }[]` (title included for the link text).
- `GET /api/plans/:id/games` returns `{ total, wins, draws, losses, games: { id, ply, result, white, black, playedAt }[] }`
  with the five newest games. Duplicate games are excluded, as in the game list.
- `GET /api/plans` index entries get `gameCount`.

**Web.**
- Game viewer: a box under the board with the plan moment. The move link sets the board to that ply. The plan link
  goes to `/plans/:id`.
- Key moments: the existing list shows "Plan: <title>" when a key moment is 1 to 20 plies after a plan moment.
- Plan page: a "Your games" section. Shows only when `total >= 3`.
- Plans list: no change except an optional "N games" label (builder's call).

## Decisions I made (owner can change)

- The minimum of three games for the box stays (M10 rule). Today only `london-e4-break` (7 games) reaches it.
- Ply window 16 to 60, at most two plans per game, one moment per plan (from the parent spec).
- Matching runs on unanalysed games too.
- Games from a repertoire other than London or Caro-Kann (for example Slav) get no London or Caro-Kann plan.

## Left to the builder

Component layout and CSS, the exact cache structure, whether the plan list shows "N games".

## Tests

- Matcher on recorded PGN fixtures: a London game that reaches `london-e4-break`, a Caro-Kann game for
  `caro-advance-d4`, the ply window (a match at ply 14 does not count), colour filter, repertoire filter,
  at most two plans, a game without user colour.
- Cache: second call does not replay (spy); a changed plan hash recomputes.
- Routes: `/games/:id/plans`, `/plans/:id/games` (counts, W/D/L, duplicates excluded, five links), unknown id gives 404.
- Web: game page box, key-moment link within 20 plies and none at 21, plan page box hidden under 3 games.
- Real data on a copy of the owner's database: about 14 moments in 88 games, all confirmed by hand on two games.
