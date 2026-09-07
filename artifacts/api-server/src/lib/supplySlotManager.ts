/**
 * Supply Slot Manager — Active Supply Slot + Returning Provider Waitlist
 *
 * KEY INVARIANTS (enforced by this module):
 *   1. Account, Subscription, Supply Slot, and Visibility are INDEPENDENT.
 *   2. active_paid + slot_status=waiting is IMPOSSIBLE through normal flows.
 *      Payment requires a valid reservation (or existing allocation, or uncapped).
 *   3. Consumer count = allocated + reserved (both consume capacity).
 *   4. processWaitlist() creates 3-hour RESERVATIONS for capped markets.
 *      It allocates directly only for uncapped markets.
 *   5. Closed markets block new reservations/allocations even with spare capacity.
 *   6. All events recorded in slot_audit_log (immutable, append-only).
 *   7. office data, reviews, transactions, reputation are NEVER deleted.
 *
 * Slot lifecycle:
 *   [new approval]         → allocated (admin direct; no reservation needed)
 *   [capacity check]       → reserved (3h window; checkPrePaymentCapacity)
 *   reserved → allocated   (convertReservationToAllocation — payment confirmed)
 *   reserved → released    (expireReservation — sweeper, or releaseSlot)
 *   allocated → released   (releaseSlot — non-payment / cancellation / suspension)
 *   released → reserved    (processWaitlist — slot freed, next in line gets reservation)
 *   waiting → reserved     (processWaitlist — slot freed, next in line gets reservation)
 *   waiting → released     (releaseSlot — rejection / suspension while waiting)
 *   [no market key]        → not_required
 *
 * Priority tiers:
 *   1 = returning  — previously held an allocated slot in this market (allocated_at IS NOT NULL)
 *   2 = existing   — approved/active, has supply_gate_market_key, never held a slot
 *   3 = new        — everything else
 *
 * Within a tier: most-recently-allocated provider first (allocated_at DESC NULLS LAST),
 * then FIFO (created_at ASC).
 */

import { pool } from "@workspace/db";
import { logger } from "./logger";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SlotStatus = "allocated" | "reserved" | "waiting" | "released" | "not_required";

export interface SlotResult {
  slotStatus:   SlotStatus;
  marketKey:    string | null;
  priorityTier: number;
}

/** Result of a pre-payment capacity check. */
export interface PrePaymentResult {
  /**
   * Whether the provider can proceed to payment right now.
   * true  → payment gateway may proceed
   * false → payment must be blocked; provider is on the waitlist
   */
  canPay:               boolean;
  reason:
    | "valid_reservation"   // has a valid (unexpired) reservation
    | "active_slot"         // already allocated (subscription renewal)
    | "not_required"        // uncapped market — no reservation needed
    | "reservation_created" // reservation just created for them (capacity found)
    | "waitlist_entered"    // entered waitlist; market full or closed
    | "already_waiting"     // already on waitlist, still waiting
    | "already_reserved_expired" // had a reservation but it expired; re-queued
    ;
  slotStatus:           SlotStatus | null;
  reservationExpiresAt: Date | null;
  marketKey:            string | null;
  /** English explanation (show to provider). */
  message:   string;
  /** Arabic explanation (show to provider). */
  messageAr: string;
}

export interface WaitlistEntry {
  officeId:     number;
  name:         string;
  nameAr:       string | null;
  city:         string;
  marketKey:    string;
  providerType: string;
  priorityTier: number;
  slotStatus:   SlotStatus;
  allocatedAt:  Date | null;
  createdAt:    Date;
}

export interface ReservationEntry {
  officeId:             number;
  name:                 string;
  nameAr:               string | null;
  city:                 string;
  marketKey:            string;
  providerType:         string;
  priorityTier:         number;
  reservationStartedAt: Date;
  reservationExpiresAt: Date;
  minutesRemaining:     number;
}

export interface MarketSlotSummary {
  marketKey:        string;
  supplyCap:        number | null;
  allocatedSlots:   number;
  reservedSlots:    number;
  activeSlots:      number;        // allocated + reserved (= capacity consumed)
  remainingSlots:   number | null;
  waitingCount:     number;
  returningWaiting: number;
  isClosed:         boolean;
}

export interface ProcessWaitlistResult {
  reserved:  number[];  // office IDs that received 3-hour reservations (capped markets)
  allocated: number[];  // office IDs directly allocated (uncapped markets only)
}

// ── Internal helpers ──────────────────────────────────────────────────────────

interface OfficeMarketRow {
  id:                     number;
  supply_gate_market_key: string | null;
  country:                string | null;
  city:                   string;
  category:               string;
}

async function fetchOfficeMarket(officeId: number): Promise<OfficeMarketRow | null> {
  const res = await pool.query<OfficeMarketRow>(
    `SELECT id, supply_gate_market_key, country, city, category
     FROM offices WHERE id = $1`,
    [officeId],
  );
  return res.rows[0] ?? null;
}

/** Count offices consuming market capacity (allocated + reserved). */
async function countActiveSlots(marketKey: string, client: { query: Function }): Promise<number> {
  const res = await client.query(
    `SELECT COUNT(*)::integer AS cnt
     FROM market_slot_allocations
     WHERE market_key = $1 AND slot_status IN ('allocated', 'reserved')`,
    [marketKey],
  );
  return (res.rows[0] as { cnt: number } | undefined)?.cnt ?? 0;
}

/** Fetch supply_cap for a market key using the given client (for use inside transactions). */
async function fetchCapForMarketKey(
  marketKey: string,
  client: { query: Function },
): Promise<number | null> {
  const parts = marketKey.split("|");
  if (parts.length !== 3) return null;
  const [countryCode, cityId, categoryId] = parts;
  const res = await client.query(
    `SELECT supply_cap FROM market_supply_control
     WHERE country_code = $1 AND city_id = $2 AND category_id = $3 LIMIT 1`,
    [countryCode, cityId, categoryId],
  );
  return (res.rows[0] as { supply_cap: number | null } | undefined)?.supply_cap ?? null;
}

/** Check if a market is closed (acceptance_status = 'closed'). */
async function isMarketClosed(marketKey: string): Promise<boolean> {
  const parts = marketKey.split("|");
  if (parts.length !== 3) return false;
  const [countryCode, cityId, categoryId] = parts;
  const res = await pool.query<{ acceptance_status: string }>(
    `SELECT acceptance_status FROM market_supply_control
     WHERE country_code = $1 AND city_id = $2 AND category_id = $3 LIMIT 1`,
    [countryCode, cityId, categoryId],
  );
  return res.rows[0]?.acceptance_status === "closed";
}

/** Check if a market is closed using a transaction client. */
async function isMarketClosedTx(marketKey: string, client: { query: Function }): Promise<boolean> {
  const parts = marketKey.split("|");
  if (parts.length !== 3) return false;
  const [countryCode, cityId, categoryId] = parts;
  const res = await client.query(
    `SELECT acceptance_status FROM market_supply_control
     WHERE country_code = $1 AND city_id = $2 AND category_id = $3 LIMIT 1`,
    [countryCode, cityId, categoryId],
  );
  return (res.rows[0] as { acceptance_status: string } | undefined)?.acceptance_status === "closed";
}

async function recordAuditEntry(opts: {
  officeId:         number;
  marketKey:        string;
  action:           string;
  slotStatusBefore: string | null;
  slotStatusAfter:  string;
  priorityTier:     number;
  reason:           string;
  performedBy:      number | null;
  metadata?:        Record<string, unknown>;
  client?:          { query: Function };
}): Promise<void> {
  const q = opts.client ?? pool;
  await q.query(
    `INSERT INTO slot_audit_log (
       office_id, market_key, action, slot_status_before, slot_status_after,
       priority_tier, reason, performed_by, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      opts.officeId, opts.marketKey, opts.action,
      opts.slotStatusBefore, opts.slotStatusAfter,
      opts.priorityTier, opts.reason, opts.performedBy,
      opts.metadata ? JSON.stringify(opts.metadata) : null,
    ],
  );
}

/** Create a 3-hour reservation row for an office (inside a transaction).
 *
 * Also creates a slot_notification_outbox row atomically — if the reservation
 * INSERT succeeds, the outbox row is guaranteed to exist so the provider is
 * notified even if the server crashes before the outbox worker runs.
 *
 * The `reservation_id` (officeId:now.toISOString()) is the idempotency key;
 * ON CONFLICT DO NOTHING prevents duplicate outbox entries if this is re-run.
 */
async function createReservationRow(
  officeId: number,
  marketKey: string,
  priorityTier: number,
  prevStatus: string | null,
  client: { query: Function },
): Promise<Date> {
  const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + THREE_HOURS_MS);

  // 1. Create / refresh the reservation slot row.
  await client.query(
    `INSERT INTO market_slot_allocations
       (office_id, market_key, slot_status, priority_tier,
        reservation_started_at, reservation_expires_at, updated_at)
     VALUES ($1, $2, 'reserved', $3, $4, $5, $4)
     ON CONFLICT (office_id) DO UPDATE
       SET slot_status               = 'reserved',
           market_key                = EXCLUDED.market_key,
           priority_tier             = $3,
           reservation_started_at    = $4,
           reservation_expires_at    = $5,
           reservation_released_at   = NULL,
           reservation_release_reason = NULL,
           updated_at                = $4`,
    [officeId, marketKey, priorityTier, now, expiresAt],
  );

  // 2. Slot lifecycle audit.
  await client.query(
    `INSERT INTO slot_audit_log
       (office_id, market_key, action, slot_status_before, slot_status_after,
        priority_tier, reason, performed_by)
     VALUES ($1,$2,'reservation_created',$3,'reserved',$4,'slot_available_system',NULL)`,
    [officeId, marketKey, prevStatus, priorityTier],
  );

  // 3. Notification outbox — atomic with the reservation (same transaction).
  //    ON CONFLICT DO NOTHING: idempotent if createReservationRow is re-run for
  //    the same reservation_started_at (e.g., after a partial rollback retry).
  const reservationId = `${officeId}:${now.toISOString()}`;
  await client.query(
    `INSERT INTO slot_notification_outbox
       (office_id, market_key, reservation_id, notification_type, status, next_attempt_at)
     VALUES ($1, $2, $3, 'slot_reserved', 'pending', NOW())
     ON CONFLICT (reservation_id) DO NOTHING`,
    [officeId, marketKey, reservationId],
  );

  // 4. Notification lifecycle audit.
  await client.query(
    `INSERT INTO slot_audit_log
       (office_id, market_key, action, slot_status_before, slot_status_after,
        priority_tier, reason, performed_by)
     VALUES ($1,$2,'notification_queued',$3,'reserved',$4,'outbox_reservation_notice',NULL)`,
    [officeId, marketKey, prevStatus, priorityTier],
  );

  return expiresAt;
}

// ── RESERVATION_DURATION_HOURS ────────────────────────────────────────────────

/** Duration of a slot reservation in milliseconds. */
const RESERVATION_DURATION_MS = 3 * 60 * 60 * 1000; // 3 hours

// ── determinePriorityTier ─────────────────────────────────────────────────────

/**
 * Determine the waitlist priority tier for an office in a given market.
 *   Tier 1: previously held an allocated slot (allocated_at IS NOT NULL)
 *   Tier 2: approved/active with a supply_gate_market_key, never held a slot
 *   Tier 3: everything else
 */
export async function determinePriorityTier(officeId: number, marketKey: string): Promise<number> {
  const returning = await pool.query<{ cnt: number }>(
    `SELECT COUNT(*)::integer AS cnt
     FROM market_slot_allocations
     WHERE office_id = $1 AND market_key = $2 AND allocated_at IS NOT NULL`,
    [officeId, marketKey],
  );
  if ((returning.rows[0]?.cnt ?? 0) > 0) return 1;

  const existing = await pool.query<{ cnt: number }>(
    `SELECT COUNT(*)::integer AS cnt
     FROM offices
     WHERE id = $1
       AND supply_gate_market_key = $2
       AND status IN ('approved','active')
       AND is_demo = false`,
    [officeId, marketKey],
  );
  if ((existing.rows[0]?.cnt ?? 0) > 0) return 2;

  return 3;
}

// ── checkPrePaymentCapacity ───────────────────────────────────────────────────

/**
 * Pre-payment capacity gate. Must be called by the payment gateway BEFORE
 * initiating any charge or paid activation.
 *
 * Outcomes:
 *   canPay=true  — payment may proceed; one of:
 *     valid_reservation   — holds a valid (unexpired) reservation
 *     active_slot         — already allocated (subscription renewal)
 *     not_required        — uncapped market
 *     reservation_created — slot found, reservation just created for them
 *
 *   canPay=false — payment must be blocked; one of:
 *     waitlist_entered        — entered waitlist; market full or closed
 *     already_waiting         — already on waitlist
 *     already_reserved_expired — their reservation expired; re-entered waitlist
 *
 * Side-effects (only when canPay=false and office is not already waiting):
 *   - Enters the office into the waitlist
 *   - Calls processWaitlist() — may immediately create a new reservation if
 *     capacity exists and the office has highest priority
 */
export async function checkPrePaymentCapacity(officeId: number): Promise<PrePaymentResult> {
  const office = await fetchOfficeMarket(officeId);
  if (!office) throw new Error(`Office ${officeId} not found`);

  const marketKey = office.supply_gate_market_key;

  // ── Uncapped market (no market key) ──────────────────────────────────────
  if (!marketKey) {
    return {
      canPay: true,
      reason: "not_required",
      slotStatus: "not_required",
      reservationExpiresAt: null,
      marketKey: null,
      message:   "Your market has no capacity limit. Payment may proceed.",
      messageAr: "لا يوجد حد أقصى لسوقك. يمكنك المتابعة للدفع.",
    };
  }

  // ── Fetch current slot record ─────────────────────────────────────────────
  const slotRes = await pool.query<{
    slot_status: SlotStatus;
    market_key: string;
    allocated_at: Date | null;
    reservation_expires_at: Date | null;
  }>(
    `SELECT slot_status, market_key, allocated_at, reservation_expires_at
     FROM market_slot_allocations WHERE office_id = $1`,
    [officeId],
  );
  const slot = slotRes.rows[0];
  const now = new Date();

  // ── Valid reservation → can pay ───────────────────────────────────────────
  if (
    slot?.slot_status === "reserved" &&
    slot.market_key === marketKey &&
    slot.reservation_expires_at &&
    new Date(slot.reservation_expires_at) > now
  ) {
    return {
      canPay: true,
      reason: "valid_reservation",
      slotStatus: "reserved",
      reservationExpiresAt: new Date(slot.reservation_expires_at),
      marketKey,
      message:
        "A slot has been reserved for you. You have until " +
        new Date(slot.reservation_expires_at).toISOString() +
        " to complete payment.",
      messageAr:
        "تم حجز مقعد لك. لديك حتى " +
        new Date(slot.reservation_expires_at).toISOString() +
        " لإتمام الدفع.",
    };
  }

  // ── Already allocated (renewal) → can pay ────────────────────────────────
  if (slot?.slot_status === "allocated" && slot.market_key === marketKey) {
    return {
      canPay: true,
      reason: "active_slot",
      slotStatus: "allocated",
      reservationExpiresAt: null,
      marketKey,
      message:   "Your listing is active. Renewal payment may proceed.",
      messageAr: "ملفك نشط. يمكنك المتابعة لتجديد الاشتراك.",
    };
  }

  // ── Otherwise: check market and attempt to get a reservation ─────────────

  // Closed market — enter waitlist (for when it reopens), block payment
  const closed = await isMarketClosed(marketKey);
  if (closed) {
    // Enter waitlist if not already there
    const prevStatus = slot?.slot_status ?? null;
    if (prevStatus !== "waiting") {
      const priorityTier = await determinePriorityTier(officeId, marketKey);
      await pool.query(
        `INSERT INTO market_slot_allocations
           (office_id, market_key, slot_status, priority_tier, updated_at)
         VALUES ($1, $2, 'waiting', $3, NOW())
         ON CONFLICT (office_id) DO UPDATE
           SET slot_status = 'waiting',
               market_key = EXCLUDED.market_key,
               priority_tier = $3,
               updated_at = NOW()`,
        [officeId, marketKey, priorityTier],
      );
      // Outer check guarantees prevStatus !== "waiting" — audit unconditionally
      await recordAuditEntry({
        officeId, marketKey, action: "waitlist_entered",
        slotStatusBefore: prevStatus, slotStatusAfter: "waiting",
        priorityTier, reason: "market_closed_pre_payment_check",
        performedBy: null,
      });
    }

    return {
      canPay: false,
      reason: prevStatus === "waiting" ? "already_waiting" : "waitlist_entered",
      slotStatus: "waiting",
      reservationExpiresAt: null,
      marketKey,
      message:
        "The market for this category in your city is currently closed to new providers. " +
        "SkayOffice is not accepting payment for this market at the moment. " +
        "Your account, profile, reputation, and history are preserved. " +
        "You are on the waitlist for when this market reopens.",
      messageAr:
        "السوق لهذه الفئة في مدينتك مغلق حالياً أمام المزودين الجدد. " +
        "لا يمكن لـ SkayOffice قبول الدفع لهذا السوق في الوقت الحالي. " +
        "حسابك وملفك الشخصي وسمعتك وتاريخك محفوظة. " +
        "أنت في قائمة الانتظار لحين إعادة فتح هذا السوق.",
    };
  }

  // Handle expired reservation — re-enter waitlist
  const hadExpiredReservation =
    slot?.slot_status === "reserved" &&
    slot.reservation_expires_at &&
    new Date(slot.reservation_expires_at) <= now;

  // Enter waitlist (atomically; skip if already waiting)
  const currentStatus = slot?.slot_status ?? null;
  const priorityTier = await determinePriorityTier(officeId, marketKey);

  if (currentStatus !== "waiting") {
    await pool.query(
      `INSERT INTO market_slot_allocations
         (office_id, market_key, slot_status, priority_tier, updated_at)
       VALUES ($1, $2, 'waiting', $3, NOW())
       ON CONFLICT (office_id) DO UPDATE
         SET slot_status = 'waiting',
             market_key = EXCLUDED.market_key,
             priority_tier = $3,
             reservation_started_at = NULL,
             reservation_expires_at = NULL,
             updated_at = NOW()
       WHERE market_slot_allocations.slot_status NOT IN ('allocated')`,
      [officeId, marketKey, priorityTier],
    );
    await recordAuditEntry({
      officeId, marketKey, action: "waitlist_entered",
      slotStatusBefore: currentStatus, slotStatusAfter: "waiting",
      priorityTier, reason: "pre_payment_check_no_reservation",
      performedBy: null,
      metadata: hadExpiredReservation ? { previouslyHadExpiredReservation: true } : undefined,
    });
  }

  // Set is_subscription_hidden = true (not visible while waiting/unallocated)
  await pool.query(
    `UPDATE offices SET is_subscription_hidden = true WHERE id = $1`,
    [officeId],
  );

  // Trigger processWaitlist — if capacity exists and this office is highest priority,
  // they may get a reservation immediately.
  const pwResult = await processWaitlist(marketKey);
  const gotReservation = pwResult.reserved.includes(officeId);

  if (gotReservation) {
    // Re-fetch to get the reservation expiry
    const refreshRes = await pool.query<{ reservation_expires_at: Date }>(
      `SELECT reservation_expires_at FROM market_slot_allocations WHERE office_id = $1`,
      [officeId],
    );
    const expiresAt = refreshRes.rows[0]?.reservation_expires_at ?? null;

    return {
      canPay: true,
      reason: "reservation_created",
      slotStatus: "reserved",
      reservationExpiresAt: expiresAt,
      marketKey,
      message:
        "A slot has been reserved for you. You have 3 hours to complete payment and activate your listing.",
      messageAr:
        "تم حجز مقعد لك. لديك 3 ساعات لإتمام الدفع وتفعيل ملفك الشخصي.",
    };
  }

  return {
    canPay: false,
    reason: hadExpiredReservation ? "already_reserved_expired"
          : currentStatus === "waiting" ? "already_waiting"
          : "waitlist_entered",
    slotStatus: "waiting",
    reservationExpiresAt: null,
    marketKey,
    message:
      "The market for this category in your city is currently at capacity. " +
      "SkayOffice is not accepting payment for this market at the moment. " +
      "Your account, profile, reputation, and history are preserved (محفوظة). " +
      "You are on the waitlist and will be notified when a slot becomes available. " +
      "Once notified, you will have 3 hours to activate and pay. " +
      "Joining the waitlist does not guarantee a market slot.",
    messageAr:
      "اكتمل الحد الأقصى لمزودي الخدمة في هذه الفئة وهذه المدينة. " +
      "لا يمكن لـ SkayOffice قبول الدفع لهذا السوق في الوقت الحالي. " +
      "حسابك وملفك الشخصي وسمعتك وتاريخك محفوظة. " +
      "أنت في قائمة الانتظار وسيتم إشعارك عند توفر مقعد. " +
      "بمجرد إشعارك، ستملك 3 ساعات للتفعيل والدفع. " +
      "الانضمام إلى قائمة الانتظار لا يضمن الحصول على مقعد.",
  };
}

// ── convertReservationToAllocation ───────────────────────────────────────────

/**
 * Convert a valid reservation to an allocated slot after payment is confirmed.
 * Called by the payment gateway after a successful charge.
 *
 * Throws if:
 *   - No slot record exists for the office
 *   - Slot is not in 'reserved' status
 *   - Reservation has expired
 *
 * Effects:
 *   - Sets slot_status → 'allocated', allocated_at → NOW()
 *   - Clears reservation timestamps (marks reservation_released_at)
 *   - Sets is_subscription_hidden = false (office becomes publicly visible)
 *   - Records 'reservation_converted' audit event
 */
export async function convertReservationToAllocation(
  officeId: number,
  adminId?: number | null,
): Promise<void> {
  const res = await pool.query<{
    slot_status: SlotStatus;
    market_key: string;
    priority_tier: number;
    reservation_expires_at: Date | null;
  }>(
    `SELECT slot_status, market_key, priority_tier, reservation_expires_at
     FROM market_slot_allocations WHERE office_id = $1`,
    [officeId],
  );
  const row = res.rows[0];

  if (!row) {
    throw new Error(`No slot record for office ${officeId} — cannot convert reservation`);
  }
  if (row.slot_status !== "reserved") {
    throw new Error(
      `Office ${officeId} does not have a reserved slot ` +
      `(current status: ${row.slot_status}). Payment cannot be activated.`,
    );
  }

  const now = new Date();
  if (row.reservation_expires_at && new Date(row.reservation_expires_at) < now) {
    throw new Error(
      `Reservation for office ${officeId} expired at ${row.reservation_expires_at.toISOString()}. ` +
      `Payment cannot be activated with an expired reservation.`,
    );
  }

  const marketKey = row.market_key;
  const priorityTier = row.priority_tier;

  await pool.query(
    `UPDATE market_slot_allocations
     SET slot_status               = 'allocated',
         allocated_at              = $1,
         reservation_released_at   = $1,
         reservation_release_reason = 'converted_to_allocation',
         payment_locked_until      = NULL,
         updated_at                = $1
     WHERE office_id = $2`,
    [now, officeId],
  );

  await pool.query(
    `UPDATE offices SET is_subscription_hidden = false WHERE id = $1`,
    [officeId],
  );

  await recordAuditEntry({
    officeId, marketKey, action: "reservation_converted",
    slotStatusBefore: "reserved", slotStatusAfter: "allocated",
    priorityTier, reason: "payment_confirmed",
    performedBy: adminId ?? null,
  });

  logger.info({ officeId, marketKey, priorityTier }, "[slot] Reservation converted to allocation");
}

// ── expireReservation ─────────────────────────────────────────────────────────

/**
 * Expire a single reservation (called by the reservation sweeper).
 * Sets slot_status → 'released', records expiry in the audit log.
 * Returns the market key so the caller can run processWaitlist().
 *
 * Idempotent: if the slot is not 'reserved' (already released/allocated), no-op.
 */
export async function expireReservation(officeId: number): Promise<string | null> {
  const res = await pool.query<{ slot_status: SlotStatus; market_key: string; priority_tier: number }>(
    `SELECT slot_status, market_key, priority_tier
     FROM market_slot_allocations WHERE office_id = $1`,
    [officeId],
  );
  const row = res.rows[0];

  if (!row || row.slot_status !== "reserved") {
    logger.debug(
      { officeId, currentStatus: row?.slot_status },
      "[slot] expireReservation: not in reserved state, no-op",
    );
    return row?.market_key !== "unassigned" ? row?.market_key ?? null : null;
  }

  const now = new Date();
  await pool.query(
    `UPDATE market_slot_allocations
     SET slot_status               = 'released',
         released_at               = $1,
         release_reason            = 'reservation_expired',
         reservation_released_at   = $1,
         reservation_release_reason = 'expired_3h_window',
         reservation_expires_at    = NULL,
         reservation_started_at    = NULL,
         payment_locked_until      = NULL,
         updated_at                = $1
     WHERE office_id = $2`,
    [now, officeId],
  );

  await recordAuditEntry({
    officeId, marketKey: row.market_key, action: "reservation_expired",
    slotStatusBefore: "reserved", slotStatusAfter: "released",
    priorityTier: row.priority_tier, reason: "3h_window_elapsed",
    performedBy: null,
    metadata: { expiredAt: now.toISOString() },
  });

  logger.info({ officeId, marketKey: row.market_key }, "[slot] Reservation expired");
  return row.market_key !== "unassigned" ? row.market_key : null;
}

// ── clearPaymentLock ──────────────────────────────────────────────────────────

/**
 * Clear the payment_locked_until timestamp for an office's slot row.
 *
 * Called when a payment attempt concludes (success, failure, or gateway error)
 * so the reservation sweeper can immediately proceed with releasing an expired
 * reservation on its next scheduled run, without waiting for the 30-min lock
 * window to elapse naturally.
 *
 * Safe to call even if the column is already NULL or the row doesn't exist.
 */
export async function clearPaymentLock(officeId: number): Promise<void> {
  await pool.query(
    `UPDATE market_slot_allocations
     SET payment_locked_until = NULL, updated_at = NOW()
     WHERE office_id = $1`,
    [officeId],
  );
}

// ── allocateSlot ──────────────────────────────────────────────────────────────

/**
 * Attempt to allocate a market slot for an office.
 * Used for admin-direct activations and for the not_required path.
 * Payment-driven activations should use checkPrePaymentCapacity() +
 * convertReservationToAllocation() instead.
 *
 * Outcomes:
 *   allocated    — slot assigned; is_subscription_hidden cleared
 *   waiting      — market full; office enters waitlist; is_subscription_hidden unchanged
 *   not_required — office has no supply_gate_market_key
 *
 * Idempotent: if already allocated in this market, returns immediately.
 * Transaction-safe: uses SELECT ... FOR UPDATE on market_supply_control.
 */
export async function allocateSlot(
  officeId: number,
  reason: string,
  adminId?: number | null,
): Promise<SlotResult> {
  const office = await fetchOfficeMarket(officeId);
  if (!office) throw new Error(`Office ${officeId} not found`);

  const marketKey = office.supply_gate_market_key;

  if (!marketKey) {
    await pool.query(
      `INSERT INTO market_slot_allocations
         (office_id, market_key, slot_status, priority_tier, allocated_at, updated_at)
       VALUES ($1, 'unassigned', 'not_required', 3, NULL, NOW())
       ON CONFLICT (office_id) DO UPDATE
         SET slot_status = 'not_required', updated_at = NOW()`,
      [officeId],
    );
    await recordAuditEntry({
      officeId, marketKey: "unassigned", action: "not_required",
      slotStatusBefore: null, slotStatusAfter: "not_required",
      priorityTier: 3, reason: "No supply_gate_market_key assigned",
      performedBy: adminId ?? null,
    });
    return { slotStatus: "not_required", marketKey: null, priorityTier: 3 };
  }

  // Pre-lock idempotency guard
  const existingRes = await pool.query(
    `SELECT slot_status, market_key FROM market_slot_allocations WHERE office_id = $1`,
    [officeId],
  );
  const currentSlot = existingRes.rows[0] as
    | { slot_status: SlotStatus; market_key: string }
    | undefined;
  if (currentSlot?.slot_status === "allocated" && currentSlot?.market_key === marketKey) {
    logger.info({ officeId, marketKey }, "[slot] allocateSlot: already allocated — idempotent no-op");
    const priorityTier = await determinePriorityTier(officeId, marketKey);
    return { slotStatus: "allocated", marketKey, priorityTier };
  }

  const priorityTier = await determinePriorityTier(officeId, marketKey);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const parts = marketKey.split("|");
    let supplyCap: number | null = null;
    if (parts.length === 3) {
      const [countryCode, cityId, categoryId] = parts;
      const lockRes = await client.query(
        `SELECT supply_cap FROM market_supply_control
         WHERE country_code = $1 AND city_id = $2 AND category_id = $3
         FOR UPDATE`,
        [countryCode, cityId, categoryId],
      );
      supplyCap = (lockRes.rows[0] as { supply_cap: number | null } | undefined)?.supply_cap ?? null;
    }

    const currentCount = await countActiveSlots(marketKey, client);

    // Post-lock idempotency re-check
    const postLockRes = await client.query(
      `SELECT slot_status FROM market_slot_allocations WHERE office_id = $1`,
      [officeId],
    );
    const postLockStatus = (postLockRes.rows[0] as { slot_status: SlotStatus } | undefined)?.slot_status;
    if (postLockStatus === "allocated") {
      await client.query("COMMIT");
      logger.info({ officeId, marketKey }, "[slot] allocateSlot: already allocated (post-lock re-check)");
      return { slotStatus: "allocated", marketKey, priorityTier };
    }

    const prevStatus = postLockStatus ?? null;
    let newStatus: SlotStatus;

    if (supplyCap !== null && currentCount >= supplyCap) {
      newStatus = "waiting";
    } else {
      newStatus = "allocated";
    }

    if (newStatus === "allocated") {
      await client.query(
        `INSERT INTO market_slot_allocations
           (office_id, market_key, slot_status, priority_tier, allocated_at,
            released_at, release_reason, allocated_by, updated_at)
         VALUES ($1, $2, 'allocated', $3, NOW(), NULL, NULL, $4, NOW())
         ON CONFLICT (office_id) DO UPDATE
           SET slot_status   = 'allocated',
               market_key    = EXCLUDED.market_key,
               priority_tier = $3,
               allocated_at  = NOW(),
               released_at   = NULL,
               release_reason = NULL,
               allocated_by  = $4,
               reservation_started_at  = NULL,
               reservation_expires_at  = NULL,
               reservation_released_at = NULL,
               reservation_release_reason = NULL,
               updated_at    = NOW()`,
        [officeId, marketKey, priorityTier, adminId ?? null],
      );
      await client.query(
        `UPDATE offices SET is_subscription_hidden = false WHERE id = $1`,
        [officeId],
      );
      await client.query(
        `INSERT INTO slot_audit_log
           (office_id, market_key, action, slot_status_before, slot_status_after,
            priority_tier, reason, performed_by)
         VALUES ($1,$2,'allocated',$3,'allocated',$4,$5,$6)`,
        [officeId, marketKey, prevStatus, priorityTier, reason, adminId ?? null],
      );
    } else {
      await client.query(
        `INSERT INTO market_slot_allocations
           (office_id, market_key, slot_status, priority_tier, updated_at)
         VALUES ($1, $2, 'waiting', $3, NOW())
         ON CONFLICT (office_id) DO UPDATE
           SET slot_status   = 'waiting',
               market_key    = EXCLUDED.market_key,
               priority_tier = $3,
               updated_at    = NOW()`,
        [officeId, marketKey, priorityTier],
      );
      await client.query(
        `UPDATE offices SET is_subscription_hidden = true WHERE id = $1`,
        [officeId],
      );
      await client.query(
        `INSERT INTO slot_audit_log
           (office_id, market_key, action, slot_status_before, slot_status_after,
            priority_tier, reason, performed_by)
         VALUES ($1,$2,'waitlist_entered',$3,'waiting',$4,$5,$6)`,
        [officeId, marketKey, prevStatus, priorityTier, reason, adminId ?? null],
      );
    }

    await client.query("COMMIT");
    logger.info({ officeId, marketKey, newStatus, priorityTier }, `[slot] allocateSlot → ${newStatus}`);
    return { slotStatus: newStatus, marketKey, priorityTier };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ── releaseSlot ───────────────────────────────────────────────────────────────

/**
 * Release an office's market slot (non-payment, cancellation, suspension, rejection).
 * Does NOT touch is_subscription_hidden — the caller sets it before calling this.
 * Returns the market key so the caller can pass it to processWaitlist().
 *
 * Handles 'reserved' slots correctly: clears reservation timestamps.
 */
export async function releaseSlot(
  officeId: number,
  reason: string,
  adminId?: number | null,
): Promise<string | null> {
  const res = await pool.query<{ slot_status: string; market_key: string; priority_tier: number }>(
    `SELECT slot_status, market_key, priority_tier
     FROM market_slot_allocations WHERE office_id = $1`,
    [officeId],
  );
  const row = res.rows[0];

  if (!row) {
    logger.debug({ officeId }, "[slot] releaseSlot: no slot record found, skipping");
    return null;
  }

  const prevStatus = row.slot_status;
  const marketKey  = row.market_key;

  if (prevStatus === "released" || prevStatus === "not_required") {
    logger.debug({ officeId, prevStatus }, "[slot] releaseSlot: already released/not_required, no-op");
    return marketKey !== "unassigned" ? marketKey : null;
  }

  const now = new Date();
  await pool.query(
    `UPDATE market_slot_allocations
     SET slot_status               = 'released',
         released_at               = $1,
         release_reason            = $2,
         reservation_released_at   = CASE WHEN slot_status = 'reserved' THEN $1 ELSE reservation_released_at END,
         reservation_release_reason = CASE WHEN slot_status = 'reserved' THEN $3 ELSE reservation_release_reason END,
         reservation_expires_at    = NULL,
         reservation_started_at    = NULL,
         updated_at                = $1
     WHERE office_id = $4`,
    [now, reason, `released_by_admin: ${reason}`, officeId],
  );

  const auditAction = prevStatus === "reserved" ? "reservation_released" : "released";
  await recordAuditEntry({
    officeId, marketKey, action: auditAction,
    slotStatusBefore: prevStatus, slotStatusAfter: "released",
    priorityTier: row.priority_tier, reason, performedBy: adminId ?? null,
    metadata: { previousStatus: prevStatus },
  });

  logger.info({ officeId, marketKey, prevStatus, reason }, "[slot] Slot released");
  return marketKey !== "unassigned" ? marketKey : null;
}

// ── cancelSlot ────────────────────────────────────────────────────────────────

export async function cancelSlot(
  officeId: number,
  adminId?: number | null,
): Promise<string | null> {
  return releaseSlot(officeId, "subscription_cancelled", adminId);
}

// ── processWaitlist ───────────────────────────────────────────────────────────

/**
 * Fill available market capacity with the highest-priority waiting providers.
 *
 * For CAPPED markets: creates 3-hour RESERVATIONS (slot_status → 'reserved').
 *   The provider must pay within the reservation window to convert to 'allocated'.
 * For UNCAPPED markets: directly allocates (slot_status → 'allocated').
 * For CLOSED markets: returns immediately without creating any reservations.
 *
 * Must be called AFTER a slot is released and AFTER a cap is increased.
 * Transaction-safe: uses SELECT ... FOR UPDATE on market_supply_control.
 *
 * Returns { reserved: officeIds[], allocated: officeIds[] }
 */
export async function processWaitlist(marketKey: string): Promise<ProcessWaitlistResult> {
  if (!marketKey || marketKey === "unassigned") return { reserved: [], allocated: [] };
  const parts = marketKey.split("|");
  if (parts.length !== 3) return { reserved: [], allocated: [] };
  const [countryCode, cityId, categoryId] = parts;

  const reserved: number[] = [];
  const allocated: number[] = [];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock the market row
    const lockRes = await client.query<{ supply_cap: number | null; acceptance_status: string }>(
      `SELECT supply_cap, acceptance_status
       FROM market_supply_control
       WHERE country_code = $1 AND city_id = $2 AND category_id = $3
       FOR UPDATE`,
      [countryCode, cityId, categoryId],
    );

    // Closed market — do not create new reservations
    if (lockRes.rows[0]?.acceptance_status === "closed") {
      await client.query("COMMIT");
      logger.debug({ marketKey }, "[slot] processWaitlist: market is closed — no reservations created");
      return { reserved: [], allocated: [] };
    }

    const supplyCap = lockRes.rows[0]?.supply_cap ?? null;

    if (supplyCap === null) {
      // Uncapped market — allocate all waiting directly
      await allocateAllWaitingUncapped(marketKey, client, allocated);
      await client.query("COMMIT");
      return { reserved: [], allocated };
    }

    const currentCount = await countActiveSlots(marketKey, client);
    const available = supplyCap - currentCount;

    if (available <= 0) {
      await client.query("COMMIT");
      return { reserved: [], allocated: [] };
    }

    // Fetch the top `available` waiting offices in priority order
    const waitingRes = await client.query<{
      office_id: number;
      priority_tier: number;
      slot_status: string;
    }>(
      `SELECT office_id, priority_tier, slot_status
       FROM market_slot_allocations
       WHERE market_key = $1 AND slot_status = 'waiting'
       ORDER BY priority_tier ASC, allocated_at DESC NULLS LAST, created_at ASC
       LIMIT $2`,
      [marketKey, available],
    );

    for (const waiting of waitingRes.rows) {
      const { office_id: officeId, priority_tier: priorityTier, slot_status: prevStatus } = waiting;
      await createReservationRow(officeId, marketKey, priorityTier, prevStatus, client);
      reserved.push(officeId);
    }

    await client.query("COMMIT");

    if (reserved.length > 0) {
      logger.info(
        { marketKey, reserved, available, supplyCap },
        `[slot] processWaitlist — ${reserved.length} reservation(s) created`,
      );
    }

    return { reserved, allocated };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Helper: allocate all waiting offices for an uncapped market. */
async function allocateAllWaitingUncapped(
  marketKey: string,
  client: { query: Function },
  allocated: number[],
): Promise<void> {
  const waitingRes = await client.query(
    `SELECT office_id, priority_tier FROM market_slot_allocations
     WHERE market_key = $1 AND slot_status = 'waiting'
     ORDER BY priority_tier ASC, allocated_at DESC NULLS LAST, created_at ASC`,
    [marketKey],
  );

  for (const w of waitingRes.rows as Array<{ office_id: number; priority_tier: number }>) {
    const { office_id: officeId, priority_tier: priorityTier } = w;
    await client.query(
      `UPDATE market_slot_allocations
       SET slot_status = 'allocated', allocated_at = NOW(), released_at = NULL,
           release_reason = NULL, updated_at = NOW()
       WHERE office_id = $1`,
      [officeId],
    );
    await client.query(
      `UPDATE offices SET is_subscription_hidden = false WHERE id = $1`,
      [officeId],
    );
    await client.query(
      `INSERT INTO slot_audit_log
         (office_id, market_key, action, slot_status_before, slot_status_after,
          priority_tier, reason, performed_by)
       VALUES ($1,$2,'allocated','waiting','allocated',$3,'uncapped_market_auto_allocate',NULL)`,
      [officeId, marketKey, priorityTier],
    );
    allocated.push(officeId);
  }
}

// ── forceAllocateSlot ─────────────────────────────────────────────────────────

/**
 * Admin override: force-allocate a market slot, bypassing the supply cap.
 * Now TRANSACTIONAL — the slot update, visibility update, and audit write
 * all succeed or roll back together.
 *
 * Does NOT trigger processWaitlist (admin decided to add a slot above cap).
 */
export async function forceAllocateSlot(
  officeId: number,
  reason: string,
  adminId: number,
): Promise<SlotResult> {
  const office = await fetchOfficeMarket(officeId);
  if (!office) throw new Error(`Office ${officeId} not found`);

  const marketKey = office.supply_gate_market_key ?? "unassigned";
  const priorityTier = marketKey !== "unassigned"
    ? await determinePriorityTier(officeId, marketKey)
    : 3;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Get previous status for audit
    const prevRes = await client.query(
      `SELECT slot_status FROM market_slot_allocations WHERE office_id = $1`,
      [officeId],
    );
    const prevStatus = (prevRes.rows[0] as { slot_status: string } | undefined)?.slot_status ?? null;

    await client.query(
      `INSERT INTO market_slot_allocations
         (office_id, market_key, slot_status, priority_tier, allocated_at,
          released_at, release_reason, allocated_by, updated_at)
       VALUES ($1, $2, 'allocated', $3, NOW(), NULL, NULL, $4, NOW())
       ON CONFLICT (office_id) DO UPDATE
         SET slot_status               = 'allocated',
             market_key                = EXCLUDED.market_key,
             priority_tier             = $3,
             allocated_at              = NOW(),
             released_at               = NULL,
             release_reason            = NULL,
             allocated_by              = $4,
             reservation_started_at    = NULL,
             reservation_expires_at    = NULL,
             reservation_released_at   = NULL,
             reservation_release_reason = NULL,
             updated_at                = NOW()`,
      [officeId, marketKey, priorityTier, adminId],
    );

    await client.query(
      `UPDATE offices SET is_subscription_hidden = false WHERE id = $1`,
      [officeId],
    );

    await client.query(
      `INSERT INTO slot_audit_log
         (office_id, market_key, action, slot_status_before, slot_status_after,
          priority_tier, reason, performed_by, metadata)
       VALUES ($1,$2,'admin_override',$3,'allocated',$4,$5,$6,$7)`,
      [
        officeId, marketKey, prevStatus, priorityTier,
        `admin_force_override: ${reason}`, adminId,
        JSON.stringify({ bypassedCapCheck: true }),
      ],
    );

    await client.query("COMMIT");

    logger.info(
      { officeId, marketKey, priorityTier, adminId, reason },
      "[slot] Slot force-allocated by admin override (cap bypassed, ATOMIC)",
    );

    return {
      slotStatus:   "allocated",
      marketKey:    marketKey !== "unassigned" ? marketKey : null,
      priorityTier,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ── allocateNewApproval ───────────────────────────────────────────────────────

/**
 * Called when admin approves a new office application (inside the approval
 * transaction). Direct allocation — no reservation needed for admin actions.
 */
export async function allocateNewApproval(
  officeId: number,
  marketKey: string,
  adminId: number,
  client: { query: Function },
): Promise<void> {
  const priorityRes = await pool.query<{ cnt: number }>(
    `SELECT COUNT(*)::integer AS cnt
     FROM market_slot_allocations
     WHERE office_id = $1 AND allocated_at IS NOT NULL`,
    [officeId],
  );
  const priorityTier = (priorityRes.rows[0]?.cnt ?? 0) > 0 ? 1 : 3;

  await client.query(
    `INSERT INTO market_slot_allocations
       (office_id, market_key, slot_status, priority_tier, allocated_at,
        allocated_by, updated_at)
     VALUES ($1, $2, 'allocated', $3, NOW(), $4, NOW())
     ON CONFLICT (office_id) DO UPDATE
       SET slot_status               = 'allocated',
           market_key                = EXCLUDED.market_key,
           priority_tier             = $3,
           allocated_at              = NOW(),
           allocated_by              = $4,
           released_at               = NULL,
           release_reason            = NULL,
           reservation_started_at    = NULL,
           reservation_expires_at    = NULL,
           reservation_released_at   = NULL,
           reservation_release_reason = NULL,
           updated_at                = NOW()`,
    [officeId, marketKey, priorityTier, adminId],
  );

  await client.query(
    `INSERT INTO slot_audit_log
       (office_id, market_key, action, slot_status_before, slot_status_after,
        priority_tier, reason, performed_by)
     VALUES ($1,$2,'allocated',NULL,'allocated',$3,'admin_approval',$4)`,
    [officeId, marketKey, priorityTier, adminId],
  );
}

// ── getSlotStatus ─────────────────────────────────────────────────────────────

export async function getSlotStatus(officeId: number): Promise<{
  slotStatus:           SlotStatus | null;
  marketKey:            string | null;
  priorityTier:         number | null;
  reservationExpiresAt: Date | null;
}> {
  const res = await pool.query<{
    slot_status:           SlotStatus;
    market_key:            string;
    priority_tier:         number;
    reservation_expires_at: Date | null;
  }>(
    `SELECT slot_status, market_key, priority_tier, reservation_expires_at
     FROM market_slot_allocations WHERE office_id = $1`,
    [officeId],
  );
  const row = res.rows[0];
  if (!row) return { slotStatus: null, marketKey: null, priorityTier: null, reservationExpiresAt: null };
  return {
    slotStatus:           row.slot_status,
    marketKey:            row.market_key !== "unassigned" ? row.market_key : null,
    priorityTier:         row.priority_tier,
    reservationExpiresAt: row.reservation_expires_at ?? null,
  };
}

// ── getWaitlistForMarket ──────────────────────────────────────────────────────

export async function getWaitlistForMarket(marketKey: string): Promise<WaitlistEntry[]> {
  const res = await pool.query<{
    office_id:     number;
    name:          string;
    name_ar:       string | null;
    city:          string;
    market_key:    string;
    priority_tier: number;
    slot_status:   SlotStatus;
    allocated_at:  Date | null;
    created_at:    Date;
  }>(
    `SELECT
       a.office_id, o.name, o.name_ar, o.city, o.provider_type,
       a.market_key, a.priority_tier, a.slot_status,
       a.allocated_at, a.created_at
     FROM market_slot_allocations a
     JOIN offices o ON o.id = a.office_id
     WHERE a.market_key = $1 AND a.slot_status = 'waiting'
     ORDER BY a.priority_tier ASC, a.allocated_at DESC NULLS LAST, a.created_at ASC`,
    [marketKey],
  );
  return res.rows.map((r) => ({
    officeId:     r.office_id,
    name:         r.name,
    nameAr:       r.name_ar,
    city:         r.city,
    marketKey:    r.market_key,
    providerType: (r as any).provider_type ?? "office",
    priorityTier: r.priority_tier,
    slotStatus:   r.slot_status,
    allocatedAt:  r.allocated_at,
    createdAt:    r.created_at,
  }));
}

// ── getReservedSlotsForMarket ─────────────────────────────────────────────────

export async function getReservedSlotsForMarket(marketKey: string): Promise<ReservationEntry[]> {
  const now = new Date();
  const res = await pool.query<{
    office_id:              number;
    name:                   string;
    name_ar:                string | null;
    city:                   string;
    provider_type:          string;
    priority_tier:          number;
    reservation_started_at: Date;
    reservation_expires_at: Date;
  }>(
    `SELECT
       a.office_id, o.name, o.name_ar, o.city, o.provider_type,
       a.priority_tier, a.reservation_started_at, a.reservation_expires_at
     FROM market_slot_allocations a
     JOIN offices o ON o.id = a.office_id
     WHERE a.market_key = $1
       AND a.slot_status = 'reserved'
       AND a.reservation_expires_at > NOW()
     ORDER BY a.reservation_expires_at ASC`,
    [marketKey],
  );
  return res.rows.map((r) => ({
    officeId:             r.office_id,
    name:                 r.name,
    nameAr:               r.name_ar,
    city:                 r.city,
    marketKey,
    providerType:         r.provider_type ?? "office",
    priorityTier:         r.priority_tier,
    reservationStartedAt: r.reservation_started_at,
    reservationExpiresAt: r.reservation_expires_at,
    minutesRemaining:     Math.max(
      0,
      Math.floor((new Date(r.reservation_expires_at).getTime() - now.getTime()) / 60000),
    ),
  }));
}

// ── getMarketSlotSummary ──────────────────────────────────────────────────────

export async function getMarketSlotSummary(marketKey: string): Promise<MarketSlotSummary> {
  const parts = marketKey.split("|");
  const capRes = parts.length === 3
    ? await pool.query<{ supply_cap: number | null; acceptance_status: string }>(
        `SELECT supply_cap, acceptance_status
         FROM market_supply_control
         WHERE country_code = $1 AND city_id = $2 AND category_id = $3
         LIMIT 1`,
        parts,
      )
    : { rows: [] };

  const supplyCap = (capRes.rows[0] as any)?.supply_cap ?? null;
  const isClosed  = (capRes.rows[0] as any)?.acceptance_status === "closed";

  const statsRes = await pool.query<{
    allocated:        string;
    reserved:         string;
    waiting:          string;
    returning_waiting: string;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE slot_status = 'allocated')::text AS allocated,
       COUNT(*) FILTER (WHERE slot_status = 'reserved')::text  AS reserved,
       COUNT(*) FILTER (WHERE slot_status = 'waiting')::text   AS waiting,
       COUNT(*) FILTER (WHERE slot_status = 'waiting' AND priority_tier = 1)::text AS returning_waiting
     FROM market_slot_allocations
     WHERE market_key = $1`,
    [marketKey],
  );

  const allocatedSlots = parseInt(statsRes.rows[0]?.allocated ?? "0", 10);
  const reservedSlots  = parseInt(statsRes.rows[0]?.reserved  ?? "0", 10);
  const waiting        = parseInt(statsRes.rows[0]?.waiting   ?? "0", 10);
  const returning      = parseInt(statsRes.rows[0]?.returning_waiting ?? "0", 10);
  const activeSlots    = allocatedSlots + reservedSlots;

  return {
    marketKey,
    supplyCap,
    allocatedSlots,
    reservedSlots,
    activeSlots,
    remainingSlots: supplyCap !== null ? Math.max(0, supplyCap - activeSlots) : null,
    waitingCount:   waiting,
    returningWaiting: returning,
    isClosed,
  };
}

// ── getSlotAuditLog ───────────────────────────────────────────────────────────

export async function getSlotAuditLog(officeId: number): Promise<Array<{
  id:               number;
  marketKey:        string;
  action:           string;
  slotStatusBefore: string | null;
  slotStatusAfter:  string | null;
  priorityTier:     number | null;
  reason:           string;
  performedBy:      number | null;
  performedByName:  string | null;
  metadata:         Record<string, unknown> | null;
  createdAt:        Date;
}>> {
  const res = await pool.query(
    `SELECT
       l.id, l.market_key, l.action, l.slot_status_before, l.slot_status_after,
       l.priority_tier, l.reason, l.performed_by,
       u.name AS performed_by_name,
       l.metadata, l.created_at
     FROM slot_audit_log l
     LEFT JOIN users u ON u.id = l.performed_by
     WHERE l.office_id = $1
     ORDER BY l.created_at DESC`,
    [officeId],
  );
  return res.rows.map((r: any) => ({
    id:               r.id,
    marketKey:        r.market_key,
    action:           r.action,
    slotStatusBefore: r.slot_status_before,
    slotStatusAfter:  r.slot_status_after,
    priorityTier:     r.priority_tier,
    reason:           r.reason,
    performedBy:      r.performed_by,
    performedByName:  r.performed_by_name,
    metadata:         r.metadata,
    createdAt:        r.created_at,
  }));
}

// ── countAllocatedSlotsForMarket ──────────────────────────────────────────────
// Exported for use in marketGate.ts and admin.ts.
// IMPORTANT: counts BOTH 'allocated' and 'reserved' — reserved slots consume
// capacity to prevent double-booking during the payment window.

export async function countAllocatedSlotsForMarket(marketKey: string): Promise<number> {
  const res = await pool.query<{ cnt: number }>(
    `SELECT COUNT(*)::integer AS cnt
     FROM market_slot_allocations
     WHERE market_key = $1 AND slot_status IN ('allocated', 'reserved')`,
    [marketKey],
  );
  return res.rows[0]?.cnt ?? 0;
}
