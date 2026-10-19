# M8b Coach Chat Speed + Live Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the coach chat feel fast (streamed answers, a fast default chat model, engine facts ready early), add "Go deeper" with the strongest model, add a live Stockfish eval under the board, and close the M8a "wrong non-move facts" gap with attack facts.

**Architecture:** Providers gain an optional streaming call; the CLI runner gets an `onData` hook. A chat answer runs as before (job + row) but its partial `answer` text is pushed to the browser over Server-Sent Events; validation still runs on the whole answer at the end. A separate live Stockfish process serves `/api/live` for the board. The fact pack gains per-position attack facts.

**Tech Stack:** as before; Hono `streamSSE` (`hono/streaming`), browser `EventSource`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-19-coach-chat-design.md` (M8b = goals 6 and 8; §5 live engine and "checking…" UI, §7 streaming, §8 fast/deep models, §9 live engine, §11 speed target). M8a state: `docs/ROADMAP.md` (M8a log, rulings, known gaps).

## Global Constraints

- All M8a rules hold: the AI never invents moves, lines or evaluations; lines by id only; grounding set as in M8a; one retry; history last 10 turns.
- Streamed text shows with a "checking…" mark until the server validated the whole answer. On validation failure the streamed text is replaced by the retry's answer and the UI shows "The coach is correcting its answer…". Providers that cannot stream show "The coach is thinking…" until the whole answer arrives.
- Speed target (to measure, not a gate): first words in about 3–5 s, full answer in about 10–15 s with the default CLI provider and chat model. If no CLI reaches it, the chat stays slower and uses the CLIs anyway; API keys stay optional (owner: "if the only option is slow, slow it is, I can wait").
- Chat model ≠ coach-note model: new per-provider settings "Chat model" (fast, default from the spike) and "Deep model" (strongest, default from the spike); the existing per-provider model setting keeps driving coach notes. Empty uses the default.
- "Go deeper" re-asks the same question at the same anchor with the deep model and shows the new answer below the first; the first stays.
- Live engine: a dedicated Stockfish process outside the analysis pool; MultiPV 3; small budget (about 0.5–1 s per position); stopped with UCI `stop` when the position changes; browser requests debounced (250 ms) and aborted on change.
- Attack facts: the coach may claim that a piece is attacked, defended, hanging or trapped only when the fact pack says so (prompt rule); facts come from chess.js.
- Tests never hit the network or spawn real CLIs/engines; streaming adapters are tested with recorded stream fixtures in `server/ai/providers/__fixtures__/`. Only Task 1 (spike) makes real calls.
- Safety: never touch `data/chess.db` or port 8787; visual checks with `pnpm smoke:start` (port 8788).

## Review Focus

1. The browser closes the tab (or switches games) while an answer streams: the server keeps running the job, stores the answer, and frees resources; reopening shows the stored answer — test in Task 3.
2. Validation fails after text was streamed: the UI replaces the text, never shows the rejected text without a mark, and the final row holds only the validated answer — test in Task 3 and Task 6.
3. The live engine gets a new position while it is still searching: the old search is stopped, only the newest result reaches the board — test in Task 5.
4. A provider's stream ends without a final result (CLI crash, timeout): the message becomes `error` with "Try again", never stuck in `streaming` — test in Task 2 and Task 3.
5. "Go deeper" while another message is pending: rejected with 409 like any second question — test in Task 4.

---

### Task 1: Speed spike  *(model: sonnet; real CLI calls allowed)*

**Files:** Create `docs/superpowers/notes/2026-10-19-chat-speed-spike.md`, `server/ai/providers/__fixtures__/{claude-cli,codex-cli,opencode-cli}-stream.jsonl`, `scripts/spike-chat-speed.ts` (kept; documented as manual)

- [ ] Step 1: write `scripts/spike-chat-speed.ts`: builds the real chat prompt for the Bh6 fixture position (reuse `askCoach`'s prompt builder with a fixed fact pack JSON saved in the notes folder), runs each CLI with streaming flags, and prints time to first byte, time to first `answer` character, total time, and output tokens when the CLI reports them.
- [ ] Step 2: run it for: claude-cli (`--output-format stream-json --verbose --include-partial-messages` plus the M5 flags) with Haiku 5.5, Sonnet 5.5, Opus 5.5; codex-cli (`exec --json`) with its default and one smaller model; opencode-cli (`--format json`) with its configured model. Three runs each; record median.
- [ ] Step 3: check whether claude's `--json-schema` still works with `stream-json`; record the event shapes that carry text deltas for each CLI; save one real stream per CLI as a fixture (redact nothing secret; prompts contain only chess facts).
- [ ] Step 4: write the notes: a table of the numbers, the chosen default chat model and deep model per provider, which CLIs can stream text deltas, and the exact parse rules. Commit `docs: chat speed spike`.

**Produces:** the notes file (Tasks 2 and 4 read it for flags, event shapes and defaults) and the fixtures.

### Task 2: Streaming providers  *(model: sonnet)*

**Files:** Modify `server/ai/types.ts`, `server/ai/cli-runner.ts`, `server/ai/providers/*.ts`; Create `server/ai/partial-answer.ts`, `server/ai/partial-answer.test.ts`; Test `server/ai/providers/*.test.ts`

**Interfaces — Produces:**
- `AiProvider.stream?(req: AiRequest, opts: { model: string | null; signal?: AbortSignal; onText: (fullTextSoFar: string) => void }): Promise<{ text: string; model: string }>` — same final result as `complete`; providers without streaming leave it undefined.
- `CliRunner` gains optional `onData?: (chunk: string) => void` (stdout chunks as they arrive); `realCliRunner` wires it.
- `partialAnswer(rawSoFar: string): string | null` — the decoded value of the top-level `"answer"` JSON string field as far as it has arrived (handles escapes, `\n`, a cut in the middle of an escape), or null before the field starts.
- Streaming per provider exactly as the spike notes say (claude-cli stream-json; anthropic-api SDK `messages.stream`; openrouter `stream: true` SSE; codex / opencode only if the spike found text deltas).
- [ ] Step 1: failing tests: `partialAnswer` on cut JSON (mid-word, mid-escape, before the field, after the field ends); each streaming adapter replays its recorded fixture through a fake runner/fetch and calls `onText` with growing text, then returns the same final text `complete` would; a stream that ends without a final result rejects with `AiProviderError` (Review Focus 4).
- [ ] Step 2: run → FAIL. Step 3: implement. Step 4: pass + full gate.
- [ ] Step 5: commit `feat: streaming ai providers`.

### Task 3: Streamed chat answers over SSE  *(model: sonnet)*

**Files:** Modify `server/ai/runner.ts` (optional `onText` + `onRetry` passthrough), `server/ai/chat.ts`, `server/routes/chat.ts`, `server/chat/chat-repo.ts`; Create `server/chat/stream-hub.ts`, tests `server/chat/stream-hub.test.ts`, `server/routes/chat-stream.test.ts`

**Interfaces:**
- Consumes: `AiProvider.stream`, `partialAnswer` (Task 2).
- Produces:
  - `runStructured` opts gain `onText?: (partialAnswerText: string) => void` and `onRetry?: () => void`; it uses `provider.stream` when present and `onText` is set, else `complete`.
  - `StreamHub` (in-memory, per message id): `publish(id, event)`, `subscribe(id, listener) => unsubscribe`, `last(id)`; events `{ type: 'delta', text }`, `{ type: 'retry' }`, `{ type: 'done' }`, `{ type: 'error', message }`.
  - Route `GET /api/chat/:messageId/stream` (SSE): sends the current partial text first (late subscribers), then events until `done`/`error`; closes on client disconnect without stopping the job (Review Focus 1).
  - Message status: `streaming` while text arrives, then `done` or `error`; `markInterruptedChats` also turns `streaming` into `error`.
- [ ] Step 1: failing tests: hub fan-out + late subscriber gets the partial text; a fake streaming provider produces deltas, then a grounding failure → `retry` event → second stream → `done`, and the stored row holds only the validated second answer (Review Focus 2); client disconnect mid-stream → job still stores the answer (Review Focus 1); stream ends without result → row `error` (Review Focus 4); non-streaming provider → no deltas, `done` only.
- [ ] Step 2: run → FAIL. Step 3: implement. Step 4: pass + full gate.
- [ ] Step 5: commit `feat: stream chat answers over sse`.

### Task 4: Chat and deep models, "Go deeper"  *(model: sonnet)*

**Files:** Create `server/db/migrations/015_chat_deep.sql`; Modify `server/config.ts`, `server/routes/settings.ts`, `shared/types.ts`, `server/routes/chat.ts`, `server/chat/chat-repo.ts`, `web/src/components/SettingsSections.tsx` or `web/src/pages/SettingsPage.tsx` (AI section); Tests: `server/routes/chat.test.ts`, `server/routes/settings.test.ts`, `web/src/pages/SettingsPage.test.tsx`

**Interfaces — Produces:**
- Settings: `aiChatModels: Record<ProviderId, string | null>`, `aiDeepModels: Record<ProviderId, string | null>` in `SettingsDTO` / `SettingsUpdate` (keys `ai_chat_model_<id>`, `ai_deep_model_<id>`); defaults `CHAT_MODEL_DEFAULTS` / `DEEP_MODEL_DEFAULTS` per provider from the spike notes (null = provider default).
- `chat_messages` gains `deep INTEGER NOT NULL DEFAULT 0` and `parent_id INTEGER REFERENCES chat_messages(id) ON DELETE CASCADE`; `ChatMessageDTO` gains `deep: boolean; parentId: number | null`.
- `POST /api/chat/:messageId/deeper` → `{ messageId, jobId }`: new row with the same question and anchor, `deep = 1`, `parent_id`, the next turn number, the deep model; 409 if a message of that game is pending (Review Focus 5); 404 if the parent has no done answer.
- Normal questions use the chat model; coach notes keep using the existing model setting.
- Settings UI: under each provider's model field, two fields "Chat model" and "Deep model", placeholder "default (<default name>)".
- [ ] Step 1: failing tests: settings round trip; a normal question uses the chat model; deeper uses the deep model and links `parent_id`; 409 / 404 cases; Settings page sends only changed fields (M7 rule).
- [ ] Step 2: run → FAIL. Step 3: implement. Step 4: pass + full gate + build.
- [ ] Step 5: commit `feat: chat and deep models, go deeper`.

### Task 5: Live engine  *(model: sonnet)*

**Files:** Create `server/engine/live.ts`, `server/engine/live.test.ts`, `server/routes/live.ts`, `server/routes/live.test.ts`, `web/src/components/LiveEval.tsx`, `web/src/components/LiveEval.test.tsx`; Modify `server/engine/uci.ts` (stop support), `server/app.ts`, `server/main.ts` (start/close), `web/src/pages/GameViewerPage.tsx`, `web/src/api.ts`

**Interfaces — Produces:**
- `UciEngine.stop(): Promise<void>` (sends `stop`, waits for `bestmove`).
- `class LiveEngine { analyse(fen: string, opts: { multipv: 3; movetimeMs: number; signal: AbortSignal }): Promise<EngineLine[]> }` — one dedicated process, lazily started; a new call stops the running search first (Review Focus 3); `LIVE_MOVETIME_MS = 700`.
- `GET /api/live?fen=` → `{ fen, sideToMove: Color, lines: { san: string[]; uci: string[]; evalCp: number | null; evalMate: number | null }[] }` (scores from the side to move's view; SAN via chess.js, max 8 plies); the web converts to the owner's view; request abort → `stop`.
- A small LRU cache (FEN → lines, 200 entries) shared with `buildFactPack`: the fact pack reuses a cached MultiPV 3 for the anchor when it exists (§9).
- `LiveEval` props `{ fen: string; userColor: Color | null; onArrow(arrow | null): void }`: shows "Stockfish: +0.8 · your chances 62 %" and the top 3 lines in SAN; debounced 250 ms; aborts on change; the best move is drawn as an arrow on the board.
- [ ] Step 1: failing tests: fake engine — second `analyse` before the first ends stops the first and only the second resolves; route abort calls stop; cache hit avoids an engine call in `buildFactPack`; `LiveEval` debounces and ignores stale responses.
- [ ] Step 2: run → FAIL. Step 3: implement. Step 4: pass + full gate + build.
- [ ] Step 5: commit `feat: live engine eval`.

### Task 6: Attack facts and streaming chat UI  *(model: sonnet)*

**Files:** Modify `server/chat/fact-pack.ts`, `server/ai/prompts/chat.ts`, `web/src/components/CoachChat.tsx`, `web/src/api.ts`, `web/src/styles.css`; Tests: `server/chat/fact-pack.test.ts`, `web/src/components/CoachChat.test.tsx`

**Interfaces — Produces:**
- `FactPack.attacks: { square: string; piece: string; color: Color; attackedBy: string[]; defendedBy: string[]; hanging: boolean }[]` for the anchor position and `FactPack.playedAttacks` for the position after the played move (same shape), from chess.js (`attackers`/board scan); `hanging` = attacked and (undefended or attacked by a lower-value piece).
- Prompt rule (bump `CHAT_PROMPT_VERSION`): "Say that a piece attacks, defends, or wins another piece only when the attacks facts or a line show it."
- Pre-warm: when the Coach chat tab opens or the owner starts typing, the web calls `POST /api/games/:id/chat/prefetch { anchor }` (fire and forget) which fills the engine cache for the anchor (add the route in this task).
- `CoachChat`: subscribes to `/api/chat/:id/stream` while a message is pending; shows streamed text with a "checking…" mark; on `retry` shows "The coach is correcting its answer…" and clears the text; on `done` refetches and shows lines, rule, lesson, "Add to review" and a "Go deeper" button (Task 4 route); a deep answer renders below its parent with a "Deeper answer" label; a non-streaming provider shows "The coach is thinking…".
- [ ] Step 1: failing tests: Bh6 position — `playedAttacks` (after 10.Bh6 in the fixture game) shows the bishop on h6 attacked by the g7 pawn, and the rook on f8 NOT attacked by the bishop because g7 blocks the diagonal (the M8a smoke error); hanging flag cases; CoachChat with a mocked EventSource: deltas render with "checking…", retry clears, done shows lines and "Go deeper"; deeper answer placement.
- [ ] Step 2: run → FAIL. Step 3: implement. Step 4: pass + full gate + build; smoke screenshot of a streaming answer mid-way (seeded slow fake provider is not possible in smoke — screenshot the done state with a deep answer).
- [ ] Step 5: commit `feat: attack facts and streaming chat ui`.

### Task 7: Smoke run and close  *(main session)*

- [ ] Full gate + `pnpm validate:content`. On a temp copy of the live DB (port 8788): ask the Bh6 question with the default chat model; record time to first words and total; check the "attacked the rook on f8" error does not recur on the whole-game question; "Go deeper" with the deep model; live eval updates while stepping through a line.
- [ ] ROADMAP: M8b done, numbers, rulings; back up `data/chess.db`; merge to `main` and push.
