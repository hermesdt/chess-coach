# Chess Coach

Chess Coach is a local web app for chess improvement.
It is for beginner players.

- It syncs your games from chess.com and lichess.
- It analyses each game with Stockfish.
- It trains openings, your own mistakes, and basic principles.
- It uses spaced repetition (FSRS) for training.

All moves and evaluations come from Stockfish, chess.js, or validated files in `content/`.

## Status

The app is in development. See `docs/ROADMAP.md` for the status of each milestone.
The AI coach (M5) is not available yet.

## Requirements

- Node.js 26 (tested version). The app uses the built-in `node:sqlite` module.
- pnpm 10.
- Stockfish installed on your computer (for example, `brew install stockfish`).

## Setup

1. Install the dependencies: `pnpm install`.
2. Copy `.env.example` to `.env`.
3. Set `CHESSCOM_USERNAME` and/or `LICHESS_USERNAME` in `.env`.
4. Set `LICHESS_TOKEN` to sync lichess games. Lichess requires a personal token for the export.
5. Set `STOCKFISH_PATH` if Stockfish is not on your `PATH`.
6. Start the app: `pnpm dev`.

The server listens on `http://127.0.0.1:8787` only.
The app keeps its data in `data/chess.db`.

## Commands

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Start the server and the web app in watch mode. |
| `pnpm test` | Run the tests. |
| `pnpm typecheck` | Check the TypeScript types. |
| `pnpm lint` | Run ESLint. |
| `pnpm validate:content` | Validate the repertoire files in `content/`. |

## License

MIT. See `LICENSE`.
