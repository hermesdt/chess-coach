# M1 Foundation + Sync + Games Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local app that stores settings, syncs games from chess.com and lichess, imports PGN, lists games, and replays a game on a board.

**Architecture:** One pnpm package. Hono server on `127.0.0.1:8787` with `node:sqlite` and SQL migrations; Vite + React SPA that proxies `/api` to the server. Shared DTO types in `shared/`. Long work (sync) runs as background jobs stored in SQLite and polled by the web.

**Tech Stack:** Node 26, pnpm 10, TypeScript (strict, ESM), Hono + @hono/node-server, node:sqlite (`DatabaseSync`), chess.js, Vite, React 19, React Router, react-chessboard (latest; v5 uses a single `options` prop — read its README), Vitest (+ jsdom + @testing-library/react for web), ESLint flat config + typescript-eslint, tsx, concurrently.

**Spec:** `docs/superpowers/specs/2026-10-18-chess-coach-design.md` (§5, §6, §7, §12 screens 2/3/8, §17.2–3)

## Global Constraints

- Server binds to `127.0.0.1` only, port `8787`. Vite dev server proxies `/api` → `http://127.0.0.1:8787`.
- DB file: `data/chess.db` (directory gitignored). Tests use `:memory:`.
- Config via `.env` (gitignored; load with `process.loadEnvFile()` if the file exists); commit `.env.example` with `CHESSCOM_USERNAME`, `LICHESS_USERNAME`, `LICHESS_TOKEN`, `STOCKFISH_PATH`, `ANTHROPIC_API_KEY`, `AI_PROVIDER`, `AI_MODEL`, `AI_EFFORT`.
- Settings stored in DB win over `.env`. The lichess token is never returned by any API response (only `lichessTokenSet: boolean`).
- First sync fetches the last `syncInitialMonths` months (default 12). Later syncs are incremental from the newest stored game of that source.
- chess.com requests send `User-Agent: chess-coach-local/0.1 (personal use)`.
- Lichess export: `GET https://lichess.org/api/games/user/{username}?since=<ms>&pgnInJson=true&opening=true&clocks=false&evals=false` with `Accept: application/x-ndjson` and `Authorization: Bearer <token>` when a token exists. Without a token lichess returns 404; report this as: `Lichess needs a personal access token. Create one at https://lichess.org/account/oauth/token (no scopes needed) and add it in Settings.`
- Only standard chess is stored (skip chess.com `rules !== "chess"`, lichess `variant !== "standard"`, PGNs with a `Variant` header other than Standard).
- Username matching is case-insensitive.
- Tests never hit the network: inject `fetchFn: typeof fetch` and use fixtures in `server/**/__fixtures__/`.
- Scripts in `package.json`: `dev`, `build`, `start`, `test`, `typecheck`, `lint`.

## Review Focus

1. Running sync twice must not duplicate games (unique `(source, source_id)`) — test in Task 2 and Task 6.
2. Lichess fails (no token) while chess.com succeeds: the job ends `done` with the chess.com games stored and the lichess error in `message`; it ends `error` only when every configured source failed — test in Task 6.
3. A network error halfway through chess.com archives keeps the months already inserted (insert per month) — test in Task 6.
4. PGN import with several games, CRLF line endings, comments/variations, a custom start position (`SetUp`/`FEN` headers), and a non-standard `Variant` (skipped) — tests in Task 3 and Task 6.
5. Settings PUT with an empty string clears a value; GET never leaks the token — test in Task 2.

---

## File Structure

```
package.json, tsconfig.json, tsconfig.node.json?, vite.config.ts, vitest.config.ts,
eslint.config.js, .gitignore, .env.example, index.html (in web/)
shared/types.ts                     DTOs used by server and web
server/main.ts                      starts the HTTP server
server/app.ts                       createApp(deps) → Hono app, mounts routes
server/config.ts                    env loading + resolved settings
server/db/db.ts                     openDb(path) → DatabaseSync (runs migrations)
server/db/migrate.ts                migrate(db)
server/db/migrations/001_init.sql   settings, games, sync_state, jobs
server/db/settings-repo.ts
server/db/games-repo.ts
server/chess/pgn.ts                 PGN parsing, user colour, result
server/sync/chesscom.ts             chess.com client + mapper
server/sync/lichess.ts              lichess client + mapper
server/sync/sync-service.ts         orchestrates both sources
server/jobs.ts                      job table + background runner
server/routes/*.ts                  health, settings, games, sync, jobs, import
web/index.html, web/src/main.tsx, web/src/App.tsx, web/src/api.ts, web/src/styles.css
web/src/hooks/useJob.ts
web/src/pages/DashboardPage.tsx, GamesPage.tsx, GameViewerPage.tsx, SettingsPage.tsx
web/src/components/ImportPgnDialog.tsx, MoveList.tsx
web/src/lib/navigator.ts            pure move-navigation reducer
```

## Shared types (`shared/types.ts`) — the contract for all tasks

```ts
export type Source = 'chesscom' | 'lichess' | 'import';
export type Color = 'white' | 'black';
export type GameResult = 'win' | 'loss' | 'draw';
export type TimeClass = 'ultrabullet' | 'bullet' | 'blitz' | 'rapid' | 'classical' | 'daily' | 'unknown';

export interface NewGame {
  source: Source; sourceId: string; playedAt: number; // ms epoch (game end)
  timeClass: TimeClass; rated: boolean;
  white: string; black: string; whiteElo: number | null; blackElo: number | null;
  userColor: Color | null; result: GameResult | null; // result from the user's view; null if userColor null
  termination: string | null; eco: string | null; openingName: string | null;
  pgn: string; url: string | null; plyCount: number;
}
export interface GameSummary extends Omit<NewGame, 'pgn'> { id: number }
export interface MoveInfo { ply: number; san: string; uci: string; fenBefore: string; fenAfter: string }
export interface GameDetail extends GameSummary { pgn: string; startFen: string; moves: MoveInfo[] }
export interface GameListQuery { source?: Source; color?: Color; result?: GameResult; q?: string; limit?: number; offset?: number }
export interface GameList { items: GameSummary[]; total: number }
export interface SettingsDTO { chesscomUsername: string | null; lichessUsername: string | null; lichessTokenSet: boolean; syncInitialMonths: number }
export interface SettingsUpdate { chesscomUsername?: string; lichessUsername?: string; lichessToken?: string; syncInitialMonths?: number }
export type JobStatus = 'queued' | 'running' | 'done' | 'error';
export interface Job { id: number; kind: string; status: JobStatus; progress: number; total: number | null; message: string | null; error: string | null; createdAt: number; finishedAt: number | null }
export interface ImportPreviewItem { index: number; white: string; black: string; date: string | null; detectedColor: Color | null; skippedReason: string | null }
export interface ImportRequest { pgn: string; colors?: (Color | null)[] } // colors[i] overrides detection for game i
export interface ImportResult { inserted: number; duplicates: number; skipped: number }
```

---

### Task 1: Scaffold, tooling, health endpoint, web shell  *(model: sonnet)*

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `eslint.config.js`, `.gitignore`, `.env.example`, `shared/types.ts` (verbatim from above), `server/app.ts`, `server/main.ts`, `server/routes/health.ts`, `web/index.html`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/styles.css`, `web/src/pages/DashboardPage.tsx` (placeholder)
- Test: `server/routes/health.test.ts`

**Interfaces:**
- Produces: `createApp(deps: AppDeps): Hono` where `interface AppDeps { db: DatabaseSync; fetchFn?: typeof fetch; now?: () => number }` (db is unused until Task 2 but in the type now). `GET /api/health` → `{ ok: true }`.
- Web shell: top nav with links Dashboard (`/`), Games (`/games`), Settings (`/settings`); routes render placeholders until later tasks.

- [ ] **Step 1:** Init pnpm package (`"type": "module"`), install deps listed in Tech Stack. Scripts: `dev` = concurrently `tsx watch server/main.ts` and `vite`; `build` = `vite build`; `start` = `tsx server/main.ts` (serves `dist/` statically in addition to `/api` when it exists); `test` = `vitest run`; `typecheck` = `tsc --noEmit`; `lint` = `eslint .`. Vite `root: 'web'`, `build.outDir: '../dist'`. Vitest: `environment: 'node'` by default, `web/**` tests use jsdom via `environmentMatchGlobs` or per-file `// @vitest-environment jsdom`.
- [ ] **Step 2: Write the failing test** `health.test.ts`: `createApp({ db: new DatabaseSync(':memory:') }).request('/api/health')` → status 200, JSON `{ ok: true }`.
- [ ] **Step 3:** Run `pnpm test` → FAIL (module missing).
- [ ] **Step 4:** Implement `createApp`, health route, `main.ts` (`serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 8787 })`), web shell.
- [ ] **Step 5:** `pnpm test && pnpm typecheck && pnpm lint` → all pass. `pnpm build` succeeds.
- [ ] **Step 6:** Commit `chore: scaffold app with health endpoint and web shell`.

### Task 2: Database, migrations, settings  *(model: sonnet)*

**Files:**
- Create: `server/db/db.ts`, `server/db/migrate.ts`, `server/db/migrations/001_init.sql`, `server/db/settings-repo.ts`, `server/db/games-repo.ts`, `server/config.ts`, `server/routes/settings.ts`
- Modify: `server/app.ts`, `server/main.ts` (open `data/chess.db`, creating `data/`)
- Test: `server/db/games-repo.test.ts`, `server/routes/settings.test.ts`

**Interfaces:**
- Produces:
  - `openDb(path: string): DatabaseSync` (runs `migrate`, sets `PRAGMA journal_mode=WAL` for files, `foreign_keys=ON`)
  - `migrate(db: DatabaseSync): void` — applies `server/db/migrations/NNN_*.sql` in order, tracked in `schema_migrations(version TEXT PRIMARY KEY, applied_at INTEGER)`. Resolve the directory from `import.meta.url`.
  - `getSetting(db, key: string): string | null`, `setSetting(db, key: string, value: string | null): void` (null deletes)
  - `insertGames(db, games: NewGame[]): { inserted: number; duplicates: number }` — one transaction, `INSERT OR IGNORE` on `UNIQUE(source, source_id)`
  - `listGames(db, q: GameListQuery): GameList` — newest first; `q` matches white/black/opening name (LIKE, case-insensitive); default limit 50
  - `getGameRow(db, id: number): (GameSummary & { pgn: string }) | null`
  - `latestPlayedAt(db, source: Source): number | null`
  - `getSettings(db): ResolvedSettings` where `ResolvedSettings = SettingsDTO & { lichessToken: string | null }`; keys `chesscom_username`, `lichess_username`, `lichess_token`, `sync_initial_months`; DB value wins, else env (`CHESSCOM_USERNAME`, `LICHESS_USERNAME`, `LICHESS_TOKEN`), months default 12
  - `GET /api/settings` → `SettingsDTO`; `PUT /api/settings` body `SettingsUpdate` → `SettingsDTO` (empty string clears; `syncInitialMonths` must be integer 1–120 else 400)
- `001_init.sql` tables: `settings(key PK, value)`, `games` (columns per `NewGame` in snake_case + `id INTEGER PK`, `imported_at`, `UNIQUE(source, source_id)`, index on `played_at DESC`), `sync_state(source PK, last_synced_at)`, `jobs` (per `Job`).

- [ ] **Step 1: Write failing tests:**
  - `insertGames` twice with the same 2 games → second call `{ inserted: 0, duplicates: 2 }`; `listGames` total 2, ordered by `playedAt` desc.
  - `listGames({ q: 'caro' })` matches `openingName` "Caro-Kann Defense" case-insensitively; `{ color: 'black', result: 'win' }` filters.
  - `latestPlayedAt(db, 'chesscom')` → max `playedAt` of that source, `null` when none.
  - Settings: PUT `{ lichessToken: 'abc', chesscomUsername: 'Me' }` → response has `lichessTokenSet: true` and no key containing `abc` anywhere in the JSON text; PUT `{ chesscomUsername: '' }` → `chesscomUsername: null`; PUT `{ syncInitialMonths: 0 }` → 400.
  - `migrate` run twice on the same DB does not throw.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the files above.
- [ ] **Step 4:** `pnpm test && pnpm typecheck && pnpm lint` → pass.
- [ ] **Step 5:** Commit `feat: sqlite storage, games repository and settings API`.

### Task 3: PGN utilities  *(model: sonnet)*

**Files:**
- Create: `server/chess/pgn.ts`, `server/chess/__fixtures__/multi.pgn` (3 games incl. CRLF, comments, a variation, one `SetUp "1"` + `FEN` game, one `Variant "Chess960"` game)
- Test: `server/chess/pgn.test.ts`

**Interfaces:**
- Produces:
  - `splitPgn(text: string): string[]` — splits a multi-game PGN into single-game strings (normalise CRLF to LF first)
  - `parsePgn(pgn: string): { headers: Record<string, string>; startFen: string; moves: MoveInfo[] }` — mainline only (chess.js `loadPgn`, then `history({ verbose: true })` replayed from `startFen`); throws `PgnError` on illegal/unparseable input
  - `resolveUserColor(white: string, black: string, usernames: (string | null)[]): Color | null` — case-insensitive; null when none or both match
  - `resultForUser(rawResult: string, color: Color | null): GameResult | null` — `1-0`, `0-1`, `1/2-1/2`; `*` → null
  - `gameFromPgn(pgn: string, opts: { source: Source; sourceId?: string; usernames: (string | null)[]; userColor?: Color | null }): NewGame | { skipped: string }` — `sourceId` defaults to a sha1 hex of the normalised movetext + `White`/`Black`/`Date` headers; `playedAt` from `UTCDate`+`UTCTime`, else `Date` (midnight UTC), else `Date.now()`; `timeClass` from `TimeControl` (base + 40×increment seconds: <30 ultrabullet, <180 bullet, <480 blitz, <1500 rapid, else classical; `-` or containing `/` → daily; missing → unknown); `openingName` from `Opening` header, else last path segment of `ECOUrl` with `-` → space; skipped reason `"non-standard variant"` for Variant other than Standard/missing.

- [ ] **Step 1: Write failing tests** with the fixture: `splitPgn` → 4 strings; `parsePgn` of game 1 → first move `{ ply: 1, san: 'e4', uci: 'e2e4' }` and `moves.length` equals the mainline ply count (variation ignored); the FEN game's `startFen` equals its `FEN` header and its first `fenBefore` equals it; `resolveUserColor('Alvaro','bob',['alvaro',null])` → `'white'`, both match → null; `resultForUser('0-1','black')` → `'win'`; `gameFromPgn` on the Chess960 game → `{ skipped: 'non-standard variant' }`; `TimeControl "600+5"` → `rapid`, `"180+2"` → `blitz`, `"1/86400"` → `daily`; same PGN twice → same `sourceId`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Tests, typecheck, lint pass.
- [ ] **Step 5:** Commit `feat: pgn parsing and game normalisation`.

### Task 4: chess.com client  *(model: sonnet)*

**Files:**
- Create: `server/sync/chesscom.ts`, `server/sync/__fixtures__/chesscom-archives.json`, `server/sync/__fixtures__/chesscom-2026-09.json` (record real data: pick any active public account, trim to ~4 games, include one with `rules: "chess960"`)
- Test: `server/sync/chesscom.test.ts`

**Interfaces:**
- Consumes: `gameFromPgn` (Task 3) for moves/headers; `NewGame`.
- Produces:
  - `mapChesscomGame(g: ChesscomGame, username: string): NewGame | null` — `source 'chesscom'`, `sourceId = g.uuid ?? g.url`, `playedAt = g.end_time * 1000`, `timeClass = g.time_class`, `rated = g.rated`, players/elo from `g.white`/`g.black`, `url = g.url`, rest from the PGN. null for non-`chess` rules.
  - `fetchChesscomGames(username: string, opts: { sinceMs: number; fetchFn?: typeof fetch; onMonth?: (games: NewGame[], monthUrl: string) => void }): Promise<number>` — gets archives, keeps months whose `YYYY/MM` ≥ month of `sinceMs` (UTC), fetches oldest→newest, calls `onMonth` per month (so callers insert per month), returns total mapped. Non-2xx → throw `SyncError` with status and URL. Lower-case the username in URLs.

- [ ] **Step 1: Write failing tests** with a fake `fetchFn` routing URLs to fixtures: months before `sinceMs` are not requested; chess960 game skipped; mapped game has `userColor` matching the username regardless of case and correct `result`; a 500 on the second month → first month's `onMonth` already called, then the promise rejects with `SyncError`.
- [ ] **Step 2:** Run → FAIL.  **Step 3:** Implement.  **Step 4:** Pass + typecheck + lint.
- [ ] **Step 5:** Commit `feat: chess.com game sync client`.

### Task 5: lichess client  *(model: sonnet)*

**Files:**
- Create: `server/sync/lichess.ts`, `server/sync/__fixtures__/lichess-games.ndjson` (3 lines; record with `curl -H "Accept: application/json" "https://lichess.org/game/export/<id>?pgnInJson=true&opening=true"` for real game ids, one non-standard variant line)
- Test: `server/sync/lichess.test.ts`

**Interfaces:**
- Produces:
  - `mapLichessGame(g: LichessGame, username: string): NewGame | null` — `source 'lichess'`, `sourceId = g.id`, `playedAt = g.lastMoveAt`, `timeClass` from `g.speed` (`correspondence` → `daily`), `rated`, names from `players.*.user.name` (anonymous/AI → `"Anonymous"` / `"Stockfish level N"`), elo from `players.*.rating`, `eco`/`openingName` from `g.opening`, `url = https://lichess.org/<id>`, `pgn = g.pgn`. null for non-standard variant.
  - `fetchLichessGames(username: string, opts: { sinceMs: number; token: string | null; fetchFn?: typeof fetch; onBatch?: (games: NewGame[]) => void }): Promise<number>` — streams ndjson line by line (handle chunks splitting lines), calls `onBatch` every 100 games and at the end. Status 404 without token → throw `LichessTokenRequiredError` (message from Global Constraints); 404 with token → `SyncError('Lichess user not found')`; other non-2xx → `SyncError`.

- [ ] **Step 1: Write failing tests:** request URL contains `since=<sinceMs>` and `pgnInJson=true`, `Authorization` header present only when token given; stream delivered in odd-sized chunks still yields 2 games (variant skipped); 404 without token → `LichessTokenRequiredError`.
- [ ] **Step 2:** FAIL.  **Step 3:** Implement.  **Step 4:** Pass + typecheck + lint.
- [ ] **Step 5:** Commit `feat: lichess game sync client`.

### Task 6: Jobs, sync service, import, games API  *(model: sonnet)*

**Files:**
- Create: `server/jobs.ts`, `server/sync/sync-service.ts`, `server/routes/sync.ts`, `server/routes/jobs.ts`, `server/routes/games.ts`, `server/routes/import.ts`
- Modify: `server/app.ts`
- Test: `server/sync/sync-service.test.ts`, `server/routes/games.test.ts`, `server/routes/import.test.ts`

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces:
  - `createJob(db, kind: string): Job`, `updateJob(db, id: number, patch: Partial<Pick<Job, 'status'|'progress'|'total'|'message'|'error'|'finishedAt'>>): void`, `getJob(db, id): Job | null`
  - `runJob(db, kind: string, work: (report: (progress: number, total: number | null, message?: string) => void) => Promise<string | void>): Job` — creates the job, starts `work` without awaiting, sets `running` → `done` (message = returned string) or `error`. Export `waitForJob(db, id, timeoutMs)` for tests.
  - `syncAll(db, deps: { fetchFn?: typeof fetch; now?: () => number }, report): Promise<SyncSummary>` where `SyncSummary = { chesscom: number | null; lichess: number | null; errors: string[] }` (null = not configured). For each configured source: `sinceMs = latestPlayedAt + 1` or `now - syncInitialMonths × 30 days`; insert per month/batch; record `sync_state.last_synced_at`. Throws only if every configured source failed; throws `SyncError('No usernames configured')` if none configured.
  - `POST /api/sync` → `{ jobId }` (kind `sync`; message like `chess.com: 34 new · lichess: token needed`); `GET /api/jobs/:id` → `Job` or 404.
  - `GET /api/games` (query → `GameListQuery`) → `GameList`; `GET /api/games/:id` → `GameDetail` (moves from `parsePgn`) or 404.
  - `POST /api/import/preview` body `{ pgn }` → `ImportPreviewItem[]`; `POST /api/import` body `ImportRequest` → `ImportResult` (source `import`; `colors[i] === undefined` → detected colour).
  - `GET /api/sync/status` → `{ chesscom: number | null; lichess: number | null }` (last_synced_at per source).

- [ ] **Step 1: Write failing tests:**
  - chess.com OK + lichess without token → job `done`, chess.com games stored, `message` mentions the token; both failing → job `error`.
  - Sync twice with the same fixtures → second run inserts 0.
  - Second sync passes `since = latestPlayedAt + 1` to the lichess URL.
  - Import of the Task 3 fixture → preview lists 4 items with the Chess960 one `skippedReason: 'non-standard variant'`; import → `{ inserted: 3, skipped: 1 }`; re-import → `duplicates: 3`.
  - `GET /api/games/:id` for an imported game → `moves.length` > 0 and `moves[0].fenBefore === startFen`; unknown id → 404.
- [ ] **Step 2:** FAIL.  **Step 3:** Implement.  **Step 4:** Pass + typecheck + lint.
- [ ] **Step 5:** Commit `feat: background sync jobs, pgn import and games API`.

### Task 7: Web — API client, Settings, Games list, Import  *(model: sonnet)*

**Files:**
- Create: `web/src/api.ts`, `web/src/hooks/useJob.ts`, `web/src/pages/SettingsPage.tsx`, `web/src/pages/GamesPage.tsx`, `web/src/components/ImportPgnDialog.tsx`
- Modify: `web/src/App.tsx`, `web/src/pages/DashboardPage.tsx`, `web/src/styles.css`
- Test: `web/src/hooks/useJob.test.ts`

**Interfaces:**
- Consumes: the HTTP API of Task 2 and 6, `shared/types.ts`.
- Produces: `api` object with typed methods (`getSettings`, `putSettings`, `listGames`, `getGame`, `startSync`, `getJob`, `previewImport`, `importPgn`, `getSyncStatus`); `useJob(jobId: number | null, intervalMs = 1000): Job | null` (polls until `done`/`error`).
- Settings page: chess.com username, lichess username, lichess token (password input, placeholder shows "saved" when `lichessTokenSet`), link to the lichess token page, months for first sync. Save shows confirmation.
- Games page: "Sync now" (disabled while a sync job runs; shows progress and final message), "Import PGN" dialog (textarea + file input → preview table with a White/Black/Neither select where `detectedColor` is null → import), filters (source, colour, result, search), table columns: date, platform, colour, opponent (+elo), result, opening, time class; row click → `/games/:id`; pagination 50 per page. Empty state: "No games yet. Add your usernames in Settings, then press Sync."
- Dashboard (temporary): game count, last sync per source, "Sync now" button.

- [ ] **Step 1: Write failing test** for `useJob` with fake timers and a mocked `api.getJob`: polls while `running`, stops at `done`.
- [ ] **Step 2:** FAIL.  **Step 3:** Implement.  **Step 4:** Pass + typecheck + lint; `pnpm build` succeeds.
- [ ] **Step 5:** Commit `feat: settings, games list, sync and import UI`.

### Task 8: Web — Game viewer  *(model: sonnet)*

**Files:**
- Create: `web/src/lib/navigator.ts`, `web/src/components/MoveList.tsx`, `web/src/pages/GameViewerPage.tsx`
- Modify: `web/src/App.tsx`
- Test: `web/src/lib/navigator.test.ts`

**Interfaces:**
- Consumes: `api.getGame` → `GameDetail`.
- Produces: `navigate(state: { ply: number; maxPly: number }, action: 'first' | 'prev' | 'next' | 'last' | { goto: number }): { ply: number; maxPly: number }` (ply 0 = start position, clamped to [0, maxPly]); `fenAt(game: GameDetail, ply: number): string` (`startFen` for 0, else `moves[ply-1].fenAfter`).
- Page: header (players, elos, result for the user, opening, date, link to the original game), board (react-chessboard, read-only, orientation = `userColor ?? 'white'`, last move highlighted), MoveList (numbered pairs, current move highlighted, click to jump), buttons ⏮ ◀ ▶ ⏭ and keyboard ←/→/Home/End.

- [ ] **Step 1: Write failing tests** for `navigate` (clamping at both ends, goto) and `fenAt` (0 → startFen, last ply → final fen).
- [ ] **Step 2:** FAIL.  **Step 3:** Implement.  **Step 4:** Pass + typecheck + lint + build.
- [ ] **Step 5:** Commit `feat: game viewer with move navigation`.

### Task 9: Smoke run and milestone close  *(main session)*

- [ ] **Step 1:** `pnpm typecheck && pnpm lint && pnpm test` → all green.
- [ ] **Step 2:** Start `pnpm dev`; `curl 127.0.0.1:8787/api/health` → `{"ok":true}`; set a chess.com username via `PUT /api/settings` (a known public account), `POST /api/sync`, poll the job to `done`, `GET /api/games?limit=1` returns a game, `GET /api/games/<id>` returns moves. Load `http://localhost:5173/games` in a browser if available.
- [ ] **Step 3:** Clear the test username, update `docs/ROADMAP.md` (M1 → done, log line), commit `docs: close M1`.
