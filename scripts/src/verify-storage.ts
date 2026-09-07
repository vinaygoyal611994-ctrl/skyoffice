/**
 * Non-destructive live storage verification command.
 *
 * Blocker 5: Verifies that object-storage credentials and buckets are
 * functional WITHOUT modifying any real data. Uses a disposable object
 * (uploaded and immediately deleted) to confirm round-trip write ability.
 * Runs only when the required STORAGE_* env vars are present.
 *
 * Usage:
 *   DATABASE_URL=<url> tsx scripts/src/verify-storage.ts
 *
 * Exit codes:
 *   0 — all checks passed (or skipped due to missing env)
 *   1 — one or more checks failed
 *
 * Checks performed:
 *   1. All required STORAGE_* env vars are set
 *   2. BACKUP_S3_BUCKET differs from the main storage buckets (parity guard)
 *   3. Public bucket: HeadBucket (connectivity + credentials)
 *   4. Private bucket: HeadBucket
 *   5. Backup bucket: HeadBucket (if BACKUP_S3_BUCKET is set)
 *   6. Private bucket write round-trip: PUT disposable probe → HEAD → DELETE
 *   7. Backup bucket is not the same bucket as private or public (isolation guard)
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

// ---------------------------------------------------------------------------
// Env helpers
// ---------------------------------------------------------------------------

const REQUIRED_VARS = [
  "STORAGE_ENDPOINT",
  "STORAGE_REGION",
  "STORAGE_ACCESS_KEY_ID",
  "STORAGE_SECRET_ACCESS_KEY",
  "STORAGE_PUBLIC_BUCKET",
  "STORAGE_PRIVATE_BUCKET",
];

function getEnv(name: string): string | undefined {
  return process.env[name];
}

function requireEnv(name: string): string {
  const v = getEnv(name);
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// ---------------------------------------------------------------------------
// Result tracking
// ---------------------------------------------------------------------------

type CheckResult = { name: string; ok: boolean; detail: string };
const results: CheckResult[] = [];

function pass(name: string, detail: string): void {
  results.push({ name, ok: true, detail });
  console.log(`  ✓ ${name}: ${detail}`);
}

function fail(name: string, detail: string): void {
  results.push({ name, ok: false, detail });
  console.error(`  ✗ ${name}: ${detail}`);
}

// ---------------------------------------------------------------------------
// S3 helpers
// ---------------------------------------------------------------------------

function buildClient(overrides?: {
  endpoint?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}): S3Client {
  const endpoint = (overrides?.endpoint ?? requireEnv("STORAGE_ENDPOINT")).replace(/\/+$/, "");
  return new S3Client({
    endpoint,
    region: overrides?.region ?? requireEnv("STORAGE_REGION"),
    credentials: {
      accessKeyId: overrides?.accessKeyId ?? requireEnv("STORAGE_ACCESS_KEY_ID"),
      secretAccessKey: overrides?.secretAccessKey ?? requireEnv("STORAGE_SECRET_ACCESS_KEY"),
    },
    forcePathStyle: true,
  });
}

async function headBucket(client: S3Client, bucket: string): Promise<void> {
  await client.send(new HeadBucketCommand({ Bucket: bucket }));
}

async function probeWriteRoundTrip(client: S3Client, bucket: string): Promise<void> {
  const key = `__verify-storage-probe-${Date.now()}.txt`;
  const body = `SkayOffice storage probe — safe to delete — ${new Date().toISOString()}`;
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: "text/plain",
        // Tag the object as a disposable probe so it's easy to identify in logs
        Tagging: "probe=true&disposable=true",
      }),
    );
    // Verify read-back
    const get = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const bodyStream = get.Body;
    if (!bodyStream) throw new Error("PUT succeeded but GET returned empty body");
    // Drain the stream (small payload — safe to buffer)
    const chunks: Uint8Array[] = [];
    for await (const chunk of bodyStream as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    const readBack = Buffer.concat(chunks).toString("utf-8");
    if (!readBack.includes("SkayOffice storage probe")) {
      throw new Error(`Read-back content mismatch: got "${readBack.slice(0, 100)}"`);
    }
  } finally {
    // Always clean up the probe object — even on error the probe may have landed
    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    } catch {
      // Suppress cleanup error — the probe key is non-sensitive and will be
      // garbage-collected naturally; deletion failure should not hide the real error.
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("\n── SkayOffice: Live Storage Verification ──────────────────────────────");
  console.log("  Non-destructive: only a disposable probe object is written (and immediately deleted).");
  console.log("");

  // ── Check 1: Required env vars ────────────────────────────────────────────
  const missing = REQUIRED_VARS.filter((v) => !getEnv(v));
  if (missing.length > 0) {
    console.warn(`  ⚠  Missing storage env vars: ${missing.join(", ")}`);
    console.warn("     Storage verification skipped — set STORAGE_* env vars to enable.");
    console.warn("");
    process.exit(0); // Not an error — just not configured
  }
  pass("env-vars", `All ${REQUIRED_VARS.length} required STORAGE_* env vars present`);

  // ── Check 2: Backup bucket isolation ─────────────────────────────────────
  const publicBucket = requireEnv("STORAGE_PUBLIC_BUCKET");
  const privateBucket = requireEnv("STORAGE_PRIVATE_BUCKET");
  const backupBucket = getEnv("BACKUP_S3_BUCKET");

  if (!backupBucket) {
    fail(
      "backup-bucket-isolation",
      "BACKUP_S3_BUCKET is not set — backups will fall back to the main private bucket. " +
        "Set BACKUP_S3_BUCKET to a dedicated backup-only bucket for proper isolation.",
    );
  } else if (backupBucket === privateBucket || backupBucket === publicBucket) {
    fail(
      "backup-bucket-isolation",
      `BACKUP_S3_BUCKET ('${backupBucket}') is the same as a main storage bucket. ` +
        "Backups and live data must use separate, isolated buckets.",
    );
  } else {
    pass(
      "backup-bucket-isolation",
      `BACKUP_S3_BUCKET ('${backupBucket}') is distinct from private ('${privateBucket}') and public ('${publicBucket}')`,
    );
  }

  const mainClient = buildClient();

  // ── Check 3: Public bucket connectivity ──────────────────────────────────
  try {
    await headBucket(mainClient, publicBucket);
    pass("public-bucket-head", `HeadBucket on '${publicBucket}' succeeded`);
  } catch (err) {
    fail("public-bucket-head", `HeadBucket on '${publicBucket}' failed: ${(err as Error).message}`);
  }

  // ── Check 4: Private bucket connectivity ─────────────────────────────────
  try {
    await headBucket(mainClient, privateBucket);
    pass("private-bucket-head", `HeadBucket on '${privateBucket}' succeeded`);
  } catch (err) {
    fail("private-bucket-head", `HeadBucket on '${privateBucket}' failed: ${(err as Error).message}`);
  }

  // ── Check 5: Backup bucket connectivity ──────────────────────────────────
  if (backupBucket) {
    const backupEndpoint = getEnv("BACKUP_S3_ENDPOINT");
    const backupRegion = getEnv("BACKUP_S3_REGION");
    const backupAccessKey = getEnv("BACKUP_S3_ACCESS_KEY_ID");
    const backupSecretKey = getEnv("BACKUP_S3_SECRET_ACCESS_KEY");

    const backupClient = buildClient({
      endpoint: backupEndpoint ?? requireEnv("STORAGE_ENDPOINT"),
      region: backupRegion ?? requireEnv("STORAGE_REGION"),
      accessKeyId: backupAccessKey ?? requireEnv("STORAGE_ACCESS_KEY_ID"),
      secretAccessKey: backupSecretKey ?? requireEnv("STORAGE_SECRET_ACCESS_KEY"),
    });

    try {
      await headBucket(backupClient, backupBucket);
      pass("backup-bucket-head", `HeadBucket on backup bucket '${backupBucket}' succeeded`);
    } catch (err) {
      fail("backup-bucket-head", `HeadBucket on backup bucket '${backupBucket}' failed: ${(err as Error).message}`);
    }
  } else {
    console.log("  –  backup-bucket-head: skipped (BACKUP_S3_BUCKET not set)");
  }

  // ── Check 6: Private bucket write round-trip ──────────────────────────────
  console.log("\n  Running write round-trip probe on private bucket (PUT → GET → DELETE)...");
  try {
    await probeWriteRoundTrip(mainClient, privateBucket);
    pass(
      "private-bucket-write-roundtrip",
      `Write probe PUT+GET+DELETE on '${privateBucket}' succeeded — disposable probe cleaned up`,
    );
  } catch (err) {
    fail(
      "private-bucket-write-roundtrip",
      `Write probe failed on '${privateBucket}': ${(err as Error).message}`,
    );
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const failed = results.filter((r) => !r.ok);
  console.log("\n── Summary ────────────────────────────────────────────────────────────");
  console.log(`  ${results.length - failed.length} passed, ${failed.length} failed`);

  if (failed.length > 0) {
    console.error("\nFailed checks:");
    for (const r of failed) {
      console.error(`  ✗ ${r.name}: ${r.detail}`);
    }
    console.error("");
    process.exit(1);
  } else {
    console.log("\n  All storage checks passed. ✓");
    console.log("");
    process.exit(0);
  }
}

main().catch((err: Error) => {
  console.error("Storage verification failed unexpectedly:", err.message);
  process.exit(1);
});
