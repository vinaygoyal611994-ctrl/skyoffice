import { index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Stores hashed one-time tokens for password reset.
 *
 * SECURITY INVARIANTS:
 *  - `token_hash` is always SHA-256(raw_token); the raw token is never stored.
 *  - `requested_ip_hash` is SHA-256(ip_address); the raw IP is never stored.
 *  - `used_at IS NOT NULL` means the token has already been consumed.
 *  - A token is valid only when: used_at IS NULL AND expires_at > NOW().
 *  - All previous unused tokens for a user are invalidated before a new one
 *    is issued, and again after a successful reset.
 */
export const passwordResetTokensTable = pgTable(
  "password_reset_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    requestedIpHash: text("requested_ip_hash"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Queried on every reset attempt to find valid tokens for a user.
    index("idx_password_reset_tokens_user_id").on(table.userId),
  ],
);

export type PasswordResetToken =
  typeof passwordResetTokensTable.$inferSelect;
