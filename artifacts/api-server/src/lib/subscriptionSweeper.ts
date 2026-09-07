/**
 * Subscription Sweeper — daily background job for subscription lifecycle automation.
 *
 * Responsibilities:
 *   1. Transition active_paid/trial → expiring   (when within warning window of expires_at)
 *   2. Transition expiring/active_paid/trial → expired  (when expires_at has passed)
 *   3. Transition expired → hidden_due_to_nonpayment    (after grace period)
 *   4. Send expiry reminder emails with dedup
 *
 * Safety:
 *   • Processes offices in small batches — no large sequential DB locks.
 *   • Each transition is independently atomic.
 *   • Errors on individual offices are logged and skipped — the sweep continues.
 *   • Office data, reviews, history, QR links are NEVER deleted.
 *
 * Scheduling: registered in index.ts, runs every 6 hours.
 */

import { pool } from "@workspace/db";
import { logger } from "./logger";
import {
  getSystemConfigValue,
  markExpiring,
  expireSubscription,
  hideForNonPayment,
  checkAndSendReminders,
} from "./subscriptionLifecycle";
import { getCommercialState } from "./commercialActivation";
import type { OfficeSubscription } from "@workspace/db";

export interface SweeperResult {
  ranAt:             string;
  durationMs:        number;
  markedExpiring:    number;
  markedExpired:     number;
  markedHidden:      number;
  remindersSent:     number;
  errors:            number;
}

/**
 * Main sweeper function. Designed to be called by a setInterval in index.ts.
 * Returns a result summary for logging/testing.
 */
export async function runSubscriptionSweep(): Promise<SweeperResult> {
  const start = Date.now();
  const result: SweeperResult = {
    ranAt:          new Date().toISOString(),
    durationMs:     0,
    markedExpiring: 0,
    markedExpired:  0,
    markedHidden:   0,
    remindersSent:  0,
    errors:         0,
  };

  logger.info("[sub-sweeper] Starting subscription sweep");

  try {
    // Load config values (with defaults in case system_config rows are missing)
    const [warningDaysStr, graceDaysStr, commercialState] = await Promise.all([
      getSystemConfigValue("subscription_expiry_warning_days", "7"),
      getSystemConfigValue("subscription_grace_period_days", "3"),
      getCommercialState(),
    ]);
    const warningDays = parseInt(warningDaysStr, 10) || 7;
    const graceDays   = parseInt(graceDaysStr,   10) || 3;

    // ── Step 1: Mark as 'expiring' ────────────────────────────────────────────
    // Find active_paid and trial subscriptions within the warning window.
    const expiringCandidates = await pool.query<{
      office_id: number;
    }>(
      `SELECT office_id
       FROM office_subscriptions
       WHERE state IN ('active_paid', 'trial')
         AND expires_at IS NOT NULL
         AND expires_at > now()
         AND expires_at <= now() + ($1 || ' days')::interval`,
      [warningDays],
    );

    for (const row of expiringCandidates.rows) {
      try {
        await markExpiring(row.office_id);
        result.markedExpiring++;
      } catch (err) {
        logger.error({ err, officeId: row.office_id }, "[sub-sweeper] Failed to mark expiring");
        result.errors++;
      }
    }

    // ── Step 2: Mark as 'expired' ─────────────────────────────────────────────
    // Find subscriptions (any active state) whose expires_at has passed.
    const expiredCandidates = await pool.query<{
      office_id: number;
    }>(
      `SELECT office_id
       FROM office_subscriptions
       WHERE state IN ('trial', 'active_paid', 'expiring')
         AND expires_at IS NOT NULL
         AND expires_at <= now()`,
    );

    for (const row of expiredCandidates.rows) {
      try {
        await expireSubscription(row.office_id);
        result.markedExpired++;
      } catch (err) {
        logger.error({ err, officeId: row.office_id }, "[sub-sweeper] Failed to expire subscription");
        result.errors++;
      }
    }

    // ── Step 3: Hide for non-payment ──────────────────────────────────────────
    // ONLY run when commercial enforcement is active.
    // When commercial_state = 'disabled' or 'scheduled', offices are NEVER hidden
    // for non-payment — they continue operating normally during the free market-
    // building period.
    if (commercialState !== "active") {
      logger.info(
        { commercialState },
        "[sub-sweeper] Step 3 skipped — commercial enforcement is not active",
      );
    } else {
    // Find expired subscriptions that have passed the grace period.
    const hideCandidates = await pool.query<{
      office_id: number;
    }>(
      `SELECT sh.office_id
       FROM subscription_history sh
       WHERE sh.to_state = 'expired'
         AND sh.created_at <= now() - ($1 || ' days')::interval
         AND NOT EXISTS (
           SELECT 1 FROM subscription_history sh2
           WHERE sh2.office_id = sh.office_id
             AND sh2.created_at > sh.created_at
         )
         AND EXISTS (
           SELECT 1 FROM office_subscriptions os
           WHERE os.office_id = sh.office_id
             AND os.state = 'expired'
         )`,
      [graceDays],
    );

    for (const row of hideCandidates.rows) {
      try {
        await hideForNonPayment(row.office_id);
        result.markedHidden++;
      } catch (err) {
        logger.error({ err, officeId: row.office_id }, "[sub-sweeper] Failed to hide office");
        result.errors++;
      }
    }
    } // end if (commercialState === "active")

    // ── Step 4: Send expiry reminders ─────────────────────────────────────────
    // Find offices in reminder-eligible states with valid expires_at.
    // Raw query returns snake_case columns; we map explicitly to camelCase type.
    interface ReminderRow {
      office_id:          number;
      email:              string;
      name:               string;
      name_ar:            string | null;
      id:                 number;
      state:              string;
      trial_started_at:   Date | null;
      trial_ends_at:      Date | null;
      paid_through_date:  Date | null;
      expires_at:         Date | null;
      cancelled_at:       Date | null;
      cancelled_by:       number | null;
      cancel_reason:      string | null;
      hidden_at:          Date | null;
      notified_reminders: string[];
      notes:                string | null;
      slot_sync_needed_at:  Date | null;
      created_at:           Date;
      updated_at:           Date;
    }

    const reminderCandidates = await pool.query<ReminderRow>(
      `SELECT os.*,
              u.email,
              o.name,
              o.name_ar
       FROM   office_subscriptions os
       JOIN   offices o ON o.id = os.office_id
       JOIN   users   u ON u.id = o.user_id
       WHERE  os.state IN ('trial', 'active_paid', 'expiring')
         AND  os.expires_at IS NOT NULL
         AND  os.expires_at > now() - INTERVAL '1 day'
         AND  os.expires_at <= now() + INTERVAL '8 days'`,
    );

    for (const row of reminderCandidates.rows) {
      try {
        const sub: OfficeSubscription = {
          id:                row.id,
          officeId:          row.office_id,
          state:             row.state as OfficeSubscription["state"],
          trialStartedAt:    row.trial_started_at,
          trialEndsAt:       row.trial_ends_at,
          paidThroughDate:   row.paid_through_date,
          expiresAt:         row.expires_at,
          cancelledAt:       row.cancelled_at,
          cancelledBy:       row.cancelled_by,
          cancelReason:      row.cancel_reason,
          hiddenAt:          row.hidden_at,
          notifiedReminders: row.notified_reminders,
          notes:             row.notes,
          slotSyncNeededAt:  row.slot_sync_needed_at ?? null,
          createdAt:         row.created_at,
          updatedAt:         row.updated_at,
        };

        const reminders = await checkAndSendReminders(
          { id: row.office_id, email: row.email, name: row.name, nameAr: row.name_ar },
          sub,
        );
        result.remindersSent += reminders.filter(r => r.sent).length;
      } catch (err) {
        logger.error({ err, officeId: row.office_id }, "[sub-sweeper] Failed to check reminders");
        result.errors++;
      }
    }
  } catch (fatalErr) {
    logger.error({ err: fatalErr }, "[sub-sweeper] Fatal error during sweep");
    result.errors++;
  }

  result.durationMs = Date.now() - start;
  logger.info(result, "[sub-sweeper] Subscription sweep complete");
  return result;
}

/**
 * Register the sweeper to run every 6 hours via setInterval.
 * Called once during server startup in index.ts.
 */
export function scheduleSubscriptionSweep(): void {
  const SIX_HOURS = 6 * 60 * 60 * 1000;

  // Run once shortly after startup (30s delay to let DB warm up)
  setTimeout(() => {
    runSubscriptionSweep().catch((err) => {
      logger.error({ err }, "[sub-sweeper] Initial run failed");
    });
  }, 30_000).unref();

  // Then every 6 hours
  setInterval(() => {
    runSubscriptionSweep().catch((err) => {
      logger.error({ err }, "[sub-sweeper] Scheduled run failed");
    });
  }, SIX_HOURS).unref();

  logger.info("[sub-sweeper] Subscription sweeper scheduled (every 6h, first run in 30s)");
}
