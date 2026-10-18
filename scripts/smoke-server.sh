#!/usr/bin/env bash
# Starts the app with a fresh temp DB on PORT (default 8788). Prints SMOKE_URL and SMOKE_PID.
set -euo pipefail

cd "$(dirname "$0")/.."
PORT="${PORT:-8788}"

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is already in use. Refusing to start." >&2
  exit 1
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/chess-smoke.XXXXXX")"
CHESS_DB_PATH="$TMP/chess.db" PORT="$PORT" node_modules/.bin/tsx server/main.ts >"$TMP/server.log" 2>&1 &
PID=$!

for _ in $(seq 1 100); do
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "Server exited early. Log:" >&2
    cat "$TMP/server.log" >&2
    rm -rf "$TMP"
    exit 1
  fi
  if curl -fs "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    echo "$TMP" >"${TMPDIR:-/tmp}/chess-smoke-$PID.dir"
    echo "SMOKE_URL=http://127.0.0.1:$PORT"
    echo "SMOKE_PID=$PID"
    exit 0
  fi
  sleep 0.2
done

echo "Server did not become healthy in time." >&2
kill "$PID" 2>/dev/null || true
rm -rf "$TMP"
exit 1
