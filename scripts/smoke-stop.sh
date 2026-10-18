#!/usr/bin/env bash
# Stops the smoke server with the given pid and removes only its temp dir.
set -euo pipefail

PID="${1:-}"
if ! [[ "$PID" =~ ^[0-9]+$ ]]; then
  echo "Usage: smoke-stop.sh <pid>" >&2
  exit 1
fi

TMPROOT="$(cd "${TMPDIR:-/tmp}" && pwd -P)"
MARKER="${TMPDIR:-/tmp}/chess-smoke-$PID.dir"
if [ ! -f "$MARKER" ]; then
  echo "No smoke run recorded for pid $PID. Refusing to stop it." >&2
  exit 1
fi
DIR="$(cat "$MARKER")"
REAL="$(cd "$DIR" 2>/dev/null && pwd -P || true)"
case "$REAL" in
  "$TMPROOT"/chess-smoke.*) ;;
  *) echo "Refusing: $DIR is not a chess-smoke dir under $TMPROOT." >&2; exit 1 ;;
esac

kill "$PID" 2>/dev/null || true
for _ in $(seq 1 25); do
  kill -0 "$PID" 2>/dev/null || break
  sleep 0.2
done
rm -rf "$REAL" "$MARKER"
echo "Stopped $PID and removed $REAL"
