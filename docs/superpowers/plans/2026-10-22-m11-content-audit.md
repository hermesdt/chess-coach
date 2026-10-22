# M11 Content Quality Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every chess claim in the repertoire comments, lesson texts and guide texts is checked against the board (chess.js) and, for evaluation claims, Stockfish; every false or misleading sentence is fixed; a cheap script keeps move sequences in prose legal.

**Architecture:** One tooling task (sequence-replay check, `pnpm check:sequences`), one protocol note that fixes the report format, then 18 audit batches. Each batch is audit (read-only, strongest model, writes a report) → fix (applies only `false` / `misleading` verdicts) → re-check (the same auditor, scoped to the changed sentences). Auditors are read-only and may run in parallel; fixers run one at a time.

**Tech Stack:** as before (TypeScript, chess.js, the `stockfish` binary, vitest). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-20-content-audit-design.md` (all sections; §1 error table is the checklist). Starting notes: `docs/ROADMAP.md` → "Content notes for the M11 audit (from the M10 reviews)" and the M9 ledger notes.

## Global Constraints

- Rule: the AI never invents moves, lines or evaluations. A claim is `ok` only with evidence: a chess.js replay, `attackers()` / piece-on-square check, or Stockfish at ≥ 1M nodes (endgames deeper) with `ucinewgame` before each search.
- No "The engine line is …" in a fixed text (write "One line is …"); no exact engine numbers (write "about"); no "%" in guide texts (spec §1 table).
- Fix rules: correct sentences are not rewritten for style; a fix never makes a true sentence false or vaguer; delete a sentence when no true short sentence fits; keep the length rules (repertoire comment: one or two sentences; lesson body: 150–400 words; guide sentences: 20 words or fewer).
- Never change a repertoire move, a lesson solution, a node id, an exercise id or a guide `moves` list in this milestone. If a text shows that a move was chosen for a false reason, put it in the report's "For the owner" section instead. (Renaming ids changes card references.)
- `content/` stays valid: `pnpm validate:content` passes at the end (engine run once in Task 22; batches run `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm check:sequences`).
- Safety: never touch `data/chess.db` except the read-only open in Task 3; no port 8787; smoke runs use `pnpm smoke:start`.
- Milestone done → back up `data/chess.db` to `data/backups/pre-m11-<date>.db` only if a migration was added (none expected), merge to `main`, push (standing owner instruction in the ROADMAP).

## Review Focus

1. A fix makes a true sentence false or vaguer: the re-check verifies every changed sentence again, from the position, and compares it with the old one (Tasks 4–21, step 3).
2. A fixed text breaks a length or format rule or the validator (comment length, lesson body words): `pnpm test` and `pnpm validate:lessons` run after each lesson batch; the fixer's step lists the rule (Tasks 16–20).
3. The sequence check blocks content authors with false alarms (alternatives such as "Bf5 or e6", "instead", "not"): sentences with those words give warnings, not errors; the spike in Task 1 reports the counts (Task 1 test).
4. A claim that depends on a pin: chess.js ignores pins in `attackers()`; the protocol note tells auditors to check pinned pieces with a legal-move test (Task 2).
5. A sentence true for the board in the node but quoted under another position (guide texts, transpositions): auditors check each text against the exact FEN named in the report (Tasks 2 and 21).

---

### Task 1: Sequence-replay check  *(model: sonnet)*

**Files:** Create `server/content/sequences.ts`, `server/content/sequences.test.ts`; Modify `scripts/validate-content.ts`, `package.json` (script `check:sequences`)

**Interfaces — Produces:**
- `extractSan(sentence: string): string[]` — SAN tokens in order (move numbers, `...` and `.` stripped; `O-O`, `O-O-O`, `x`, `+`, `#`, `=Q` kept).
- `checkSequence(sentence: string, starts: string[]): { ok: boolean; replayed: number }` — `starts` are FENs; ok when the tokens replay legally from at least one start (two or more tokens; one token is not a sequence).
- `sequenceIssues(): ValidationIssue[]` — for every text in the content, the start positions are: repertoire comment → node `fenBefore` and `fenAfter`; lesson exercise explanation and prompt → exercise `fen` and the position after the solution; guide route/deviation/job/mistake text → the FEN of the board it belongs to (node id, final-form board, or mistake board); lesson `body` and `summary` → every exercise `fen` of that lesson (no exercise: skipped). Rule `illegal-sequence` is an error; a sentence containing `or`, `instead`, `not`, `if`, `before`, `rather` gives severity `warning`.
- `pnpm check:sequences [file]` prints issues and exits 1 on errors.

- [ ] Step 1: failing tests: `extractSan` cases (`"After Nxe4 you play ...Bf5."`, `"Castle O-O first"`, `"The move 3 is…"` gives none); `checkSequence` legal / illegal from the first start but legal from the second; a one-token sentence is ok; an illegal sequence in a fixture repertoire comment gives an `illegal-sequence` error; the same sentence with `instead` gives a warning.
- [ ] Step 2: run `pnpm vitest run server/content` → FAIL. Step 3: implement. Step 4: run → PASS.
- [ ] Step 5 (spike): run `pnpm check:sequences` over all content; write the counts (sentences with 2+ tokens, errors, warnings) and every error with its text into the commit message body. Every error is either a real content error (list it for Task 4–21 batches, do not fix here) or a false alarm that must be fixed in the extractor. Until the batches have fixed the real errors, `pnpm check:sequences` exits 0 and prints `illegal-sequence` issues as warnings (flag `--strict` makes them errors; Task 22 turns `--strict` on for good).
- [ ] Step 6: wire `sequenceIssues()` into the full `pnpm validate:content` run (cheap, no engine; warnings until Task 22, then errors); full gate `pnpm test && pnpm typecheck && pnpm lint`; commit `feat: sequence-replay check for content text`.

### Task 2: Audit protocol note  *(model: sonnet)*

**Files:** Create `docs/superpowers/notes/2026-10-22-m11-audit-protocol.md`

**Interfaces — Produces:** the protocol every batch task reads. Content, verbatim from the decisions here:
- Report file per batch: `docs/superpowers/notes/2026-10-22-m11-audit-<batch-id>.md`, sections "Scope", "Claims" (table), "For the owner", "Re-check".
- Claims table columns: `id | location (file + node id / lesson id + field) | position (FEN) | sentence | claim type | check (tool and evidence) | verdict | fix`. Claim types: line-open/blocked, attack/guard, pin, count, geometry, reason, plan, sequence, evaluation, trade-or-sacrifice, general-rule, other. Verdicts: `ok`, `false`, `misleading`, `unverifiable` (fix or delete).
- Check rules by type from spec §5 (lines square by square; attackers with a pin test via legal moves; evaluation words with Stockfish ≥ 1M nodes and `ucinewgame`; every quoted sequence replayed plus the opponent's best reply; general rules tested in every position where they are stated).
- Auditor rules: throwaway scripts only under `/tmp`; strongest model; list EVERY sentence with a factual claim (not only the suspicious ones); no verdict without evidence.
- Fixer rules: fix only `false` / `misleading` / `unverifiable`; keep the Global Constraints; record `old → new` per fix in the report; commit per batch.
- Re-check rules: the auditor re-verifies each changed sentence from the position and sets `ok` or reopens it; the fixer gets one more round, then the item goes to "For the owner".
- Batch prerequisites: add the owner's reported problems for the batch's scope (Task 3) and the M10/M9 notes from the ROADMAP as known claims to check first.
- [ ] Step 1: write the note. Step 2: commit `docs: M11 audit protocol`.

### Task 3: Reported problems intake  *(main session)*

**Files:** Create `docs/superpowers/notes/2026-10-22-m11-reported-problems.md`; Modify `docs/ROADMAP.md` (remove the temporary task when done)

- [ ] Step 1: copy the live DB with `sqlite3 -readonly data/chess.db ".backup /tmp/m11-flags.db"` (never write to `data/chess.db`), read `card_flags` joined to `cards` (note, card refs, FEN, prompt, solution).
- [ ] Step 2: sort each report: content error (name the batch that owns it: repertoire node id / lesson id / guide) or app bug (write it as a follow-up item, do not fix here). Do not restore any card.
- [ ] Step 3: write the note (no secrets; owner's notes may be quoted), delete `/tmp/m11-flags.db`, remove the temporary task from the ROADMAP "Next session", commit `docs: M11 reported problems`.

### Tasks 4–15: Repertoire batches  *(auditor: opus; fixer: sonnet; re-check: the same auditor)*

Each task: **Files:** Modify the repertoire file named; Create `docs/superpowers/notes/2026-10-22-m11-audit-<batch-id>.md`. "Subtree P" is the node with id P and everything below it, except subtrees given to another batch. Counts are commented nodes.

- [ ] Step 1 (audit): auditor reads the protocol note, loads the batch with the repo's loader (`server/repertoire/load.ts`), and lists every claim of every commented node with the position (`fenBefore` and `fenAfter`), checks it, writes the report (claims table, verdicts).
- [ ] Step 2 (fix): fixer applies the fixes in the repertoire JSON (comments only), appends `old → new` to the report, runs `pnpm test && pnpm typecheck && pnpm lint && pnpm check:sequences <file>`, commits `content: audit <batch-id>`.
- [ ] Step 3 (re-check): the auditor re-verifies every changed sentence and sets the final verdicts; zero open `false` or `misleading`; commit the report update `docs: audit report <batch-id>`.

| Task | Batch id | File | Scope |
|---|---|---|---|
| 4 | `ck-sidelines` | `caro-kann.json` | nodes `e4`, `e4 c6`, `e4 c6 d4`, `e4 c6 d4 d5`; subtrees `e4 c6 Nc3`, `e4 c6 d3`, `e4 c6 Nf3`, `e4 c6 Bc4`, `e4 c6 Qf3`, `e4 c6 Qh5`, `e4 c6 c4` (about 74) |
| 5 | `ck-advance` | `caro-kann.json` | subtrees `e4 c6 d4 d5 e5`, `e4 c6 d4 d5 Nf3`, `e4 c6 d4 d5 Bd3` (about 59) |
| 6 | `ck-exchange-fantasy` | `caro-kann.json` | subtrees `e4 c6 d4 d5 exd5`, `e4 c6 d4 d5 f3` (about 78) |
| 7 | `ck-classical` | `caro-kann.json` | subtrees `e4 c6 d4 d5 Nc3`, `e4 c6 d4 d5 Nd2` (about 61); includes the M4 "open the c8 bishop" sentences (fixed in `963d710`): list them as checked |
| 8 | `lo-nf6` | `london.json` | nodes `d4`, `d4 d5`, `d4 d5 Bf4`; subtree `d4 d5 Bf4 Nf6` (about 69) |
| 9 | `lo-d5-rest` | `london.json` | subtrees `d4 d5 Bf4 c5`, `d4 d5 Bf4 Nc6`, `d4 d5 Bf4 Bf5`, `d4 d5 Bf4 e6` (about 71); includes the 4 level-1 nodes added in M10 under `d4 d5 Bf4 Bf5 e3` |
| 10 | `lo-other-replies` | `london.json` | subtrees `d4 Nf6`, `d4 c5`, `d4 e5`, `d4 f5` (about 78); includes the M10 Qc1 note (`d4 Nf6 Bf4 c5 e3 Qb6`) for the owner section |
| 11 | `sl-main-nf3` | `slav.json` | nodes `d4 d5`, `d4 d5 c4`, `d4 d5 c4 c6`; subtree `d4 d5 c4 c6 Nf3` (about 88) |
| 12 | `sl-nc3-exchange` | `slav.json` | subtrees `d4 d5 c4 c6 Nc3`, `d4 d5 c4 c6 cxd5`, `d4 d5 c4 c6 e3` (about 58) |
| 13 | `sl-anti-london` | `slav.json` | subtree `d4 d5 Bf4` (about 75); includes the M9 notes on `5.Ne5 Nbd7 6.Nxc4 b5` and `4.Nd2 cxd4` |
| 14 | `sl-second-moves` | `slav.json` | subtrees `d4 d5 Nf3`, `d4 d5 e3`, `d4 d5 Bg5`, `d4 d5 e4`, `d4 d5 Nc3` (about 41) |
| 15 | `sl-first-moves` | `slav.json` | subtrees `c4`, `Nf3` (about 47); includes the M9 note "the e6 pawn blocks your c8 bishop for now" and the Bxc3 "so" wording |

### Tasks 16–20: Lesson batches  *(same roles and steps as Tasks 4–15)*

**Files:** Modify the lesson files named; Create the report note. Claims to audit: `summary`, `body`, every exercise `prompt` and `explanation` (and tag texts shown in the lesson). Fixer additionally runs `pnpm validate:lessons` (fast, no change to solutions) and checks the body stays 150–400 words. Do not rename ids (`queen-sacrifice-mate` stays).

| Task | Batch id | Lessons (files in `content/lessons/`) | Known notes from the ROADMAP to check first |
|---|---|---|---|
| 16 | `ls-1-5` | `01-blunder-check` … `05-castle` | "king is safe / solid" phrases never engine-checked (level 1) |
| 17 | `ls-6-10` | `06-trades` … `10-mates` | the sacrifice-versus-trade wording; exercise explanations with sequences |
| 18 | `ls-11-15` | `11-caro-kann-plans` … `15-good-bad-bishop` | lesson 15 neighbour-colour rule and "dxc4 gives up the pawn" (fixed in M9, re-check) |
| 19 | `ls-16-20` | `16-rook-endgames` … `20-minority-attack` | prophylaxis body mentions a mate-threat rule no exercise uses; "about 69 %" style numbers |
| 20 | `ls-21-25` | `21-pawn-breaks` … `25-opposite-bishops` | any remaining "The engine line is …" text; exact engine numbers |

### Task 21: Guide texts  *(same roles and steps)*

**Files:** Modify `content/guides/*.json` (texts only, never `moves`, `bad`, `good`, node ids or roots); Create `docs/superpowers/notes/2026-10-22-m11-audit-guides.md`

- [ ] Step 1 (audit): the three guides had two separate opus content reviews in M10 (every sentence, every board), so this batch does not repeat that. The auditor checks: (a) each guide sentence against the repertoire comment of the same node after Tasks 4–15 (a contradiction is a finding; the tree wins if the tree is right); (b) the M10 deferred items (Caro-Kann Two Knights 23-word sentence, Panov mistake lead-in "…e6 and …Bb4", optional `…Bxd1` hint; Slav `why` paragraph 2 and 3.Nc3 plan wording; the three `good` moves that lose 7–15 win %: Slav vs-nf3 0 …e6, London vs-qb6 1 Qc1, London vs-qb6 0 Be2); (c) the sequence check output for guides; (d) text rules: 20 words or fewer, no "%", no exact engine numbers.
- [ ] Step 2 (fix) and Step 3 (re-check) as in Tasks 4–15; the fixer also runs `pnpm validate:content content/guides/<name>.json` for each changed guide (engine, a few minutes each).

### Task 22: Close  *(main session)*

- [ ] Step 1: `pnpm check:sequences --strict` exits 0; make `--strict` the default in `pnpm check:sequences` and in `pnpm validate:content`; full gate `pnpm test && pnpm typecheck && pnpm lint && pnpm build`; full `pnpm validate:content` → content OK.
- [ ] Step 2: write an index `docs/superpowers/notes/2026-10-22-m11-audit-index.md`: per batch, claims checked, false/misleading found and fixed, open items "For the owner" (includes the London Qc1 question), and the owner's example (Caro-Kann "open the c8 bishop") as checked, fixed in `963d710`.
- [ ] Step 3: ROADMAP: M11 done, rulings, known gaps, link to the index; merge to `main` and push (standing instruction); smoke on a read-only `.backup` copy of the live DB (port 8788): open the three guides and a review card from each repertoire.
