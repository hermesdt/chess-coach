# M8a Coach Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A coach chat on the game page: the owner asks about a position, a move, a plan or the whole game; the AI answers from an engine-built fact pack, attaches engine lines by id, and the owner plays those lines (and their own moves) on the board as side branches.

**Architecture:** Server: a fact-pack builder (Stockfish MultiPV + refutation + threats + owner-named moves + material/captures + repertoire), a chat AI call on top of M5's `runStructured` with multi-turn history, a `chat_messages` table and routes that run each answer as a job (polled, no streaming in M8a). Web: a variation tree for the game board, an interactive board, and a "Moves | Coach chat" tab pair in the right column.

**Tech Stack:** as before (Hono, node:sqlite, chess.js, Stockfish pool, React 19, react-chessboard, zod, vitest). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-19-coach-chat-design.md` (M8a = goals 1–5, 7, 9; §5, §6, §7 validation part, §8 except fast/deep models, §10, §11). Parent spec `docs/superpowers/specs/2026-10-18-chess-coach-design.md` §11, §18.

## Global Constraints

- The AI never invents moves, lines, or evaluations. Moves come from Stockfish, chess.js, the game, or validated `content/` files.
- The AI attaches lines **by id** from the fact pack (`L1`, `L2`, `L3`, `REF`, `Q1…`, `REP1…`, prefixed per turn, e.g. `t3.L1`); it never writes a move sequence. Unknown ids fail validation.
- Grounding set = this turn's fact pack (full lines) + the game's moves + the fact packs of earlier turns in the thread. Any other move → one retry → plain error in the chat with "Try again".
- Lines are stored to their full engine length (up to 16 plies); line buttons show up to 8 plies with "show more".
- Answer schema: `{ answer: string, lines: { id: string, why: string }[] (0–3), rule: string, lessonId: LessonId | null }`. The first sentence of `answer` answers the exact question.
- History: the last 10 turns of the thread go to the AI. API providers get real message lists; CLI providers get the history flattened into the prompt.
- Tone: direct and honest, plain words, short sentences, no flattery; say clearly when an idea is bad and why, without insults. Level notes (§18) apply.
- "Add to review": the card's accepted answers are the engine moves within 5 win % of the best; kind `mistake`; `refs.source = 'chat'` when the anchor is not a game position where the owner erred; one card per position.
- Owner-made branches are saved only as the anchor of a sent message. A message left `pending` by a restart becomes `error` on startup.
- Chats belong to the canonical game (`duplicate_of`); a duplicate's page shows the canonical game's chat.
- M8a has no streaming: the UI shows "The coach is thinking…" and the page stays usable.
- Tests never hit the network or spawn real CLIs/engines (fake pool, fake provider). Safety: never touch `data/chess.db` or port 8787; visual checks with `pnpm smoke:start` (port 8788).

## Review Focus

1. Question at a final position (checkmate / stalemate / no engine lines): the fact pack has no lines and the chat still answers — test in Task 2.
2. Owner names an illegal or ambiguous move ("Nd2" when two knights can, "Qh5" illegal): reported as illegal/ambiguous in the facts, no crash — test in Task 2.
3. No AI provider available (`aiProvider = none` or none ready): the chat shows a clear message and a link to Settings, never a stuck "thinking" — test in Task 4 (route) and Task 5 (UI).
4. A second question while one is pending: the input is disabled and the server rejects a second pending message per game with 409 — test in Task 4.
5. Game not analysed yet: the chat tab says "Analyse this game first" with the existing Analyse button; the route returns 409 — test in Task 4 and Task 5.

---

### Task 1: Variation tree and interactive game board  *(model: sonnet)*

**Files:** Create `web/src/lib/variations.ts`, `web/src/lib/variations.test.ts`, `web/src/components/GameTabs.tsx`; Modify `web/src/pages/GameViewerPage.tsx`, `web/src/components/MoveList.tsx`, `web/src/styles.css`

**Interfaces — Produces:**
- `type NodeId = string`; `interface VarNode { id: NodeId; parent: NodeId | null; san: string; uci: string; fenAfter: string; children: NodeId[]; mainline: boolean; label?: string }`
- `createTree(startFen: string, moves: MoveInfo[]): VarTree` (main line nodes, ids `m<ply>`); `addMove(tree, from: NodeId | 'root', uci: string): { tree: VarTree; node: NodeId } | null` (chess.js legality; returns the existing child if the move already exists, so the next main-line move just advances); `addLine(tree, from, ucis: string[], label: string): { tree; last: NodeId }`; `pathFromMain(tree, id): { ply: number; path: string[] }` (main-line ply where the branch starts + UCI moves after it); `fenOf(tree, id)`, `next(tree, id)`, `prev(tree, id)`, `branchPoint(tree, id)`.
- `GameViewerPage` state: `current: NodeId` instead of `ply`; the board allows dragging (react-chessboard `allowDragging: true`) and calls `addMove`. "Back to game" returns to `branchPoint`. Arrow keys/buttons use `next`/`prev` along the current line.
- `GameTabs` props `{ moves: ReactNode; chat: ReactNode }` with tabs "Moves" and "Coach chat" (Coach chat is a placeholder until Task 5).

- [ ] Step 1: failing tests in `variations.test.ts`: main line from 3 moves; `addMove` of the next main-line move returns that main node; `addMove` of another move creates a branch child with `mainline: false`; illegal UCI returns null; `addLine` with label; `pathFromMain` of a node two moves deep in a branch from ply 18 → `{ ply: 18, path: [uci1, uci2] }`; `next`/`prev` follow the current line.
- [ ] Step 2: run `pnpm vitest run web/src/lib/variations.test.ts` → FAIL (module missing).
- [ ] Step 3: implement `variations.ts`; switch `GameViewerPage` to the tree (eval graph and key moments still select main-line nodes); `MoveList` renders branches indented under their start move with their label; add `GameTabs`.
- [ ] Step 4: tests pass; existing GameViewer/MoveList behaviour unchanged for the main line; full gate + `pnpm build`.
- [ ] Step 5: commit `feat: variation tree and interactive game board`.

### Task 2: Position fact pack  *(model: sonnet)*

**Files:** Create `server/chat/fact-pack.ts`, `server/chat/named-moves.ts`, `server/chat/fact-pack.test.ts`, `server/chat/named-moves.test.ts`

**Interfaces:**
- Consumes: `EnginePool['analyse'](fen, { nodes, multipv })` (`server/engine/pool.ts`), `gameFacts` (`server/ai/facts.ts`), `getAnalysis`, `winPct` / `flip` (`server/analysis/winpct.ts`), `loadAllRepertoires` (`server/repertoire/load.ts`), `currentLevel` (`server/level.ts`).
- Produces:
  - `interface FactLine { id: string; kind: 'best' | 'refutation' | 'named' | 'repertoire'; startFen: string; san: string[]; uci: string[]; evalCp: number | null; evalMate: number | null; winPctForUser: number; materialEnd: { white: number; black: number }; captures: { ply: number; piece: string; square: string; by: 'white' | 'black' }[]; checks: number; comment?: string }`
  - `interface FactPack { turnPrefix: string; anchor: { fen: string; sideToMove: Color; ply: number; path: string[]; inBranch: boolean; isUserToMove: boolean; describe: string }; played: { san: string; winBefore: number; winAfter: number; classification: Classification; tags: Tag[] } | null; lines: FactLine[]; threat: { san: string; uci: string } | null; named: { text: string; status: 'legal' | 'illegal' | 'ambiguous'; lineId?: string }[]; game: GameFacts; isFinal: 'checkmate' | 'stalemate' | null }`
  - `buildFactPack(deps: { db: DatabaseSync; pool: Pick<EnginePool, 'analyse'>; reps: Repertoire[]; nodes: number }, input: { gameId: number; anchor: { ply: number; path: string[] }; question: string; turn: number }): Promise<FactPack>`
  - `parseNamedMoves(text: string, fen: string): { text: string; status: 'legal' | 'illegal' | 'ambiguous'; uci?: string }[]` — SAN-like tokens (`Nf3`, `exd5`, `O-O`, `Qh5+`) and "knight to f3"-style phrases reuse the patterns in `server/ai/grounding.ts`.
  - `factPackSan(pack: FactPack): string[]` (every SAN in lines, threat, played).
- Rules: MultiPV 3 from the anchor (`L1..L3`), `REF` = best play after the played move (main line only, when a next move exists), threat = opponent's best move via null move (skip when in check), each legal named move analysed from the position after it (`Q1…`), repertoire nodes that match the anchor FEN (`REP1…`, with their validated comment). Lines cut to 16 plies. All ids prefixed `t<turn>.`. `describe` = "the position after 9...exf5 (your move 10)" or "a side line: 10. Nge2 Nf5 (after 9...exf5)".

- [ ] Step 1: failing tests (fake pool returning scripted lines; a fixture game): MultiPV gives 3 lines with ids `t1.L1..t1.L3`; main-line anchor with a next move gives `played` and `t1.REF`; branch anchor gives `played: null`, `inBranch: true`; captures and `materialEnd` for a line with `Bxh6 gxh6` (bishop for pawn counted); checkmate FEN → `isFinal: 'checkmate'`, `lines: []` (Review Focus 1); named moves: "what about Qh5?" illegal → `illegal`, "Nd2" with two knights able → `ambiguous`, "Nge2" legal → `legal` with a `Q1` line (Review Focus 2); a London position matching the repertoire gives a `REP1` line with its comment; owner moved both sides in a branch → `isUserToMove: false`.
- [ ] Step 2: run the two test files → FAIL.
- [ ] Step 3: implement.
- [ ] Step 4: tests pass; full gate.
- [ ] Step 5: commit `feat: chat fact pack`.

### Task 3: Chat AI call with history  *(model: sonnet)*

**Files:** Create `server/ai/chat.ts`, `server/ai/prompts/chat.ts`, `server/ai/chat.test.ts`; Modify `server/ai/types.ts`, `server/ai/runner.ts`, `server/ai/providers/*.ts` (history), `server/ai/grounding.ts` only if needed

**Interfaces:**
- Consumes: `FactPack`, `factPackSan` (Task 2); `runStructured`, `groundingSet`, `toStrictJsonSchema`; `LESSON_IDS` (`shared/lessons.ts`).
- Produces:
  - `AiRequest` gains `history?: { role: 'user' | 'assistant'; text: string }[]`. API adapters (anthropic-api, openrouter) send it as messages before `user`; CLI adapters prepend it as a "Conversation so far" block in the prompt.
  - `chatAnswerSchema` (zod) per Global Constraints; `type ChatAnswer`.
  - `askCoach(provider: AiProvider, input: { pack: FactPack; question: string; history: { question: string; anchorDescribe: string; answer: ChatAnswer }[]; earlierPacks: FactPack[]; level: 1 | 2 | 3; rating: number | null; model: string | null; signal?: AbortSignal }): Promise<{ answer: ChatAnswer; model: string }>`
  - `CHAT_PROMPT_VERSION` constant in `prompts/chat.ts`.
- Rules: `allowedSan = groundingSet([...factPackSan(pack), ...game moves, ...earlierPacks.flatMap(factPackSan)], factsText)`; text fields checked = `answer`, `rule`, every `lines[].why`; `lines[].id` must exist in `pack.lines` (validation error otherwise → the runner's retry); history capped to the last 10 turns; the prompt states the tone rule and "answer the exact question in the first sentence".

- [ ] Step 1: failing tests (fake provider): valid answer passes; an answer naming a move outside the grounding set fails once, retry succeeds; a move from an earlier turn's pack is accepted; unknown line id `t2.L9` triggers a retry; history of 12 turns sends only 10; anthropic-api adapter request contains the history as messages; claude-cli prompt contains the flattened history.
- [ ] Step 2: run `pnpm vitest run server/ai/chat.test.ts` → FAIL.
- [ ] Step 3: implement.
- [ ] Step 4: tests pass; existing M5 tests unchanged; full gate.
- [ ] Step 5: commit `feat: coach chat ai call with history`.

### Task 4: Chat storage, routes and review card  *(model: sonnet)*

**Files:** Create `server/db/migrations/014_chat.sql`, `server/chat/chat-repo.ts`, `server/routes/chat.ts`, `server/chat/chat-card.ts`, tests `server/chat/chat-repo.test.ts`, `server/routes/chat.test.ts`, `server/chat/chat-card.test.ts`; Modify `server/app.ts`, `server/main.ts` (startup recovery), `shared/types.ts`

**Interfaces:**
- Consumes: `buildFactPack` (Task 2), `askCoach` (Task 3), `runJob` (`server/jobs.ts`), registry `pick`, `upsertCard` / `positionKey` (`server/srs/cards-repo.ts`), `getAnalysis`.
- Produces:
  - Table `chat_messages(id, game_id, turn, question, anchor_json, fact_pack_json, answer_json, status 'pending'|'done'|'error', error, provider, model, created_at)`; one row per question (answer stored on the same row).
  - `shared/types.ts`: `ChatLineDTO { id; label: string; san: string[]; uci: string[]; startFen: string; winPctForUser: number; why: string }`, `ChatMessageDTO { id; turn; question; anchor: { ply: number; path: string[]; describe: string }; status; error: string | null; answer: { text: string; lines: ChatLineDTO[]; rule: string; lessonId: LessonId | null } | null; provider: ProviderId | null; model: string | null; createdAt: number }`.
  - Routes: `GET /api/games/:id/chat` → `ChatMessageDTO[]`; `POST /api/games/:id/chat { question, anchor: { ply, path }, provider? }` → `{ messageId, jobId }`; `POST /api/chat/:messageId/retry` → `{ jobId }`; `POST /api/chat/:messageId/review-card { lineId? }` → `{ cardId }`.
  - `markInterruptedChats(db)` at startup: `pending` → `error` ("The server restarted. Try again.").
  - `chatCard(pack: FactPack, game): Omit<Card, 'id'|'createdAt'|'suspended'>`: solution = first moves of best lines within 5 win % of `L1`; refs `{ gameId, ply, source?: 'chat' }`.
- Rules: `:id` resolves to the canonical game (`duplicate_of`); 409 "Analyse this game first." when the analysis is not done (Review Focus 5); 409 when the game already has a pending message (Review Focus 4); provider `none` / none available → the message is stored as `error` with "No AI coach is set up. Open Settings." (Review Focus 3); the job builds the fact pack, loads the last 10 done turns as history and their packs for grounding, calls `askCoach`, stores the answer with resolved lines, or stores the error text (reuse `coachErrorMessage`).

- [ ] Step 1: failing tests: migration + repo round trip; POST runs the job with fake pool/provider and GET returns a done message with resolved `ChatLineDTO`s; 409 cases; no-provider error message; retry re-runs an `error` message; duplicate game id uses the canonical game's thread; `markInterruptedChats`; `chatCard` accepts L1 and L2 when within 5 win %, not L3 when 12 % worse; `refs.source = 'chat'` for a branch anchor.
- [ ] Step 2: run the three test files → FAIL.
- [ ] Step 3: implement.
- [ ] Step 4: tests pass; full gate.
- [ ] Step 5: commit `feat: coach chat storage, routes and review card`.

### Task 5: Coach chat UI  *(model: sonnet)*

**Files:** Create `web/src/components/CoachChat.tsx`, `web/src/components/CoachChat.test.tsx`; Modify `web/src/pages/GameViewerPage.tsx`, `web/src/api.ts`, `web/src/styles.css`

**Interfaces:**
- Consumes: `GameTabs`, `VarTree` helpers (Task 1); chat routes and DTOs (Task 4); `useJob`; `lessonLink` (`web/src/lib/lesson-links.ts`).
- Produces: `CoachChat` props `{ gameId: number; analysed: boolean; anchor: { ply: number; path: string[]; describe: string }; onShowLine(line: ChatLineDTO, anchor): void; onShowAnchor(anchor): void; onAnalyse(): void }`.
- Behaviour: context line "About {describe}"; message list (owner question, coach answer text, rule, lesson link, line buttons "Line 1: 10. Nge2 Nf5 11. O-O …" with "show more" past 8 plies and the Stockfish win % for the owner, "Add to review" → "Added to review"); "The coach is thinking…" while the job runs; error text with "Try again"; input "Ask about this position…", Enter sends, disabled while a message is pending; not analysed → "Analyse this game first" + Analyse button; clicking an older message calls `onShowAnchor`. In `GameViewerPage`, `onShowLine` calls `addLine` from the anchor node with the line's label and selects its first move; the anchor `describe` comes from the current node.
- [ ] Step 1: failing tests (mocked api): renders history; sending posts question + anchor and shows "thinking"; a line button calls `onShowLine`; "Add to review" posts and shows "Added to review"; error + "Try again"; not analysed state; input disabled while pending; no-provider message shows a Settings link.
- [ ] Step 2: run → FAIL.
- [ ] Step 3: implement.
- [ ] Step 4: tests pass; full gate + `pnpm build`; smoke screenshot of a game page with a seeded chat (fake data in the smoke DB) at 1280 px.
- [ ] Step 5: commit `feat: coach chat ui`.

### Task 6: Smoke run and close  *(main session)*

- [ ] Full gate + `pnpm validate:content`. On a temp copy of the live DB (port 8788): open the Bh6 game, ask "I played Bh6 to open the pawns near the king. Was that a good idea?" with the default provider; check the first sentence answers the question, every line button plays legal moves, "Add to review" creates a card, a follow-up question uses history. Note answer times for M8b.
- [ ] ROADMAP: M8a done, M8b next (plan to write), rulings; merge to `main` and push (back up `data/chess.db` first).
