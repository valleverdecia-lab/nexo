#!/usr/bin/env bash
# Jarvis — arranque en macOS/Linux.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

PY=""
for c in python3 python; do
  if command -v "$c" >/dev/null 2>&1; then PY="$c"; break; fi
done
if [ -z "$PY" ]; then
  echo "No encuentro Python 3. Instálalo y vuelve a intentarlo." >&2
  exit 1
fi

PUERTO="${PUERTO:-8765}"
echo "Jarvis en http://127.0.0.1:$PUERTO"
( sleep 1
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "http://127.0.0.1:$PUERTO" >/dev/null 2>&1 &
  elif command -v open >/dev/null 2>&1; then open "http://127.0.0.1:$PUERTO" >/dev/null 2>&1 &
  fi ) &
exec "$PY" server.py --puerto "$PUERTO" "$@"
