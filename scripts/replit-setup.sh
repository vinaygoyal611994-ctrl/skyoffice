#!/bin/bash
# Replit auto-setup: installs deps, runs migrations, seeds DB.
# Safe to run on every startup — migrations and seed are fully idempotent.
set -e

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║        SkayOffice — Replit Setup         ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ---------------------------------------------------------------------------
# 1. Validate required secrets
# ---------------------------------------------------------------------------
MISSING=""
[ -z "$DATABASE_URL" ]   && MISSING="${MISSING}\n  • DATABASE_URL   — Neon PostgreSQL connection string"
[ -z "$SESSION_SECRET" ] && MISSING="${MISSING}\n  • SESSION_SECRET — any random string (32+ chars)"

if [ -n "$MISSING" ]; then
  echo "⛔  Missing required Replit Secrets:"
  printf "%b\n" "$MISSING"
  echo ""
  echo "   How to add: open the Secrets tab (lock icon, left sidebar)"
  echo "   then click  '+ New Secret'  for each entry above."
  echo ""
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. Install dependencies
# ---------------------------------------------------------------------------
echo "▸ Step 1/3 — Installing dependencies..."
pnpm install --no-frozen-lockfile --silent
echo "  ✓ Dependencies ready"
echo ""

# ---------------------------------------------------------------------------
# 3. Run database migrations (idempotent)
# ---------------------------------------------------------------------------
echo "▸ Step 2/3 — Running database migrations..."
DATABASE_URL="$DATABASE_URL" pnpm --filter @workspace/scripts run migrate
echo ""

# ---------------------------------------------------------------------------
# 4. Seed database (idempotent — skips rows that already exist)
# ---------------------------------------------------------------------------
echo "▸ Step 3/3 — Seeding database..."
DATABASE_URL="$DATABASE_URL" \
SEED_ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD:-Admin@123456}" \
SEED_DEMO_PASSWORD="${SEED_DEMO_PASSWORD:-Demo@123456}" \
pnpm --filter @workspace/api-server run seed:no-images
echo ""

echo "✅  Setup complete — starting servers..."
echo ""
