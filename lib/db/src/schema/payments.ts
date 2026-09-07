import {
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { officesTable } from "./offices";
import { officeSubscriptionsTable } from "./subscriptions";
import { plansTable } from "./plans";

/**
 * office_payment_transactions — Ledger of all payment attempts.
 *
 * One row per checkout session. Multiple rows per office over time (one per
 * billing cycle attempt).
 *
 * The system relies on three layers of idempotency:
 *   1. idempotency_key (UNIQUE) — prevents double checkout-session creation for the same billing month
 *   2. gateway_session_id (UNIQUE) — Stripe session; prevents double webhook processing
 *   3. gateway_event_id (UNIQUE) — Stripe event ID; prevents Stripe replay delivery triggering a second activation
 *
 * status values:
 *   pending       — checkout session created, webhook not yet received
 *   succeeded     — Stripe confirmed payment; subscription activated
 *   failed        — Stripe reported failure (card declined, etc.)
 *   cancelled     — session cancelled or gateway error before completion
 *   failed_no_slot — Stripe succeeded but slot had expired before activation
 */
export const officePaymentTransactionsTable = pgTable(
  "office_payment_transactions",
  {
    id:                       serial("id").primaryKey(),
    officeId:                 integer("office_id").notNull()
                                .references(() => officesTable.id, { onDelete: "cascade" }),
    subscriptionId:           integer("subscription_id")
                                .references(() => officeSubscriptionsTable.id, { onDelete: "set null" }),
    planId:                   integer("plan_id")
                                .references(() => plansTable.id, { onDelete: "set null" }),
    // reservation_id is nullable — uncapped-market renewals don't require a reservation
    reservationId:            integer("reservation_id"),
    amountHalalas:            integer("amount_halalas").notNull(),
    currency:                 text("currency").notNull().default("SAR"),
    gateway:                  text("gateway").notNull().default("stripe"),
    gatewaySessionId:         text("gateway_session_id").notNull(),
    gatewayPaymentIntentId:   text("gateway_payment_intent_id"),
    gatewayEventId:           text("gateway_event_id"),
    idempotencyKey:           text("idempotency_key").notNull(),
    status:                   text("status").notNull().default("pending"),
    paidAt:                   timestamp("paid_at", { withTimezone: true }),
    failedAt:                 timestamp("failed_at", { withTimezone: true }),
    failureReason:            text("failure_reason"),
    metadata:                 jsonb("metadata"),
    createdAt:                timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:                timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_payment_txn_session_id").on(table.gatewaySessionId),
    uniqueIndex("uq_payment_txn_payment_intent").on(table.gatewayPaymentIntentId),
    uniqueIndex("uq_payment_txn_event_id").on(table.gatewayEventId),
    uniqueIndex("uq_payment_txn_idempotency").on(table.idempotencyKey),
    index("idx_payment_txn_office_status").on(table.officeId, table.status),
  ],
);

export type OfficePaymentTransaction = typeof officePaymentTransactionsTable.$inferSelect;
export type OfficePaymentTransactionInsert = typeof officePaymentTransactionsTable.$inferInsert;
