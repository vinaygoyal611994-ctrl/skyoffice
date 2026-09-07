# SkayOffice — Disaster Recovery Runbook

> **Last verified:** 2026-07-20
> **Owner:** Platform / Engineering
> **Applies to:** Production at `https://skayoffice-pilot.replit.app`

---

## Backup architecture

SkayOffice uses a two-tier backup strategy.

| Tier | Mechanism | Schedule | Retention | Storage location | Off-platform? |
|------|-----------|----------|-----------|-----------------|--------------|
| **Primary** | Neon point-in-time restore (PITR) | Continuous WAL streaming | 7 days (Core) / 28 days (Pro/Teams) | Neon managed infrastructure | Yes — independent of the application runtime |
| **Secondary** | pg_dump → gzip → GCS (Replit Object Storage) | Daily, ~5 min after server start | 30 days (files retained; oldest pruned automatically) | GCS bucket `DEFAULT_OBJECT_STORAGE_BUCKET_ID` under `backups/` prefix | Partially — same Replit account, separate storage service |

### Recovery Point Objective (RPO)

| Scenario | RPO |
|---------|-----|
| Primary tier (PITR) | Seconds to low minutes (WAL-based, near-continuous) |
| Secondary tier (pg_dump) | Up to 24 hours (daily backup cadence) |
| Both tiers unavailable | Up to last secondary backup before both were lost |

### Recovery Time Objective (RTO)

| Scenario | Estimated RTO |
|---------|--------------|
| PITR restore via Replit dashboard | 5–30 minutes (depends on restore window and Neon response time) |
| Restore from secondary pg_dump backup | 15–60 minutes (download, decompress, psql restore, verify) |
| Full rebuild from scratch (schema + seed) | 2–4 hours |

---

## Incident decision tree

```
Database is unavailable or data is missing
       │
       ├─► Is data corruption/deletion recent (< 7 days)?
       │        YES → Use PITR (Procedure A)  ← fastest, most granular
       │        NO  → Use secondary pg_dump backup (Procedure B)
       │
       └─► Is the Replit platform itself unreachable?
                YES → Contact Replit support; prepare to restore from
                      secondary backup to a new provider using Procedure B
                NO  → Start with Procedure A
```

---

## Procedure A — Restore from Neon PITR (primary tier)

> Use this for accidental data deletion, corruption, or any incident where the precise recovery point matters and occurred within the PITR retention window.

### Prerequisites
- Replit account owner or team admin access
- Target recovery timestamp (UTC)

### Steps

1. Open the **Replit workspace** for this project.
2. Go to the **Database** tab in the left sidebar.
3. Click **"Data Recovery"** (or navigate to the Data Recovery section within the database panel).
4. Select the target database (production).
5. Choose **"Point-in-time restore"** and enter the recovery timestamp (UTC).
6. Replit / Neon will fork the database to the specified point in time and provide a new connection string.
7. Update the `DATABASE_URL` secret in the Replit project to point to the restored database.
8. Restart the production deployment to pick up the new connection string.
9. Run the smoke test (see Verification below) to confirm the application is healthy.

> **Note:** PITR creates a new database branch. The old (corrupted/lost) database is not deleted automatically. Delete it once the restore is confirmed.

### Reference
https://docs.replit.com/features/data-and-storage/data-recovery

---

## Procedure B — Restore from secondary pg_dump backup

> Use this when: the PITR window has been exceeded, the Neon service is unavailable, the Replit account has billing issues, or as a validation exercise.

### Prerequisites
- Access to the GCS bucket: `DEFAULT_OBJECT_STORAGE_BUCKET_ID` environment secret
- A target PostgreSQL instance (existing Replit DB, or a new standalone Postgres)
- `pg_restore` or `psql` available locally (PostgreSQL 16 client tools)
- `gzip`/`gunzip` available

### Step 1 — List available backups

Backup files follow the naming pattern:
```
backups/skayoffice-YYYYMMDD_HHmmss.sql.gz
```

To list them, use the Replit Object Storage browser (App Storage pane in the workspace) or the GCS console for the project's bucket. Files are sorted lexicographically — the last entry is the most recent.

### Step 2 — Download the target backup

From the Replit workspace shell:
```bash
# Find the backup you want (most recent example):
gsutil ls gs://$DEFAULT_OBJECT_STORAGE_BUCKET_ID/backups/ | tail -5

# Download it:
gsutil cp gs://$DEFAULT_OBJECT_STORAGE_BUCKET_ID/backups/skayoffice-YYYYMMDD_HHmmss.sql.gz .
```

Or download it from the Replit Object Storage pane directly.

### Step 3 — Decompress and inspect

```bash
gunzip -k skayoffice-YYYYMMDD_HHmmss.sql.gz
head -50 skayoffice-YYYYMMDD_HHmmss.sql   # confirm it's a valid SQL dump
```

A valid dump starts with:
```sql
--
-- PostgreSQL database dump
--
-- Dumped from database version 16.x
```

### Step 4 — Restore to target database

```bash
# Restore to the target Postgres instance via DATABASE_URL:
psql "$DATABASE_URL" < skayoffice-YYYYMMDD_HHmmss.sql
```

If restoring to a fresh database (no existing schema):
```bash
# Create a new database first, then restore:
createdb -U postgres skayoffice_restored
psql "postgresql://postgres@localhost/skayoffice_restored" \
  < skayoffice-YYYYMMDD_HHmmss.sql
```

### Step 5 — Update connection string and restart

1. Set the `DATABASE_URL` secret in the Replit project to the new database URL.
2. Restart the production deployment.
3. Run the verification smoke test (see below).

---

## Procedure C — Trigger a manual backup immediately

> Use this before a risky deployment, schema change, or any operation that might cause data loss.

From the Replit workspace shell:
```bash
DATABASE_URL="$DATABASE_URL" \
DEFAULT_OBJECT_STORAGE_BUCKET_ID="$DEFAULT_OBJECT_STORAGE_BUCKET_ID" \
bash scripts/backup-db.sh
```

This runs `pg_dump`, compresses the output, and writes `backups/skayoffice-YYYYMMDD-HHMMSS.sql.gz` locally. Upload the resulting file to GCS manually if you need off-site storage.

To trigger the Node.js backup (which uploads directly to object storage) from a one-off script:
```bash
cd /home/runner/workspace
DATABASE_URL="$DATABASE_URL" \
DEFAULT_OBJECT_STORAGE_BUCKET_ID="$DEFAULT_OBJECT_STORAGE_BUCKET_ID" \
node -e "
  import('./artifacts/api-server/dist/index.mjs').then(() => process.exit(0));
"
```
(The backup fires 5 minutes after the server starts.)

---

## Verification smoke test

After any restore, confirm the application is healthy:

```bash
PROD="https://skayoffice-pilot.replit.app/api"

# 1. Process alive
curl -sf "$PROD/healthz" | python3 -c "import sys,json; d=json.load(sys.stdin); print('health:', d)"

# 2. DB connectivity
curl -sf "$PROD/healthz?deep=1" | python3 -c "import sys,json; d=json.load(sys.stdin); print('db:', d.get('db'))"

# 3. Public listing returns data
curl -sf "$PROD/offices?providerType=office" | python3 -c "import sys,json; d=json.load(sys.stdin); print('offices:', d.get('total', 0))"
```

Expected output:
```
health: {'status': 'ok'}
db: ok
offices: <number>
```

---

## Backup verification procedure

> Run this quarterly or after any infrastructure change.

### Verify backup files exist in object storage

```bash
# List all backup files (should show files with recent timestamps):
# Via Replit Object Storage pane → browse backups/ prefix
# OR from shell:
gsutil ls -l gs://$DEFAULT_OBJECT_STORAGE_BUCKET_ID/backups/ | sort | tail -10
```

Expected: files dated within the last 24 hours.

### Verify a backup file is a valid SQL dump

```bash
# Download and inspect the most recent backup:
LATEST=$(gsutil ls gs://$DEFAULT_OBJECT_STORAGE_BUCKET_ID/backups/ | sort | tail -1)
gsutil cp "$LATEST" /tmp/latest-backup.sql.gz
gunzip -t /tmp/latest-backup.sql.gz && echo "gzip integrity: OK"
gunzip -c /tmp/latest-backup.sql.gz | head -5
```

Expected first line: `-- PostgreSQL database dump`

### Verify restore works (staging restore test)

Quarterly, restore the most recent backup to a temporary Neon branch or local Postgres:

```bash
# Create a temporary database, restore, check row counts, delete:
createdb skayoffice_verify
gunzip -c /tmp/latest-backup.sql.gz | psql skayoffice_verify
psql skayoffice_verify -c "SELECT COUNT(*) FROM users; SELECT COUNT(*) FROM offices;"
dropdb skayoffice_verify
```

---

## Automated backup log reference

The backup scheduler writes structured log lines to the production deployment logs.

| Log message | Meaning |
|------------|---------|
| `[backup] Backup scheduler registered` | scheduleBackups() called at startup; first run in 5 min |
| `[backup] Starting pg_dump` | Dump in progress |
| `[backup] Backup uploaded to object storage` | Upload succeeded; includes key name and size |
| `[backup] Pruned old backup files` | Retention applied; includes count deleted and retained |
| `[backup] initial backup failed` | First run failed; check err field for cause |
| `[backup] scheduled backup failed` | Recurring run failed; check err field for cause |

---

## Contact and escalation

| Situation | Action |
|---------|--------|
| Data loss confirmed, within PITR window | Use Procedure A; notify engineering owner |
| Data loss confirmed, outside PITR window | Use Procedure B; assess scope before restore |
| Both tiers unavailable | Contact Replit support (`support.replit.com`); assess data loss scope |
| Backup scheduler not firing (no log lines in 26+ hours) | Check production logs; trigger manual backup (Procedure C) |
