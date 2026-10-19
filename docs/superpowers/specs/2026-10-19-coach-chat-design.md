# Coach Chat — Design (M8)

Date: 2026-10-19
Status: approved by the owner (2026-10-19)
Parent spec: `docs/superpowers/specs/2026-10-18-chess-coach-design.md` (all its
rules still hold, in particular §11 AI coaching and §18 levels).

Marks: **(owner)** = the owner said or approved it. **(my call)** = decided by
the designer; the owner can change it.

## 1. Intent

The owner looks at a lost game and wants to talk about it with a coach. The
trigger example (owner): in a London game, after 9...exf5 they played
10.Bh6?? "to open the pawns near the king". The engine says "?? lost 73 %",
but the owner wants to know: was the *idea* stupid or good, why does it fail
here, and what is better. The app today gives a one-shot coach note per game;
it cannot answer the owner's own reasons.

Why it matters: the owner learns most from their own ideas being judged, not
from engine numbers. A coach that answers "why" and shows better lines on the
board turns each game into a lesson.

Success (owner's words, restated): a clear answer to the exact question, no
wrong facts, enough depth, and something concrete the owner can learn and do.

## 2. Goals

Delivery in two steps, each merged into `main` when done **(owner)**:

- **M8a — the chat:** goals 1–5, 7 and 9. Answers arrive whole (no
  streaming), with the provider's normal model.
- **M8b — speed and live engine:** goals 6 and 8 (live Stockfish eval,
  streaming, fast default model, "Go deeper").

1. A chat on the game page. The owner asks about a move, a plan, the opening,
   or the whole game **(owner)**.
2. Each message is tied to the board position shown when it is sent (game
   ply, or a position inside a side branch). The chat shows "About the
   position after 9...exf5 (your move 10)" **(owner approved)**.
3. The coach judges the owner's idea: what is good in it, why it fails or
   works here **(owner)**. The first sentence answers the exact question
   **(owner approved)**.
4. The coach can offer alternative lines. Each line is a button; a click
   plays it on the board as a side branch, and the owner steps through it with
   the arrow buttons **(owner)**.
5. From any position (main line or branch) the owner can move pieces on the
   board and ask "and what about this?" **(owner)**.
6. While the owner explores, Stockfish shows a live eval and its best move for
   the current position, without the AI **(owner)**.
7. Each answer ends with one short rule or habit, with a course lesson link
   when one fits, and an "Add to review" button for the position
   **(owner approved)**.
8. Answers feel fast: streamed text, a fast model by default, engine facts
   ready before the question is sent. A "Go deeper" button asks again with the
   strongest model **(owner approved)**.
9. The chat history is saved per game and shown again when the game is
   reopened **(owner approved)**.

## 3. Non-goals

- A chat outside the game page (a general "ask the coach" page). Later.
- Questions across many games ("why do I lose with the London?"). The existing
  weakness report covers that.
- Voice input or output.
- AI moves that do not come from the engine (see §6 rule).
- Paid API usage by default: the default path uses the owner's CLI
  subscriptions; API keys stay optional **(owner approved)**.

## 4. Anti-goals (a failure even if it "works")

From the owner: the chat is useless if

- the answer does not clearly answer the question;
- the answer states a wrong fact (a wrong move, a wrong eval, a move that is
  not legal);
- the answer is shallow, or gives nothing the owner can learn or do.

Also (my call): a frozen page while the AI thinks; an answer that silently
changes after it was shown without a visible "checking" state.

## 5. Screen (decided)

Layout A **(owner chose)**: the board stays on the left; the right column has
two tabs, **Moves** and **Coach chat**. The existing coach note, key moments,
eval graph and stats stay where they are.

- **Board.** The game board becomes interactive. Dragging a piece from any
  position creates a side branch from there (if the move equals the next main
  line move, the board just advances). Arrow keys and buttons move through the
  current line (main line or branch). A "Back to game" control returns to the
  main line at the branch point.
- **Live engine (owner).** Under the board: eval (win % and pawns), the best
  move as an arrow, and the top 3 engine lines in SAN, for the position shown.
  It updates on every position change.
- **Moves tab.** The main line plus side branches shown indented under the
  move they start from (as in the mockup). Branches from chat lines carry the
  line's label.
- **Coach chat tab.**
  - A context line: "About the position after 9...exf5 (your move 10)" or
    "About a side line: 10. Nge2 Nf5 (after 9...exf5)".
  - The message list: owner messages and coach answers. Each coach answer may
    have line buttons ("Line 1: 10. Nge2 Nf5 11. O-O …", eval from
    Stockfish), a rule, a lesson link, "Add to review" and "Go deeper".
  - The input box: "Ask about this position…". Enter sends.
  - While the coach answers: the text appears as it streams, marked
    "checking…" until the server has validated it (see §7).
- Clicking an older message moves the board to that message's position.

## 6. Facts and the no-invented-moves rule (decided)

Project rule: the AI never invents moves, lines, or evaluations. Moves come
from Stockfish, chess.js, the game, or validated `content/` files.

For each question the server builds a **position fact pack** and sends only
facts to the AI:

- Game summary facts as today (`gameFacts`: players, ratings, result,
  opening, SAN moves, key moments) — so whole-game questions work.
- The anchor: FEN, side to move, ply, and the move path from the main line if
  it is a branch.
- The move the owner played from this position in the game (if the anchor is
  on the main line and a next move exists): its eval before/after, its
  classification and tags, and the engine's **refutation line** (best play
  after it).
- **Engine MultiPV 3** from the anchor: three lines (SAN, max 8 plies each)
  with evals.
- **Threats:** the opponent's best move if it were their turn (null-move
  analysis, skipped when the side to move is in check).
- **Moves the owner names in the question** ("what about Qh5?"): the server
  parses SAN-like tokens from the owner's text; each legal one is analysed
  (eval + engine line after it) and added to the facts. An illegal one is
  reported as illegal in the facts.
- **Repertoire match:** if the anchor position is in one of the owner's
  repertoires, the repertoire move(s) and their validated comments.
- **Material and tactics facts** for every line in the pack: the material
  balance at the end of the line and after each capture, the captures along
  the line (piece and square), checks, and the existing move tags where they
  apply. So "this loses the bishop" or "Black wins a pawn" is a fact the AI
  reads, not a guess **(my call, from the builder check)**.
- Level and rating (§18): tone and depth follow the level.

Each line in the fact pack has an id (`L1`, `L2`, `L3`, `REF` for the
refutation, `Q1…` for owner-named moves, `REP1…` for repertoire moves). Ids
are unique per turn (for example `t3.L1`), so an id from an older turn cannot
be reused by mistake **(my call)**.

Lines are analysed and stored to their full engine length (up to 16 plies);
the line buttons show up to 8 plies by default with "show more" **(my call)**.

The AI answer may only:

- name moves that are in the grounding set: this turn's fact pack (full
  lines), the game's moves, and the fact packs of earlier turns in the same
  thread. Any other move fails grounding and triggers the one retry; a second
  failure shows a plain error in the chat with a "Try again" button
  **(my call, from the builder check)**. The existing grounding code is
  extended, not replaced;
- attach lines **by id** from the fact pack. It cannot write a move sequence
  itself. The server turns the ids into the SAN lines shown as buttons.

So every move shown in a line button comes from Stockfish, the game, or the
repertoire content; every eval comes from Stockfish **(my call — this is how
"the AI proposes options" works without inventing moves)**.

## 7. Answer format, validation and streaming (decided, with builder parts)

Answer schema (zod, strict JSON as in M5), roughly:

```
{ answer: string,            // first sentence answers the exact question
  lines: { id: string, why: string }[],   // 0–3 line ids from the fact pack
  rule: string,               // one short rule or habit
  lessonId: LessonId | null }
```

- Validation as in M5 (`runStructured`): JSON parse, schema, grounding of all
  text fields against the fact pack, unknown line ids rejected. One retry with
  the error appended; then a plain error message in the chat.
- Streaming: the server streams the `answer` text to the browser as it arrives
  (Server-Sent Events from the Hono server; the existing job polling is too
  coarse for this). The streamed text is shown with a "checking…" mark. When
  validation passes, the mark goes away and the lines, rule, lesson and
  buttons appear. If validation fails, the streamed text is replaced by the
  retry's answer (the UI shows "The coach is correcting its answer…").
- Providers that cannot stream deliver the whole answer at once; the UI shows
  "The coach is thinking…" until then. Today none of the five adapters stream
  and the CLI runner buffers until exit; the builder adds streaming where the
  provider supports it (likely claude CLI `--output-format stream-json`,
  Anthropic API, OpenRouter; codex and opencode to be checked) **(builder
  verifies per provider)**.
- Extracting a partial `answer` string from streamed JSON is the builder's
  choice (incremental JSON parse, or a prose-first output format), as long as
  the final answer is validated as a whole.

## 8. Conversation and providers (decided)

- One thread per game. Each turn sends: system prompt, the current fact pack,
  and the previous turns of the thread (owner text + validated coach answers,
  with each turn's anchor in words). History is capped to the last 10 turns
  **(my call)**.
- `AiRequest` gains a history / messages field. API providers send real
  message lists; CLI providers get the history flattened into the prompt
  **(my call)**.
- **Default chat model = a fast model** per provider (for claude: Sonnet or
  Haiku, low effort). **"Go deeper"** re-asks the same question with the
  strongest model (for claude: Opus) and shows the new answer under the old
  one. A separate "chat model" setting per provider sits next to the existing
  model setting **(owner approved the idea; the exact defaults are the
  builder's, from a measured spike, see §11)**.
- Provider choice follows the existing `auto` order and the coach panel's
  provider selector.
- Tone: direct and honest, plain words, short sentences, no flattery; the
  owner wants to know "how stupid or based" an idea is — say clearly when an
  idea is bad and why, without insults **(owner's words; tone wording my
  call)**. Level notes from §18 apply.

## 9. Live engine (decided)

- A dedicated Stockfish process for the live eval, separate from the analysis
  pool, so background game analysis does not block it and it does not slow the
  pool much **(my call)**.
- Budget: MultiPV 3, a small node budget (builder picks, about 0.5–1 s per
  position), stopped (UCI `stop`) when the position changes. Requests are
  debounced in the browser.
- The fact pack for the chat reuses the live analysis of the anchor when it is
  fresh and deep enough; otherwise the server runs the pool analysis at the
  normal `engineNodes` budget. Fact pack analysis starts when the owner opens
  the chat tab or types, so it is often ready when the question is sent.

## 10. Data and "Add to review" (decided)

- New tables (names are the builder's): chat threads (one per game) and chat
  messages: role, text, anchor (ply + branch move path in UCI + FEN),
  validated payload JSON (lines resolved to SAN + evals, rule, lessonId),
  provider, model, deep flag, status (streaming / done / error), created_at.
- Side branches the owner makes by moving pieces are not saved by themselves;
  a branch is saved only as the anchor of a message sent from it **(my call)**.
- "Add to review" on a coach answer creates a review card from the anchor
  position: the prompt asks for the best move; accepted answers are the engine
  moves within 5 win % of the best (same rule as M6 "principle" exercises).
  Card kind: a mistake card when the anchor is a game position where the owner
  erred, else a new card source "chat"; one card per position (existing
  position dedup) **(my call)**.
- Duplicates: chats live on the canonical game; a duplicate copy's page shows
  the canonical game's chat (M7 `duplicate_of`).

## 11. Constraints

- Everything from the parent spec: local only, 127.0.0.1, secrets in `.env`
  or settings, tests never hit the network (record provider stream fixtures),
  `data/chess.db` safety rules, smoke runs on port 8788 with a temp DB.
- Speed target (owner approved, to be measured, M8b): first words in about
  3–5 s and a full answer in about 10–15 s with the default CLI provider and
  model. M8b starts with a short spike that measures time to first token
  and total time for claude / codex / opencode with candidate fast models and
  streaming, and picks the defaults from the numbers. The spike is a tuning
  step, not a gate: if no CLI reaches the target, the chat stays slower and
  uses the CLIs anyway; API keys stay optional **(owner: "if the only option
  is slow, slow it is, I can wait")**.
- In M8a answers arrive whole, about 20–40 s with today's CLIs; the UI shows
  "The coach is thinking…" and the page stays usable.
- A message left in status "streaming" or "pending" by a server restart is
  marked as an error on startup, with "Try again" **(my call)**.
- The live engine must not make the game page feel slow on the owner's Mac.

## 12. Left to the builder

- SSE details, partial-JSON extraction, adapter streaming per provider.
- Exact fast/deep model defaults (from the spike), node budgets.
- Variation tree data structure in the web and how the Moves tab draws it.
- Table and route names, prompt wording (prompt version constant as in M5).
- Whether `DrillBoard` is reused for the interactive game board.

## 13. Calls made without the owner (review these)

1. The AI attaches lines by id from an engine-built fact pack; it never writes
   a move sequence. Moves the owner names are checked and analysed by the
   server before the AI sees them.
2. Streamed text is shown with a "checking…" mark and can be replaced if
   validation fails.
3. History capped to the last 10 turns.
4. A dedicated live-engine process outside the analysis pool.
5. Owner-made branches are saved only when a message is sent from them.
6. "Add to review" accepts engine moves within 5 win % of the best.
7. "Go deeper" shows a second answer below the first instead of replacing it.
8. Grounding set = this turn's fact pack + game moves + earlier turns' fact
   packs; anything else → one retry → error with "Try again".
9. The fact pack adds material, captures and checks along every line.
10. Line ids are unique per turn; lines stored to 16 plies, shown to 8.
11. A restart marks unfinished messages as errors.
