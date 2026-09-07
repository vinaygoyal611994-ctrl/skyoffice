import { boolean, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Account status model (customer accounts only for now, but the column is
// generic on the users table). "deactivated" blocks login entirely;
// "suspended" can still log in/browse but is blocked from creating new
// contact events / video-call requests. Always re-checked fresh against the
// DB where it matters — never trusted from stale session data.
export const userStatusEnum = ["active", "suspended", "deactivated"] as const;

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  role: text("role", { enum: ["office", "customer", "admin"] }).notNull(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone"),
  passwordHash: text("password_hash").notNull(),
  status: text("status", { enum: userStatusEnum }).notNull().default("active"),
  statusReason: text("status_reason"),
  statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
  statusChangedBy: integer("status_changed_by"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  // Tracks the last time any mutable field on this row changed (password,
  // status, role, name). Populated by the migration default and kept current
  // by $onUpdate — safe to query without reading the audit log.
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  // Legal consent — populated at registration time; nullable so existing
  // accounts are unaffected. Version strings use semver-style "1.0" initially.
  termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
  privacyAcceptedAt: timestamp("privacy_accepted_at", { withTimezone: true }),
  acceptedTermsVersion: text("accepted_terms_version"),
  acceptedPrivacyVersion: text("accepted_privacy_version"),
  // Marks seed, QA, and internal-admin accounts so they are excluded from
  // business analytics without scattered email-pattern checks. Set at account
  // creation for internal accounts; defaults to false for all real users.
  isInternal: boolean("is_internal").notNull().default(false),
  // Blocker 8: provider email/phone verification timestamps.
  // Null means unverified. Set once upon successful OTP confirmation.
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true }),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
