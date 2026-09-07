# Production Data Safety & Backup Procedures

## Table of Contents
1. [Root Cause: Prior Production Data Loss](#1-root-cause-prior-production-data-loss)
2. [New Migration Workflow](#2-new-migration-workflow)
3. [Destructive-Change Safeguard](#3-destructive-change-safeguard)
4. [Dev / Production Isolation](#4-dev--production-isolation)
5. [Backup Status](#5-backup-status)
6. [Recovery Procedure](#6-recovery-procedure)

---

## 1. Root Cause: Prior Production Data Loss

### What happened
Every office-domain table (`offices`, `office_admin_notes`, `office_media`, `office_services`, `office_verification_documents`, `office_assistant_knowledge`, `office_assistant_settings`, `assistant_conversations`, `assistant_messages`, `assistant_analytics_events`, `favourites`, `contact_events`, `video_call_requests`) was dropped and recreated in the production database. Tables owned by the auth/infrastructure layer (`users`, `session`, `audit_log`) were unaffected.

### Root cause
**`drizzle-kit push`** was the mechanism. The `post-merge.sh` script that runs automatically after every task-agent merge contained:

```bash
pnpm --filter db push   # <-- this was the culprit
```

`drizzle-kit push` works by comparing the **currently loaded Drizzle schema files** against the live database and issuing DDL to make them match — including `DROP TABLE` and `DROP INDEX` for anything present in the database but absent from the schema. This is intentional behaviour for development, where it offers a fast "sync to current schema" workflow. It is catastrophic for production.

The specific failure mode: at some point during a task merge, the office-domain schema files were either temporarily absent, mis-imported in `lib/db/src/schema/index.ts`, or the schema was in a partially-committed state when `post-merge.sh` ran. Drizzle-kit saw those tables as "not in the schema" and dropped them. The `users`/`session`/`audit_log` tables were defined in separate files that happened to be correctly loaded — so they survived.

`lib/db/package.json` also previously had a `push-force` script:
```
"push-force": "drizzle-kit push --force"
```
This bypasses even Drizzle's own interactive confirmation prompt, making an accidental destructive push entirely silent. **This script has been removed.**

### Evidence trail
- All office-domain tables share a common parent: `lib/db/src/schema/offices.ts` (and `assistant.ts`, `contact.ts`, `favourites.ts`)
- The surviving tables (`users`, `session`, `audit_log`) are in separate files (`users.ts`, `session.ts`, `auditLog.ts`)
- If `offices.ts` or the other office-domain files were momentarily missing from `lib/db/src/schema/index.ts`, drizzle-kit push would see 0 rows for those tables in its schema diff, conclude they should not exist, and drop them

### Why this cannot happen again
See §2 and §3 below. `post-merge.sh` no longer calls `drizzle-kit push`. Schema changes now require an explicit SQL migration file that is reviewed before it is applied.

---

## 2. New Migration Workflow

### Overview
Schema changes are now managed through **versioned SQL migration files** stored in `lib/db/migrations/`. The migration runner (`scripts/src/migrate.ts`) applies only files that have not yet been applied, tracking state in a `__drizzle_migrations` table. It refuses to apply any file containing destructive DDL.

### `post-merge.sh` — before vs after

**Before (unsafe):**
```bash
pnpm install --frozen-lockfile
pnpm --filter db push       # could DROP tables
```

**After (safe):**
```bash
pnpm install --frozen-lockfile
pnpm --filter @workspace/scripts run migrate   # additive-only, safety-checked
```

### Developer workflow for schema changes

1. **Edit** the Drizzle schema (`lib/db/src/schema/*.ts`)
2. **Generate** a SQL migration file:
   ```bash
   pnpm --filter @workspace/db run generate
   ```
   This creates a new file in `lib/db/migrations/` (e.g. `0001_add_language_column.sql`).
3. **Review** the generated SQL. Verify it only adds, never drops.
4. **Commit** the migration file alongside the schema change.
5. The next `post-merge.sh` run (triggered automatically after the merge) applies the migration.

### For development only: schema push
The `push` script in `lib/db/package.json` is retained **for local development convenience only**:
```bash
pnpm --filter @workspace/db run push
```
**Never run this with a production `DATABASE_URL`.** It is intentionally excluded from `post-merge.sh` and from any deployment step.

### Migration file location
```
lib/db/
  migrations/
    meta/
      _journal.json          ← ordered migration list (committed)
      0000_snapshot.json     ← drizzle schema snapshot
    0000_furry_shinko_yamashiro.sql  ← baseline (all tables as of initial setup)
    0001_...sql              ← future migrations, one per schema change
  drizzle.config.ts          ← `out` points to migrations/
  src/schema/
    index.ts                 ← imports every schema file; MUST stay complete
```

### Baseline stamping
The initial migration (`0000_...`) represents the schema as it was when `drizzle-kit generate` was first run on this codebase. Because the database already contained all those tables (created via earlier pushes), the migration runner stamps this migration as applied **without executing it** the first time it runs on any given database. This prevents spurious "relation already exists" errors.

---

## 3. Destructive-Change Safeguard

The migration runner (`scripts/src/migrate.ts`) scans every pending migration's SQL content for the following patterns **before connecting to the database to apply anything**:

| Pattern | Reason blocked |
|---|---|
| `DROP TABLE` | Destroys a whole table and its data |
| `DROP SCHEMA` | Destroys all tables in a schema |
| `TRUNCATE` | Empties a table in place |
| `ALTER TABLE … DROP COLUMN` | Permanently removes a column's data |

If any match is found, the runner prints a clear error and **exits non-zero without touching the database**:

```
⛔ SAFETY CHECK FAILED — Migration "0002_remove_old_column" contains "ALTER TABLE … DROP COLUMN".
This migration could destroy production data. It will NOT be applied automatically.
Review the SQL carefully, then apply it manually and record it:
  psql $DATABASE_URL -f lib/db/migrations/0002_remove_old_column.sql
  pnpm --filter scripts run stamp -- "0002_remove_old_column"
```

### Intentional destructive migrations
When a destructive change is genuinely needed (e.g. dropping a deprecated column after a safe multi-phase migration):
1. Generate the migration normally (`drizzle-kit generate`)
2. Get a second set of eyes on the SQL
3. **Apply it manually** to the target database
4. **Stamp it** so the runner does not try to re-apply it:
   ```bash
   DATABASE_URL=<production-url> pnpm --filter scripts run stamp -- "<tag>"
   ```

Note: `DROP INDEX`, `CREATE INDEX`, `CREATE UNIQUE INDEX`, and constraint additions are not blocked — these are considered safe structural changes.

---

## 4. Dev / Production Isolation

### Platform isolation — how Replit separates databases

Replit provisions **two entirely separate PostgreSQL databases**:

| Environment | `DATABASE_URL` source | Database |
|---|---|---|
| Dev workspace | Replit workspace secrets (development scope) | Replit-managed dev PostgreSQL |
| Production deployment | Replit deployment secrets (production scope) | Replit-managed production PostgreSQL |

These are different database instances on different infrastructure. A `DATABASE_URL` from the workspace **cannot** connect to the production database, and vice versa. Replit injects the correct `DATABASE_URL` automatically in each environment.

### Evidence of separation
The `.replit` file uses `[userenv.shared]` only for non-sensitive frontend config (`VITE_PUBLIC_APP_URL`). `DATABASE_URL` is never listed in `[userenv.shared]` — it is managed entirely by Replit's database provisioning. Running `pnpm --filter @workspace/scripts run migrate` in the workspace targets the **dev database only**.

### Seed script — cannot target production
`artifacts/api-server/src/scripts/seed.ts` connects through the standard `@workspace/db` client which reads `DATABASE_URL` from the environment. When run in the workspace it targets the dev database. It has no hard-coded production credentials and no special flag to target production. To run it against production would require explicitly setting `DATABASE_URL` to the production connection string, which requires deliberate human action (not something post-merge.sh does).

### Preventing accidental production push
- `push` and `push-force` are not called anywhere in `post-merge.sh` or any deployment pipeline
- `push-force` has been removed from `lib/db/package.json` entirely
- `post-merge.sh` only calls the safe migration runner, which targets whatever `DATABASE_URL` is in the environment at run time (dev during post-merge)
- Production schema changes must be applied manually using the procedure in §6 or via a production-targeted script with deliberate `DATABASE_URL` configuration

---

## 5. Backup Status

### Production database (PostgreSQL)

Replit Autoscale deployments use Replit's managed PostgreSQL. Replit performs **automatic daily backups** with a **7-day retention window** for production databases provisioned through the platform. These backups are managed by Replit infrastructure and are not configurable from the application layer.

- **Frequency**: Daily (platform-managed)
- **Retention**: 7 days
- **Last successful backup**: Not directly visible from the application; contact Replit support to confirm backup health or to initiate a restore
- **Restore access**: Replit support can restore to any daily backup point within the 7-day window on request

> ⚠️ **Gap**: There is no application-level custom backup configured beyond the platform default. For a production pilot where office data is being onboarded, consider requesting a pre-pilot manual snapshot from Replit support before onboarding real offices, so a known-good restore point exists even if the daily window hasn't captured it yet.

### Dev workspace database

The dev database is covered by Replit's workspace checkpoint system (triggered on code changes). This is not a PostgreSQL-level backup — it is a workspace state snapshot. Dev data loss is expected and acceptable; the seed script can restore the demo dataset at any time:

```bash
pnpm --filter @workspace/api-server run seed
```

### Object storage (office media and documents)

Office logos, cover images, gallery images, verification documents, and marketing videos are stored in Replit Object Storage (`DEFAULT_OBJECT_STORAGE_BUCKET_ID`).

> ⚠️ **Gap**: Replit Object Storage does **not** have built-in versioning or automatic backup. If a file is deleted (by the application or an operator), it cannot be recovered from a Replit-managed backup. The database holds the `objectPath` references; if a path is referenced in the database but the object is missing in storage, the frontend will show a broken image or a failed document download.

**Mitigation options** (not yet implemented — see §6 gap callout):
- Periodic export of all object storage contents to a separate bucket or external storage (e.g. AWS S3, Cloudflare R2) via a scheduled script
- Soft-delete convention: mark objects as deleted in the database but do not delete them from storage, with a deferred cleanup job

---

## 6. Recovery Procedure

This procedure describes how to restore office data if the tables are dropped again despite the safeguards above. It assumes Replit production PostgreSQL backups are available (7-day window).

### Step 1 — Confirm the scope of loss
```sql
-- Run against the affected database:
SELECT table_name, pg_size_pretty(pg_total_relation_size(quote_ident(table_name))) AS size
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```
Note which tables are missing or empty.

### Step 2 — Stop write traffic immediately
In the Replit dashboard, pause or redeploy the API server with a maintenance-mode build so no new writes land on the partially-empty database during recovery. A simple approach: set an env var `MAINTENANCE_MODE=true` and return 503 from all mutating routes, then redeploy.

### Step 3 — Request a point-in-time restore from Replit support
Contact Replit support (support@replit.com or the in-product help channel) and provide:
- The repl/project name
- The approximate timestamp when data loss occurred
- The list of affected tables
- A request to restore to the daily backup **before** the incident

Replit can restore the entire database to a prior daily snapshot. This will overwrite **all** tables, including any new data written after the incident — which is why stopping write traffic (Step 2) is critical.

### Step 4 — Apply migrations on the restored database
After a point-in-time restore, the `__drizzle_migrations` tracking table may be missing or stale. Run the migration runner to re-apply any schema changes that occurred after the backup point:
```bash
DATABASE_URL=<production-url> pnpm --filter @workspace/scripts run migrate
```

The migration runner's stamping logic handles the case where the tracking table was restored from backup (it won't re-apply already-applied migrations, and it blocks destructive ones).

### Step 5 — Verify data integrity
```sql
-- Sanity check: row counts should match expectations
SELECT 'offices' AS tbl, COUNT(*) FROM offices
UNION ALL SELECT 'users', COUNT(*) FROM users
UNION ALL SELECT 'office_media', COUNT(*) FROM office_media
UNION ALL SELECT 'office_verification_documents', COUNT(*) FROM office_verification_documents;
```

Cross-reference with the admin dashboard's office count and any pre-incident backups or exports.

### Step 6 — Re-seed demo data if needed
If demo offices are missing after a restore (the restored snapshot may pre-date their creation):
```bash
pnpm --filter @workspace/api-server run seed
```
The seed script is idempotent — it skips creation if the demo accounts already exist.

### Step 7 — Resume traffic
Remove the maintenance mode env var and redeploy to restore normal operation.

---

### Object storage recovery (if files are missing)

There is currently **no automated recovery path for object storage**. If office media files are deleted:

1. Check if the office still has the file on their local device (logo, documents) — ask them to re-upload
2. For verification documents that were already reviewed and approved: the admin panel shows document status but cannot recover the file itself. A new upload flow would be required
3. For marketing videos (large files): re-upload required

**Recommended action before pilot**: export a one-time snapshot of all objects in the production storage bucket to a separate safe location. This can be done via the Replit Object Storage API or CLI:
```bash
# Pseudocode — adapt to actual bucket API
for each objectPath in SELECT object_path FROM office_verification_documents:
    download objectPath → backup-location/
for each logoUrl in SELECT logo_url FROM offices WHERE logo_url IS NOT NULL:
    download logoUrl → backup-location/
```

---

*Document written: 2026-07-15. Review and update after each significant infrastructure change.*
