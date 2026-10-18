#!/usr/bin/env bash
# Starts the app with a fresh temp DB on PORT (default 8788). Prints SMOKE_URL and SMOKE_PID.
set -euo pipefail

cd "$(dirname "$0")/.."
PORT="${PORT:-8788}"
TMPBASE="${TMPDIR:-/tmp}"

if ! command -v lsof >/dev/null 2>&1; then
  echo "lsof is required but not found. Refusing to start." >&2
  exit 1
fi
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is already in use. Refusing to start." >&2
  exit 1
fi

TMP="$(mktemp -d "$TMPBASE/chess-smoke.XXXXXX")"
# node runs directly (no wrapper), so $! is the real server pid.
CHESS_DB_PATH="$TMP/chess.db" PORT="$PORT" node --import tsx server/main.ts >"$TMP/server.log" 2>&1 &
PID=$!

fail() {
  echo "$1" >&2
  kill "$PID" 2>/dev/null || true
  cat "$TMP/server.log" >&2 || true
  rm -rf "$TMP"
  exit 1
}

for _ in $(seq 1 150); do
  kill -0 "$PID" 2>/dev/null || fail "Server exited early."
  if curl -fs "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    if ! lsof -nP -a -p "$PID" -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
      fail "Health answered, but pid $PID does not own port $PORT."
    fi
    START="$(ps -p "$PID" -o lstart= | sed 's/^ *//;s/ *$//')"
    printf '%s\n%s\n' "$TMP" "$START" >"$TMPBASE/chess-smoke-$PID.dir"
    echo "SMOKE_URL=http://127.0.0.1:$PORT"
    echo "SMOKE_PID=$PID"
    exit 0
  fi
  sleep 0.2
done
fail "Server did not become healthy in time."
