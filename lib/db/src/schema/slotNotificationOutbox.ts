/**
 * slot_notification_outbox — Drizzle schema.
 *
 * Guarantees exactly-once email delivery for every new slot reservation.
 * One row is inserted atomically inside the processWaitlist transaction
 * (via createReservationRow → enqueueNotification), so the outbox row is
 * committed if and only if the reservation itself commits.
 *
 * The outbox worker (slotNotificationOutbox.ts) polls every 2 minutes,
 * locks rows via FOR UPDATE SKIP LOCKED, validates the reservation is still
 * live, sends the bilingual notification email, and updates the row status.
 *
 * Matches migration 0032_slot_notification_outbox.sql exactly.
 *
 * Notes on indexes:
 *   idx_slot_notif_outbox_office — reproduced here (office lookup / cascades).
 *   idx_slot_notif_outbox_due   — partial index (WHERE status IN ('pending','failed'));
 *     not natively expressible in Drizzle schema; managed only by migration 0032.
 *     It will be created on fresh DB runs by drizzle-kit migrate, and already
 *     exists in all environments that ran the migration.
 */

import {
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { officesTable } from "./offices";

// ── Status enum ───────────────────────────────────────────────────────────────

export const outboxStatusEnum = ["pending", "sent", "failed", "skipped"] as const;
export type OutboxStatus = (typeof outboxStatusEnum)[number];

// ── Notification-type enum ────────────────────────────────────────────────────

export const outboxNotificationTypeEnum = ["slot_reserved"] as const;
export type OutboxNotificationType = (typeof outboxNotificationTypeEnum)[number];

// ── Table ─────────────────────────────────────────────────────────────────────

export const slotNotificationOutboxTable = pgTable(
  "slot_notification_outbox",
  {
    id: serial("id").primaryKey(),

    officeId: integer("office_id")
      .notNull()
      .references(() => officesTable.id, { onDelete: "cascade" }),

    marketKey: text("market_key").notNull(),

    /**
     * Idempotency key: "{officeId}:{reservationStartedAt}".
     * Unique per reservation window — ON CONFLICT DO NOTHING on this column
     * prevents duplicate outbox rows if enqueueNotification is re-run.
     * Maps to the UNIQUE (reservation_id) constraint in migration 0032.
     */
    reservationId: text("reservation_id").notNull(),

    notificationType: text("notification_type", { enum: outboxNotificationTypeEnum })
      .notNull()
      .default("slot_reserved"),

    /**
     * Delivery lifecycle.  DB-level CHECK enforced by migration 0032:
     *   CHECK (status IN ('pending', 'sent', 'failed', 'skipped'))
     * Drizzle enum provides compile-time type-safety without duplicating the constraint.
     */
    status: text("status", { enum: outboxStatusEnum })
      .notNull()
      .default("pending"),

    /** Number of send attempts (both successful and failed).  Starts at 0. */
    attempts: integer("attempts").notNull().default(0),

    /**
     * Sanitised error description ≤ 500 chars.
     * Never contains stack traces, tokens, or credentials.
     */
    lastError: text("last_error"),

    /** When the worker should next attempt delivery (backoff-driven). */
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
    // Unique constraint on reservation_id — prevents duplicate outbox rows
    // for the same reservation (matches UNIQUE (reservation_id) in migration 0032).
    uniqueIndex("uq_slot_notif_outbox_reservation_id").on(table.reservationId),

    // Office lookup — cascading deletes, admin queries (idx_slot_notif_outbox_office).
    index("idx_slot_notif_outbox_office").on(table.officeId),

    // NOTE: idx_slot_notif_outbox_due is a partial index
    //   ON (next_attempt_at, status, attempts) WHERE status IN ('pending', 'failed')
    // Drizzle does not support partial indexes in table definitions.
    // This index is created by migration 0032 and exists in all environments.
  ],
);

// ── Inferred types ────────────────────────────────────────────────────────────

export type SlotNotificationOutbox       = typeof slotNotificationOutboxTable.$inferSelect;
export type SlotNotificationOutboxInsert = typeof slotNotificationOutboxTable.$inferInsert;
