import { pool } from "@workspace/db";
import { logger } from "./logger";

/**
 * Invalidate ALL active sessions for a given user across all devices.
 *
 * This is called after a successful password reset so every logged-in device
 * is signed out and must re-authenticate with the new password.
 *
 * Implementation: connect-pg-simple stores session data as JSON in the
 * `session` table's `sess` column. We delete every session row where the
 * embedded `user.id` matches the given userId.
 *
 * The query uses the PostgreSQL JSON `->>` operator (works on both `json`
 * and `jsonb` column types) to extract the user id string for comparison.
 */
export async function invalidateAllSessions(userId: number): Promise<number> {
  try {
    const result = await pool.query(
      `DELETE FROM "session"
       WHERE sess -> 'user' ->> 'id' = $1::text`,
      [userId.toString()],
    );
    const count = result.rowCount ?? 0;
    logger.info({ userId, sessionsRemoved: count }, "Invalidated all user sessions after password reset");
    return count;
  } catch (err) {
    // Log but don't re-throw — session invalidation failure should not
    // prevent the password from being updated (the reset already completed).
    logger.error({ err, userId }, "Failed to invalidate sessions after password reset");
    return 0;
  }
}
