import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * system_config — admin-configurable platform settings (key → value pairs).
 *
 * Values are stored as text; callers parse to int/bool as needed.
 * All writes go through the API; direct DB edits are discouraged.
 *
 * Seeded keys (migration 0028):
 *   trial_duration_days           — default trial length in days (default: 14)
 *   subscription_grace_period_days — days after expiry before hiding (default: 3)
 *   subscription_expiry_warning_days — days before expiry for "expiring" state (default: 7)
 */
export const systemConfigTable = pgTable("system_config", {
  key:         text("key").primaryKey(),
  value:       text("value").notNull(),
  description: text("description"),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy:   integer("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
});

export type SystemConfig = typeof systemConfigTable.$inferSelect;
