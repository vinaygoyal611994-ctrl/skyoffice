/**
 * provider_verification_tokens — schema for Blocker 8.
 *
 * Stores hashed OTP codes for email and phone verification.
 *
 * SECURITY INVARIANTS:
 *  - token_hash is always SHA-256(raw_6_digit_otp); raw code is never stored.
 *  - channel is 'email' or 'phone' — which contact method is being verified.
 *  - A token is valid only when: used_at IS NULL AND expires_at > NOW().
 *  - All previous unused tokens for (user_id, channel) are invalidated
 *    before a new one is issued.
 *  - Failed guesses are persisted and invalidate the token after three tries.
 *  - Expired/used rows are safe to prune — they serve no functional purpose.
 *
 * Matches migration 0036_provider_verification_and_sr_notifications.sql.
 */

import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";

export const verificationChannelEnum = ["email", "phone"] as const;
export type VerificationChannel = (typeof verificationChannelEnum)[number];

export const providerVerificationTokensTable = pgTable(
  "provider_verification_tokens",
  {
    id: serial("id").primaryKey(),

    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),

    /** Which channel is being verified: 'email' | 'phone' */
    channel: text("channel", { enum: verificationChannelEnum }).notNull(),

    /** SHA-256(raw OTP) — raw code is never stored. */
    tokenHash: text("token_hash").notNull(),

    /** Email address or E.164 phone number the code was sent to. */
    contact: text("contact").notNull(),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    attemptCount: integer("attempt_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // One valid token per user per channel — looked up on every verify attempt.
    index("idx_prov_verif_tokens_user_channel").on(table.userId, table.channel),
    // Concurrent issuance must not create multiple active codes.
    uniqueIndex("uq_prov_verif_tokens_active_user_channel")
      .on(table.userId, table.channel)
      .where(sql`${table.usedAt} IS NULL`),
  ],
);

export type ProviderVerificationToken =
  typeof providerVerificationTokensTable.$inferSelect;
