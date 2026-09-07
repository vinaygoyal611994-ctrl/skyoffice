# SkayOffice Pilot — Backup and Disaster Recovery Plan

**Version:** 2.0
**Date:** 2026-08-19
**Owner:** Application owner
**Review frequency:** Before each major release; at minimum every 6 months

> **v2.0 change:** The application no longer depends on Replit Object Storage
> (GCS sidecar). All object storage and backups use an S3-compatible provider
> (AWS S3, Cloudflare R2, MinIO, …) configured via environment variables.

---

## 1. Scope

This document covers:
- PostgreSQL database backup and recovery
- Object storage (uploaded media, covers, documents) backup and recovery
- Source code and environment configuration recovery
- Disaster recovery procedures for both development and production environments

---

## 2. Environment Architecture

### 2.1 Storage Layout

| Store | Contents | Configured by |
|---|---|---|
| PostgreSQL | Accounts, offices, audit log, sessions, media *paths* | `DATABASE_URL` |
| Private bucket | Uploaded media originals + processed variants, verification documents (all served through the API with auth/ACL checks) | `STORAGE_PRIVATE_BUCKET` |
| Public bucket | Static public assets served via `/storage/public-objects/*` | `STORAGE_PUBLIC_BUCKET` |
| Backup bucket | Nightly gzipped `pg_dump` files under `backups/` | `BACKUP_S3_BUCKET` |

**Critical:** development and production must use separate databases and
separate buckets. The backup bucket should be a **dedicated, private,
backup-only bucket** — ideally in a different account or with credentials the
app cannot use to delete anything else.

### 2.2 Required Environment Variables

**Object storage (required in production — the server refuses to start without them):**

| Variable | Description | Example |
|---|---|---|
| `STORAGE_ENDPOINT` | S3-compatible endpoint URL | `https://<accountid>.r2.cloudflarestorage.com` |
| `STORAGE_REGION` | Region | `auto` (R2) or `us-east-1` |
| `STORAGE_ACCESS_KEY_ID` | Access key | — |
| `STORAGE_SECRET_ACCESS_KEY` | Secret key | — |
| `STORAGE_PUBLIC_BUCKET` | Public assets bucket | `skayoffice-public` |
| `STORAGE_PRIVATE_BUCKET` | Private objects bucket | `skayoffice-private` |

**Backup destination (recommended):**

| Variable | Description | Default if unset |
|---|---|---|
| `BACKUP_S3_BUCKET` | Dedicated backup bucket | Falls back to `STORAGE_PRIVATE_BUCKET` with a logged warning |
| `BACKUP_S3_ENDPOINT` | Backup endpoint | `STORAGE_ENDPOINT` |
| `BACKUP_S3_REGION` | Backup region | `STORAGE_REGION` |
| `BACKUP_S3_ACCESS_KEY_ID` | Backup credentials | `STORAGE_ACCESS_KEY_ID` |
| `BACKUP_S3_SECRET_ACCESS_KEY` | Backup credentials | `STORAGE_SECRET_ACCESS_KEY` |

**Bucket CORS (required for uploads):** office media/document uploads go
directly from the browser to a presigned `PUT` URL, so the **private bucket**
must have a provider-level CORS rule allowing the frontend origin:

```json
[
  {
    "AllowedOrigins": ["https://<your-frontend-domain>"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "MaxAgeSeconds": 3600
  }
]
```

Without this rule every browser upload fails with a CORS error even though
the presigned URL itself is valid. Verify with a real end-to-end browser
upload after provisioning.

Bucket requirements:
- All buckets private (no public-read ACLs). The API serves every object —
  public media through an approved-media allowlist, private documents behind
  session + ownership checks.
- Enable object **versioning** on the private and backup buckets so
  accidental deletions/overwrites are recoverable.
- Consider a lifecycle rule on the backup bucket keeping non-current versions
  ≥ 30 days.

---

## 3. Database Backup

### 3.1 Automated backup (built in)

In production the server runs a backup cycle automatically:
1. `pg_dump` against `DATABASE_URL` (plain format, `--no-owner --no-acl`)
2. gzip level 9
3. Upload to the backup bucket under `backups/skayoffice-YYYYMMDD_HHmmss.sql.gz`
4. Retention pruning: keeps the newest **30** files (~30 days)

First run fires 5 minutes after startup, then every 24 hours. Failures are
logged (`[backup] … failed`) and never affect request handling — monitor the
production logs for these messages.

### 3.2 Manual backup

```bash
# From any machine with pg_dump and the production DATABASE_URL:
pg_dump "$DATABASE_URL" --format=plain --no-owner --no-acl \
  | gzip > skayoffice-$(date +%Y%m%d-%H%M).sql.gz

# Upload to the backup bucket (aws CLI works with R2/MinIO via --endpoint-url):
aws s3 cp skayoffice-*.sql.gz "s3://$BACKUP_S3_BUCKET/backups/" \
  --endpoint-url "$BACKUP_S3_ENDPOINT"
```

**Never commit backup files to git.** Keep `*.sql.gz` / `*.pgdump` in `.gitignore`.

### 3.3 Provider-level PITR

If the PostgreSQL host offers point-in-time recovery (e.g. Neon, RDS), that
is the PRIMARY recovery tier; the S3 dumps in this document are the
SECONDARY, provider-independent tier. Confirm and record here:
- [ ] PITR available? Retention window?
- [ ] How to initiate a restore?

---

## 4. Object Storage Backup

The database stores object **paths**, not files. A DB restore alone does not
recover uploaded media/documents — the buckets must also be protected.

1. **Versioning** (first line of defence): enable it on the private bucket so
   deletes/overwrites are recoverable.
2. **Cross-bucket sync** (recommended, run on a schedule from any host):

```bash
# Mirror the private bucket into the backup bucket under media/
aws s3 sync "s3://$STORAGE_PRIVATE_BUCKET" \
  "s3://$BACKUP_S3_BUCKET/media/" \
  --endpoint-url "$STORAGE_ENDPOINT"
# (rclone sync works equally well and supports different providers per side.)
```

---

## 5. Recovery Procedures

### 5.1 Database restore from an S3 backup

**WARNING:** Restore into a fresh/empty database first and verify before
pointing production at it. Never overwrite production with development data.

```bash
# 1. Fetch the newest backup
aws s3 ls "s3://$BACKUP_S3_BUCKET/backups/" --endpoint-url "$BACKUP_S3_ENDPOINT" | sort | tail -1
aws s3 cp "s3://$BACKUP_S3_BUCKET/backups/<newest>.sql.gz" - \
  --endpoint-url "$BACKUP_S3_ENDPOINT" | gunzip > restore.sql

# 2. Restore into a new database
createdb skayoffice_restore
psql "postgresql://user:pass@host/skayoffice_restore" < restore.sql

# 3. Verify
psql "postgresql://user:pass@host/skayoffice_restore" \
  -c "SELECT count(*) FROM offices;" \
  -c "SELECT count(*) FROM users;" \
  -c "SELECT count(*) FROM audit_log;"

# 4. Point DATABASE_URL at the restored database and restart the server.
```

One-liner for full-loss recovery:

```bash
aws s3 cp "s3://$BACKUP_S3_BUCKET/backups/<newest>.sql.gz" - \
  --endpoint-url "$BACKUP_S3_ENDPOINT" | gunzip | psql "$DATABASE_URL"
```

### 5.2 Object storage restore

```bash
# Restore mirrored media back into the main private bucket
aws s3 sync "s3://$BACKUP_S3_BUCKET/media/" \
  "s3://$STORAGE_PRIVATE_BUCKET" \
  --endpoint-url "$STORAGE_ENDPOINT"
```

If versioning is enabled and only specific objects were deleted, restore the
prior versions via the provider console or
`aws s3api list-object-versions` + `copy-object`.

### 5.3 Source code recovery

The full application source is in git. Restore from the git remote or from
workspace checkpoints; then re-enter secrets (5.4) and redeploy.

### 5.4 Environment configuration recovery

Secrets that must be re-entered if the hosting environment is lost:

| Secret | Description | Where to find replacement |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | DB provider console |
| `SESSION_SECRET` | Express session signing key | Generate new: `openssl rand -base64 32` (logs out all users) |
| `STORAGE_ENDPOINT` / `STORAGE_REGION` | S3-compatible endpoint | Storage provider console |
| `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY` | Storage credentials | Storage provider console (rotate on loss) |
| `STORAGE_PUBLIC_BUCKET` / `STORAGE_PRIVATE_BUCKET` | Bucket names | Storage provider console |
| `BACKUP_S3_*` | Backup destination | Storage provider console |
| `FRONTEND_URL` | Canonical frontend URL | — |
| `CORS_ALLOWED_ORIGINS` | Allowed origins | — |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | Email delivery | Resend dashboard |
| `SENTRY_DSN` / `VITE_SENTRY_DSN` | Error reporting | Sentry project settings |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Payments | Stripe dashboard |
| `SEED_ADMIN_PASSWORD` / `SEED_DEMO_PASSWORD` | Seed account passwords | Stored securely by application owner |

Store all secret values in a secure password manager. Never in unencrypted
documents, email, or chat.

### 5.5 Second admin account recovery

If the primary admin account is lost or inaccessible, use
`artifacts/api-server/src/scripts/createAdmin.ts` — see Section 6.

---

## 6. Creating a Second Admin Account

**Required before commercial launch.** A second admin account must exist for
redundancy.

```bash
export NEW_ADMIN_EMAIL="owner@skayoffice.com"
export NEW_ADMIN_NAME="SkayOffice Owner"
export NEW_ADMIN_PASSWORD="<generate a strong password>"

pnpm --filter @workspace/api-server exec tsx src/scripts/createAdmin.ts
```

The script validates uniqueness and password length (min 12 chars), hashes
with bcrypt, never logs the plaintext, and creates the account with
`role='admin'`, `status='active'`. Change the password immediately after
first login.

---

## 7. RPO and RTO Targets

| Metric | Value with this plan |
|---|---|
| **RPO** (database) | ≤ 24 h via automated nightly dump; better if provider PITR is available |
| **RPO** (object storage) | Depends on sync schedule; near-zero with bucket versioning |
| **RTO** | ≤ 4 hours for full recovery (source + secrets + DB restore + bucket restore) |
| **Backup verification** | Test-restore into a separate DB every 90 days |
| **DR drill** | Every 6 months |

---

## 8. Disaster Scenarios and Response

| Scenario | Impact | Response |
|---|---|---|
| Single row deleted accidentally | Low | Provider PITR if available; otherwise restore latest dump into a scratch DB and copy the row back; check audit_log |
| Table dropped accidentally | High | Stop the app; restore latest dump (5.1) |
| Full database corrupted | Critical | Restore latest dump (5.1); reconcile from audit_log |
| Object storage files deleted | High | Restore prior versions (versioning) or re-sync from backup bucket (5.2) |
| Hosting environment lost | High | Restore source from git; re-enter secrets (5.4); restore DB and buckets |
| Session table corrupted | Low | Drop and recreate session table; users re-login |
| Storage credentials leaked | Critical | Rotate keys at the provider immediately; update env vars; audit bucket access logs |
| Admin account compromised | Critical | Invalidate sessions via DB; rotate `SESSION_SECRET`; use second admin |

---

## 9. Action Items (Open)

| # | Action | Priority | Owner | Status |
|---|---|---|---|---|
| DR-01 | Provision S3-compatible buckets (public, private, backup) and set env vars | Critical | App owner | OPEN |
| DR-02 | Enable versioning on private + backup buckets | Critical | App owner | OPEN |
| DR-03 | Create second admin account via `createAdmin.ts` | Critical | App owner | OPEN |
| DR-04 | Store all secrets in secure password manager | Critical | App owner | OPEN |
| DR-05 | Verify first automated backup appears in the backup bucket after deploy | High | App owner | OPEN |
| DR-06 | Test restore into separate test DB | High | Engineering | OPEN |
| DR-07 | Schedule object-storage sync (`aws s3 sync` / rclone) | High | App owner | OPEN |
| DR-08 | Confirm provider PITR availability for PostgreSQL host | Medium | App owner | OPEN |
| DR-09 | Schedule first DR drill (90 days from now) | Medium | App owner | OPEN |

---

## 10. Contacts

| Role | Responsibility |
|---|---|
| Application owner | DR decisions, credentials, communication |
| Lead engineer | Technical recovery execution |
| Storage/DB provider support | Platform-level backup, restore, and infrastructure issues |
