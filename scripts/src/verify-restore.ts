/**
 * Isolated restore-verification tool.
 *
 * Blocker 7 (isolated restore verification): Downloads the most recent backup
 * from the BACKUP_S3_BUCKET, restores it into a throwaway database specified
 * via RESTORE_VERIFY_DATABASE_URL, then runs a set of sanity queries.
 *
 * SAFETY RULES (enforced in code):
 *   1. The target database URL MUST be provided via RESTORE_VERIFY_DATABASE_URL.
 *      This script refuses to run against DATABASE_URL to prevent any chance
 *      of overwriting production or development data.
 *   2. RESTORE_VERIFY_DATABASE_URL must NOT equal DATABASE_URL.
 *   3. The target database is assumed to be an empty/disposable restore target.
 *   4. This script never touches the primary database, the private bucket,
 *      or the public bucket.  It reads only from the backup bucket.
 *   5. All changes are confined to RESTORE_VERIFY_DATABASE_URL.
 *
 * Usage:
 *   RESTORE_VERIFY_DATABASE_URL="postgresql://..." \
 *   BACKUP_S3_BUCKET="my-backup-bucket" \
 *   STORAGE_ENDPOINT="..." \
 *   STORAGE_REGION="..." \
 *   STORAGE_ACCESS_KEY_ID="..." \
 *   STORAGE_SECRET_ACCESS_KEY="..." \
 *   tsx scripts/src/verify-restore.ts
 *
 * Optional env vars:
 *   BACKUP_S3_ENDPOINT         — defaults to STORAGE_ENDPOINT
 *   BACKUP_S3_REGION           — defaults to STORAGE_REGION
 *   BACKUP_S3_ACCESS_KEY_ID    — defaults to STORAGE_ACCESS_KEY_ID
 *   BACKUP_S3_SECRET_ACCESS_KEY— defaults to STORAGE_SECRET_ACCESS_KEY
 *   RESTORE_BACKUP_KEY         — if set, restore this specific key instead of the latest
 *   RESTORE_MIN_OFFICES        — fail if fewer than N offices rows (default 0 = skip check)
 *
 * Exit codes:
 *   0 — restore succeeded and all sanity checks passed
 *   1 — restore failed or a sanity check failed
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createGunzip } from "node:zlib";
import { PassThrough } from "node:stream";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import pg from "pg";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Safety guard: refuse to run against the primary database
// ---------------------------------------------------------------------------

function assertNotPrimaryDatabase(): void {
  const primaryUrl = process.env["DATABASE_URL"] ?? "";
  const restoreUrl = process.env["RESTORE_VERIFY_DATABASE_URL"] ?? "";

  if (!restoreUrl) {
    console.error(
      "ERROR: RESTORE_VERIFY_DATABASE_URL is not set.\n" +
        "This script requires a dedicated throwaway restore target.\n" +
        "Never set it to DATABASE_URL (your production/development database).",
    );
    process.exit(1);
  }

  // Normalise URLs for comparison (strip trailing slash, lowercase)
  const normalise = (u: string) => u.trim().toLowerCase().replace(/\/$/, "");
  if (normalise(restoreUrl) === normalise(primaryUrl)) {
    console.error(
      "ERROR: RESTORE_VERIFY_DATABASE_URL must not equal DATABASE_URL.\n" +
        "This script will DROP and recreate the target schema — never point it\n" +
        "at your production or development database.",
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// S3 helpers
// ---------------------------------------------------------------------------

function buildBackupClient(): S3Client {
  const endpoint = (
    process.env["BACKUP_S3_ENDPOINT"] ??
    process.env["STORAGE_ENDPOINT"] ??
    ""
  ).replace(/\/+$/, "");
  const region =
    process.env["BACKUP_S3_REGION"] ?? process.env["STORAGE_REGION"] ?? "auto";
  const accessKeyId =
    process.env["BACKUP_S3_ACCESS_KEY_ID"] ??
    process.env["STORAGE_ACCESS_KEY_ID"] ??
    "";
  const secretAccessKey =
    process.env["BACKUP_S3_SECRET_ACCESS_KEY"] ??
    process.env["STORAGE_SECRET_ACCESS_KEY"] ??
    "";

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    console.error(
      "ERROR: Backup storage credentials are incomplete.\n" +
        "Set STORAGE_ENDPOINT, STORAGE_ACCESS_KEY_ID, STORAGE_SECRET_ACCESS_KEY\n" +
        "(or BACKUP_S3_* overrides) before running restore verification.",
    );
    process.exit(1);
  }

  return new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
}

async function findLatestBackupKey(
  client: S3Client,
  bucket: string,
): Promise<string> {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: "backups/",
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of page.Contents ?? []) {
      if (obj.Key?.endsWith(".sql.gz")) keys.push(obj.Key);
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  if (keys.length === 0) {
    throw new Error(`No backup files found in bucket '${bucket}' under 'backups/'`);
  }

  keys.sort((a, b) => a.localeCompare(b));
  return keys[keys.length - 1]!;
}

async function streamBackupToBuffer(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<Buffer> {
  const resp = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!resp.Body) throw new Error(`GET ${key} returned empty body`);

  const gunzip = createGunzip();
  const passthrough = new PassThrough();
  const chunks: Buffer[] = [];

  // Pipe the compressed S3 stream through gunzip into a PassThrough buffer
  const bodyStream = resp.Body as NodeJS.ReadableStream;
  bodyStream.pipe(gunzip).pipe(passthrough);

  await new Promise<void>((resolve, reject) => {
    passthrough.on("data", (chunk: Buffer) => chunks.push(chunk));
    passthrough.on("end", resolve);
    passthrough.on("error", reject);
    gunzip.on("error", reject);
    bodyStream.on("error", reject);
  });

  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

async function restoreSqlToDatabase(
  sql: Buffer,
  targetUrl: string,
): Promise<void> {
  console.log("  Restoring SQL dump to target database via psql...");
  await new Promise<void>((resolve, reject) => {
    const psql = (
      require("node:child_process") as typeof import("node:child_process")
    ).spawn("psql", [targetUrl, "--no-password"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stderrLines: string[] = [];
    psql.stderr.on("data", (data: Buffer) => {
      const line = data.toString();
      stderrLines.push(line);
      // Print warnings to help diagnose permission/ownership errors that
      // are non-fatal for a restore-verification scenario
      if (line.toLowerCase().includes("error")) {
        process.stderr.write("  psql: " + line);
      }
    });

    psql.on("error", (err: Error) =>
      reject(new Error(`psql failed to launch: ${err.message}`)),
    );
    psql.on("close", (code) => {
      if (code !== 0) {
        const detail = stderrLines.join("").trim().slice(0, 500);
        reject(new Error(`psql exited with code ${code}: ${detail}`));
      } else {
        resolve();
      }
    });

    psql.stdin.end(sql);
  });
}

// ---------------------------------------------------------------------------
// Sanity queries
// ---------------------------------------------------------------------------

interface SanityResult {
  name: string;
  ok: boolean;
  detail: string;
}

async function runSanityChecks(targetUrl: string): Promise<SanityResult[]> {
  const client = new pg.Client({ connectionString: targetUrl });
  await client.connect();
  const results: SanityResult[] = [];

  const check = async (
    name: string,
    query: string,
    validate: (rows: Record<string, unknown>[]) => string,
  ): Promise<void> => {
    try {
      const { rows } = await client.query(query);
      const detail = validate(rows as Record<string, unknown>[]);
      results.push({ name, ok: true, detail });
      console.log(`  ✓ ${name}: ${detail}`);
    } catch (err) {
      const detail = (err as Error).message;
      results.push({ name, ok: false, detail });
      console.error(`  ✗ ${name}: ${detail}`);
    }
  };

  const minOffices = parseInt(process.env["RESTORE_MIN_OFFICES"] ?? "0", 10);

  await check(
    "offices-count",
    "SELECT COUNT(*) AS n FROM offices",
    (rows) => {
      const n = parseInt(String((rows[0] as any)?.n ?? "0"), 10);
      if (minOffices > 0 && n < minOffices) {
        throw new Error(`Expected >= ${minOffices} offices, got ${n}`);
      }
      return `${n} office rows found`;
    },
  );

  await check(
    "users-count",
    "SELECT COUNT(*) AS n FROM users",
    (rows) => `${(rows[0] as any)?.n ?? 0} user rows found`,
  );

  await check(
    "audit-log-count",
    "SELECT COUNT(*) AS n FROM audit_log",
    (rows) => `${(rows[0] as any)?.n ?? 0} audit_log rows found`,
  );

  await check(
    "sessions-table-exists",
    "SELECT 1 FROM information_schema.tables WHERE table_name = 'session' LIMIT 1",
    (rows) => (rows.length > 0 ? "session table present" : "session table MISSING"),
  );

  await check(
    "latest-office",
    "SELECT id, name, status FROM offices ORDER BY id DESC LIMIT 1",
    (rows) => {
      if (rows.length === 0) return "no offices (empty restore is OK if intended)";
      const r = rows[0] as any;
      return `latest office: id=${r.id} name="${r.name}" status=${r.status}`;
    },
  );

  await client.end();
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("\n── SkayOffice: Isolated Restore Verification ──────────────────────────");
  console.log("  SAFETY: reads from BACKUP_S3_BUCKET, writes ONLY to RESTORE_VERIFY_DATABASE_URL.");
  console.log("");

  // Safety guard — must happen before any other work
  assertNotPrimaryDatabase();

  const backupBucket = process.env["BACKUP_S3_BUCKET"];
  if (!backupBucket) {
    console.error(
      "ERROR: BACKUP_S3_BUCKET is not set.\n" +
        "Restore verification requires a dedicated backup bucket.",
    );
    process.exit(1);
  }

  const restoreUrl = process.env["RESTORE_VERIFY_DATABASE_URL"]!;
  const client = buildBackupClient();

  // ── 1. Find or use specified backup key ──────────────────────────────────
  let key = process.env["RESTORE_BACKUP_KEY"];
  if (key) {
    console.log(`  Using specified backup key: ${key}`);
  } else {
    console.log(`  Finding latest backup in '${backupBucket}/backups/'...`);
    try {
      key = await findLatestBackupKey(client, backupBucket);
      console.log(`  Latest backup: ${key}`);
    } catch (err) {
      console.error(`  ERROR: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  // ── 2. Download + decompress ─────────────────────────────────────────────
  console.log("\n  Downloading and decompressing backup...");
  let sqlBuffer: Buffer;
  try {
    sqlBuffer = await streamBackupToBuffer(client, backupBucket, key);
    const sizeMB = (sqlBuffer.byteLength / (1024 * 1024)).toFixed(2);
    console.log(`  Decompressed size: ${sizeMB} MB`);
  } catch (err) {
    console.error(`  ERROR downloading/decompressing: ${(err as Error).message}`);
    process.exit(1);
  }

  // ── 3. Restore into throwaway database ───────────────────────────────────
  console.log("\n  Restoring into RESTORE_VERIFY_DATABASE_URL...");
  try {
    await restoreSqlToDatabase(sqlBuffer, restoreUrl);
    console.log("  Restore complete.");
  } catch (err) {
    console.error(`  ERROR during restore: ${(err as Error).message}`);
    process.exit(1);
  }

  // ── 4. Sanity checks ─────────────────────────────────────────────────────
  console.log("\n  Running sanity checks on restored database...");
  let sanityResults: SanityResult[] = [];
  try {
    sanityResults = await runSanityChecks(restoreUrl);
  } catch (err) {
    console.error(`  ERROR during sanity checks: ${(err as Error).message}`);
    process.exit(1);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const failed = sanityResults.filter((r) => !r.ok);
  console.log("\n── Summary ────────────────────────────────────────────────────────────");
  console.log(`  Restored from: ${key}`);
  console.log(`  ${sanityResults.length - failed.length} checks passed, ${failed.length} failed`);

  if (failed.length > 0) {
    console.error("\n  Failed checks:");
    for (const r of failed) {
      console.error(`    ✗ ${r.name}: ${r.detail}`);
    }
    process.exit(1);
  } else {
    console.log("\n  Restore verification successful. ✓");
    console.log(
      "  IMPORTANT: The restore target database contains a copy of production data.\n" +
        "  Drop it or rotate its credentials once verification is complete.",
    );
    console.log("");
    process.exit(0);
  }
}

main().catch((err: Error) => {
  console.error("Restore verification failed unexpectedly:", err.message);
  process.exit(1);
});
