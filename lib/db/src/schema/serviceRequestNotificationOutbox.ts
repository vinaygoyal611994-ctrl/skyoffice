/**
 * service_request_notification_outbox — schema for Blocker 9.
 *
 * Exactly-once lifecycle email delivery for service request status changes.
 *
 * Architecture (mirrors slot_notification_outbox):
 *  1. One or two outbox rows are inserted atomically inside the status-change
 *     transaction (one for the customer, one for the office as appropriate).
 *     If the status update rolls back, the outbox row rolls back too.
 *  2. The outbox worker polls every 2 minutes, locks rows via FOR UPDATE SKIP
 *     LOCKED, fetches recipient contact info, sends the bilingual email, and
 *     marks the row sent/failed/skipped.
 *  3. Exponential backoff on failure; permanently failed after 5 attempts.
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
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { serviceRequestsTable } from "./serviceRequests";

// ── Notification-type enum ────────────────────────────────────────────────────

export const srNotificationTypeEnum = [
  "sr_submitted",                  // → office: new request received
  "sr_offer_sent",                 // → customer: office sent an offer
  "sr_offer_accepted",             // → office: customer accepted the offer
  "sr_offer_rejected",             // → office: customer rejected the offer
  "sr_rejected",                   // → customer: office rejected the request
  "sr_completed_awaiting_confirm", // → customer: awaiting your confirmation
  "sr_confirmed_completed",        // → office: customer confirmed completion
  "sr_not_completed",              // → office: customer flagged not completed
] as const;

export type SrNotificationType = (typeof srNotificationTypeEnum)[number];

// ── Delivery-status enum ──────────────────────────────────────────────────────

export const srOutboxStatusEnum = ["pending", "sent", "failed", "skipped"] as const;
export type SrOutboxStatus = (typeof srOutboxStatusEnum)[number];

// ── Table ─────────────────────────────────────────────────────────────────────

export const serviceRequestNotificationOutboxTable = pgTable(
  "service_request_notification_outbox",
  {
    id: serial("id").primaryKey(),

    /** FK to the service request this notification relates to. */
    serviceRequestId: integer("service_request_id")
      .notNull()
      .references(() => serviceRequestsTable.id, { onDelete: "cascade" }),

    /** The user who should receive this notification. */
    recipientUserId: integer("recipient_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),

    /** Whether the recipient is the customer or the office in this context. */
    recipientRole: text("recipient_role", { enum: ["customer", "office"] }).notNull(),

    /** Which lifecycle event triggered this notification. */
    notificationType: text("notification_type", {
      enum: srNotificationTypeEnum,
    }).notNull(),

    /** Delivery lifecycle. */
    status: text("status", { enum: srOutboxStatusEnum })
      .notNull()
      .default("pending"),

    /** Number of send attempts (0 = not yet tried). */
    attempts: integer("attempts").notNull().default(0),

    /** Sanitised error description ≤500 chars; never contains stack traces. */
    lastError: text("last_error"),

    /** Earliest time for next delivery attempt (backoff-driven). */
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    /** Populated when status transitions to 'sent' or 'skipped'. */
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (table) => [
    // Worker scan: fetch due notifications efficiently (mirrors slot outbox pattern).
    // Partial index created by migration 0036; declared here for completeness.
    // Note: drizzle-kit will create the non-partial variant; migration creates the partial.
    index("idx_sr_notif_outbox_due").on(
      table.nextAttemptAt,
      table.status,
      table.attempts,
    ),

    // Recipient user lookup (admin queries, cascade awareness)
    index("idx_sr_notif_outbox_recipient").on(table.recipientUserId),

    // Service-request lookup
    index("idx_sr_notif_outbox_sr_id").on(table.serviceRequestId),
  ],
);

export type ServiceRequestNotificationOutbox =
  typeof serviceRequestNotificationOutboxTable.$inferSelect;
export type ServiceRequestNotificationOutboxInsert =
  typeof serviceRequestNotificationOutboxTable.$inferInsert;
