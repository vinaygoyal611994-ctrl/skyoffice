/**
 * Minimal seed: sirf admin user create karo (S3 storage ki zaroorat nahi)
 */
import { db, pool, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword } from "../lib/auth";
import { logger } from "../lib/logger";

const ADMIN_EMAIL = "admin@skayoffice.demo";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
  throw new Error("SEED_ADMIN_PASSWORD environment variable is required");
}

async function seedAdmin() {
  logger.info("Creating admin user...");

  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, ADMIN_EMAIL));

  if (existing) {
    logger.info("Admin user already exists — updating password");
    const passwordHash = await hashPassword(ADMIN_PASSWORD!);
    await db
      .update(usersTable)
      .set({ passwordHash })
      .where(eq(usersTable.email, ADMIN_EMAIL));
    logger.info("Admin password updated");
  } else {
    const passwordHash = await hashPassword(ADMIN_PASSWORD!);
    await db.insert(usersTable).values({
      role: "admin",
      name: "Platform Admin",
      email: ADMIN_EMAIL,
      passwordHash,
    });
    logger.info(`Admin user created: ${ADMIN_EMAIL}`);
  }

  await pool.end();
  logger.info("Done!");
}

seedAdmin().catch((err) => {
  logger.error({ err }, "Admin seed failed");
  process.exit(1);
});
