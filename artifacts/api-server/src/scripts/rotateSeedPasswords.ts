/**
 * One-time rotation for accounts created by the old seed script, which used
 * a single hardcoded password ("Demo12345!") for the admin account and every
 * demo customer/office account. That password is now public (it shipped in
 * source control), so this script re-hashes every seeded account's password
 * using the current SEED_ADMIN_PASSWORD / SEED_DEMO_PASSWORD secrets.
 *
 * Safe to re-run: it only touches the known seed emails
 * (admin@skayoffice.demo, customer@skayoffice.demo, office1..N@skayoffice.demo)
 * and always sets the password to the current secret value, so re-running it
 * after rotating a secret re-syncs the DB to match.
 *
 * Usage: pnpm --filter @workspace/api-server exec tsx src/scripts/rotateSeedPasswords.ts
 */
import { db, pool, usersTable } from "@workspace/db";
import { eq, like, or } from "drizzle-orm";
import { hashPassword } from "../lib/auth";
import { logger } from "../lib/logger";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`${key} environment variable is required but was not provided.`);
  }
  return value;
}

async function rotate() {
  const adminPassword = requireEnv("SEED_ADMIN_PASSWORD");
  const demoPassword = requireEnv("SEED_DEMO_PASSWORD");

  const adminHash = await hashPassword(adminPassword);
  const demoHash = await hashPassword(demoPassword);

  const adminResult = await db
    .update(usersTable)
    .set({ passwordHash: adminHash })
    .where(eq(usersTable.email, "admin@skayoffice.demo"))
    .returning({ id: usersTable.id, email: usersTable.email });
  logger.info({ updated: adminResult.map((u) => u.email) }, "Rotated admin password");

  const demoResult = await db
    .update(usersTable)
    .set({ passwordHash: demoHash })
    .where(
      or(
        eq(usersTable.email, "customer@skayoffice.demo"),
        like(usersTable.email, "office%@skayoffice.demo"),
      ),
    )
    .returning({ id: usersTable.id, email: usersTable.email });
  logger.info(
    { updated: demoResult.map((u) => u.email) },
    "Rotated demo customer/office passwords",
  );

  logger.info("Password rotation complete. No password values were logged.");
}

rotate()
  .catch((err) => {
    logger.error({ err }, "Password rotation failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
