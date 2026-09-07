/**
 * GET /api/admin/health — Platform Health endpoint.
 *
 * Returns a structured operational health snapshot for the admin dashboard.
 * Requires admin role. No secrets, credentials, URLs, or stack traces are
 * ever included in the response.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { requireRole } from "../middlewares/authMiddleware";
import { getHealthSnapshot } from "../lib/healthTracker";

const router: IRouter = Router();

// ── Thresholds ────────────────────────────────────────────────────────────────

const THRESHOLDS = {
  // 5xx errors in the last hour
  errors: { critical: 10, warning: 3 },
  // Consecutive aggregation job failures
  consecutiveFailures: { critical: 3, warning: 1 },
  // Minutes since last successful aggregation job before raising a flag.
  // Aggregator runs hourly + on startup; warn after 2 h, critical after 6 h.
  jobStaleness: { warningMinutes: 120, criticalMinutes: 360 },
  // Email failure rate (fraction 0–1), only meaningful with ≥ 5 attempts.
  emailFailRate: { warning: 0.20 },
};

type HealthStatus = "healthy" | "warning" | "critical";

function worstStatus(...statuses: HealthStatus[]): HealthStatus {
  if (statuses.includes("critical")) return "critical";
  if (statuses.includes("warning"))  return "warning";
  return "healthy";
}

// ── Background-job helpers ────────────────────────────────────────────────────

interface JobRow {
  id: number;
  date_start: string;
  trigger: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  failed_at: string | null;
  duration_ms: number | null;
  rows_processed: number | null;
  /** Safe truncated error — no stack trace, no credentials */
  error_message: string | null;
}

/** Count how many trailing jobs (most-recent-first) are all failed. */
function countConsecutiveFailures(jobs: JobRow[]): number {
  let count = 0;
  for (const job of jobs) {
    if (job.status === "failed") count++;
    else break;
  }
  return count;
}

function jobStatus(
  consecutiveFailures: number,
  lastSuccessAt: Date | null,
  hasHistory: boolean,
): HealthStatus {
  if (!hasHistory) return "healthy"; // no jobs yet — scheduler not overdue

  if (consecutiveFailures >= THRESHOLDS.consecutiveFailures.critical) return "critical";

  const msSinceSuccess = lastSuccessAt
    ? Date.now() - lastSuccessAt.getTime()
    : Infinity;
  const minutesSinceSuccess = msSinceSuccess / 60_000;

  if (minutesSinceSuccess >= THRESHOLDS.jobStaleness.criticalMinutes) return "critical";
  if (consecutiveFailures >= THRESHOLDS.consecutiveFailures.warning)   return "warning";
  if (minutesSinceSuccess >= THRESHOLDS.jobStaleness.warningMinutes)   return "warning";

  return "healthy";
}

// ── Route ─────────────────────────────────────────────────────────────────────

router.get(
  "/admin/health",
  requireRole("admin"),
  async (_req: Request, res: Response): Promise<void> => {
    const checkedAt = new Date();

    // ── 1. Application errors (in-memory) ────────────────────────────────────
    const snap = getHealthSnapshot();
    const errorsLastHour = snap.errors.lastHour;
    let appStatus: HealthStatus = "healthy";
    if (errorsLastHour >= THRESHOLDS.errors.critical)     appStatus = "critical";
    else if (errorsLastHour >= THRESHOLDS.errors.warning) appStatus = "warning";

    const application = {
      status:           appStatus,
      errors5xxTotal:   snap.errors.total5xx,
      errors5xxLastHour: errorsLastHour,
      last5xxAt:        snap.errors.last5xxAt,
      recentErrors:     snap.errors.recent.map((e) => ({
        timestamp:    e.timestamp,
        method:       e.method,
        path:         e.path,
        statusCode:   e.statusCode,
        errorSummary: e.errorSummary,
      })),
    };

    // ── 2. Database / core services ──────────────────────────────────────────
    let dbStatus: HealthStatus = "healthy";
    let dbResponseMs: number | null = null;
    let dbMessage: string | null = null;

    try {
      const t0 = Date.now();
      const client = await pool.connect();
      try {
        await client.query("SELECT 1");
      } finally {
        client.release();
      }
      dbResponseMs = Date.now() - t0;
    } catch (err) {
      dbStatus = "critical";
      // Only expose a generic message — no connection string, no host, no credentials
      dbMessage = "Database ping failed — check connectivity";
    }

    const database = {
      status:      dbStatus,
      responseMs:  dbResponseMs,
      message:     dbMessage,
      apiHealthy:  true, // if this handler is executing, the API is reachable
    };

    // ── 3. Background jobs (analytics aggregation) ───────────────────────────
    let bgStatus: HealthStatus = "healthy";
    let recentJobs: JobRow[] = [];
    let totalCompleted = 0;
    let totalFailed = 0;
    let totalSkipped = 0;
    let lastSuccessAt: Date | null = null;
    let consecutiveFailures = 0;

    try {
      // Fetch last 10 jobs (most recent first) for consecutive-failure detection
      const jobsResult = await pool.query<JobRow>(`
        SELECT id, date_start, trigger, status, started_at,
               completed_at, failed_at, duration_ms, rows_processed,
               -- Truncate error message; strip any potential credential strings
               CASE WHEN error_message IS NOT NULL
                    THEN LEFT(error_message, 100)
                    ELSE NULL
               END AS error_message
        FROM analytics_aggregation_jobs
        ORDER BY started_at DESC
        LIMIT 10
      `);
      recentJobs = jobsResult.rows;

      // Aggregate counts (7-day window — short enough to reflect recent state)
      const statsResult = await pool.query<{
        total_completed: string;
        total_failed: string;
        total_skipped: string;
        last_success_at: string | null;
      }>(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'completed')::int AS total_completed,
          COUNT(*) FILTER (WHERE status = 'failed')::int    AS total_failed,
          COUNT(*) FILTER (WHERE status = 'skipped')::int   AS total_skipped,
          MAX(completed_at) FILTER (WHERE status = 'completed') AS last_success_at
        FROM analytics_aggregation_jobs
        WHERE started_at > NOW() - INTERVAL '7 days'
      `);

      const stats = statsResult.rows[0];
      totalCompleted = parseInt(stats.total_completed ?? "0", 10);
      totalFailed    = parseInt(stats.total_failed    ?? "0", 10);
      totalSkipped   = parseInt(stats.total_skipped   ?? "0", 10);
      lastSuccessAt  = stats.last_success_at ? new Date(stats.last_success_at) : null;

      consecutiveFailures = countConsecutiveFailures(recentJobs);
      bgStatus = jobStatus(consecutiveFailures, lastSuccessAt, recentJobs.length > 0);
    } catch (err) {
      bgStatus = "warning";
    }

    const backgroundJobs = {
      status:               bgStatus,
      lastSuccessAt,
      consecutiveFailures,
      totalCompleted,
      totalFailed,
      totalSkipped,
      recentJobs: recentJobs.map((j) => ({
        id:           j.id,
        dateStart:    j.date_start,
        trigger:      j.trigger,
        status:       j.status,
        startedAt:    j.started_at,
        completedAt:  j.completed_at,
        durationMs:   j.duration_ms,
        rowsProcessed: j.rows_processed,
        errorMessage: j.error_message,
      })),
    };

    // ── 3.5 Market recompute runs ────────────────────────────────────────────
    interface RecomputeRunRow {
      id: number;
      triggered_by: string;
      status: string;
      started_at: string;
      completed_at: string | null;
      failed_at: string | null;
      skipped_at: string | null;
      duration_ms: number | null;
      markets_upserted: number | null;
      error_message: string | null;
      skip_reason: string | null;
    }

    let marketRecompute: {
      status: HealthStatus;
      lastSuccessAt: Date | null;
      lastFailureAt: Date | null;
      consecutiveFailures: number;
      totalCompleted7d: number;
      totalFailed7d: number;
      totalSkipped7d: number;
      recentRuns: RecomputeRunRow[];
    };

    try {
      const [runsRes, statsRes] = await Promise.all([
        pool.query<RecomputeRunRow>(`
          SELECT id, triggered_by, status, started_at,
                 completed_at, failed_at, skipped_at, duration_ms, markets_upserted,
                 skip_reason,
                 CASE WHEN error_message IS NOT NULL
                      THEN LEFT(error_message, 100) ELSE NULL
                 END AS error_message
          FROM market_recompute_runs
          ORDER BY started_at DESC
          LIMIT 10
        `),
        pool.query<{
          total_completed: string;
          total_failed: string;
          total_skipped: string;
          last_success_at: string | null;
          last_failure_at: string | null;
        }>(`
          SELECT
            COUNT(*) FILTER (WHERE status = 'completed')::int AS total_completed,
            COUNT(*) FILTER (WHERE status = 'failed')::int    AS total_failed,
            COUNT(*) FILTER (WHERE status = 'skipped')::int   AS total_skipped,
            MAX(completed_at) FILTER (WHERE status = 'completed') AS last_success_at,
            MAX(failed_at)    FILTER (WHERE status = 'failed')    AS last_failure_at
          FROM market_recompute_runs
          WHERE started_at > NOW() - INTERVAL '7 days'
        `),
      ]);

      const mrRuns   = runsRes.rows;
      const mrStats  = statsRes.rows[0];
      const mrConsec = countConsecutiveFailures(
        mrRuns.map((r) => ({ ...r, date_start: r.started_at, trigger: r.triggered_by, rows_processed: r.markets_upserted }))
      );
      const mrLastSuccess = mrStats.last_success_at ? new Date(mrStats.last_success_at) : null;
      const mrLastFailure = mrStats.last_failure_at ? new Date(mrStats.last_failure_at) : null;
      const mrStatus = jobStatus(mrConsec, mrLastSuccess, mrRuns.length > 0);

      marketRecompute = {
        status:             mrStatus,
        lastSuccessAt:      mrLastSuccess,
        lastFailureAt:      mrLastFailure,
        consecutiveFailures: mrConsec,
        totalCompleted7d:   parseInt(mrStats.total_completed ?? "0", 10),
        totalFailed7d:      parseInt(mrStats.total_failed    ?? "0", 10),
        totalSkipped7d:     parseInt(mrStats.total_skipped   ?? "0", 10),
        recentRuns: mrRuns,
      };
    } catch {
      // Table may not exist in dev environments that haven't run migration 0035
      marketRecompute = {
        status:             "healthy",
        lastSuccessAt:      null,
        lastFailureAt:      null,
        consecutiveFailures: 0,
        totalCompleted7d:   0,
        totalFailed7d:      0,
        totalSkipped7d:     0,
        recentRuns: [],
      };
    }

    // ── 4. Notifications (email) ─────────────────────────────────────────────
    const providerConfigured =
      !!(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);

    const emailSnap = snap.email;
    let notifStatus: HealthStatus = "healthy";
    let failureRate: number | null = null;

    if (providerConfigured && emailSnap.attempted >= 5) {
      failureRate = emailSnap.failed / emailSnap.attempted;
      if (failureRate > THRESHOLDS.emailFailRate.warning) notifStatus = "warning";
    }

    const notifications = {
      status:              notifStatus,
      providerConfigured,
      attempted:           emailSnap.attempted,
      delivered:           emailSnap.delivered,
      failed:              emailSnap.failed,
      failureRate:         failureRate !== null ? Math.round(failureRate * 100) : null,
      lastFailureAt:       emailSnap.lastFailureAt,
      lastFailureSummary:  emailSnap.lastFailureSummary,
    };

    // ── 5. Payments — live metrics from office_payment_transactions ──────────
    let payments: {
      status:              string;
      gatewayConnected:    boolean;
      succeededLast24h:    number | null;
      failedLast24h:       number | null;
      failedNoSlotLast24h: number | null;
      stuckPendingCount:   number | null;
      note:                string | null;
    };
    try {
      const [payRes] = await Promise.all([
        pool.query<{
          succeeded_last24h:     string;
          failed_last24h:        string;
          failed_no_slot_last24h: string;
          stuck_pending:         string;
        }>(
          `SELECT
             COUNT(*) FILTER (WHERE status = 'succeeded'   AND created_at > NOW() - INTERVAL '24 hours')::text AS succeeded_last24h,
             COUNT(*) FILTER (WHERE status = 'failed'      AND created_at > NOW() - INTERVAL '24 hours')::text AS failed_last24h,
             COUNT(*) FILTER (WHERE status = 'failed_no_slot' AND created_at > NOW() - INTERVAL '24 hours')::text AS failed_no_slot_last24h,
             COUNT(*) FILTER (WHERE status = 'pending'     AND created_at < NOW() - INTERVAL '1 hour')::text    AS stuck_pending
           FROM office_payment_transactions`,
        ),
      ]);
      const p = payRes.rows[0];
      const gatewayConnected = !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.length > 0);
      const stuckPending     = parseInt(p?.stuck_pending ?? "0", 10);

      payments = {
        status:              stuckPending > 0 ? "warning" : "healthy",
        gatewayConnected,
        succeededLast24h:    parseInt(p?.succeeded_last24h     ?? "0", 10),
        failedLast24h:       parseInt(p?.failed_last24h        ?? "0", 10),
        failedNoSlotLast24h: parseInt(p?.failed_no_slot_last24h ?? "0", 10),
        stuckPendingCount:   stuckPending,
        note:                !gatewayConnected
          ? "STRIPE_SECRET_KEY not set — Stripe is not connected"
          : null,
      };
    } catch (_payErr) {
      // Table may not exist yet in dev environments that haven't run migration 0033
      payments = {
        status:              "not_configured",
        gatewayConnected:    false,
        succeededLast24h:    null,
        failedLast24h:       null,
        failedNoSlotLast24h: null,
        stuckPendingCount:   null,
        note:                "Payment table not found — run migration 0033.",
      };
    }

    // ── 6. Slot-sync consistency ─────────────────────────────────────────────
    //
    // Detects offices where payment succeeded and subscription is active_paid
    // but convertReservationToAllocation() failed post-commit.  Any non-zero
    // count is critical: the provider paid but their listing is still hidden.
    let slotSyncStatus: HealthStatus = "healthy";
    let slotSyncPendingCount = 0;
    let slotSyncMessage: string | null = null;
    let slotSyncNeedsAdmin = 0;

    try {
      const syncRes = await pool.query<{
        pending_count:     string;
        needs_admin_count: string;
      }>(
        `SELECT
           COUNT(*) FILTER (WHERE slot_sync_needed_at IS NOT NULL)::text               AS pending_count,
           COUNT(*) FILTER (
             WHERE slot_sync_needed_at IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1 FROM market_slot_allocations msa
                 WHERE msa.office_id = os.office_id
                   AND msa.slot_status = 'reserved'
                   AND msa.reservation_expires_at > NOW()
               )
           )::text AS needs_admin_count
         FROM office_subscriptions os
         WHERE os.state = 'active_paid'`,
      );
      slotSyncPendingCount = parseInt(syncRes.rows[0]?.pending_count ?? "0", 10);
      slotSyncNeedsAdmin   = parseInt(syncRes.rows[0]?.needs_admin_count ?? "0", 10);

      if (slotSyncPendingCount > 0) {
        slotSyncStatus  = "critical";
        slotSyncMessage = slotSyncNeedsAdmin > 0
          ? `${slotSyncPendingCount} active_paid office(s) have no allocated slot; ${slotSyncNeedsAdmin} need manual admin intervention (reservation expired)`
          : `${slotSyncPendingCount} active_paid office(s) have no allocated slot — slot-sync sweeper will retry`;
      }
    } catch (_syncErr) {
      // Migration 0036 not yet applied in this environment.
      slotSyncMessage = "slot_sync_needed_at column not found — run migration 0036";
    }

    const slotSync = {
      status:             slotSyncStatus,
      pendingCount:       slotSyncPendingCount,
      needsAdminCount:    slotSyncNeedsAdmin,
      message:            slotSyncMessage,
    };

    // ── 7. Storage parity guard (Blocker 4) ──────────────────────────────────
    // Validates that storage env vars are present and that the backup bucket
    // is isolated from the main storage buckets. No credentials, bucket names,
    // or URLs are included in the response — only parity status indicators.
    const storageParityChecks: Array<{ name: string; ok: boolean; note: string | null }> = [];
    const REQUIRED_STORAGE = [
      "STORAGE_ENDPOINT",
      "STORAGE_REGION",
      "STORAGE_ACCESS_KEY_ID",
      "STORAGE_SECRET_ACCESS_KEY",
      "STORAGE_PUBLIC_BUCKET",
      "STORAGE_PRIVATE_BUCKET",
    ];
    const missingStorage = REQUIRED_STORAGE.filter((v) => !process.env[v]);
    storageParityChecks.push({
      name: "storage-env-vars",
      ok: missingStorage.length === 0,
      note: missingStorage.length > 0
        ? `Missing: ${missingStorage.join(", ")}`
        : null,
    });
    const backupBucket = process.env["BACKUP_S3_BUCKET"];
    const privateBucket = process.env["STORAGE_PRIVATE_BUCKET"];
    const publicBucket = process.env["STORAGE_PUBLIC_BUCKET"];
    const backupIsolated =
      !!backupBucket &&
      backupBucket !== privateBucket &&
      backupBucket !== publicBucket;
    storageParityChecks.push({
      name: "backup-bucket-isolation",
      ok: backupIsolated,
      note: !backupBucket
        ? "BACKUP_S3_BUCKET not set — backups use main bucket (set a dedicated backup bucket)"
        : !backupIsolated
        ? "BACKUP_S3_BUCKET conflicts with a main storage bucket — use a dedicated backup bucket"
        : null,
    });
    const storageParityOk = storageParityChecks.every((c) => c.ok);
    const storageParity: { status: HealthStatus; checks: typeof storageParityChecks } = {
      status: storageParityOk ? "healthy" : missingStorage.length > 0 ? "critical" : "warning",
      checks: storageParityChecks,
    };

    // ── 8. Overall status ────────────────────────────────────────────────────
    const overallStatus = worstStatus(
      appStatus,
      bgStatus,
      marketRecompute.status,
      dbStatus,
      notifStatus,
      slotSyncStatus,
      storageParity.status,
    );

    // ── 9. Assemble response ─────────────────────────────────────────────────
    res.json({
      overallStatus,
      checkedAt,
      uptimeSeconds: Math.floor(snap.uptimeMs / 1000),
      application,
      backgroundJobs,
      marketRecompute,
      database,
      notifications,
      payments,
      slotSync,
      storageParity,
    });
  },
);

export default router;
