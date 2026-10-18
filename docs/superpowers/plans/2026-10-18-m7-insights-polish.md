# M7 Insights + Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the owner where they stand (results per opening and colour, mistake trends, accuracy and rating over time), finish the Settings page, remove duplicate imported games from stats, and document setup in a README.

**Architecture:** One insights service computes aggregates with SQL over `games`, `game_analysis`, `move_analysis` and `opening_events`. The Insights page draws them with plain SVG components that follow the dataviz skill. Polish tasks close gaps carried in the ROADMAP log.

**Tech Stack:** as before. No chart library (plain SVG).

**Spec:** `docs/superpowers/specs/2026-10-18-chess-coach-design.md` (§2.8, §2.9, §12 screens 1, 7, 8) and the ROADMAP log ("rulings" and "known minor gaps").

## Global Constraints

- Every insight counts each game once: duplicates (same players case-insensitive, same `Date`, same mainline SAN sequence) are linked via `games.duplicate_of` (migration) and excluded from aggregates; the synced copy is canonical over the imported one.
- Insights use only games with `user_color` set. Time windows: last 30 / 90 / 365 days / all (default 90).
- Opening grouping: repertoire match first (from `opening_events`: "Caro-Kann (your repertoire)", "London (your repertoire)"), else `opening_name` up to the first ":" or variation word list, else ECO family (A–E + first digit).
- Charts follow the dataviz skill (read `~/.claude/plugins/.../dataviz` SKILL.md path given in the dispatch): one palette, labelled axes, accessible colours, light theme.
- README covers: requirements (Node 26, pnpm, Stockfish via Homebrew), install, `.env` keys, lichess token steps, AI provider setup (claude / codex / opencode logins, OpenRouter key), `pnpm dev` / `pnpm build && pnpm start`, data location and backup (copy `data/chess.db`), content validation.

## Review Focus

1. A user with zero analysed games: every insight card shows an empty state that says what to do — test in Task 1 (API returns empty arrays) and Task 2 screenshot.
2. Duplicate detection does not merge two different games between the same players on the same day — test in Task 3.
3. Rating trend mixes time classes → separate series per platform + time class — test in Task 1.
4. Window switch is fast (< 200 ms on 5 000 games) — test in Task 1 with generated rows.
5. Settings flags list: un-suspending a flagged card removes the flag — test in Task 4.

---

### Task 1: Insights API  *(model: sonnet)*

**Files:** Create `server/insights/insights.ts`, `server/routes/insights.ts`; Modify `server/app.ts`, `shared/types.ts`; Test `server/insights/insights.test.ts`

**Interfaces — Produces:** `getInsights(db, window: '30d' | '90d' | '365d' | 'all', now): Insights` where `Insights = { byOpening: { group: string; color: Color; games: number; win: number; draw: number; loss: number; avgAccuracy: number | null }[]; tagsByMonth: { month: string; tag: Tag; perGame: number }[]; accuracyByMonth: { month: string; avg: number; games: number }[]; rating: { series: string; points: { t: number; elo: number }[] }[]; summary: { games: number; analysed: number; winRate: number | null } }`; route `GET /api/insights?window=` .

- [ ] Step 1: failing tests per Global Constraints and Review Focus 1, 3, 4. Steps 2–5. Commit `feat: insights api`.

### Task 2: Insights page  *(model: sonnet)*

**Files:** Create `web/src/pages/InsightsPage.tsx`, `web/src/components/charts/{BarResults,LineSeries,TagHeatmap}.tsx`; Modify `web/src/App.tsx` (nav "Insights"), `web/src/api.ts`; Test `web/src/components/charts/scales.test.ts`

- Cards: "Results by opening" (stacked W/D/L bars per group and colour, sorted by games; London-as-White and Caro-Kann-as-Black pinned on top), "Mistakes per game by type" (month × tag heatmap or small multiples), "Accuracy" (line), "Rating" (lines per series), window selector. Each card has an empty state.
- [ ] Step 1: failing tests for scale helpers. Steps 2–5 (+ build + screenshots at 1280 px with demo data and with an empty DB). Commit `feat: insights page`.

### Task 3: Duplicate games  *(model: sonnet)*

**Files:** Create `server/db/migrations/0NN_duplicates.sql` (`ALTER TABLE games ADD COLUMN duplicate_of INTEGER`), `server/games/duplicates.ts`; Modify import and sync paths to link duplicates after insert, `listGames` (hide duplicates by default, `?includeDuplicates=1`), insights/dashboard queries (exclude), analysis eligibility (skip duplicates); Test `server/games/duplicates.test.ts`

- [ ] Step 1: failing tests per Global Constraints and Review Focus 2. Steps 2–5. Commit `feat: link duplicate games`.

### Task 4: Settings completeness + gap fixes  *(model: sonnet)*

**Files:** Modify `web/src/pages/SettingsPage.tsx`, `server/routes/settings.ts`, `server/config.ts`, `server/sync/chesscom.ts`, `server/srs/cards-repo.ts`, `server/routes/review.ts`; Test as listed

- Settings sections: Accounts (M1), AI coach (M5), Engine (`engineNodes`), Review (`reviewDailyLimit`, `reviewNewPerDay`), Reported problems (list flags with card preview and "Restore card" → un-suspend + delete flag), Data (DB path, game/card counts).
- chess.com 429/5xx: retry up to 3 times with backoff 1 s / 3 s / 9 s, honour `Retry-After` (test with fake fetch).
- A note under each setting that also comes from `.env`: "Empty uses the value from .env".
- [ ] Steps 1–5 with tests for flags restore and chess.com retry. Commit `feat: settings completeness and sync retry`.

### Task 5: README + production run  *(model: haiku — documentation from the listed facts; reviewed by sonnet)*

**Files:** Update the existing `README.md` (added in commit 409272d with an MIT LICENSE — keep both); Modify `package.json` if `start` needs `NODE_ENV=production`
- [ ] Write README per Global Constraints. Verify `pnpm build && pnpm start` serves the app at `http://127.0.0.1:8787` (curl `/` and `/api/health`). Commit `docs: readme`.

### Task 6: Smoke run and close  *(main session)*

- [ ] Full gate + `pnpm validate:content` green. End-to-end with a real account (if the owner has set usernames) or a public account in a temp copy of the DB: sync → analyse → review → coach → insights. Screenshots of every page. ROADMAP M7 → done; final summary to the owner.
