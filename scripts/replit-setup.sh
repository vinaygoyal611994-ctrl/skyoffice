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

# DATABASE_URL is provided automatically by Replit's built-in PostgreSQL.
# If using an external DB (Neon etc.), add DATABASE_URL as a Replit Secret.
if [ -z "$DATABASE_URL" ]; then
  echo "⛔  DATABASE_URL is not set. Enable Replit's built-in PostgreSQL database"
  echo "   or add DATABASE_URL as a Replit Secret."
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. Write api-server/.env from Replit Secrets so --env-file=.env works
# ---------------------------------------------------------------------------
echo "▸ Writing api-server/.env from Replit Secrets..."
cat > "$(dirname "$0")/../artifacts/api-server/.env" <<EOF
DATABASE_URL=${DATABASE_URL}
SESSION_SECRET=${SESSION_SECRET}
PORT=8080
NODE_ENV=development
SEED_ADMIN_PASSWORD=${SEED_ADMIN_PASSWORD:-Admin@123456}
SEED_DEMO_PASSWORD=${SEED_DEMO_PASSWORD:-Demo@123456}
EOF
echo "  ✓ .env written"
echo ""

# ---------------------------------------------------------------------------
# 3. Install dependencies
# ---------------------------------------------------------------------------
echo "▸ Step 1/3 — Installing dependencies..."
pnpm install --no-frozen-lockfile --silent
echo "  ✓ Dependencies ready"
echo ""

# ---------------------------------------------------------------------------
# 4. Create/sync database schema (drizzle-kit push — safe for fresh DB)
# ---------------------------------------------------------------------------
echo "▸ Step 2/3 — Syncing database schema..."
DATABASE_URL="$DATABASE_URL" pnpm --filter @workspace/db run push --force
echo ""

# ---------------------------------------------------------------------------
# 5. Seed database (idempotent — skips rows that already exist)
# ---------------------------------------------------------------------------
echo "▸ Step 3/3 — Seeding database..."
DATABASE_URL="$DATABASE_URL" \
SEED_ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD:-Admin@123456}" \
SEED_DEMO_PASSWORD="${SEED_DEMO_PASSWORD:-Demo@123456}" \
pnpm --filter @workspace/api-server run seed:no-images
echo ""

echo "✅  Setup complete — starting servers..."
echo ""
