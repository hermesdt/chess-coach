# Chess Coach

Chess Coach is a local web app for chess improvement.
It is for beginner players.

- It syncs your games from chess.com and lichess.
- It analyses each game with Stockfish.
- It explains your games with an AI coach (optional).
- It trains openings, your own mistakes, and basic principles.
- It uses spaced repetition (FSRS) for training.
- It shows insights about your games over time.

All moves and evaluations come from Stockfish, chess.js, or validated files in `content/`.
The AI never invents moves, lines, or evaluations.

## Status

Milestones M1 to M6 are done. M7 adds the insights page and this README.
See `docs/ROADMAP.md` for the status of each milestone.

## Requirements

- Node.js 26 (tested version). The app uses the built-in `node:sqlite` module.
- pnpm 10.
- Stockfish installed on your computer (for example, `brew install stockfish`).
- At least one AI provider, only if you want the AI coach. See [AI coach setup](#ai-coach-setup).

## Setup

1. Install the dependencies: `pnpm install`.
2. Copy `.env.example` to `.env`.
3. Set `CHESSCOM_USERNAME` and/or `LICHESS_USERNAME` in `.env`.
4. Set `LICHESS_TOKEN` to sync lichess games. See [Lichess token](#lichess-token).
5. Set `STOCKFISH_PATH` only if Stockfish is not on your `PATH`.
6. Start the app: `pnpm dev`.

You can also enter the usernames, the token, and the API keys on the Settings page.
A value saved on the Settings page wins. An empty field uses the value from `.env`.

The server listens on `http://127.0.0.1:8787` only.
It does not accept connections from other computers.
The app keeps its data in `data/chess.db`.

## Environment keys

The app reads these keys from `.env`. All keys are optional.

| Key | Purpose |
|-----|---------|
| `CHESSCOM_USERNAME` | Your chess.com username. |
| `LICHESS_USERNAME` | Your lichess username. |
| `LICHESS_TOKEN` | Your personal lichess token. See [Lichess token](#lichess-token). |
| `STOCKFISH_PATH` | The path to the Stockfish program. Default: `stockfish` on your `PATH`. |
| `ANTHROPIC_API_KEY` | API key for the `anthropic-api` provider. |
| `OPENROUTER_API_KEY` | API key for the `openrouter` provider. |
| `PORT` | The port of the server. Default: `8787`. |
| `CHESS_DB_PATH` | The path of the database file. Default: `data/chess.db`. |
| `BACKUP_DIR` | The folder for database backups. See [Data and backups](#data-and-backups). |
| `ENGINE_NODES` | The Stockfish node budget per position. Default: `400000`. Allowed: 10000 to 5000000. |

## Lichess token

Lichess does not export your games without a token.
Without a token, the lichess sync stops and asks for one.

1. Sign in to lichess.org.
2. Open `https://lichess.org/account/oauth/token`.
   You can also go to your account preferences and open "API access tokens".
3. Create a personal access token. The app needs no scopes for this.
4. Copy the token into `LICHESS_TOKEN` in `.env`, or into the lichess token field on the Settings page.

Keep the token secret. `.env` is in `.gitignore`. Do not commit it.

## AI coach setup

The AI coach is optional. The rest of the app works without it.

| Provider | What you need |
|----------|---------------|
| `claude-cli` | The `claude` command on your `PATH`. Sign in with Claude's own sign-in flow. |
| `codex-cli` | The `codex` command on your `PATH`. Sign in with Codex's own sign-in flow. |
| `opencode-cli` | The `opencode` command on your `PATH`. Sign in with opencode's own sign-in flow. |
| `openrouter` | An OpenRouter API key in `OPENROUTER_API_KEY`, or on the Settings page. |
| `anthropic-api` | An Anthropic API key in `ANTHROPIC_API_KEY`, or on the Settings page. |

The CLI providers use your own subscription login.
The app removes `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` from the environment of the CLI runs.
So a stored API key does not replace your subscription login.

In the AI coach section of Settings, choose a provider or `auto`.
With `auto`, the app tries the providers in this order: `claude-cli`, `codex-cli`, `anthropic-api`, `openrouter`, `opencode-cli`.
Use the test button of each provider to check it.
You can set a model for each provider. An empty model uses the default model of that provider.

## Commands

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Start the server and the web app in watch mode. |
| `pnpm build` | Build the web app into `dist/`. |
| `pnpm start` | Start the server. It serves `dist/` when that folder exists. |
| `pnpm test` | Run the tests. |
| `pnpm typecheck` | Check the TypeScript types. |
| `pnpm lint` | Run ESLint. |
| `pnpm validate:content` | Validate the repertoire files in `content/`. |
| `pnpm smoke:start` | Start a test copy with a temporary database on port 8788. It prints the URL and the process ID. |
| `pnpm smoke:stop <pid>` | Stop the test copy that `pnpm smoke:start` started. |

## Production-style run

Build the web app, then start the server:

```sh
pnpm build
pnpm start
```

`pnpm start` serves the built web app from `dist/` when that folder exists.
Run `pnpm build` again after you change the web app.
Open `http://127.0.0.1:8787`. Change the port with `PORT` in `.env`.

## Data and backups

The app keeps its data in `data/chess.db`. The file holds your games, analysis, and training cards.

- For the default database path, the app copies the database to `data/backups/chess-YYYY-MM-DD.db`.
  It makes a copy when it starts and then once every 24 hours. It keeps the newest 7 copies.
- To back up by hand, stop the app and copy `data/chess.db` to a safe place.
- Set `BACKUP_DIR` to back up a database at another path.
- The Data section of the Settings page shows the database path and the backup folder.

## Content validation

The files in `content/` hold the repertoires and the lessons.
Run `pnpm validate:content` after you change a file.
The command prints `content OK` when the files pass.

## Settings page

- Accounts: the chess.com username, the lichess username, and the lichess token.
- AI coach: the provider, the models, and the API keys.
- Engine and review: the Stockfish node budget and the daily review limits.
- Reported problems: the cards you flagged.
- Data: the database path, the counts of games and cards, and the backup folder.

## License

MIT. See `LICENSE`.
