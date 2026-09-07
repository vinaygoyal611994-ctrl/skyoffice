import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
  unique,
  index,
} from "drizzle-orm/pg-core";

// ── market_slot_allocations ───────────────────────────────────────────────────

export const marketSlotAllocationsTable = pgTable(
  "market_slot_allocations",
  {
    id:            serial("id").primaryKey(),
    officeId:      integer("office_id").notNull(),
    marketKey:     text("market_key").notNull(),
    slotStatus:    text("slot_status").notNull().default("waiting"),
    priorityTier:  integer("priority_tier").notNull().default(3),
    allocatedAt:   timestamp("allocated_at", { withTimezone: true }),
    releasedAt:    timestamp("released_at", { withTimezone: true }),
    releaseReason: text("release_reason"),
    allocatedBy:   integer("allocated_by"),
    notes:         text("notes"),
    // Reservation lifecycle (populated while slot_status = 'reserved')
    reservationStartedAt:    timestamp("reservation_started_at",   { withTimezone: true }),
    reservationExpiresAt:    timestamp("reservation_expires_at",   { withTimezone: true }),
    reservationReleasedAt:   timestamp("reservation_released_at",  { withTimezone: true }),
    reservationReleaseReason: text("reservation_release_reason"),
    /**
     * Payment-pending protection window.
     * Set to NOW()+30min when a Stripe Checkout session is created for this reservation.
     * The reservation sweeper skips any slot where payment_locked_until > NOW(), so a
     * reservation that expires during an active checkout cannot be released prematurely.
     * Cleared when payment succeeds, fails, or the 30-min window elapses naturally.
     */
    paymentLockedUntil: timestamp("payment_locked_until",          { withTimezone: true }),
    createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("market_slot_allocations_office_id_key").on(t.officeId),
    index("idx_slot_alloc_market_key").on(t.marketKey),
    index("idx_slot_alloc_slot_status").on(t.slotStatus),
    index("idx_slot_alloc_mkt_status").on(t.marketKey, t.slotStatus),
  ],
);

export type MarketSlotAllocation = typeof marketSlotAllocationsTable.$inferSelect;
export type MarketSlotAllocationInsert = typeof marketSlotAllocationsTable.$inferInsert;

/**
 * Slot status values:
 *   allocated    — office holds an active market slot; publicly visible
 *   reserved     — 3-hour exclusive hold pending payment confirmation;
 *                  counts against capacity (prevents double-booking)
 *   waiting      — on the waitlist; market is full or closed
 *   released     — slot released; office hidden; no capacity consumed
 *   not_required — office has no supply_gate_market_key (uncapped market)
 */
export type SlotStatus = "allocated" | "reserved" | "waiting" | "released" | "not_required";

// ── slot_audit_log ────────────────────────────────────────────────────────────

export const slotAuditLogTable = pgTable(
  "slot_audit_log",
  {
    id:               serial("id").primaryKey(),
    officeId:         integer("office_id").notNull(),
    marketKey:        text("market_key").notNull(),
    action:           text("action").notNull(),
    slotStatusBefore: text("slot_status_before"),
    slotStatusAfter:  text("slot_status_after"),
    priorityTier:     integer("priority_tier"),
    reason:           text("reason").notNull(),
    performedBy:      integer("performed_by"),
    metadata:         jsonb("metadata"),
    createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_slot_audit_office").on(t.officeId),
    index("idx_slot_audit_market").on(t.marketKey),
    index("idx_slot_audit_action").on(t.action),
  ],
);

export type SlotAuditLog = typeof slotAuditLogTable.$inferSelect;

export type SlotAuditAction =
  | "allocated"
  | "released"
  | "waitlist_entered"
  | "waitlist_exited"
  | "priority_assigned"
  | "admin_override"
  | "not_required"
  | "reservation_created"
  | "reservation_expired"
  | "reservation_released"
  | "reservation_converted";
