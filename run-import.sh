#!/usr/bin/env bash
# Self-contained launcher for the direct TSDB import.
# Usage: ./run-import.sh
#
# Reads DATABASE_URL from .env (gitignored) or the environment.
# Format: postgresql://postgres.<PROJ>:<PASS>@<HOST>:5432/postgres
#
# History note: previous version had the DB password hardcoded — that
# credential is considered leaked, rotate in Supabase if you haven't already.

set -euo pipefail
IFS=$'\n\t'

cd "$(dirname "${BASH_SOURCE[0]}")"

# Load .env if present.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . .env
  set +a
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "✗ DATABASE_URL not set." >&2
  echo "  Add it to .env (gitignored), or export it before running." >&2
  echo "  Format: postgresql://postgres.<PROJ>:<PASS>@<HOST>:5432/postgres" >&2
  exit 1
fi

mkdir -p tsdb_export/logs
LOG="tsdb_export/logs/direct-import.log"
: > "$LOG"   # truncate

# caffeinate keeps macOS awake during long imports. No-op on Linux.
if command -v caffeinate >/dev/null 2>&1; then
  PREFIX=(caffeinate -i)
else
  PREFIX=()
fi

nohup "${PREFIX[@]}" env DATABASE_URL="$DATABASE_URL" \
  node tsdb-run-direct-import.js >"$LOG" 2>&1 &
PID=$!

echo "▶ Launched PID $PID — log: $LOG"
sleep 3

echo "--- log so far ---"
cat "$LOG"
echo "------------------"
echo "▶ Follow live: tail -f \"$(pwd)/$LOG\""
echo "▶ Stop:        kill $PID"
