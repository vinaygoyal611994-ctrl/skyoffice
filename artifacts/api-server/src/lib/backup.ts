/**
 * HIGH-09: Automated database backup — secondary off-site tier.
 *
 * Architecture
 * ─────────────
 * PRIMARY tier  → Managed-Postgres PITR (whatever the hosting provider
 *                  offers, e.g. Neon point-in-time recovery).
 *
 * SECONDARY tier → This module.  Runs pg_dump daily, compresses the
 *                  output, and uploads it to an S3-compatible bucket.
 *                  Stored independently of the provider's PITR history;
 *                  survives scenarios where the database service itself is
 *                  lost (billing lapse, account issue) as long as the
 *                  backup bucket remains accessible.
 *                  Retained for KEEP_COUNT files (default 30 ≈ 30 days).
 *
 * Destination
 * ───────────
 * Backups should go to a DEDICATED bucket, configured via:
 *   BACKUP_S3_BUCKET             (required for a separate destination)
 *   BACKUP_S3_ENDPOINT           (defaults to STORAGE_ENDPOINT)
 *   BACKUP_S3_REGION             (defaults to STORAGE_REGION)
 *   BACKUP_S3_ACCESS_KEY_ID      (defaults to STORAGE_ACCESS_KEY_ID)
 *   BACKUP_S3_SECRET_ACCESS_KEY  (defaults to STORAGE_SECRET_ACCESS_KEY)
 *
 * If BACKUP_S3_BUCKET is not set, backups fall back to the main private
 * storage bucket (STORAGE_PRIVATE_BUCKET) with a logged warning — better a
 * co-located backup than no backup at all in a misconfigured environment.
 *
 * See docs/backup-and-disaster-recovery.md for restore procedures.
 *
 * Public API
 * ──────────
 *  runBackup()       — one-shot: dump → gzip → upload → prune old files
 *  scheduleBackups() — registers a 24-hour interval (production only)
 */

import { spawn } from "node:child_process";
import { createGzip } from "node:zlib";

import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Object-key prefix under which backup files are stored. */
const BACKUP_PREFIX = "backups/";

/** Maximum number of backup files retained in object storage (≈ 30 days). */
const KEEP_COUNT = 30;

/** Delay before the first automatic backup fires after server startup. */
const INITIAL_DELAY_MS = 5 * 60 * 1000; // 5 minutes

/** Interval between automatic backups. */
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ---------------------------------------------------------------------------
// Backup destination resolution
// ---------------------------------------------------------------------------

interface BackupDestination {
  client: S3Client;
  bucket: string;
  /** True when falling back to the main storage bucket (no BACKUP_S3_BUCKET). */
  usedFallbackBucket: boolean;
}

/**
 * Builds the S3 client + bucket for backup uploads.
 *
 * Each BACKUP_S3_* var falls back to its STORAGE_* counterpart, so a setup
 * that keeps backups in the same account only needs BACKUP_S3_BUCKET.
 */
function resolveBackupDestination(): BackupDestination {
  const endpoint =
    process.env.BACKUP_S3_ENDPOINT || process.env.STORAGE_ENDPOINT;
  const region = process.env.BACKUP_S3_REGION || process.env.STORAGE_REGION;
  const accessKeyId =
    process.env.BACKUP_S3_ACCESS_KEY_ID || process.env.STORAGE_ACCESS_KEY_ID;
  const secretAccessKey =
    process.env.BACKUP_S3_SECRET_ACCESS_KEY ||
    process.env.STORAGE_SECRET_ACCESS_KEY;

  if (!endpoint || !region || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Backup storage credentials are not configured — set the STORAGE_* " +
        "env vars (and optionally BACKUP_S3_* overrides) before running backups",
    );
  }

  let bucket = process.env.BACKUP_S3_BUCKET;
  let usedFallbackBucket = false;
  if (!bucket) {
    bucket = process.env.STORAGE_PRIVATE_BUCKET;
    usedFallbackBucket = true;
  }
  if (!bucket) {
    throw new Error(
      "No backup destination bucket — set BACKUP_S3_BUCKET (recommended: a " +
        "dedicated backup-only bucket) or STORAGE_PRIVATE_BUCKET",
    );
  }

  const client = new S3Client({
    endpoint: endpoint.replace(/\/+$/, ""),
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });

  return { client, bucket, usedFallbackBucket };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Spawns pg_dump against DATABASE_URL, pipes stdout through gzip (level 9),
 * and resolves with the compressed buffer.  Rejects on any non-zero exit code
 * or stream error so the caller can log and handle it.
 */
function dumpDatabase(databaseUrl: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pgDump = spawn("pg_dump", [
      databaseUrl,
      "--no-password",
      "--format=plain",
      "--no-owner",
      "--no-acl",
    ]);

    const gzip = createGzip({ level: 9 });
    const chunks: Buffer[] = [];

    pgDump.stdout.pipe(gzip);

    gzip.on("data", (chunk: Buffer) => chunks.push(chunk));
    gzip.on("end", () => resolve(Buffer.concat(chunks)));
    gzip.on("error", (err: Error) =>
      reject(new Error(`gzip stream error: ${err.message}`)),
    );

    const stderrLines: string[] = [];
    pgDump.stderr.on("data", (data: Buffer) =>
      stderrLines.push(data.toString()),
    );

    pgDump.on("error", (err: Error) =>
      reject(new Error(`pg_dump failed to launch: ${err.message}`)),
    );

    pgDump.on("close", (code) => {
      if (code !== 0) {
        // Emit warnings pg_dump sent to stderr (usually about role ownership)
        // then fail.
        const detail = stderrLines.join("").trim().slice(0, 500);
        reject(new Error(`pg_dump exited with code ${code}: ${detail}`));
      }
      // code === 0: gzip 'end' has already resolved the promise above.
    });
  });
}

/**
 * Builds a lexicographically sortable object key for a new backup file.
 * Example: `backups/skayoffice-20260720_192308.sql.gz`
 */
function buildBackupKey(): string {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  // YYYYMMDD_HHmmss — no colons, dashes, or dots; safe for S3 and filesystems
  const ts =
    `${now.getUTCFullYear()}` +
    `${p(now.getUTCMonth() + 1)}` +
    `${p(now.getUTCDate())}` +
    `_` +
    `${p(now.getUTCHours())}` +
    `${p(now.getUTCMinutes())}` +
    `${p(now.getUTCSeconds())}`;
  return `${BACKUP_PREFIX}skayoffice-${ts}.sql.gz`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Performs one complete backup cycle:
 *
 *   1. Runs pg_dump against the production database.
 *   2. Compresses the SQL dump with gzip level 9.
 *   3. Uploads the compressed file to the backup bucket under `backups/`.
 *   4. Prunes the oldest backup files beyond KEEP_COUNT.
 *
 * Throws on any failure — the caller is responsible for logging.
 */
export async function runBackup(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not set — backup cannot proceed without a database connection string",
    );
  }

  const { client, bucket, usedFallbackBucket } = resolveBackupDestination();
  if (usedFallbackBucket) {
    logger.warn(
      { bucket },
      "[backup] BACKUP_S3_BUCKET is not set — uploading backups to the main " +
        "private storage bucket. Configure a dedicated backup bucket for " +
        "proper isolation.",
    );
  }

  const key = buildBackupKey();
  logger.info({ key, bucket }, "[backup] Starting pg_dump");

  const buffer = await dumpDatabase(databaseUrl);
  const sizeMB = (buffer.byteLength / (1024 * 1024)).toFixed(2);

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: "application/gzip",
    }),
  );

  logger.info({ key, sizeMB }, "[backup] Backup uploaded to object storage");

  // -------------------------------------------------------------------------
  // Retention: delete oldest files once the count exceeds KEEP_COUNT.
  // Files are sorted lexicographically; because key names contain ISO-8601
  // timestamps (YYYYMMDD_HHmmss), lex order = chronological order.
  // -------------------------------------------------------------------------
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: BACKUP_PREFIX,
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of page.Contents ?? []) {
      if (obj.Key && obj.Key.endsWith(".sql.gz")) {
        keys.push(obj.Key);
      }
    }
    continuationToken = page.IsTruncated
      ? page.NextContinuationToken
      : undefined;
  } while (continuationToken);

  keys.sort((a, b) => a.localeCompare(b)); // oldest first

  if (keys.length > KEEP_COUNT) {
    const excess = keys.slice(0, keys.length - KEEP_COUNT);
    await Promise.all(
      excess.map((k) =>
        client.send(new DeleteObjectCommand({ Bucket: bucket, Key: k })),
      ),
    );
    logger.info(
      { deleted: excess.length, retained: KEEP_COUNT },
      "[backup] Pruned old backup files",
    );
  }
}

/**
 * Registers the automated backup schedule with the Node.js event loop.
 *
 * Call once at server startup (production only).  Fires an initial backup
 * INITIAL_DELAY_MS after registration (default 5 min, to let the server
 * stabilize), then repeats every BACKUP_INTERVAL_MS (default 24 h).
 *
 * Both timers are unref()'d — they never block a clean process exit and a
 * backup failure never propagates to any HTTP request handler.
 *
 * Do NOT call in development: dev and production may share the same bucket,
 * so calling this in dev would interleave dev backups with production ones.
 */
export function scheduleBackups(): void {
  const safeRun = async (label: string): Promise<void> => {
    try {
      await runBackup();
    } catch (err) {
      logger.error({ err }, `[backup] ${label} failed`);
    }
  };

  const initial = setTimeout(
    () => {
      void safeRun("initial backup");
      setInterval(
        () => void safeRun("scheduled backup"),
        BACKUP_INTERVAL_MS,
      ).unref();
    },
    INITIAL_DELAY_MS,
  );
  initial.unref();

  logger.info(
    {
      initialDelayMin: INITIAL_DELAY_MS / 60_000,
      intervalHours: BACKUP_INTERVAL_MS / 3_600_000,
      keepCount: KEEP_COUNT,
      prefix: BACKUP_PREFIX,
    },
    "[backup] Backup scheduler registered",
  );
}
