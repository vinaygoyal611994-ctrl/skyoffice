#!/usr/bin/env bash
# HIGH-09: Database backup script for SkayOffice production database.
#
# Usage (manual):
#   DATABASE_URL="postgresql://..." bash scripts/backup-db.sh
#
# Usage (scheduled — add to server cron or CI):
#   0 3 * * * /path/to/scripts/backup-db.sh >> /var/log/skayoffice-backup.log 2>&1
#
# The script produces a compressed pg_dump file named:
#   backups/skayoffice-YYYY-MM-DD-HHMMSS.sql.gz
#
# Retention: by default keeps the last 30 files (≈30 days of daily backups).
# Adjust KEEP_COUNT below to match your retention policy.

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-$(dirname "$0")/../backups}"
KEEP_COUNT="${KEEP_COUNT:-30}"
TIMESTAMP=$(date +"%Y-%m-%d-%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/skayoffice-${TIMESTAMP}.sql.gz"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set. Aborting." >&2
  exit 1
fi

mkdir -p "${BACKUP_DIR}"

echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Starting backup → ${BACKUP_FILE}"

pg_dump "${DATABASE_URL}" \
  --no-password \
  --format=plain \
  --no-owner \
  --no-acl \
  | gzip -9 > "${BACKUP_FILE}"

SIZE=$(du -sh "${BACKUP_FILE}" | cut -f1)
echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Backup complete. Size: ${SIZE}"

# Rotate: remove oldest files beyond KEEP_COUNT
BACKUP_COUNT=$(ls -1 "${BACKUP_DIR}"/skayoffice-*.sql.gz 2>/dev/null | wc -l)
if [ "${BACKUP_COUNT}" -gt "${KEEP_COUNT}" ]; then
  REMOVE_COUNT=$(( BACKUP_COUNT - KEEP_COUNT ))
  echo "Rotating ${REMOVE_COUNT} old backup(s)..."
  ls -1t "${BACKUP_DIR}"/skayoffice-*.sql.gz | tail -n "${REMOVE_COUNT}" | xargs rm -f
fi

echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Done."
