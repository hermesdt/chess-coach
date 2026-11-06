# Chess Coach

Local web app that helps the owner (chess.com ~550) improve: syncs games from
chess.com and lichess, analyses them with Stockfish, explains them with Claude,
and trains openings (Caro-Kann as Black, London as White), own mistakes, and
beginner principles with spaced repetition.

- Design: `docs/superpowers/specs/2026-10-18-chess-coach-design.md`
- Status and next steps: `docs/ROADMAP.md` (always read first; update it when a
  milestone changes state)
- Plans: `docs/superpowers/plans/`

## Rules

- The AI never invents moves, lines, or evaluations. Moves come from
  Stockfish, chess.js, or validated `content/` files.
- Content in `content/` must pass `pnpm validate:content`.
- Tests never hit the network; use recorded fixtures in `server/**/__fixtures__/`.
- Commands: `pnpm dev`, `pnpm test`, `pnpm typecheck`, `pnpm lint`.
- Server binds to 127.0.0.1 only. Secrets live in `.env` (gitignored).

## Safety

Never delete or overwrite `data/chess.db` or stop a process you did not start.
Manual and smoke runs use `pnpm smoke:start` (temp DB, port 8788) and
`pnpm smoke:stop <pid>`. Backups live in `data/backups/`.

Before you check out a branch that changes start-up code, take a backup first.
The owner's dev server (`tsx watch`) restarts on a file change. Start-up syncs
then write to `data/chess.db`. Use `sqlite3 data/chess.db ".backup <file>"`.
A plain `cp` misses the WAL file.
