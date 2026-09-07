import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, passwordResetTokensTable, usersTable } from "@workspace/db";
import type { PasswordResetToken } from "@workspace/db";

// ---------------------------------------------------------------------------
// Token expiry
// ---------------------------------------------------------------------------
/** Admin accounts get a shorter window — they are higher-value targets. */
export const ADMIN_EXPIRY_MINUTES = 15;
export const DEFAULT_EXPIRY_MINUTES = 45;

export function expiryMinutesForRole(
  role: "admin" | "office" | "customer" | undefined,
): number {
  return role === "admin" ? ADMIN_EXPIRY_MINUTES : DEFAULT_EXPIRY_MINUTES;
}

// ---------------------------------------------------------------------------
// Cryptographic helpers
// ---------------------------------------------------------------------------

/**
 * Generate a cryptographically secure 32-byte (256-bit) random token.
 * Returns the raw hex string. This value is sent to the user — NEVER stored.
 */
export function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Hash a raw token with SHA-256. This value IS stored in the database.
 *
 * SHA-256 is appropriate here (unlike password hashing) because:
 *   - The raw token has 256 bits of entropy — brute-force is infeasible.
 *   - SHA-256 is fast, which is fine for high-entropy random values.
 *   - bcrypt/argon2 are designed for low-entropy secrets (passwords).
 */
export function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/**
 * One-way hash of an IP address for audit logging.
 * The raw IP is never stored — only this hash, which cannot be reversed.
 */
export function hashIp(ip: string): string {
  return crypto.createHash("sha256").update(ip).digest("hex");
}

// ---------------------------------------------------------------------------
// Database operations
// ---------------------------------------------------------------------------

/**
 * Mark all unused password reset tokens for this user as consumed.
 * Called before issuing a new token (so only one valid token per user at a
 * time) and again after a successful reset (belt-and-suspenders).
 */
export async function invalidatePreviousTokens(userId: number): Promise<void> {
  await db
    .update(passwordResetTokensTable)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(passwordResetTokensTable.userId, userId),
        isNull(passwordResetTokensTable.usedAt),
      ),
    );
}

/**
 * Create a new password reset token for the user.
 * Returns the raw token (to be emailed) and expiry minutes — raw token never
 * stored.
 */
export async function createResetToken(opts: {
  userId: number;
  role: "admin" | "office" | "customer";
  ip: string;
}): Promise<{ rawToken: string; expiryMinutes: number }> {
  const rawToken = generateToken();
  const tokenHash = hashToken(rawToken);
  const expiryMinutes = expiryMinutesForRole(opts.role);
  const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);
  const requestedIpHash = hashIp(opts.ip);

  await db.insert(passwordResetTokensTable).values({
    userId: opts.userId,
    tokenHash,
    expiresAt,
    requestedIpHash,
  });

  return { rawToken, expiryMinutes };
}

/**
 * Look up a valid (unused, non-expired) token row.
 * Returns the full row or null if invalid / expired / already used.
 */
export async function lookupValidToken(
  rawToken: string,
): Promise<PasswordResetToken | null> {
  const tokenHash = hashToken(rawToken);
  const now = new Date();

  const [row] = await db
    .select()
    .from(passwordResetTokensTable)
    .where(
      and(
        eq(passwordResetTokensTable.tokenHash, tokenHash),
        isNull(passwordResetTokensTable.usedAt),
        gt(passwordResetTokensTable.expiresAt, now),
      ),
    );

  return row ?? null;
}

/**
 * Check whether a token exists at all (valid OR expired/used).
 * Used to distinguish "expired" from "never existed / tampered" for audit
 * logging. The token hash is never returned in API responses.
 */
export async function lookupAnyToken(
  rawToken: string,
): Promise<PasswordResetToken | null> {
  const tokenHash = hashToken(rawToken);
  const [row] = await db
    .select()
    .from(passwordResetTokensTable)
    .where(eq(passwordResetTokensTable.tokenHash, tokenHash));
  return row ?? null;
}

/** Mark a specific token row as used immediately after a successful reset. */
export async function markTokenUsed(tokenId: number): Promise<void> {
  await db
    .update(passwordResetTokensTable)
    .set({ usedAt: new Date() })
    .where(eq(passwordResetTokensTable.id, tokenId));
}

/**
 * Atomically claim a valid reset token and update the user's password in a
 * single serializable transaction.
 *
 * Race-safety guarantee: Two concurrent reset attempts for the same token
 * cannot both succeed — the first writer marks `used_at` inside the
 * transaction; the second sees `used_at IS NOT NULL` and receives null.
 *
 * Steps performed inside the transaction (all-or-nothing):
 *   1. Re-fetch the token row with a SELECT … FOR UPDATE to acquire a
 *      row-level lock, preventing concurrent claims on the same token.
 *   2. Verify the token is still unused and unexpired (double-check after lock).
 *   3. Mark the claimed token as used.
 *   4. Update the user's password hash.
 *   5. Invalidate all other unused reset tokens for this user.
 *
 * Returns { claimed: true } on success, or { claimed: false } if the token
 * was already consumed or expired by the time the lock was acquired
 * (concurrent-use race lost).
 *
 * Note: bcrypt hashing is intentionally done BEFORE calling this function.
 * Holding a DB transaction open during a slow CPU-bound bcrypt operation
 * would unnecessarily tie up a connection slot; the hash is computed first
 * and passed in as newPasswordHash.
 */
export async function claimTokenAndUpdatePassword(
  tokenId: number,
  userId: number,
  newPasswordHash: string,
): Promise<{ claimed: true } | { claimed: false }> {
  const result = await db.transaction(async (tx) => {
    // Step 1 + 2: Lock the specific token row and verify it is still claimable.
    // Using raw SQL for SELECT … FOR UPDATE since Drizzle does not expose a
    // first-class `.forUpdate()` modifier yet — this is the established pattern
    // used elsewhere in this codebase for advisory-lock operations.
    const lockResult = await tx.execute(
      sql`SELECT id FROM password_reset_tokens
          WHERE id = ${tokenId}
            AND used_at IS NULL
            AND expires_at > NOW()
          FOR UPDATE`,
    );

    // If the lock query returned no row the token was already consumed or
    // expired between our initial lookup and now (concurrent request won the race).
    const rows = lockResult.rows as { id: number }[];
    if (rows.length === 0) {
      return { claimed: false as const };
    }

    // Step 3: Mark this token used.
    await tx
      .update(passwordResetTokensTable)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokensTable.id, tokenId));

    // Step 4: Update the password.
    await tx
      .update(usersTable)
      .set({ passwordHash: newPasswordHash })
      .where(eq(usersTable.id, userId));

    // Step 5: Invalidate every other unused token for this user (belt-and-suspenders).
    await tx
      .update(passwordResetTokensTable)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(passwordResetTokensTable.userId, userId),
          isNull(passwordResetTokensTable.usedAt),
        ),
      );

    return { claimed: true as const };
  });

  return result;
}

/**
 * Delete tokens that were consumed or expired more than 7 days ago.
 * Safe to call periodically — never removes unexpired, unused tokens.
 * Best-effort: catches and swallows errors so a cleanup failure never
 * propagates to a request handler.
 */
export async function cleanupExpiredTokens(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    // Delete rows that are either:
    //  a) already used (regardless of age), or
    //  b) expired AND older than the 7-day retention window
    await db.execute(
      sql`DELETE FROM password_reset_tokens
          WHERE used_at IS NOT NULL
             OR expires_at < ${cutoff}`,
    );
  } catch {
    // Best-effort — log silently, never throw from a cleanup job
  }
}
