#!/bin/bash
# Post-merge setup: runs automatically after each task-agent merge.
#
# IMPORTANT — migration safety:
#   This script uses a custom safe migration runner (scripts/src/migrate.ts)
#   instead of `drizzle-kit push`. The difference matters:
#
#   drizzle-kit push  — compares the live schema against the current Drizzle
#                       schema files and synchronises them, which CAN DROP
#                       tables/columns that no longer appear in the schema
#                       files. This caused the prior production data-loss
#                       incident (office-domain tables were dropped when a
#                       schema file was missing from index.ts during a push).
#
#   scripts/migrate   — applies only the SQL files in lib/db/migrations/ that
#                       have not yet been applied, and REFUSES to apply any
#                       migration containing DROP TABLE, DROP SCHEMA, TRUNCATE,
#                       or ALTER TABLE … DROP COLUMN without explicit manual
#                       approval. Additive changes (new tables, new columns,
#                       new indexes) proceed automatically.
#
# To add a new schema change:
#   1. Edit lib/db/src/schema/*.ts
#   2. Run:  pnpm --filter @workspace/db run generate
#   3. Review the generated SQL in lib/db/migrations/
#   4. Commit the migration file alongside the schema change
#   The next post-merge run will apply it automatically.
set -e
pnpm install --frozen-lockfile
pnpm --filter @workspace/scripts run migrate
