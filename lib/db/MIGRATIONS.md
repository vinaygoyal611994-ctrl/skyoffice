# SkayOffice Database Migrations

## Overview

Migrations live in `lib/db/migrations/` and are tracked by Drizzle's journal at
`lib/db/migrations/meta/_journal.json`.  The authoritative tool is **drizzle-kit**.

| Directory | Purpose |
|---|---|
| `lib/db/migrations/` | **Authoritative** SQL files.  Do not edit or delete these. |
| `lib/db/migrations/meta/_journal.json` | Drizzle's ordered migration registry. Must be updated whenever a new file is added. |
| `lib/db/src/migrations/` | Legacy staging area — **deprecated**.  All files here have been copied into the authoritative directory.  New migrations must NOT go here. |
| `lib/db/src/schema/` | Drizzle schema source of truth (TypeScript). |

---

## Current migration sequence (34 entries)

| idx | Tag | Notes |
|-----|-----|-------|
| 0 | `0000_furry_shinko_yamashiro` | Initial schema |
| 1 | `0001_production_readiness_indexes` | |
| 2 | `0002_password_reset_tokens` | |
| 3 | `0003_provider_type` | PG16 NOT-NULL constraint fix applied 2026-08-17 |
| 4 | `0004_provider_location` | |
| 5 | `0005_freelancer_image_style` | |
| 6 | `0006_user_consent_columns` | |
| 7 | `0007_image_optimisation_variants` | |
| 8 | `0008_remove_assistant_tables` | |
| 9 | `0009_audit_phase1` | |
| 10 | `0010_service_requests` | |
| 11 | `0011_analytics` | |
| 12 | `0012_media_placement_and_status` | Adds `placement`, `status`, `rejection_reason` to `office_media`; adds pending-media columns to `offices` |
| 13 | `0021_gallery_sort_order` | Adds `sort_order` to `office_media` (requires 0012's `placement` column) |
| 14 | `0022_trust_metrics` | |
| 15 | `0023_analytics_dq` | |
| 16 | `0024_market_supply_control` | |
| 17 | `0025_market_supply_snapshots` | |
| 18 | `0026_supply_gate_columns` | |
| 19 | `0027_supply_cap` | |
| 20 | `0028_subscriptions` | |
| 21 | `0029_plans_commercial` | |
| 22 | `0030_supply_slots` | |
| 23 | `0031_slot_reservations` | |
| 24 | `0032_slot_notification_outbox` | |
| 25 | `0033_payment_foundation` | |
| 26 | `0034_payment_lock` | |
| 33 | `0041_works_media_ordering` | Adds a partial placement-local ordering index only; does not alter or reclassify media rows |

---

## Bootstrapping a fresh database

```bash
# From the repo root
cd lib/db

# Set DATABASE_URL to your target database
export DATABASE_URL="postgresql://user:pass@host:port/dbname"

pnpm drizzle-kit migrate
```

All 27 migrations are idempotent (guarded with `IF NOT EXISTS` / `IF EXISTS`).
The sequence is verified against a clean PostgreSQL 16 instance.

---

## Adding a new migration

1. Update `lib/db/src/schema/` with the schema change.
2. Generate the SQL:
   ```bash
   cd lib/db
   pnpm drizzle-kit generate
   ```
   This creates a new `.sql` file in `lib/db/migrations/` **and** appends an entry
   to `_journal.json` automatically.
3. Review the generated SQL for correctness and idempotency.
4. Commit both the `.sql` file and `_journal.json`.

> **Do not** place migration files in `lib/db/src/migrations/`.  That directory is
> deprecated.  All new migrations belong in `lib/db/migrations/`.

---

## Production database — `__drizzle_migrations` stamp

The production database was set up before the migration journal was fully
integrated.  As a result, its `__drizzle_migrations` table is missing 15 entries
(only 13 of the 27 migrations are recorded).

Run the SQL below **once** on the production database to bring the tracking table
in sync.  This script only touches `__drizzle_migrations` (pure metadata) — it
makes **no schema changes**.

```sql
-- ============================================================
-- SkayOffice — Production __drizzle_migrations stamp
-- Run once after deploying the migration integrity fix.
-- Safe to re-run: ON CONFLICT DO NOTHING guards against duplicates.
-- ============================================================

BEGIN;

-- 1. Fix the hash for migration 0003 (the PG16 NOT-NULL constraint
--    compatibility patch changed the file, so the hash differs from what
--    drizzle-kit recorded when it was first applied).
UPDATE __drizzle_migrations
   SET hash = '45df7f807484c8e70fd7d5b0f1ee239deb80bc42ea2c0ce56094c09bf57aeac0'
 WHERE tag  = '0003_provider_type'
   AND hash = 'c7af40f680160fc779933e2e26f6d4001b9739873316cce20f3c8ba75072105b';

-- 2. Stamp migrations that were applied manually but never recorded.
INSERT INTO __drizzle_migrations (hash, tag, created_at) VALUES
  ('6ce41b680fda38f4f7917606aa2f1da2c558aba1006bb68e5aa7abe23c2c7448', '0012_media_placement_and_status', 1752807240000),
  ('c8aa2175505cbe159d96f1f3ebafa96c9c4c1d7791718683166c989e83782fc1', '0022_trust_metrics',             1786836333944),
  ('b4998eb2c7ba58bffca0c0d61c15502d7ce011572c18f29354c3a8103412d763', '0023_analytics_dq',              1786836333945),
  ('a5134f2c2452bee670eee7d8b3aa05609493b351801cc3776c923c431b595a3e', '0024_market_supply_control',     1786836333950),
  ('4eebe7a454bbb6a019ba5e331457cb52bfbdf5cb65addd75191cddd6153e05d6', '0025_market_supply_snapshots',   1786836333960),
  ('93759577f32b593981e512fa43eb70ad083536f09563b24bf383cef77ed49d69', '0026_supply_gate_columns',       1786836333970),
  ('428b8600bd80a8c5e7ba2c9685f0922e8897b2dbe66ffcffabaa2b62221e6321', '0027_supply_cap',                1786836333980),
  ('794c17390ab5ceb0127064a4c46d016bd2b8c506df8bdfd10ef1485604e597da', '0028_subscriptions',             1786836333990),
  ('69e4296663abae0e41a5362168acf7f1912fb9ead9251ef88e7652e30939c3a6', '0029_plans_commercial',          1786840440000),
  ('fbe4495218c3a6904ac8c589b4fd7c82ddb1f65c00b16a36afdcbd8214b21438', '0030_supply_slots',              1786841280000),
  ('2d7bca49d0780ba80a71538df7bacc4bfd90c27c947dcd185a732efaa135e432', '0031_slot_reservations',         1786844880000),
  ('64b7bb2f2a2f485e21e5960cc8bb14eee51f8985bec21a806ccc83f337d50a08', '0032_slot_notification_outbox',  1786849380000),
  ('3eac0beeb96efbda7144723156ab24563a37b09174171181bf935b1961885511', '0033_payment_foundation',         1786852020000),
  ('2fb0aa188ae1972cfe74abe1714a2dc50d50f57a0d4699eb368dcdd782a3a1e8', '0034_payment_lock',              1786853460000)
ON CONFLICT (hash) DO NOTHING;

-- Verify: should return 27 rows after the stamp.
SELECT count(*) AS total_recorded FROM __drizzle_migrations;

COMMIT;
```

After running this, `drizzle-kit migrate` on the production database will correctly
recognise all existing migrations as already applied and only run new ones.

---

## Troubleshooting

### `drizzle-kit migrate` exits silently with code 1

Drizzle-kit v0.31 swallows some errors.  Run migrations via `psql` to get
verbatim PostgreSQL error output:

```bash
for sql in lib/db/migrations/*.sql; do
  psql "$DATABASE_URL" --set ON_ERROR_STOP=1 -f "$sql" || break
done
```

### Hash mismatch warning for migration 0003

If `drizzle-kit migrate` complains about a hash mismatch on `0003_provider_type`,
run the stamp SQL above (specifically the `UPDATE` in step 1).  The file was
patched to fix a PostgreSQL 16 NOT-NULL constraint compatibility issue — the
schema produced is identical, only the internal check was made more defensive.

### Missing `__drizzle_migrations` table

A completely fresh database will not have the tracking table.  `drizzle-kit migrate`
creates it automatically before applying the first migration — no manual step needed.

### Works visibility

Migration `0042_works_visibility.sql` adds the office-controlled Works visibility
flag. Existing offices with approved or pending Works are enabled automatically;
no media rows, IDs, URLs, or stored objects are changed.

### `lib/db/src/migrations/` has newer-looking files

This directory is **deprecated**.  All files in it were copied to `lib/db/migrations/`
as part of the 2026-08-17 migration integrity fix.  Do not add new files here.
