import {
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";
import { officesTable } from "./offices";

// ── Subscription lifecycle states ─────────────────────────────────────────────

export const subscriptionStateEnum = [
  "free",                    // registered, no subscription started
  "trial",                   // trial period active
  "active_paid",             // paid subscription active
  "expiring",                // within warning window of expires_at
  "expired",                 // expired, still visible (grace period)
  "hidden_due_to_nonpayment", // hidden from public (beyond grace period)
  "cancelled",               // explicitly cancelled
] as const;

export type SubscriptionState = (typeof subscriptionStateEnum)[number];

// ── Notification types ────────────────────────────────────────────────────────

export const subscriptionNotificationTypeEnum = [
  "expiry_7d",   // 7 days before expires_at
  "expiry_3d",   // 3 days before expires_at
  "expiry_1d",   // 1 day before expires_at
  "expiry_day",  // on expiry day
] as const;

export type SubscriptionNotificationType = (typeof subscriptionNotificationTypeEnum)[number];

// ── office_subscriptions ──────────────────────────────────────────────────────

/**
 * One row per office, always reflecting the CURRENT subscription state.
 * All historical state changes are in subscription_history.
 */
export const officeSubscriptionsTable = pgTable(
  "office_subscriptions",
  {
    id:       serial("id").primaryKey(),
    officeId: integer("office_id")
      .notNull()
      .unique()
      .references(() => officesTable.id, { onDelete: "cascade" }),

    state: text("state", { enum: subscriptionStateEnum })
      .notNull()
      .default("free"),

    // Trial window
    trialStartedAt: timestamp("trial_started_at", { withTimezone: true }),
    trialEndsAt:    timestamp("trial_ends_at",    { withTimezone: true }),

    // Paid access window (set when payment confirmed — future integration)
    paidThroughDate: timestamp("paid_through_date", { withTimezone: true }),

    // Unified expiry: trial_ends_at or paid_through_date, whichever is active.
    // Used by the sweeper to fire reminders and transition expired/expiring states.
    // Reset (notified_reminders cleared) whenever this is set to a new date.
    expiresAt: timestamp("expires_at", { withTimezone: true }),

    // Cancellation
    cancelledAt:  timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy:  integer("cancelled_by").references(() => usersTable.id, { onDelete: "set null" }),
    cancelReason: text("cancel_reason"),

    // Hidden-due-to-non-payment timestamp
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),

    // Notification dedup: which reminder types already sent for current expires_at period.
    // Values: '7d', '3d', '1d', 'day'.  Cleared on every new trial or renewal.
    notifiedReminders: text("notified_reminders")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),

    notes:     text("notes"),

    // Slot-sync recovery flag.
    // Set when the subscription commits to active_paid but the post-commit
    // convertReservationToAllocation() call fails.
    // NULL = no issue.  NOT NULL = slot-sync sweeper must retry.
    // Cleared by runSlotSyncSweep() on successful recovery.
    slotSyncNeededAt: timestamp("slot_sync_needed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_office_subscriptions_state").on(table.state),
    index("idx_office_subscriptions_expires_at").on(table.expiresAt),
  ],
);

export type OfficeSubscription = typeof officeSubscriptionsTable.$inferSelect;

// ── subscription_history ──────────────────────────────────────────────────────

/**
 * Immutable audit trail — every subscription state change is recorded here.
 * Never updated; only INSERTed.  Preserves full history even after the
 * current office_subscriptions row is overwritten with a new state.
 */
export const subscriptionHistoryTable = pgTable(
  "subscription_history",
  {
    id:             serial("id").primaryKey(),
    officeId:       integer("office_id")
      .notNull()
      .references(() => officesTable.id, { onDelete: "cascade" }),
    subscriptionId: integer("subscription_id")
      .references(() => officeSubscriptionsTable.id, { onDelete: "set null" }),
    fromState:  text("from_state"),          // NULL on initial 'free' insertion
    toState:    text("to_state").notNull(),
    reason:     text("reason"),
    changedBy:  integer("changed_by")
      .references(() => usersTable.id, { onDelete: "set null" }), // NULL = system/sweeper
    metadata:   jsonb("metadata"),
    createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_subscription_history_office_id").on(table.officeId),
    index("idx_subscription_history_created_at").on(table.createdAt),
    index("idx_subscription_history_to_state").on(table.toState),
  ],
);

export type SubscriptionHistory = typeof subscriptionHistoryTable.$inferSelect;

// ── subscription_notifications ────────────────────────────────────────────────

/**
 * Dedup guard for expiry reminder emails.
 * One row per (office_id, notification_type, period_expires_at).
 * A new trial/renewal period has a different period_expires_at → new reminders fire.
 */
export const subscriptionNotificationsTable = pgTable(
  "subscription_notifications",
  {
    id:               serial("id").primaryKey(),
    officeId:         integer("office_id")
      .notNull()
      .references(() => officesTable.id, { onDelete: "cascade" }),
    notificationType: text("notification_type", {
      enum: subscriptionNotificationTypeEnum,
    }).notNull(),
    periodExpiresAt:  timestamp("period_expires_at", { withTimezone: true }).notNull(),
    sentAt:           timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    metadata:         jsonb("metadata"),
  },
  (table) => [
    uniqueIndex("uq_sub_notifications_key").on(
      table.officeId, table.notificationType, table.periodExpiresAt,
    ),
    index("idx_subscription_notifications_office").on(table.officeId),
  ],
);

export type SubscriptionNotification = typeof subscriptionNotificationsTable.$inferSelect;
