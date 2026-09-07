/**
 * Slot-sync recovery sweeper.
 *
 * ── Problem ──────────────────────────────────────────────────────────────────
 * activatePaidCore() uses two sequential DB operations:
 *   1. UPDATE office_subscriptions SET state='active_paid'  (committed)
 *   2. convertReservationToAllocation()                     (separate transaction)
 *
 * If step 2 fails, the office is left with:
 *   • subscription.state = active_paid  (payment confirmed and persisted)
 *   • market_slot_allocations.slot_status = reserved  (NOT converted)
 *   • offices.is_subscription_hidden = true  (still hidden from public listing)
 *
 * This is recorded via office_subscriptions.slot_sync_needed_at = NOW() so the
 * inconsistency is durable and cannot be silently lost.
 *
 * ── Recovery cases ───────────────────────────────────────────────────────────
 *   already_allocated   — slot was concurrently converted; just clear flag.
 *   conversion_retry    — reservation still valid; retry succeeds.
 *   uncapped_market     — no slot tracking; clear flag + restore visibility.
 *   needs_admin         — reservation expired or slot released; cannot auto-
 *                         recover without risking supply-cap violation.
 *   conversion_failed   — retry attempted but still throws; flag retained.
 *
 * ── Idempotency ─────────────────────────────────────────────────────────────
 * recoverSlotSync() is safe to call multiple times for the same office:
 *   - already_allocated  path clears the flag and is a no-op thereafter.
 *   - conversion_retry   path uses convertReservationToAllocation's own
 *     idempotency guard (throws if not in 'reserved' state).
 *   - needs_admin        path does not mutate any state.
 *
 * ── Supply-cap safety ───────────────────────────────────────────────────────
 * The sweeper NEVER force-allocates when a reservation has expired.  If the
 * 3-hour window elapsed, another office may have received the slot via
 * processWaitlist().  Only a human admin (via forceAllocateSlot) can override
 * the cap after reviewing the situation.
 */

import { pool } from "@workspace/db";
import { logger } from "./logger";
import { getSlotStatus, convertReservationToAllocation } from "./supplySlotManager";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SlotSyncStatus =
  | "recovered_already_allocated"
  | "recovered_conversion_retry"
  | "recovered_uncapped_market"
  | "needs_admin"
  | "conversion_failed";

export interface SlotSyncRecoveryResult {
  officeId: number;
  status:   SlotSyncStatus;
  reason:   string;
}

export interface SlotSyncSweepResult {
  ranAt:           string;
  durationMs:      number;
  candidateCount:  number;  // offices with slot_sync_needed_at IS NOT NULL
  recoveredCount:  number;
  needsAdminCount: number;
  failedCount:     number;
  results:         SlotSyncRecoveryResult[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Clear the durable slot-sync flag (recovery succeeded). */
async function clearSyncFlag(officeId: number): Promise<void> {
  await pool.query(
    `UPDATE office_subscriptions SET slot_sync_needed_at = NULL WHERE office_id = $1`,
    [officeId],
  );
}

/** Ensure office is publicly visible (idempotent). */
async function restoreVisibility(officeId: number): Promise<void> {
  await pool.query(
    `UPDATE offices SET is_subscription_hidden = false WHERE id = $1`,
    [officeId],
  );
}

// ── Core recovery ─────────────────────────────────────────────────────────────

/**
 * Attempt to recover a single office whose slot_sync_needed_at is set.
 *
 * Idempotent — safe to call multiple times.
 * Does NOT clear the flag unless recovery fully succeeds.
 * Does NOT auto-allocate when the reservation has expired (supply-cap safety).
 */
export async function recoverSlotSync(
  officeId: number,
): Promise<SlotSyncRecoveryResult> {
  const slotInfo = await getSlotStatus(officeId);
  const now = new Date();

  // ── Uncapped / no-slot market ───────────────────────────────────────────
  if (!slotInfo.slotStatus || slotInfo.slotStatus === "not_required") {
    await clearSyncFlag(officeId);
    await restoreVisibility(officeId);
    logger.info({ officeId }, "[slot-sync] recovered: uncapped market — flag cleared, visibility restored");
    return { officeId, status: "recovered_uncapped_market", reason: "uncapped_market" };
  }

  // ── Already allocated (concurrent fix or previous sweeper run) ──────────
  if (slotInfo.slotStatus === "allocated") {
    await clearSyncFlag(officeId);
    await restoreVisibility(officeId);
    logger.info({ officeId }, "[slot-sync] recovered: slot already allocated — flag cleared");
    return { officeId, status: "recovered_already_allocated", reason: "already_allocated" };
  }

  // ── Reservation still valid → retry conversion ──────────────────────────
  if (
    slotInfo.slotStatus === "reserved" &&
    slotInfo.reservationExpiresAt != null &&
    slotInfo.reservationExpiresAt > now
  ) {
    try {
      await convertReservationToAllocation(officeId, null);
      await clearSyncFlag(officeId);
      logger.info({ officeId }, "[slot-sync] recovered: reservation converted on retry — flag cleared");
      return { officeId, status: "recovered_conversion_retry", reason: "conversion_retry_succeeded" };
    } catch (retryErr) {
      const errMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
      logger.error(
        { err: retryErr, officeId },
        "[slot-sync] recovery failed: convertReservationToAllocation still throws — flag retained",
      );
      return { officeId, status: "conversion_failed", reason: errMsg };
    }
  }

  // ── Reservation expired / slot released or waiting → needs admin ────────
  //
  // Do NOT auto-allocate: the reservation window has elapsed, meaning
  // processWaitlist() may have already given this market slot to another
  // provider.  A force-allocation here could exceed the supply cap.
  // Surface as critical in Platform Health and require human review.
  const reason =
    slotInfo.slotStatus === "reserved" &&
    slotInfo.reservationExpiresAt &&
    slotInfo.reservationExpiresAt <= now
      ? `reservation_expired_at_${slotInfo.reservationExpiresAt.toISOString()}`
      : `slot_status_is_${slotInfo.slotStatus}`;

  logger.error(
    { officeId, slotStatus: slotInfo.slotStatus, reason },
    "[slot-sync] NEEDS ADMIN: active_paid subscription has no valid slot — manual force-allocation required",
  );
  return { officeId, status: "needs_admin", reason };
}

// ── Sweep ─────────────────────────────────────────────────────────────────────

/**
 * Find all active_paid offices with slot_sync_needed_at IS NOT NULL and
 * attempt recovery for each.  Safe to run at any frequency — each
 * individual recoverSlotSync() call is idempotent.
 */
export async function runSlotSyncSweep(): Promise<SlotSyncSweepResult> {
  const start = Date.now();
  const result: SlotSyncSweepResult = {
    ranAt:           new Date().toISOString(),
    durationMs:      0,
    candidateCount:  0,
    recoveredCount:  0,
    needsAdminCount: 0,
    failedCount:     0,
    results:         [],
  };

  let candidates: Array<{ office_id: number }>;
  try {
    const res = await pool.query<{ office_id: number }>(
      `SELECT office_id
       FROM office_subscriptions
       WHERE state = 'active_paid'
         AND slot_sync_needed_at IS NOT NULL
       ORDER BY slot_sync_needed_at ASC`,
    );
    candidates = res.rows;
  } catch (queryErr) {
    // Migration 0036 not yet applied — gracefully skip rather than crashing.
    logger.warn(
      { err: queryErr },
      "[slot-sync] sweep skipped — slot_sync_needed_at column not found (run migration 0036)",
    );
    result.durationMs = Date.now() - start;
    return result;
  }

  result.candidateCount = candidates.length;

  if (candidates.length === 0) {
    result.durationMs = Date.now() - start;
    return result;
  }

  logger.info({ count: candidates.length }, "[slot-sync] Starting sweep for pending slot-sync offices");

  for (const row of candidates) {
    try {
      const recovery = await recoverSlotSync(row.office_id);
      result.results.push(recovery);

      if (recovery.status.startsWith("recovered_")) {
        result.recoveredCount++;
      } else if (recovery.status === "needs_admin") {
        result.needsAdminCount++;
      } else {
        // "conversion_failed" — flag retained, will retry next sweep
        result.failedCount++;
      }
    } catch (unexpectedErr) {
      logger.error(
        { err: unexpectedErr, officeId: row.office_id },
        "[slot-sync] Unexpected error during recovery — flag retained, will retry next sweep",
      );
      result.failedCount++;
    }
  }

  result.durationMs = Date.now() - start;
  logger.info(
    {
      candidateCount:  result.candidateCount,
      recoveredCount:  result.recoveredCount,
      needsAdminCount: result.needsAdminCount,
      failedCount:     result.failedCount,
      durationMs:      result.durationMs,
    },
    "[slot-sync] Sweep complete",
  );
  return result;
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

/**
 * Register the slot-sync recovery sweeper.  Runs every 15 minutes — short
 * enough to catch a reservation still within its 3-hour window, even if the
 * initial activation failure happens near the end of the window.
 *
 * .unref() so the interval does not prevent graceful server shutdown.
 */
export function scheduleSlotSyncSweep(): void {
  logger.info("[slot-sync] Slot-sync recovery sweeper scheduled (every 15 min)");

  setInterval(async () => {
    try {
      await runSlotSyncSweep();
    } catch (err) {
      logger.error({ err }, "[slot-sync] Unexpected sweeper error");
    }
  }, 15 * 60 * 1000).unref();
}
