/**
 * Creates a new admin account in the database.
 *
 * This script must be run by the application owner with database access.
 * It does NOT create a hardcoded password — all credentials must be supplied
 * via environment variables at runtime so they are never stored in source code.
 *
 * Usage:
 *   NEW_ADMIN_EMAIL="owner@example.com" \
 *   NEW_ADMIN_NAME="Office Name" \
 *   NEW_ADMIN_PASSWORD="SecureTemporaryPass123!" \
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/createAdmin.ts
 *
 * Required environment variables:
 *   NEW_ADMIN_EMAIL     — Email address for the new admin account
 *   NEW_ADMIN_NAME      — Display name for the new admin
 *   NEW_ADMIN_PASSWORD  — Temporary password (change immediately after first login)
 *
 * Security notes:
 *   - The password is hashed with bcrypt before being stored; the plaintext
 *     is never written to disk, logs, or the database.
 *   - Run this once per new admin; re-running with the same email will be
 *     rejected because email addresses are unique.
 *   - After the account is created, set a strong password and enable account
 *     review notifications before sharing access.
 *   - The new admin account is created with status='active' and role='admin'.
 */

import { db, pool, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword } from "../lib/auth";
import { logger } from "../lib/logger";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `${key} environment variable is required but was not provided.\n` +
      `Usage: ${key}="value" pnpm --filter @workspace/api-server exec tsx src/scripts/createAdmin.ts`,
    );
  }
  return value;
}

async function createAdmin() {
  const email = requireEnv("NEW_ADMIN_EMAIL");
  const name = requireEnv("NEW_ADMIN_NAME");
  const password = requireEnv("NEW_ADMIN_PASSWORD");

  // Validate email format
  if (!email.includes("@") || email.length < 5) {
    throw new Error(`Invalid email address: "${email}"`);
  }

  // Validate password strength
  if (password.length < 12) {
    throw new Error("NEW_ADMIN_PASSWORD must be at least 12 characters long.");
  }

  // Check for existing account with this email
  const existing = await db
    .select({ id: usersTable.id, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.email, email));

  if (existing.length > 0) {
    const row = existing[0];
    throw new Error(
      `An account already exists for ${email} (id=${row?.id}, role=${row?.role}). ` +
      "Use a different email address or contact the database administrator.",
    );
  }

  const passwordHash = await hashPassword(password);

  const [created] = await db
    .insert(usersTable)
    .values({
      email,
      name,
      role: "admin",
      passwordHash,
      status: "active",
      phone: null,
    })
    .returning({
      id: usersTable.id,
      email: usersTable.email,
      name: usersTable.name,
      role: usersTable.role,
    });

  logger.info(
    {
      adminId: created?.id,
      email: created?.email,
      name: created?.name,
    },
    "New admin account created successfully. Share credentials securely and prompt for a password change.",
  );

  logger.info("Password value was NOT logged. The hash is stored in the database.");
}

createAdmin()
  .catch((err) => {
    logger.error({ err }, "Failed to create admin account");
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
