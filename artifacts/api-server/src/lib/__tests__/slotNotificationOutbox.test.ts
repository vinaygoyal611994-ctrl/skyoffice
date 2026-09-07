/**
 * Slot Notification Outbox — comprehensive test suite.
 *
 * Architecture under test:
 *   • enqueueNotification() — called inside processWaitlist's transaction
 *   • runOutboxWorker()     — per-row processing with FOR UPDATE SKIP LOCKED
 *   • getOutboxSummary()    — admin visibility
 *
 * Covers:
 *   1.  enqueueNotification: inserts a pending row using the provided client
 *   2.  enqueueNotification: ON CONFLICT DO NOTHING (idempotency — same reservationId)
 *   3.  Worker: no due rows → returns zero counts
 *   4.  Worker: pending row → reservation valid → sends email → marks sent → writes audit
 *   5.  Worker: row locked by concurrent worker (SKIP LOCKED) → noop, not processed twice
 *   6.  Worker: reservation expired → marks skipped → writes notification_skipped_stale audit
 *   7.  Worker: reservation converted to 'allocated' → marks skipped
 *   8.  Worker: email fails (first attempt) → increments attempts, sets backoff, status='failed'
 *   9.  Worker: email fails on last attempt → permanently marks status='failed' → writes notification_failed audit
 *   10. Worker: one row fails independently; other rows are not affected
 *   11. Worker: already sent row (status='sent') not re-processed
 *   12. Worker: office deleted (no row returned from JOIN) → marks skipped gracefully
 *   13. getOutboxSummary: returns correct counts and recent failures
 *   14. Health tracker: recordOutboxWorkerRun accumulates totals
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MockInstance } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  pool: {
    query:   vi.fn(),
    connect: vi.fn(),
  },
  db: {},
}));

vi.mock("../email", () => ({
  emailProvider: {
    sendSlotReservationNotice: vi.fn(),
  },
}));

vi.mock("../healthTracker", () => ({
  recordOutboxWorkerRun: vi.fn(),
}));

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { pool }                      from "@workspace/db";
import { emailProvider }             from "../email";
import { recordOutboxWorkerRun }     from "../healthTracker";
import {
  enqueueNotification,
  runOutboxWorker,
  getOutboxSummary,
} from "../slotNotificationOutbox";

// ── Helpers ───────────────────────────────────────────────────────────────────

type MockFn = MockInstance;

function pq()     { return pool.query   as unknown as MockFn; }
function pconn()  { return pool.connect as unknown as MockFn; }
function notify() { return emailProvider.sendSlotReservationNotice as unknown as MockFn; }
function recordHealth() { return recordOutboxWorkerRun as unknown as MockFn; }

/** Build a mock pg client with a query stub that consumes from a response list. */
function makeClientMock(responses: { rows: unknown[] }[]) {
  let callIdx = 0;
  const clientQuery = vi.fn().mockImplementation(() => {
    const resp = responses[callIdx++];
    return Promise.resolve(resp ?? { rows: [] });
  });
  return {
    query:   clientQuery,
    release: vi.fn(),
  };
}

/** Build an outbox row object as returned by the candidate SELECT or FOR UPDATE SELECT. */
function outboxRow(overrides: Partial<{
  id: number; office_id: number; market_key: string;
  reservation_id: string; attempts: number;
}> = {}) {
  return {
    id:             overrides.id             ?? 1,
    office_id:      overrides.office_id      ?? 10,
    market_key:     overrides.market_key     ?? "SA|riyadh|marketing",
    reservation_id: overrides.reservation_id ?? "10:2026-08-16T00:00:00.000Z",
    attempts:       overrides.attempts       ?? 0,
  };
}

/** Standard info row returned when the worker fetches office + slot details. */
function infoRow(override: Partial<{ email: string; name: string; name_ar: string; reservation_expires_at: Date }> = {}) {
  return {
    email:                  override.email                  ?? "office@example.com",
    name:                   override.name                   ?? "Test Office",
    name_ar:                override.name_ar                ?? "مكتب اختبار",
    reservation_expires_at: override.reservation_expires_at ?? new Date(Date.now() + 3 * 60 * 60 * 1000),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. enqueueNotification — inserts outbox row via the provided client
// ─────────────────────────────────────────────────────────────────────────────

describe("enqueueNotification", () => {
  it("calls client.query with INSERT INTO slot_notification_outbox and correct params", async () => {
    const clientQuery = vi.fn().mockResolvedValue({ rows: [] });
    const fakeClient = { query: clientQuery };

    await enqueueNotification(42, "SA|riyadh|marketing", "42:2026-08-16T00:00:00.000Z", fakeClient);

    expect(clientQuery).toHaveBeenCalledOnce();
    const [sql, params] = clientQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("INSERT INTO slot_notification_outbox");
    expect(sql).toContain("ON CONFLICT (reservation_id) DO NOTHING");
    expect(params[0]).toBe(42);                                 // office_id
    expect(params[1]).toBe("SA|riyadh|marketing");             // market_key
    expect(params[2]).toBe("42:2026-08-16T00:00:00.000Z");    // reservation_id
  });

  it("ON CONFLICT DO NOTHING: second call with same reservationId does not throw", async () => {
    const clientQuery = vi.fn().mockResolvedValue({ rows: [] });
    const fakeClient = { query: clientQuery };
    const reservationId = "99:2026-08-16T01:00:00.000Z";

    await enqueueNotification(99, "SA|jeddah|legal", reservationId, fakeClient);
    await enqueueNotification(99, "SA|jeddah|legal", reservationId, fakeClient);

    // Both calls succeed (ON CONFLICT DO NOTHING makes the second a no-op in the DB)
    expect(clientQuery).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Worker: no due rows → zero counts, health tracker called
// ─────────────────────────────────────────────────────────────────────────────

describe("runOutboxWorker — no due rows", () => {
  it("returns zero counts when no pending/failed rows are due", async () => {
    pq().mockResolvedValueOnce({ rows: [] }); // candidate SELECT returns empty

    const result = await runOutboxWorker();

    expect(result.processed).toBe(0);
    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.errors).toBe(0);
  });

  it("calls recordOutboxWorkerRun even with zero rows", async () => {
    pq().mockResolvedValueOnce({ rows: [] });

    await runOutboxWorker();

    expect(recordHealth()).toHaveBeenCalledOnce();
    const [statsArg] = (recordHealth() as MockFn).mock.calls[0] as [{ sent: number; failed: number; skipped: number }];
    expect(statsArg.sent).toBe(0);
    expect(statsArg.failed).toBe(0);
    expect(statsArg.skipped).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Worker: pending row → reservation valid → sent
// ─────────────────────────────────────────────────────────────────────────────

describe("runOutboxWorker — successful send", () => {
  it("sends email, marks row sent, writes notification_sent audit", async () => {
    const row = outboxRow();

    // Step 1: candidate SELECT returns one row
    pq().mockResolvedValueOnce({ rows: [{ id: row.id }] });

    // Step 2: per-row transaction
    const client = makeClientMock([
      { rows: [] },          // BEGIN
      { rows: [row] },       // FOR UPDATE SKIP LOCKED → lock acquired
      { rows: [{ slot_status: "reserved" }] },  // staleness check → still valid
      { rows: [infoRow()] }, // office info JOIN
      { rows: [] },          // UPDATE status='sent'
      { rows: [] },          // INSERT slot_audit_log notification_sent
      { rows: [] },          // COMMIT
    ]);
    pconn().mockResolvedValueOnce(client);

    notify().mockResolvedValue(undefined);

    const result = await runOutboxWorker();

    expect(result.sent).toBe(1);
    expect(result.processed).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(notify()).toHaveBeenCalledOnce();

    // Verify email was called with correct data
    const emailArgs = (notify() as MockFn).mock.calls[0][0] as { to: string; marketKey: string };
    expect(emailArgs.to).toBe("office@example.com");
    expect(emailArgs.marketKey).toBe("SA|riyadh|marketing");

    // UPDATE should reference 'sent'
    const updateCall = client.query.mock.calls.find(
      (c: unknown[]) => String(c[0]).includes("UPDATE slot_notification_outbox") && String(c[0]).includes("'sent'"),
    );
    expect(updateCall).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Worker: row locked by concurrent worker (SKIP LOCKED) → noop
// ─────────────────────────────────────────────────────────────────────────────

describe("runOutboxWorker — concurrent worker SKIP LOCKED", () => {
  it("skips rows that return empty from FOR UPDATE SKIP LOCKED without incrementing processed", async () => {
    const row = outboxRow();

    pq().mockResolvedValueOnce({ rows: [{ id: row.id }] }); // candidate SELECT

    // FOR UPDATE SKIP LOCKED returns empty — row taken by another worker
    const client = makeClientMock([
      { rows: [] },   // BEGIN
      { rows: [] },   // FOR UPDATE SKIP LOCKED → empty (locked)
      { rows: [] },   // ROLLBACK
    ]);
    pconn().mockResolvedValueOnce(client);

    const result = await runOutboxWorker();

    // noop — not counted in processed
    expect(result.processed).toBe(0);
    expect(result.sent).toBe(0);
    expect(notify()).not.toHaveBeenCalled();

    // ROLLBACK was called
    const rollbackCall = client.query.mock.calls.find(
      (c: unknown[]) => String(c[0]).toUpperCase().includes("ROLLBACK"),
    );
    expect(rollbackCall).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Worker: reservation expired → marks skipped
// ─────────────────────────────────────────────────────────────────────────────

describe("runOutboxWorker — stale reservation", () => {
  it("marks row skipped and writes notification_skipped_stale audit when reservation expired", async () => {
    const row = outboxRow();

    pq().mockResolvedValueOnce({ rows: [{ id: row.id }] });

    const client = makeClientMock([
      { rows: [] },     // BEGIN
      { rows: [row] },  // FOR UPDATE SKIP LOCKED → acquired
      { rows: [] },     // staleness check → 0 rows (reservation expired / no longer 'reserved')
      { rows: [] },     // UPDATE status='skipped'
      { rows: [] },     // INSERT slot_audit_log notification_skipped_stale
      { rows: [] },     // COMMIT
    ]);
    pconn().mockResolvedValueOnce(client);

    const result = await runOutboxWorker();

    expect(result.skipped).toBe(1);
    expect(result.sent).toBe(0);
    expect(notify()).not.toHaveBeenCalled();

    // Verify 'skipped' UPDATE was called
    const skipUpdate = client.query.mock.calls.find(
      (c: unknown[]) => String(c[0]).includes("'skipped'"),
    );
    expect(skipUpdate).toBeDefined();

    // Verify notification_skipped_stale audit was written
    // The action value is passed as a SQL param ($3), not embedded in the SQL string.
    const auditCall = client.query.mock.calls.find(
      (c: unknown[]) =>
        String(c[0]).includes("slot_audit_log") &&
        Array.isArray(c[1]) &&
        (c[1] as unknown[]).includes("notification_skipped_stale"),
    );
    expect(auditCall).toBeDefined();
  });

  it("marks row skipped when reservation status is 'allocated' (provider already paid)", async () => {
    // If slot_status = 'allocated', the staleness check SELECT (WHERE slot_status='reserved')
    // returns 0 rows → same skipped path.
    const row = outboxRow();

    pq().mockResolvedValueOnce({ rows: [{ id: row.id }] });

    const client = makeClientMock([
      { rows: [] },
      { rows: [row] },
      { rows: [] },     // staleness check → 0 (status is 'allocated', not 'reserved')
      { rows: [] },     // UPDATE skipped
      { rows: [] },     // audit
      { rows: [] },     // COMMIT
    ]);
    pconn().mockResolvedValueOnce(client);

    const result = await runOutboxWorker();

    expect(result.skipped).toBe(1);
    expect(notify()).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Worker: email fails (first attempt) → backoff, status='failed', not permanent
// ─────────────────────────────────────────────────────────────────────────────

describe("runOutboxWorker — email failure with retry", () => {
  it("increments attempts, sets next_attempt_at, status='failed' on first email failure", async () => {
    const row = outboxRow({ attempts: 0 }); // first attempt

    pq().mockResolvedValueOnce({ rows: [{ id: row.id }] });

    const client = makeClientMock([
      { rows: [] },          // BEGIN
      { rows: [row] },       // FOR UPDATE SKIP LOCKED
      { rows: [{ slot_status: "reserved" }] }, // staleness check → valid
      { rows: [infoRow()] }, // office info
      // email send will throw
      { rows: [] },          // UPDATE status='failed' (with backoff)
      { rows: [] },          // COMMIT
    ]);
    pconn().mockResolvedValueOnce(client);

    notify().mockRejectedValueOnce(new Error("SMTP connection refused"));

    const result = await runOutboxWorker();

    expect(result.failed).toBe(1);
    expect(result.sent).toBe(0);
    expect(result.errors).toBe(0); // caught gracefully

    // Verify UPDATE with failed status and next_attempt_at (4 params for backoff)
    const failUpdate = client.query.mock.calls.find(
      (c: unknown[]) =>
        String(c[0]).includes("UPDATE slot_notification_outbox") &&
        String(c[0]).includes("'failed'") &&
        String(c[0]).includes("next_attempt_at"),
    );
    expect(failUpdate).toBeDefined();
    const params = failUpdate![1] as unknown[];
    expect(params[1]).toBe(1); // attempts incremented to 1
    expect(params[2]).toContain("SMTP"); // last_error
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Worker: email fails on last attempt → permanently failed
// ─────────────────────────────────────────────────────────────────────────────

describe("runOutboxWorker — email failure permanent (max attempts)", () => {
  it("marks permanently failed and writes notification_failed audit on last attempt", async () => {
    const row = outboxRow({ attempts: 4 }); // 4 done, max is 5 → this is the last

    pq().mockResolvedValueOnce({ rows: [{ id: row.id }] });

    const client = makeClientMock([
      { rows: [] },
      { rows: [row] },
      { rows: [{ slot_status: "reserved" }] },
      { rows: [infoRow()] },
      // email fails on last attempt
      { rows: [] }, // UPDATE status='failed' (permanent — no next_attempt_at update)
      { rows: [] }, // INSERT slot_audit_log notification_failed
      { rows: [] }, // COMMIT
    ]);
    pconn().mockResolvedValueOnce(client);

    notify().mockRejectedValueOnce(new Error("Provider down"));

    const result = await runOutboxWorker();

    expect(result.failed).toBe(1);
    expect(result.sent).toBe(0);

    // UPDATE should NOT contain next_attempt_at (permanently failed — no backoff)
    const failUpdate = client.query.mock.calls.find(
      (c: unknown[]) =>
        String(c[0]).includes("UPDATE slot_notification_outbox") &&
        String(c[0]).includes("'failed'"),
    );
    expect(failUpdate).toBeDefined();
    expect(String(failUpdate![0])).not.toContain("next_attempt_at");
    const params = failUpdate![1] as unknown[];
    expect(params[1]).toBe(5); // attempts = MAX_ATTEMPTS

    // notification_failed audit (action value is a SQL param, not in the SQL string)
    const auditCall = client.query.mock.calls.find(
      (c: unknown[]) =>
        String(c[0]).includes("slot_audit_log") &&
        Array.isArray(c[1]) &&
        (c[1] as unknown[]).includes("notification_failed"),
    );
    expect(auditCall).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Worker: one row fails independently; other rows proceed
// ─────────────────────────────────────────────────────────────────────────────

describe("runOutboxWorker — failure isolation", () => {
  it("an error in one row does not stop other rows from being processed", async () => {
    // Two candidate rows
    pq().mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }] });

    const row1 = outboxRow({ id: 1 });
    const row2 = outboxRow({ id: 2, office_id: 20 });

    // Row 1: transaction throws unexpectedly (simulate DB error after lock)
    const client1 = makeClientMock([
      { rows: [] },   // BEGIN
      { rows: [row1] }, // lock
    ]);
    client1.query.mockImplementationOnce(() => Promise.resolve({ rows: [] }))  // BEGIN
             .mockImplementationOnce(() => Promise.resolve({ rows: [row1] }))  // lock
             .mockRejectedValueOnce(new Error("Random DB error"));              // staleness check throws

    // Row 2: succeeds
    const client2 = makeClientMock([
      { rows: [] },
      { rows: [row2] },
      { rows: [{ slot_status: "reserved" }] },
      { rows: [infoRow({ email: "o20@example.com" })] },
      { rows: [] },   // UPDATE sent
      { rows: [] },   // audit
      { rows: [] },   // COMMIT
    ]);

    pconn()
      .mockResolvedValueOnce(client1)
      .mockResolvedValueOnce(client2);

    notify().mockResolvedValue(undefined);

    const result = await runOutboxWorker();

    // Row 1 threw — counted as error
    expect(result.errors).toBe(1);
    // Row 2 succeeded
    expect(result.sent).toBe(1);
    expect(result.processed).toBe(1); // only row2 is 'processed' (row1 errored before outcome)
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Worker: already sent row is not re-processed
// ─────────────────────────────────────────────────────────────────────────────

describe("runOutboxWorker — idempotency", () => {
  it("sent rows are excluded by the candidate SELECT (status='sent' not in WHERE clause)", async () => {
    // The candidate SELECT filters WHERE status IN ('pending','failed').
    // A 'sent' row is simply not returned — simulated by empty rows.
    pq().mockResolvedValueOnce({ rows: [] }); // no candidates

    const result = await runOutboxWorker();

    expect(result.processed).toBe(0);
    expect(pconn()).not.toHaveBeenCalled(); // no per-row transaction opened
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. Worker: office deleted → marks skipped gracefully
// ─────────────────────────────────────────────────────────────────────────────

describe("runOutboxWorker — deleted office", () => {
  it("marks row skipped when office JOIN returns no rows (office was deleted)", async () => {
    const row = outboxRow();

    pq().mockResolvedValueOnce({ rows: [{ id: row.id }] });

    const client = makeClientMock([
      { rows: [] },
      { rows: [row] },                       // lock acquired
      { rows: [{ slot_status: "reserved" }] }, // staleness check → still valid
      { rows: [] },                          // office info JOIN → empty (deleted)
      { rows: [] },                          // UPDATE status='skipped'
      { rows: [] },                          // COMMIT
    ]);
    pconn().mockResolvedValueOnce(client);

    const result = await runOutboxWorker();

    expect(result.skipped).toBe(1);
    expect(notify()).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. getOutboxSummary — returns correct counts and failures
// ─────────────────────────────────────────────────────────────────────────────

describe("getOutboxSummary", () => {
  it("returns aggregate counts and recent failure rows", async () => {
    const failureDate = new Date("2026-08-01T12:00:00Z");

    // Two parallel queries: counts + failures
    pq()
      .mockResolvedValueOnce({
        rows: [{ pending: 3, sent: 42, failed: 1, skipped: 5 }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id:         99,
          office_id:  10,
          market_key: "SA|riyadh|marketing",
          attempts:   5,
          last_error: "SMTP failure",
          created_at: failureDate,
        }],
      });

    const summary = await getOutboxSummary();

    expect(summary.pending).toBe(3);
    expect(summary.sent).toBe(42);
    expect(summary.failed).toBe(1);
    expect(summary.skipped).toBe(5);
    expect(summary.recentFailures).toHaveLength(1);
    expect(summary.recentFailures[0].officeId).toBe(10);
    expect(summary.recentFailures[0].attempts).toBe(5);
    expect(summary.recentFailures[0].lastError).toBe("SMTP failure");
  });

  it("returns zeros and empty array when outbox is empty", async () => {
    pq()
      .mockResolvedValueOnce({ rows: [{ pending: 0, sent: 0, failed: 0, skipped: 0 }] })
      .mockResolvedValueOnce({ rows: [] });

    const summary = await getOutboxSummary();

    expect(summary.pending).toBe(0);
    expect(summary.failed).toBe(0);
    expect(summary.recentFailures).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. Health tracker integration
// ─────────────────────────────────────────────────────────────────────────────

describe("recordOutboxWorkerRun integration", () => {
  it("is called after each worker run with the correct stats", async () => {
    const row = outboxRow();
    pq().mockResolvedValueOnce({ rows: [{ id: row.id }] });

    const client = makeClientMock([
      { rows: [] },
      { rows: [row] },
      { rows: [{ slot_status: "reserved" }] },
      { rows: [infoRow()] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);
    pconn().mockResolvedValueOnce(client);
    notify().mockResolvedValue(undefined);

    await runOutboxWorker();

    expect(recordHealth()).toHaveBeenCalledOnce();
    const [stats] = (recordHealth() as MockFn).mock.calls[0] as [{ sent: number; failed: number; skipped: number }];
    expect(stats.sent).toBe(1);
    expect(stats.failed).toBe(0);
    expect(stats.skipped).toBe(0);
  });
});
