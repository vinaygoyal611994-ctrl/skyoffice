#!/bin/bash
# Start API server + Vite frontend in parallel.
# Called after replit-setup.sh completes successfully.
set -e

# API server runs on a fixed internal port (8080).
# Frontend Vite dev server runs on Replit's assigned PORT (default 5000).
API_PORT="${API_PORT:-8080}"
FRONTEND_PORT="${PORT:-5000}"

echo "▸ Starting API server on port $API_PORT..."
(
  cd "$(dirname "$0")/../artifacts/api-server"
  PORT="$API_PORT" \
  DATABASE_URL="$DATABASE_URL" \
  SESSION_SECRET="$SESSION_SECRET" \
  NODE_ENV="${NODE_ENV:-development}" \
  pnpm run dev
) &

# Give the API server a few seconds to boot before the frontend proxy needs it.
sleep 3

echo "▸ Starting frontend on port $FRONTEND_PORT..."
(
  cd "$(dirname "$0")/../artifacts/skayoffice-pilot"
  PORT="$FRONTEND_PORT" \
  BASE_PATH="/" \
  API_TARGET="http://localhost:$API_PORT" \
  pnpm run dev
)
