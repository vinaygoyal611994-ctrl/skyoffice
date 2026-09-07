/**
 * Narrow demo-password rotation — July 2026
 *
 * Rotates ONLY the following 7 seed accounts to the current SEED_DEMO_PASSWORD:
 *   customer@skayoffice.demo
 *   office1@skayoffice.demo … office6@skayoffice.demo
 *
 * Explicitly EXCLUDED:
 *   admin@skayoffice.demo          (admin password already set by account owner)
 *   office7-10@skayoffice.demo     (outside requested scope)
 *   All real users / QA accounts   (none match the IN list; verified by pre-flight)
 *
 * Safe to re-run: idempotent — always converges to current SEED_DEMO_PASSWORD.
 *
 * Usage (development):
 *   pnpm --filter scripts exec tsx src/rotateDemoPasswordsNarrow.ts
 *
 * Usage (production — supply the production DATABASE_URL via env):
 *   DATABASE_URL=<prod-url> pnpm --filter scripts exec tsx src/rotateDemoPasswordsNarrow.ts
 */
import bcrypt from "bcryptjs";
import pg from "pg";
import { logger } from "./logger.js";

// ── Exact IN-list scope (no LIKE, no wildcards) ───────────────────────────────
const DEMO_EMAILS = [
  "customer@skayoffice.demo",
  "office1@skayoffice.demo",
  "office2@skayoffice.demo",
  "office3@skayoffice.demo",
  "office4@skayoffice.demo",
  "office5@skayoffice.demo",
  "office6@skayoffice.demo",
] as const;

const ADMIN_EMAIL = "admin@skayoffice.demo";
const EXPECTED_COUNT = DEMO_EMAILS.length; // 7

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`${key} environment variable is required but not set`);
  return v;
}

async function main(): Promise<void> {
  const demoPassword = requireEnv("SEED_DEMO_PASSWORD");
  const databaseUrl = requireEnv("DATABASE_URL");

  logger.info("Hashing SEED_DEMO_PASSWORD (bcrypt rounds=10)...");
  const demoHash = await bcrypt.hash(demoPassword, 10);
  logger.info({ algorithm: demoHash.slice(0, 7), length: demoHash.length }, "Hash generated");

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    // ── 0. Pre-flight: list matched rows BEFORE any write ────────────────────
    const scopeCheck = await client.query<{
      email: string;
      role: string;
      hash_prefix: string;
    }>(
      `SELECT email, role, LEFT(password_hash, 7) AS hash_prefix
       FROM users
       WHERE email = ANY($1::text[])
       ORDER BY email`,
      [DEMO_EMAILS as unknown as string[]],
    );

    logger.info(
      { count: scopeCheck.rowCount, rows: scopeCheck.rows.map((r) => ({ email: r.email, role: r.role, hash_prefix: r.hash_prefix })) },
      "Pre-flight: rows matched by IN-list scope",
    );

    if (scopeCheck.rowCount !== EXPECTED_COUNT) {
      throw new Error(
        `Scope check failed: expected ${EXPECTED_COUNT} rows, found ${scopeCheck.rowCount}. Aborting.`,
      );
    }

    // Admin must never appear in the matched set
    const adminInScope = scopeCheck.rows.some((r) => r.email === ADMIN_EMAIL);
    if (adminInScope) {
      throw new Error("Admin guard triggered: admin@skayoffice.demo is in scope. Aborting immediately.");
    }

    // ── 1. Open transaction ───────────────────────────────────────────────────
    await client.query("BEGIN");
    logger.info("Transaction opened");

    // ── 2. Apply rotation ────────────────────────────────────────────────────
    const updateResult = await client.query(
      `UPDATE users
       SET password_hash = $1,
           updated_at    = NOW()
       WHERE email = ANY($2::text[])
       RETURNING id, email, role`,
      [demoHash, DEMO_EMAILS as unknown as string[]],
    );

    logger.info(
      { updated: updateResult.rows.map((r) => ({ id: r.id, email: r.email, role: r.role })) },
      "Rows updated",
    );

    if (updateResult.rowCount !== EXPECTED_COUNT) {
      throw new Error(
        `Update row-count mismatch: expected ${EXPECTED_COUNT}, got ${updateResult.rowCount}. Rolling back.`,
      );
    }

    // ── 3. Verify admin row was NOT touched ───────────────────────────────────
    const adminRow = await client.query<{
      email: string;
      updated_at: Date;
      hash_prefix: string;
    }>(
      `SELECT email, updated_at, LEFT(password_hash, 7) AS hash_prefix
       FROM users WHERE email = $1`,
      [ADMIN_EMAIL],
    );

    if (adminRow.rows.length === 0) {
      throw new Error("Admin row missing — unexpected state. Rolling back.");
    }

    logger.info(
      {
        email: adminRow.rows[0].email,
        hash_prefix: adminRow.rows[0].hash_prefix,
        updated_at: adminRow.rows[0].updated_at,
      },
      "Admin row integrity check (must be unchanged)",
    );

    // ── 4. Commit ─────────────────────────────────────────────────────────────
    await client.query("COMMIT");
    logger.info({ rotatedCount: updateResult.rowCount }, "Transaction committed — rotation complete");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error({ err }, "Rotation failed — rolled back");
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  logger.error({ err }, "rotateDemoPasswordsNarrow exited with error");
  process.exitCode = 1;
});
