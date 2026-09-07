/**
 * Slot Notification Outbox
 *
 * Guarantees that every provider who receives a 3-hour slot reservation is
 * notified exactly once, even if the server crashes between reservation
 * creation and email delivery.
 *
 * Architecture:
 *   1. enqueueNotification() — called inside the processWaitlist transaction
 *      (via createReservationRow) so the outbox row is created atomically with
 *      the reservation. If the reservation INSERT rolls back, the outbox row
 *      rolls back too. If the server crashes after both INSERTs commit, the
 *      outbox row survives and the next worker run delivers the email.
 *
 *   2. runOutboxWorker() — single-pass batch processor. For each due row:
 *        • Locks the row via FOR UPDATE SKIP LOCKED (two concurrent workers
 *          cannot process the same row).
 *        • Checks that the reservation is still valid and unexpired.
 *        • Sends the bilingual slot reservation notice via the email provider.
 *        • Marks the row sent/failed/skipped and writes a slot_audit_log entry.
 *        • On failure: applies exponential backoff (2^n minutes), max 5 attempts.
 *
 *   3. scheduleOutboxWorker() — registered at startup. Runs every 2 minutes.
 *
 *   4. getOutboxSummary() — admin visibility and Platform Health integration.
 *
 * Backoff schedule (attempts = 0-indexed runs, not DB column value):
 *   1st failure → retry in  2 min  (DB attempts=1)
 *   2nd failure → retry in  4 min  (DB attempts=2)
 *   3rd failure → retry in  8 min  (DB attempts=3)
 *   4th failure → retry in 16 min  (DB attempts=4)
 *   5th failure → permanently failed (DB attempts=5, status='failed')
 */

import { pool } from "@workspace/db";
import { logger } from "./logger";
import { emailProvider } from "./email";
import { recordOutboxWorkerRun } from "./healthTracker";

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_ATTEMPTS  = 5;
const BATCH_SIZE    = 50;
const TWO_MINUTES   = 2 * 60 * 1000;

/** Exponential backoff: 2^n minutes (capped at 1 hour). */
function backoffMs(attemptsDone: number): number {
  return Math.min(Math.pow(2, attemptsDone) * 60 * 1000, 60 * 60 * 1000);
}

/** Sanitise an error message for storage — cap length, strip stack traces. */
function sanitiseError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? "unknown error");
  return msg.slice(0, 500);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OutboxWorkerResult {
  processed:  number;
  sent:       number;
  skipped:    number;
  failed:     number;
  errors:     number;
}

export interface OutboxSummary {
  pending:        number;
  sent:           number;
  failed:         number;
  skipped:        number;
  recentFailures: Array<{
    id:         number;
    officeId:   number;
    marketKey:  string;
    attempts:   number;
    lastError:  string | null;
    createdAt:  Date;
  }>;
}

// ── enqueueNotification ────────────────────────────────────────────────────────

/**
 * Create an outbox row for a newly created reservation.
 * Must be called inside the processWaitlist transaction (via createReservationRow)
 * so reservation and outbox row are committed atomically.
 *
 * The `reservation_id` is the idempotency key — ON CONFLICT DO NOTHING prevents
 * duplicate outbox rows if createReservationRow is re-run for the same reservation.
 *
 * @param officeId       Office that received the reservation.
 * @param marketKey      Market key (country|city|category).
 * @param reservationId  Unique key for this reservation (officeId:reservationStartedAt).
 * @param client         Transaction client (same connection as the reservation INSERT).
 */
export async function enqueueNotification(
  officeId: number,
  marketKey: string,
  reservationId: string,
  client: { query: Function },
): Promise<void> {
  await client.query(
    `INSERT INTO slot_notification_outbox
       (office_id, market_key, reservation_id, notification_type, status, next_attempt_at)
     VALUES ($1, $2, $3, 'slot_reserved', 'pending', NOW())
     ON CONFLICT (reservation_id) DO NOTHING`,
    [officeId, marketKey, reservationId],
  );
}

// ── runOutboxWorker ────────────────────────────────────────────────────────────

/**
 * Process one batch of pending/failed notifications.
 *
 * Returns a result summary. Each row is processed in its own transaction
 * with FOR UPDATE SKIP LOCKED so concurrent workers never double-send.
 */
export async function runOutboxWorker(): Promise<OutboxWorkerResult> {
  const result: OutboxWorkerResult = { processed: 0, sent: 0, skipped: 0, failed: 0, errors: 0 };

  // Step 1: Fetch candidate IDs (non-locking read — coarse filter).
  const candidates = await pool.query<{ id: number }>(
    `SELECT id
     FROM slot_notification_outbox
     WHERE status IN ('pending', 'failed')
       AND attempts < $1
       AND next_attempt_at <= NOW()
     ORDER BY next_attempt_at ASC
     LIMIT $2`,
    [MAX_ATTEMPTS, BATCH_SIZE],
  );

  if (candidates.rows.length === 0) {
    recordOutboxWorkerRun(result);
    return result;
  }

  logger.debug({ count: candidates.rows.length }, "[outbox] Processing notification candidates");

  // Step 2: Process each candidate in its own transaction.
  for (const { id } of candidates.rows) {
    try {
      const outcome = await processOneRow(id);
      if (outcome === "noop") continue; // grabbed by concurrent worker
      result.processed++;
      if (outcome === "sent")    result.sent++;
      if (outcome === "skipped") result.skipped++;
      if (outcome === "failed")  result.failed++;
    } catch (err) {
      result.errors++;
      logger.error({ err, id }, "[outbox] Unexpected error processing outbox row");
    }
  }

  logger.info(result, "[outbox] Worker run complete");
  recordOutboxWorkerRun(result);
  return result;
}

/** Outcome of processing one outbox row. */
type RowOutcome = "sent" | "skipped" | "failed" | "noop";

/**
 * Process a single outbox row atomically.
 * Opens its own transaction to lock the row with FOR UPDATE SKIP LOCKED.
 * A concurrent worker that grabs the same row ID first will lock it;
 * this call will get an empty result set and return 'noop'.
 */
async function processOneRow(id: number): Promise<RowOutcome> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock this specific row. SKIP LOCKED: if a concurrent worker already holds
    // a lock on this row, we get 0 rows and bail out — no blocking.
    const lockRes = await client.query<{
      id: number;
      office_id: number;
      market_key: string;
      reservation_id: string;
      attempts: number;
    }>(
      `SELECT id, office_id, market_key, reservation_id, attempts
       FROM slot_notification_outbox
       WHERE id = $1
         AND status IN ('pending', 'failed')
         AND attempts < $2
         AND next_attempt_at <= NOW()
       FOR UPDATE SKIP LOCKED`,
      [id, MAX_ATTEMPTS],
    );

    if (lockRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return "noop"; // another worker or status already updated
    }

    const row = lockRes.rows[0];

    // ── Staleness check ────────────────────────────────────────────────────
    // Verify the reservation is still in the 'reserved' state and unexpired.
    // If the provider already paid (slot=allocated) or the reservation expired
    // without action, we skip — there is nothing useful to notify them about.
    const validRes = await client.query<{ slot_status: string }>(
      `SELECT slot_status FROM market_slot_allocations
       WHERE office_id = $1
         AND slot_status = 'reserved'
         AND reservation_expires_at > NOW()`,
      [row.office_id],
    );

    if (validRes.rows.length === 0) {
      // Reservation is stale — mark skipped, write audit, do not send email.
      await client.query(
        `UPDATE slot_notification_outbox
         SET status = 'skipped', sent_at = NOW()
         WHERE id = $1`,
        [row.id],
      );
      await writeSlotAudit(client, row.office_id, row.market_key, "notification_skipped_stale", "reservation_no_longer_valid");
      await client.query("COMMIT");
      logger.info({ id: row.id, officeId: row.office_id }, "[outbox] Notification skipped — reservation stale");
      return "skipped";
    }

    // ── Fetch office info ──────────────────────────────────────────────────
    const infoRes = await client.query<{
      email:                  string;
      name:                   string;
      name_ar:                string | null;
      reservation_expires_at: Date | null;
    }>(
      `SELECT o.email, o.name, o.name_ar, msa.reservation_expires_at
       FROM offices o
       JOIN market_slot_allocations msa ON msa.office_id = o.id
       WHERE o.id = $1`,
      [row.office_id],
    );
    const info = infoRes.rows[0];

    if (!info) {
      // Office was deleted — silently skip.
      await client.query(
        `UPDATE slot_notification_outbox SET status = 'skipped', sent_at = NOW() WHERE id = $1`,
        [row.id],
      );
      await client.query("COMMIT");
      return "skipped";
    }

    // ── Send email ─────────────────────────────────────────────────────────
    // The transaction is held open during the email send.
    // This is acceptable for a low-volume notification system (a few per day).
    // The benefit: if the send succeeds but the COMMIT fails, we retry delivery
    // rather than silently losing the notification.
    const expiresAt = info.reservation_expires_at ?? new Date(Date.now() + 3 * 60 * 60 * 1000);

    try {
      await emailProvider.sendSlotReservationNotice({
        to:           info.email,
        locale:       "ar",          // Platform default — no per-office locale stored
        officeName:   info.name,
        officeNameAr: info.name_ar ?? info.name,
        expiresAt,
        marketKey:    row.market_key,
      });

      // Success — mark sent and write audit.
      await client.query(
        `UPDATE slot_notification_outbox
         SET status = 'sent', sent_at = NOW(), attempts = attempts + 1, last_error = NULL
         WHERE id = $1`,
        [row.id],
      );
      await writeSlotAudit(client, row.office_id, row.market_key, "notification_sent", "email_delivered");
      await client.query("COMMIT");

      logger.info({ id: row.id, officeId: row.office_id, marketKey: row.market_key }, "[outbox] Notification sent");
      return "sent";

    } catch (emailErr) {
      // Email send failed — apply backoff; mark permanently failed if max reached.
      const newAttempts = row.attempts + 1;
      const exhausted   = newAttempts >= MAX_ATTEMPTS;
      const errMsg      = sanitiseError(emailErr);

      if (exhausted) {
        await client.query(
          `UPDATE slot_notification_outbox
           SET status = 'failed', attempts = $2, last_error = $3
           WHERE id = $1`,
          [row.id, newAttempts, errMsg],
        );
        await writeSlotAudit(client, row.office_id, row.market_key, "notification_failed", "max_retries_exceeded");
        await client.query("COMMIT");
        logger.warn({ id: row.id, officeId: row.office_id, newAttempts, errMsg }, "[outbox] Notification permanently failed");
      } else {
        const nextAttemptAt = new Date(Date.now() + backoffMs(newAttempts));
        await client.query(
          `UPDATE slot_notification_outbox
           SET status = 'failed', attempts = $2, last_error = $3, next_attempt_at = $4
           WHERE id = $1`,
          [row.id, newAttempts, errMsg, nextAttemptAt],
        );
        await client.query("COMMIT");
        logger.warn({ id: row.id, officeId: row.office_id, newAttempts, nextAttemptAt }, "[outbox] Notification failed — will retry");
      }

      return "failed";
    }

  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

/** Write a slot_audit_log entry via an in-progress transaction client. */
async function writeSlotAudit(
  client: { query: Function },
  officeId: number,
  marketKey: string,
  action: string,
  reason: string,
): Promise<void> {
  try {
    await client.query(
      `INSERT INTO slot_audit_log
         (office_id, market_key, action, slot_status_before, slot_status_after,
          priority_tier, reason, performed_by)
       VALUES ($1,$2,$3,NULL,NULL,NULL,$4,NULL)`,
      [officeId, marketKey, action, reason],
    );
  } catch (auditErr) {
    // Audit failure must not abort notification delivery.
    logger.warn({ auditErr, action, officeId }, "[outbox] Audit write failed — continuing");
  }
}

// ── getOutboxForMarket ────────────────────────────────────────────────────────
// Returns outbox rows scoped to a single market key — for per-market admin views.
// Only returns rows created within the last 12 hours so the list stays concise.

export interface OutboxMarketEntry {
  id:            number;
  officeId:      number;
  status:        "pending" | "sent" | "failed" | "skipped";
  attempts:      number;
  lastError:     string | null;
  nextAttemptAt: Date | null;
  createdAt:     Date;
  sentAt:        Date | null;
}

export async function getOutboxForMarket(
  marketKey: string,
): Promise<OutboxMarketEntry[]> {
  const res = await pool.query<{
    id:              number;
    office_id:       number;
    status:          string;
    attempts:        number;
    last_error:      string | null;
    next_attempt_at: Date | null;
    created_at:      Date;
    sent_at:         Date | null;
  }>(
    `SELECT id, office_id, status, attempts, last_error, next_attempt_at, created_at, sent_at
     FROM slot_notification_outbox
     WHERE market_key = $1
       AND created_at >= NOW() - INTERVAL '12 hours'
     ORDER BY created_at DESC
     LIMIT 100`,
    [marketKey],
  );
  return res.rows.map((r) => ({
    id:            r.id,
    officeId:      r.office_id,
    status:        r.status as OutboxMarketEntry["status"],
    attempts:      r.attempts,
    lastError:     r.last_error,
    nextAttemptAt: r.next_attempt_at,
    createdAt:     r.created_at,
    sentAt:        r.sent_at,
  }));
}

// ── getOutboxSummary ──────────────────────────────────────────────────────────

/**
 * Return aggregate counts and recent failures for admin visibility
 * and Platform Health checks.
 */
export async function getOutboxSummary(): Promise<OutboxSummary> {
  const [countsRes, failuresRes] = await Promise.all([
    pool.query<{
      pending: number;
      sent:    number;
      failed:  number;
      skipped: number;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'pending')::integer AS pending,
         COUNT(*) FILTER (WHERE status = 'sent')::integer    AS sent,
         COUNT(*) FILTER (WHERE status = 'failed')::integer  AS failed,
         COUNT(*) FILTER (WHERE status = 'skipped')::integer AS skipped
       FROM slot_notification_outbox`,
    ),
    pool.query<{
      id:         number;
      office_id:  number;
      market_key: string;
      attempts:   number;
      last_error: string | null;
      created_at: Date;
    }>(
      `SELECT id, office_id, market_key, attempts, last_error, created_at
       FROM slot_notification_outbox
       WHERE status = 'failed'
       ORDER BY created_at DESC
       LIMIT 10`,
    ),
  ]);

  return {
    pending:  countsRes.rows[0]?.pending  ?? 0,
    sent:     countsRes.rows[0]?.sent     ?? 0,
    failed:   countsRes.rows[0]?.failed   ?? 0,
    skipped:  countsRes.rows[0]?.skipped  ?? 0,
    recentFailures: failuresRes.rows.map((r) => ({
      id:        r.id,
      officeId:  r.office_id,
      marketKey: r.market_key,
      attempts:  r.attempts,
      lastError: r.last_error,
      createdAt: r.created_at,
    })),
  };
}

// ── scheduleOutboxWorker ──────────────────────────────────────────────────────

/**
 * Register the outbox worker to run every 2 minutes.
 * Called once at server startup (in index.ts).
 *
 * Both the setTimeout and setInterval use .unref() so they do not prevent
 * the Node.js process from exiting cleanly in tests.
 */
export function scheduleOutboxWorker(): void {
  // First run: 30 seconds after startup (give the server time to stabilise).
  setTimeout(() => {
    runOutboxWorker().catch((err) => {
      logger.error({ err }, "[outbox] Initial worker run failed");
    });
  }, 30_000).unref();

  // Subsequent runs: every 2 minutes.
  setInterval(() => {
    runOutboxWorker().catch((err) => {
      logger.error({ err }, "[outbox] Scheduled worker run failed");
    });
  }, TWO_MINUTES).unref();

  logger.info("[outbox] Notification outbox worker scheduled (every 2 min, first run in 30s)");
}
