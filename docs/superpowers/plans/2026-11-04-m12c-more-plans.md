# M12c More Plans Implementation Plan

**Goal:** Add validated level-2 and level-3 middlegame plans, including a concrete a-file example.

**Architecture:** Extend the existing authored plan catalogue, chess.js/Stockfish validator and training workflow; no runtime-generated chess advice. Use a Slav queen-trade structure, a Carlsbad minority attack and an opposite-castling Caro-Kann position. Add a reusable clear-file trigger so the Slav plan does not match when its rook is blocked.

**Tech Stack:** JSON plan content, TypeScript, chess.js, Stockfish 19, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-29-middlegame-plans-design.md`, sections 2.3 and 9.

## Constraints And Review Focus

- All positions must be legal SAN sequences from the start position; game-tree origins must match their paths.
- Plans must teach only facts verified on their own boards. Each quiz has at least three exercises and engine-checked alternatives.
- Distinguish pressure on an open file from a forced win, and conditional continuations from guaranteed ones.
- Verify that the level, side, trigger and linked guide or lesson match each position.
- Stockfish engine assessments use at least one million nodes; record the evidence and limitations.
- Never operate on the owner's live database. Preserve unrelated worktree changes.

## Tasks

### 1. Research
- [x] Replay candidate lines and evaluate their main moves, mistakes and exercise positions with `scripts/plan-probe.ts` at one million nodes.
- [x] Reject unsupported claims; record the choice and concrete engine evidence.

### 2. Author And Review
- [x] Write each plan using validated legal board sequences and test the new trigger.
- [x] Check factual claims on their displayed boards; independently review chess claims and record a ledger in `docs/superpowers/notes/`.
- [x] Run plan-specific engine validation and real-content tests; fix errors and re-check fixes. The complete content check includes the sequence checker.

### 3. Verify And Deliver
- [x] Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm validate:content`, and an isolated smoke test.
- [x] Update the roadmap with completed scope, verification, decisions and remaining candidates; commit and push without including unrelated changes.
