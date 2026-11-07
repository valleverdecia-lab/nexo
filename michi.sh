#!/usr/bin/env bash
# Michi — arranque local del backend + frontend ya compilados.
#
# El código vive en ./michi (clon de https://github.com/michiworks/Michi, ignorado por git).
# Reinstalar desde cero:
#   git clone --depth 1 https://github.com/michiworks/Michi.git michi && rm -rf michi/.git
#   cd michi && npm install --workspace backend --workspace shared --workspace runtime \
#     --workspace frontend --include-workspace-root=false --no-audit --no-fund
#   npm run build
#
# Uso:  ./michi.sh            # http://localhost:3000
#       PORT=3000 ./michi.sh
#
# Variables de entorno:
#   PORT                  puerto (por defecto 3000)
#   MICHI_EXTRA_HOSTS     host names extra permitidos, separados por coma
#   MICHI_EXTRA_ORIGINS   orígenes extra permitidos, separados por coma
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$ROOT/michi"
PORT="${PORT:-3000}"

[ -d "$APP/backend/dist" ] || { echo "Falta $APP/backend/dist — compila primero: cd michi && npm run build" >&2; exit 1; }

# El backend se niega a servir un Host/Origin que no conozca (protección contra
# DNS rebinding), así que además de loopback hay que declarar el host público
# del preview. Se añaden los que vengan en el entorno.
SANDBOX_ID="${E2B_SANDBOX_ID:-}"
HOSTS=""
ORIGINS=""
if [ -n "$SANDBOX_ID" ]; then
  HOSTS="$PORT-$SANDBOX_ID.e2b.app"
  ORIGINS="https://$PORT-$SANDBOX_ID.e2b.app"
fi
[ -n "${MICHI_EXTRA_HOSTS:-}" ] && HOSTS="${HOSTS:+$HOSTS,}$MICHI_EXTRA_HOSTS"
[ -n "${MICHI_EXTRA_ORIGINS:-}" ] && ORIGINS="${ORIGINS:+$ORIGINS,}$MICHI_EXTRA_ORIGINS"

export PORT
export MICHI_BIND_HOST="${MICHI_BIND_HOST:-0.0.0.0}"
export MICHI_ALLOWED_HOSTS="$HOSTS"
export MICHI_CORS_ORIGINS="$ORIGINS"
export MICHI_DATA_DIR="${MICHI_DATA_DIR:-$APP/.michi-data}"
export MICHI_CONFIG_DIR="${MICHI_CONFIG_DIR:-$MICHI_DATA_DIR}"

echo "Michi -> http://localhost:$PORT   (hosts: ${HOSTS:-loopback})"
exec node "$APP/backend/dist/server.js"
