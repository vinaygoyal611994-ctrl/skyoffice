---
name: Migration integrity fix
description: Root causes found and fixed in the migration journal integrity pass (2026-08-17)
---

## What was broken

- `lib/db/migrations/` (authoritative, per `drizzle.config.ts`) was missing 7 migration files.
- `_journal.json` had only 20 entries (idx 0–19); 7 files were in the deprecated `lib/db/src/migrations/` with no journal registration.
- `__drizzle_migrations` in production had only 13 rows — stopped at `0021_gallery_sort_order` — even though the DB had all 38 app tables (migrations 0022–0034 applied manually without being recorded).
- Migration `0003_provider_type` had a PG16 bug: its DO block queried `information_schema.check_constraints` for `LIKE '%category%'` and picked up a `NOT NULL` pseudo-constraint (`2200_xxx_not_null`) instead of the real value CHECK constraint. PG16 exposes NOT NULL constraints as CHECK rows in information_schema; the DO block then tried `ALTER TABLE DROP CONSTRAINT` on the NOT NULL constraint, which fails.
- Fresh-DB bootstrap was broken: `0021_gallery_sort_order` references the `placement` column added by `0012_media_placement_and_status`, which was never in the canonical directory.

## What was fixed

1. Copied 7 SQL files into `lib/db/migrations/`:
   - `0012_media_placement_and_status.sql` (from src/migrations/0020)
   - `0029_plans_commercial.sql` through `0034_payment_lock.sql`
2. Rewrote `_journal.json` to 27 entries (inserted idx 12 for 0012, shifted 0021–0028 to idx 13–20, added 0029–0034 as idx 21–26).
3. Fixed `0003_provider_type.sql` DO block: added `AND cc.check_clause NOT LIKE '%IS NOT NULL%'` filter plus an EXCEPTION handler.
4. Stamped production `__drizzle_migrations` with all 27 entries (UPDATE for 0003 hash, INSERT for missing 14). Production now has 27 rows.
5. Created `lib/db/MIGRATIONS.md` runbook (bootstrap guide, adding new migrations, stamp SQL, troubleshooting).

## Key rules going forward

**Why:** `lib/db/src/migrations/` was used as a staging area but was never wired to drizzle's journal, causing silent drift.

**How to apply:** ALL new migrations go in `lib/db/migrations/` via `drizzle-kit generate`. Never touch `src/migrations/`.

The stamp SQL is in `lib/db/MIGRATIONS.md` — safe to re-run (idempotent).

## Known pre-existing issue (do not chase)

`paymentFoundation.test.ts > nextBillingMonth` fails when run near midnight (diffDays ~14.96 vs threshold 15). Not introduced by this fix.
