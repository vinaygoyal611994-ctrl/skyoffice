/**
 * Slot Reservation Sweeper — expires 3-hour reservations and passes
 * the opportunity to the next eligible provider.
 *
 * Responsibilities:
 *   1. Find reservations whose reservation_expires_at has passed.
 *   2. Release each expired reservation (slot_status → 'released').
 *   3. Call processWaitlist() for each affected market to give the
 *      next waiting provider a fresh 3-hour reservation.
 *
 * Notification is no longer the sweeper's responsibility.
 * Each new reservation creates an outbox row atomically inside
 * processWaitlist's transaction (via createReservationRow → supplySlotManager).
 * The outbox worker (slotNotificationOutbox.ts) delivers the email within ~2 min.
 *
 * Safety:
 *   • Idempotent — expireReservation() is a no-op if slot is not 'reserved'.
 *   • Processes offices in batches; individual failures are logged and skipped.
 *   • Never deletes office data, reviews, or history.
 *   • processWaitlist() is concurrency-safe (FOR UPDATE on market row).
 *
 * Scheduling: registered in index.ts, runs every 15 minutes.
 * Manual trigger: POST /api/admin/supply-slots/sweep (admin-only).
 */

import { pool } from "@workspace/db";
import { logger } from "./logger";
import { expireReservation, processWaitlist, ProcessWaitlistResult } from "./supplySlotManager";

export interface ReservationSweeperResult {
  ranAt:          string;
  durationMs:     number;
  expiredCount:   number;
  marketKeys:     string[];
  reservedCount:  number;  // new reservations created for next providers
  allocatedCount: number;  // direct allocations (uncapped markets)
  errors:         number;  // individual expiry / processWaitlist failures
}

/**
 * Main sweeper function. Finds all expired reservations, releases them,
 * and gives the next waiting provider a fresh 3-hour reservation.
 *
 * Notification delivery is handled asynchronously by the outbox worker —
 * the outbox row is created inside processWaitlist's transaction so it
 * cannot be lost even if this process crashes before the worker runs.
 */
export async function runReservationSweep(): Promise<ReservationSweeperResult> {
  const start = Date.now();
  const result: ReservationSweeperResult = {
    ranAt:          new Date().toISOString(),
    durationMs:     0,
    expiredCount:   0,
    marketKeys:     [],
    reservedCount:  0,
    allocatedCount: 0,
    errors:         0,
  };

  logger.info("[res-sweeper] Starting reservation sweep");

  try {
    // ── Step 1: Find all expired reservations not under a payment lock ────
    //
    // payment_locked_until is set when a Stripe Checkout session is created for
    // a reservation. While the lock is in the future, the sweeper MUST NOT release
    // the reservation — the provider may be mid-checkout. The lock has a hard 30-min
    // expiry, so it can never become indefinite. Once the lock lapses (whether because
    // payment succeeded, failed, or the user abandoned Stripe), the sweeper can release
    // normally on the next scheduled run.
    const expired = await pool.query<{ office_id: number; market_key: string }>(
      `SELECT office_id, market_key
       FROM market_slot_allocations
       WHERE slot_status = 'reserved'
         AND reservation_expires_at IS NOT NULL
         AND reservation_expires_at < NOW()
         AND (payment_locked_until IS NULL OR payment_locked_until <= NOW())
       ORDER BY reservation_expires_at ASC`,
    );

    if (expired.rows.length === 0) {
      logger.debug("[res-sweeper] No expired reservations found");
      result.durationMs = Date.now() - start;
      return result;
    }

    logger.info({ count: expired.rows.length }, "[res-sweeper] Found expired reservations");

    // ── Step 2: Release each expired reservation ──────────────────────────
    // Track which markets are affected so we run processWaitlist once per market.
    const affectedMarkets = new Set<string>();

    for (const row of expired.rows) {
      try {
        const marketKey = await expireReservation(row.office_id);
        if (marketKey) {
          affectedMarkets.add(marketKey);
        }
        result.expiredCount++;
      } catch (err) {
        logger.error(
          { err, officeId: row.office_id },
          "[res-sweeper] Failed to expire reservation — skipping this office",
        );
        result.errors++;
      }
    }

    // ── Step 3: Hand off to next waiting provider ─────────────────────────
    // processWaitlist() is concurrency-safe (FOR UPDATE) and idempotent.
    // A failure in one market must not prevent processing the others.
    //
    // Each reservation created by processWaitlist also creates an outbox row
    // atomically (inside createReservationRow's transaction), so the provider
    // will receive a notification within ~2 minutes via the outbox worker —
    // even if the server restarts between now and then.
    for (const marketKey of affectedMarkets) {
      try {
        const pwResult: ProcessWaitlistResult = await processWaitlist(marketKey);
        result.reservedCount  += pwResult.reserved.length;
        result.allocatedCount += pwResult.allocated.length;
        result.marketKeys.push(marketKey);

        if (pwResult.reserved.length > 0 || pwResult.allocated.length > 0) {
          logger.info(
            { marketKey, reserved: pwResult.reserved.length, allocated: pwResult.allocated.length },
            "[res-sweeper] Waitlist promoted — notifications queued via outbox",
          );
        }
      } catch (err) {
        logger.error({ err, marketKey }, "[res-sweeper] processWaitlist failed after expiry — skipping market");
        result.errors++;
      }
    }

  } catch (fatalErr) {
    logger.error({ err: fatalErr }, "[res-sweeper] Fatal error during sweep");
    result.errors++;
  }

  result.durationMs = Date.now() - start;
  logger.info(result, "[res-sweeper] Reservation sweep complete");
  return result;
}

/**
 * Register the sweeper to run every 15 minutes via setInterval.
 * Called once during server startup in index.ts.
 * Not gated on NODE_ENV — runs in all environments (uses .unref() to allow clean exit in tests).
 */
export function scheduleReservationSweep(): void {
  const FIFTEEN_MINUTES = 15 * 60 * 1000;

  // Run once shortly after startup (60s delay — after the subscription sweeper)
  setTimeout(() => {
    runReservationSweep().catch((err) => {
      logger.error({ err }, "[res-sweeper] Initial run failed");
    });
  }, 60_000).unref();

  // Then every 15 minutes
  setInterval(() => {
    runReservationSweep().catch((err) => {
      logger.error({ err }, "[res-sweeper] Scheduled run failed");
    });
  }, FIFTEEN_MINUTES).unref();

  logger.info("[res-sweeper] Reservation sweeper scheduled (every 15 min, first run in 60s)");
}
