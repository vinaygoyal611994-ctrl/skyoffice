/**
 * Service Request Notification Outbox (Blocker 9)
 *
 * Guarantees every committed service-request status change has a durable
 * lifecycle-notification record. Delivery is at-least-once: a crash after an
 * email provider accepts a message but before its database update commits can
 * result in a retry and duplicate email.
 *
 * Architecture (mirrors slotNotificationOutbox.ts):
 *  1. enqueueServiceRequestNotifications() — called inside the status-change
 *     transaction so outbox rows commit atomically with the status update.
 *  2. runSrOutboxWorker() — single-pass batch processor with FOR UPDATE SKIP
 *     LOCKED concurrency guard. Each row is processed in its own transaction.
 *  3. scheduleSrOutboxWorker() — registered at server startup, runs every 2 min.
 *
 * Backoff schedule (same as slot outbox):
 *   1st failure → retry in  2 min  (attempts=1)
 *   2nd failure → retry in  4 min  (attempts=2)
 *   3rd failure → retry in  8 min  (attempts=3)
 *   4th failure → retry in 16 min  (attempts=4)
 *   5th failure → permanently failed (attempts=5, status='failed')
 */

import { pool } from "@workspace/db";
import { logger } from "./logger";
import { emailProvider } from "./email";
import type { SrNotificationType } from "@workspace/db";

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 5;
const BATCH_SIZE   = 50;
const TWO_MINUTES  = 2 * 60 * 1000;

/** Exponential backoff: 2^n minutes (capped at 1 hour). */
function backoffMs(attemptsDone: number): number {
  return Math.min(Math.pow(2, attemptsDone) * 60 * 1000, 60 * 60 * 1000);
}

function sanitiseError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? "unknown error");
  return msg.slice(0, 500);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SrOutboxWorkerResult {
  processed: number;
  sent:      number;
  skipped:   number;
  failed:    number;
  errors:    number;
}

// ── enqueueServiceRequestNotifications ───────────────────────────────────────

/**
 * Insert one or more outbox rows for a service-request lifecycle event.
 * Must be called with a transaction client so the outbox rows commit
 * atomically with the status change.
 *
 * @param notifications  Array of { recipientUserId, recipientRole, notificationType }
 * @param serviceRequestId  The affected service request
 * @param client  Transaction client (same connection as the UPDATE)
 */
export async function enqueueServiceRequestNotifications(
  serviceRequestId: number,
  notifications: Array<{
    recipientUserId: number;
    recipientRole: "customer" | "office";
    notificationType: SrNotificationType;
  }>,
  client: { query: Function },
): Promise<void> {
  for (const n of notifications) {
    await client.query(
      `INSERT INTO service_request_notification_outbox
         (service_request_id, recipient_user_id, recipient_role, notification_type, status, next_attempt_at)
       VALUES ($1, $2, $3, $4, 'pending', NOW())`,
      [serviceRequestId, n.recipientUserId, n.recipientRole, n.notificationType],
    );
  }
}

// ── runSrOutboxWorker ─────────────────────────────────────────────────────────

/**
 * Process one batch of pending/failed SR notifications.
 * Returns a result summary.
 */
export async function runSrOutboxWorker(): Promise<SrOutboxWorkerResult> {
  const result: SrOutboxWorkerResult = { processed: 0, sent: 0, skipped: 0, failed: 0, errors: 0 };

  const candidates = await pool.query<{ id: number }>(
    `SELECT id
     FROM service_request_notification_outbox
     WHERE status IN ('pending', 'failed')
       AND attempts < $1
       AND next_attempt_at <= NOW()
     ORDER BY next_attempt_at ASC
     LIMIT $2`,
    [MAX_ATTEMPTS, BATCH_SIZE],
  );

  if (candidates.rows.length === 0) return result;

  logger.debug({ count: candidates.rows.length }, "[sr-outbox] Processing notification candidates");

  for (const { id } of candidates.rows) {
    try {
      const outcome = await processOneSrRow(id);
      if (outcome === "noop") continue;
      result.processed++;
      if (outcome === "sent")    result.sent++;
      if (outcome === "skipped") result.skipped++;
      if (outcome === "failed")  result.failed++;
    } catch (err) {
      result.errors++;
      logger.error({ err, id }, "[sr-outbox] Unexpected error processing outbox row");
    }
  }

  logger.info(result, "[sr-outbox] Worker run complete");
  return result;
}

type RowOutcome = "sent" | "skipped" | "failed" | "noop";

async function processOneSrRow(id: number): Promise<RowOutcome> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock the row — skip if another worker is already processing it.
    const lockRes = await client.query<{
      id: number;
      service_request_id: number;
      recipient_user_id: number;
      recipient_role: string;
      notification_type: string;
      attempts: number;
    }>(
      `SELECT id, service_request_id, recipient_user_id, recipient_role, notification_type, attempts
       FROM service_request_notification_outbox
       WHERE id = $1
         AND status IN ('pending', 'failed')
         AND attempts < $2
         AND next_attempt_at <= NOW()
       FOR UPDATE SKIP LOCKED`,
      [id, MAX_ATTEMPTS],
    );

    if (lockRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return "noop";
    }

    const row = lockRes.rows[0];

    // ── Staleness check ────────────────────────────────────────────────────
    // If the service request was deleted, skip gracefully.
    const srRes = await client.query<{
      id: number;
      status: string;
      service_name: string;
      price: string | null;
      execution_duration: string | null;
      office_id: number;
      customer_id: number;
    }>(
      `SELECT id, status, service_name, price, execution_duration, office_id, customer_id
       FROM service_requests
       WHERE id = $1`,
      [row.service_request_id],
    );

    if (srRes.rows.length === 0) {
      await client.query(
        `UPDATE service_request_notification_outbox SET status = 'skipped', sent_at = NOW() WHERE id = $1`,
        [row.id],
      );
      await client.query("COMMIT");
      logger.info({ id: row.id }, "[sr-outbox] Notification skipped — service request deleted");
      return "skipped";
    }

    const sr = srRes.rows[0];

    // ── Fetch recipient info ───────────────────────────────────────────────
    const recipientRes = await client.query<{
      email: string;
      name: string;
    }>(
      `SELECT email, name FROM users WHERE id = $1`,
      [row.recipient_user_id],
    );

    if (recipientRes.rows.length === 0) {
      await client.query(
        `UPDATE service_request_notification_outbox SET status = 'skipped', sent_at = NOW() WHERE id = $1`,
        [row.id],
      );
      await client.query("COMMIT");
      return "skipped";
    }

    const recipient = recipientRes.rows[0];

    // ── Fetch office name ──────────────────────────────────────────────────
    const officeRes = await client.query<{ name: string }>(
      `SELECT name FROM offices WHERE id = $1`,
      [sr.office_id],
    );
    const officeName = officeRes.rows[0]?.name ?? "Office";

    // ── Send email ─────────────────────────────────────────────────────────
    try {
      await emailProvider.sendServiceRequestNotification({
        to:               recipient.email,
        locale:           "ar",   // Platform default; no per-user locale stored
        notificationType: row.notification_type,
        recipientRole:    row.recipient_role as "customer" | "office",
        officeName,
        serviceName:      sr.service_name,
        serviceRequestId: sr.id,
        price:            sr.price,
        executionDuration: sr.execution_duration,
      });

      await client.query(
        `UPDATE service_request_notification_outbox
         SET status = 'sent', sent_at = NOW(), attempts = attempts + 1, last_error = NULL
         WHERE id = $1`,
        [row.id],
      );
      await client.query("COMMIT");

      logger.info(
        { id: row.id, srId: row.service_request_id, notificationType: row.notification_type },
        "[sr-outbox] Notification sent",
      );
      return "sent";

    } catch (emailErr) {
      const newAttempts = row.attempts + 1;
      const exhausted = newAttempts >= MAX_ATTEMPTS;
      const errMsg = sanitiseError(emailErr);

      if (exhausted) {
        await client.query(
          `UPDATE service_request_notification_outbox
           SET status = 'failed', attempts = $2, last_error = $3
           WHERE id = $1`,
          [row.id, newAttempts, errMsg],
        );
        logger.warn({ id: row.id, newAttempts, errMsg }, "[sr-outbox] Notification permanently failed");
      } else {
        const nextAttemptAt = new Date(Date.now() + backoffMs(newAttempts));
        await client.query(
          `UPDATE service_request_notification_outbox
           SET status = 'failed', attempts = $2, last_error = $3, next_attempt_at = $4
           WHERE id = $1`,
          [row.id, newAttempts, errMsg, nextAttemptAt],
        );
        logger.warn({ id: row.id, newAttempts, nextAttemptAt }, "[sr-outbox] Notification failed — will retry");
      }

      await client.query("COMMIT");
      return "failed";
    }

  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

// ── scheduleSrOutboxWorker ────────────────────────────────────────────────────

/**
 * Register the SR outbox worker to run every 2 minutes.
 * Called once at server startup (in index.ts).
 * Uses .unref() so timers do not block clean process exit in tests.
 */
export function scheduleSrOutboxWorker(): void {
  setTimeout(() => {
    runSrOutboxWorker().catch((err) => {
      logger.error({ err }, "[sr-outbox] Initial worker run failed");
    });
  }, 35_000).unref(); // First run at 35s (5s after the slot outbox worker)

  setInterval(() => {
    runSrOutboxWorker().catch((err) => {
      logger.error({ err }, "[sr-outbox] Scheduled worker run failed");
    });
  }, TWO_MINUTES).unref();

  logger.info("[sr-outbox] SR notification outbox worker scheduled (every 2 min, first run in 35s)");
}
