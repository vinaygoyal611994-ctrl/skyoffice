/**
 * In-memory platform health tracker.
 *
 * Deliberately ephemeral — data resets on server restart. This is intentional:
 * the error window is "since last deploy / restart", which is useful operational
 * context. Nothing here is persisted, exported, or logged to external services.
 *
 * Security: all stored values are scrubbed before leaving this module.
 *   • HTTP paths have query strings stripped (avoids leaking tokens in paths)
 *   • Error messages are capped at 100 chars (avoids leaking stack traces)
 *   • No credentials, URLs, keys, or request bodies are stored
 */

const MAX_RECENT_ERRORS = 20;
const ERROR_WINDOW_MS   = 60 * 60 * 1000; // 1 hour

export interface ErrorRecord {
  timestamp: Date;
  method: string;
  /** Path only — query string removed */
  path: string;
  statusCode: number;
  /** First 100 chars of the error message; no stack trace */
  errorSummary: string;
}

interface EmailStats {
  attempted: number;
  delivered: number;
  failed: number;
  lastFailureAt: Date | null;
  /** Sanitised failure description, ≤ 100 chars */
  lastFailureSummary: string | null;
}

/** Outbox health — tracks in-memory totals for the most recent worker runs. */
interface OutboxStats {
  /** Rows still waiting to be sent (total across all pending workers runs, ephemeral). */
  totalSent:       number;
  totalFailed:     number;   // permanently failed (all retries exhausted since last restart)
  totalSkipped:    number;   // stale-reservation skips since last restart
  lastWorkerRunAt: Date | null;
  /** > 0 means some providers may not have been notified. Needs investigation. */
  lastFailureAt:   Date | null;
  lastFailureSummary: string | null;
}

interface HealthStore {
  startTime: Date;
  errors5xx: ErrorRecord[];
  total5xx: number;
  email: EmailStats;
  outbox: OutboxStats;
}

const store: HealthStore = {
  startTime:  new Date(),
  errors5xx:  [],
  total5xx:   0,
  email: {
    attempted:          0,
    delivered:          0,
    failed:             0,
    lastFailureAt:      null,
    lastFailureSummary: null,
  },
  outbox: {
    totalSent:          0,
    totalFailed:        0,
    totalSkipped:       0,
    lastWorkerRunAt:    null,
    lastFailureAt:      null,
    lastFailureSummary: null,
  },
};

// ── Public API ────────────────────────────────────────────────────────────────

/** Record a 5xx HTTP error. Safe to call from error-handling middleware. */
export function recordHttpError(
  statusCode: number,
  method: string,
  rawPath: string,
  err?: unknown,
): void {
  if (statusCode < 500) return;

  const path = rawPath.split("?")[0]; // strip query string
  const errorSummary =
    err instanceof Error
      ? err.message.slice(0, 100)
      : String(err ?? "unknown error").slice(0, 100);

  store.total5xx++;
  store.errors5xx.unshift({ timestamp: new Date(), method, path, statusCode, errorSummary });
  if (store.errors5xx.length > MAX_RECENT_ERRORS) store.errors5xx.pop();
}

/** Record a transactional email send attempt (Resend provider only). */
export function recordEmailAttempt(
  delivered: boolean,
  failureSummary?: string,
): void {
  store.email.attempted++;
  if (delivered) {
    store.email.delivered++;
  } else {
    store.email.failed++;
    store.email.lastFailureAt = new Date();
    store.email.lastFailureSummary = failureSummary
      ? failureSummary.slice(0, 100)
      : "Delivery failed";
  }
}

/**
 * Record one outbox worker run result.
 * Called by runOutboxWorker() after each pass.
 * Accumulates totals since last server restart.
 */
export function recordOutboxWorkerRun(result: {
  sent:    number;
  failed:  number;
  skipped: number;
}): void {
  store.outbox.totalSent    += result.sent;
  store.outbox.totalSkipped += result.skipped;
  store.outbox.totalFailed  += result.failed;
  store.outbox.lastWorkerRunAt = new Date();

  if (result.failed > 0) {
    store.outbox.lastFailureAt = new Date();
    store.outbox.lastFailureSummary =
      `${result.failed} notification(s) permanently failed in last run`;
  }
}

/** Return a read-only health snapshot. Called by the admin health route. */
export function getHealthSnapshot() {
  const now = Date.now();
  const windowStart = now - ERROR_WINDOW_MS;
  const recentWindow = store.errors5xx.filter(
    (e) => e.timestamp.getTime() > windowStart,
  );

  return {
    startTime:   store.startTime,
    uptimeMs:    now - store.startTime.getTime(),
    errors: {
      total5xx:    store.total5xx,
      lastHour:    recentWindow.length,
      last5xxAt:   store.errors5xx[0]?.timestamp ?? null,
      recent:      store.errors5xx.slice(0, 10), // up to 10 for drill-down
    },
    email: { ...store.email },
    outbox: { ...store.outbox },
  };
}
