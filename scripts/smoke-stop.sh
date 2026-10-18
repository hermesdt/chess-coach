#!/usr/bin/env bash
# Stops the smoke server with the given pid and removes only its temp dir.
set -euo pipefail

PID="${1:-}"
if ! [[ "$PID" =~ ^[0-9]+$ ]]; then
  echo "Usage: smoke-stop.sh <pid>" >&2
  exit 1
fi

TMPBASE="${TMPDIR:-/tmp}"
TMPROOT="$(cd "$TMPBASE" && pwd -P)"
MARKER="$TMPBASE/chess-smoke-$PID.dir"
if [ ! -f "$MARKER" ]; then
  echo "No smoke run recorded for pid $PID. Refusing to stop it." >&2
  exit 1
fi
{ read -r DIR; read -r START; } <"$MARKER"
REAL="$(cd "$DIR" 2>/dev/null && pwd -P || true)"
case "$REAL" in
  "$TMPROOT"/chess-smoke.*) ;;
  *) echo "Refusing: $DIR is not a chess-smoke dir under $TMPROOT." >&2; exit 1 ;;
esac

if kill -0 "$PID" 2>/dev/null; then
  CMD="$(ps -p "$PID" -o command= || true)"
  NOW="$(ps -p "$PID" -o lstart= | sed 's/^ *//;s/ *$//' || true)"
  if [[ "$CMD" != *server/main.ts* ]] || [ "$NOW" != "$START" ]; then
    echo "Pid $PID is not the recorded smoke server (command or start time differs). Not killing it." >&2
    rm -f "$MARKER"
    exit 1
  fi
  kill "$PID" 2>/dev/null || true
  for _ in $(seq 1 25); do
    kill -0 "$PID" 2>/dev/null || break
    sleep 0.2
  done
  if kill -0 "$PID" 2>/dev/null; then
    echo "Pid $PID ignored SIGTERM for 5 s. Sending SIGKILL." >&2
    kill -9 "$PID" 2>/dev/null || true
    sleep 0.3
  fi
  if kill -0 "$PID" 2>/dev/null; then
    echo "Pid $PID is still alive. Temp dir kept." >&2
    exit 1
  fi
else
  echo "Pid $PID is not running. Removing stale files only." >&2
fi
rm -rf "$REAL" "$MARKER"
echo "Stopped $PID and removed $REAL"
