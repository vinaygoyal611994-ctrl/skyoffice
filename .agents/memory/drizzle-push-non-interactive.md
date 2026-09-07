---
name: drizzle-kit push in this project's live environment
description: drizzle-kit push cannot run non-interactively here and threatens unrelated tables; use raw SQL for additive schema changes instead.
---

`drizzle-kit push` requires a TTY prompt for confirmation and cannot run non-interactively in this environment. It also proposed dropping the `session` table (used by `connect-pg-simple` for auth sessions), which exists in the live Postgres DB but is intentionally not modeled in the Drizzle schema.

**Why:** Blindly running `drizzle-kit push` (or forcing it non-interactively) risks dropping tables that are real and in use but simply outside the Drizzle schema's knowledge.

**How to apply:** For additive schema changes (new columns, new tables) in this kind of setup, apply them directly via raw SQL (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`) through a Node `pg` client, matching the Drizzle schema definitions exactly, instead of running `drizzle-kit push`. Verify columns/tables afterward with a direct query.
