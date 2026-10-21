# M10 Opening Guides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A guide page for each repertoire (London, Caro-Kann, Slav): why the opening, the final form per variation, the route to it, "if they do X…", the middlegame plan and typical mistakes — tied to the repertoire tree and personalised with the owner's own games.

**Architecture:** Guides are JSON content files whose every position is a repertoire node id (a SAN path) or a SAN move list, validated by the content validator. A server endpoint joins a guide with the repertoire tree, the owner's level and the owner's data (opening events, games, key moments) into one DTO. A new web page renders it (layout A), and "Plan" links point into it from review cards, the Openings tree and game pages.

**Tech Stack:** as before (Hono, node:sqlite, chess.js, Stockfish validator, React 19, react-chessboard). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-21-opening-guides-design.md` (all sections). Content error rules: `docs/superpowers/specs/2026-10-20-content-audit-design.md` §1.

## Global Constraints

- Project rule: no wrong chess fact. Every board comes from a repertoire node id (SAN path like `e4 c6 d4 d5 e5`) or a SAN list from the start, replayed with chess.js; every text claim is checked with chess.js and, for evaluation words, Stockfish ≥ 1M nodes; no "The engine line is …", no exact percentages; all error types of the audit spec §1 avoided.
- Six parts per guide, in this order and with these headings: "Why this opening", "Final form", "The route", "If they do X…", "Middlegame plan", "Typical mistakes".
- A variation = `roots: string[]` of repertoire node ids; a tree node belongs to the variation whose root is its longest prefix (node ids are SAN paths).
- Final form = one position on a main tree line (both sides' moves); "jobs" for 3–6 key pieces/pawns of the owner's side per board.
- Level: all text visible; parts whose line contains a node above the owner's level show "Unlocks at level N"; "Drill" is disabled for them; "Play on the board" stays available.
- Personal boxes use existing data only (no schema change): `opening_events` (`leak`, `out_of_book`), `games` W/D/L, key moments (current level) with ply ≤ 24. A variation's personal box shows from 3 games; a node-level item from 3 events.
- Validation errors for guides are HARD errors; own moves in guide lines follow the repertoire rule (< 15 win % loss) with `ucinewgame` per search.
- A guide may add at most about 20 repertoire nodes without asking the owner; added nodes follow the M9 rules (level, comment, validator, content review).
- Safety: never touch `data/chess.db` or port 8787; smoke runs with `pnpm smoke:start` (port 8788). When M10 is done: back up the DB, merge to `main`, push.

## Review Focus

1. A guide references a node id that no longer exists (the tree changed): `pnpm validate:content` fails with the guide file and the id — test in Task 1.
2. An owner with zero games (or games in another repertoire only): the guide renders fully with no personal boxes and no "0 games" noise — tests in Tasks 2 and 3.
3. A game that left the book at move 1 (`not_this_opening`) or never left it (`end_of_book`) is not counted as a leak or an opponent deviation; `end_of_book` games still count in variation results via their deepest matched node — test in Task 2.
4. A "Plan" link from a tree node that belongs to no guide variation opens the guide at "Why this opening", never a broken anchor — test in Task 4.
5. A level-1 owner on a level-3 variation sees the text and the "Unlocks at level 3" badge, Drill disabled, Play available — test in Task 3.

---

### Task 1: Guide schema, loader and validator  *(model: sonnet)*

**Files:** Create `server/guides/types.ts`, `server/guides/load.ts`, `server/guides/validate.ts`, `server/guides/load.test.ts`, `server/guides/validate.test.ts`, `content/guides/__test__/sample.json`; Modify `scripts/validate-content.ts` (also validate `content/guides/*.json`), `shared/types.ts` (exported guide content types)

**Interfaces — Produces:**
- `interface GuideFile { repertoireId: string; why: string; variations: GuideVariation[] }` (paragraph strings use "\n\n" breaks)
- `interface GuideVariation { key: string; name: string; roots: string[]; finalForm: { nodeId: string; jobs: { square: string; text: string }[] }; route: { nodeId: string; why: string }[]; deviations: { nodeId: string; plan: string; showNodeId?: string }[]; middlegame: string; mistakes: { moves: string[]; text: string }[] }`
  - `route[].nodeId`: own-side moves on the final-form line, in order (each an ancestor-or-self of `finalForm.nodeId`).
  - `deviations[].nodeId`: an opponent move node in the tree inside the variation; `showNodeId` (optional) a deeper node that shows the plan.
  - `mistakes[].moves`: SAN list from the start (may leave the tree).
- `loadGuides(dir?: string): GuideFile[]`, `loadGuide(json: unknown, reps: Repertoire[]): GuideFile` (throws `GuideError` with file and message).
- `validateGuide(guide: GuideFile, rep: Repertoire, engine?: { analyse… } ): ValidationIssue[]` — hard errors: unknown node id; node id outside every root of its variation; route node not on the final-form line or not an own move; a variation root that is not a node; final form not a node; job square without an own piece on the final-form board; job count outside 3–6; illegal SAN in `mistakes[].moves`; duplicate variation keys; text containing "engine line" or a "%" sign. Engine rule (< 15 win % loss) for own moves in `mistakes[].moves` that are not tree nodes, using `newGame`.
- [ ] Step 1: failing tests with `content/guides/__test__/sample.json` (built on the real Caro-Kann tree): a valid sample passes; each hard error above fails with a clear message (Review Focus 1: an unknown node id).
- [ ] Step 2: run `pnpm vitest run server/guides` → FAIL. Step 3: implement. Step 4: pass + full gate; `pnpm validate:content` still passes (no real guides yet).
- [ ] Step 5: commit `feat: guide schema, loader and validator`.

### Task 2: Guide API with personal boxes  *(model: sonnet)*

**Files:** Create `server/guides/variation.ts`, `server/guides/personal.ts`, `server/routes/guides.ts`, tests `server/guides/variation.test.ts`, `server/guides/personal.test.ts`, `server/routes/guides.test.ts`; Modify `server/app.ts`, `shared/types.ts`, `web/src/api.ts`

**Interfaces:**
- Consumes: Task 1 types and loader; `currentLevel`; repertoires via `getReps`; `opening_events`; `games`; `getAnalysis` / key-moment selection.
- Produces:
  - `variationOf(guide: GuideFile, nodeId: string): GuideVariation | null` (longest root prefix of the node's SAN path).
  - `GuideDTO = { repertoireId; name; color: Color; level: 1 | 2 | 3; why: string; variations: GuideVariationDTO[] }`; `GuideVariationDTO = GuideVariation` fields resolved: `finalForm: { nodeId; moves: string[] (SAN); fen; jobs; level }`, `route: { nodeId; san; why; level }[]`, `deviations: { nodeId; san; plan; showMoves?: string[]; level }[]`, `mistakes: { moves; fen; text }[]`, `locked: boolean` (any node of the final-form line above the owner level), `requiredLevel: 1 | 2 | 3`, `personal: VariationPersonal | null`.
  - `VariationPersonal = { games: number; win: number; draw: number; loss: number; leaks: { nodeId; expectedSan; playedSan; count; gameIds: number[] }[]; opponentMoves: { nodeId; playedSan; count; gameIds: number[] }[]; mistakes: { gameId; ply; san; reason: string }[] }` — null below 3 games; node-level items below 3 events are dropped; `opponentMoves` sorted by count desc; the guide's `deviations` sorted by the owner's `opponentMoves` count (desc), unmatched last.
  - Route `GET /api/openings/:id/guide` → `GuideDTO` (404 unknown repertoire or no guide).
- Rules: a game belongs to the repertoire via `opening_events.repertoire_id`; its variation via `variationOf` on its event `node_id` (for `end_of_book`, the deepest matched node — compute from the game moves against the tree if the event has no node); `not_this_opening` games count nowhere (Review Focus 3); duplicates (M7 `duplicate_of`) excluded; mistakes = key moments at the current level with ply ≤ 24 in the repertoire's games of that variation, reason in plain words (existing tag text).
- [ ] Step 1: failing tests: `variationOf` longest-prefix (and null outside); personal boxes from seeded games/events: 3+ games show, 2 hide; leak/opponent grouping and sort; `not_this_opening` / `end_of_book` handling; duplicate excluded; zero games → every `personal` null (Review Focus 2); route 404s; locked/requiredLevel per level.
- [ ] Step 2: run → FAIL. Step 3: implement. Step 4: pass + full gate.
- [ ] Step 5: commit `feat: guide api with personal boxes`.

### Task 3: Guide page  *(model: sonnet)*

**Files:** Create `web/src/pages/GuidePage.tsx`, `web/src/pages/GuidePage.test.tsx`, `web/src/components/guide/{FinalFormBoard,RouteStepper,PersonalBox}.tsx`; Modify `web/src/App.tsx` (route `/openings/:id/guide`), `web/src/pages/OpeningsPage.tsx` ("Read the guide" link per repertoire), `web/src/styles.css`

**Interfaces:**
- Consumes: `api.getGuide(id)` → `GuideDTO` (Task 2); existing board components and `LineDrill` (`{ roots, startPath, userColor, onExit }`).
- Produces: anchors `#why`, `#final-<key>`, `#route-<key>`, `#deviations-<key>`, `#middlegame-<key>`, `#mistakes-<key>`; the query `?v=<key>` selects the variation tab.
- Layout A: table of contents on the left (the six headings); variation tabs inside parts 2–6; "Final form" board with job markers on hover/click; "The route" stepper (step list with "why", "Play on the board" steps through the line, "Drill" starts `LineDrill` from the variation's root, disabled with title "Unlocks at level N" when locked); "If they do X…" items with "Show" playing `showMoves`; "Middlegame plan" paragraphs; "Typical mistakes" with a board each; personal boxes ("Your games") inside route, deviations, mistakes, and a results line ("Advance: 6 games, 2 wins, 4 losses" + link to Insights), hidden when `personal` is null.
- [ ] Step 1: failing tests (mocked api): renders the six headings and tabs; job text on hover/click; Drill disabled + badge for a locked variation while text shows (Review Focus 5); personal boxes hidden when null (Review Focus 2); `?v=` selects the tab; anchors exist.
- [ ] Step 2: run → FAIL. Step 3: implement. Step 4: pass + full gate + build; smoke screenshot with the sample guide at 1280 px.
- [ ] Step 5: commit `feat: guide page`.

### Task 4: "Plan" entry links  *(model: sonnet)*

**Files:** Create `web/src/lib/guide-links.ts`, `web/src/lib/guide-links.test.ts`; Modify `web/src/pages/ReviewPage.tsx` (opening cards), `web/src/components/RepertoireTree.tsx` (node), `web/src/pages/GameViewerPage.tsx` (games of a repertoire), `server/routes/games.ts` or the game DTO (repertoire id + event node of the game), `shared/types.ts`

**Interfaces — Produces:** `guideLink(repertoireId: string, variationKey: string | null, part: 'route' | 'deviations' | 'mistakes' | null): string`; the server exposes for each guide a `variationIndex: { key; roots }[]` (in `GuideDTO` or a light `GET /api/openings/:id/guide/index`) so the web maps a node id to a variation with the same longest-prefix rule; a game DTO gains `repertoire: { id; nodeId } | null`.
- Rules: opening card → its node's variation, part "route" if the node is an own move else "deviations"; tree node → same; game page → the game's event node's variation, part "route" for `leak`, "deviations" for `out_of_book`; no variation → `#why` (Review Focus 4). Link text "Plan".
- [ ] Step 1: failing tests: `guideLink` and node → variation mapping (incl. no variation → `#why`); the three pages render the link with the right href.
- [ ] Step 2: run → FAIL. Step 3: implement. Step 4: pass + full gate + build.
- [ ] Step 5: commit `feat: plan links into the guides`.

### Task 5: Caro-Kann guide  *(author: sonnet; content review: opus with chess.js + Stockfish)*

**Files:** Create `content/guides/caro-kann.json`; Modify `content/repertoires/caro-kann.json` only if a needed line is missing (≤ ~20 nodes, M9 rules)
- Variations (keys): `classical` (3.Nc3/3.Nd2 dxe4), `advance` (3.e5), `exchange` (3.exd5 cxd5), `panov` (4.c4), `two-knights` (2.Nc3 d5 3.Nf3), `fantasy` (3.f3); beginner tries (2.Bc4, early Qf3/Qh5) as deviations where they fit.
- [ ] Step 1: write the guide per the Global Constraints; every claim verified with chess.js and Stockfish in throwaway scripts outside the repo; report a table of every claim and its check.
- [ ] Step 2: `pnpm validate:content` passes (hard guide errors = 0).
- [ ] Step 3: commit `content: Caro-Kann guide`.

### Task 6: Slav guide  *(author: sonnet; content review: opus)*

**Files:** Create `content/guides/slav.json`; Modify `content/repertoires/slav.json` only if needed
- Variations: `main-slav` (4.Nc3 / 4.e3 set-ups), `exchange-slav`, `anti-london` (2.Bf4 c5), `vs-c4`, `vs-nf3`.
- [ ] Steps as Task 5. Commit `content: Slav guide`.

### Task 7: London guide  *(author: sonnet; content review: opus)*

**Files:** Create `content/guides/london.json`; Modify `content/repertoires/london.json` only if needed
- Variations: `vs-d5` (…d5 with …Nf6/…e6/…c5), `vs-kid` (…Nf6/…g6), `vs-early-c5`, `vs-qb6` (early …Qb6), `vs-bf5` (…Bf5 mirror); …e5 tries as deviations.
- [ ] Steps as Task 5. Commit `content: London guide`.

### Task 8: Smoke run and close  *(main session)*

- [ ] Full gate + `pnpm validate:content`. On a temp copy of the live DB (port 8788): open each guide; check the personal boxes against the owner's real games (counts match the Openings leaks list and Insights); every "Plan" link lands in the right part; level 1 vs `level_override` 3. Screenshots of each guide.
- [ ] ROADMAP: M10 done, rulings; back up `data/chess.db`; merge to `main` and push.
