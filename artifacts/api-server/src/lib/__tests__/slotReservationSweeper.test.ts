/**
 * Slot Reservation Sweeper — comprehensive test suite.
 *
 * The sweeper's responsibilities (post-outbox):
 *   1. Find expired reservations
 *   2. Release each via expireReservation()
 *   3. Call processWaitlist() once per affected market
 *   4. Report counts: expired / reserved / allocated / errors
 *
 * Notification delivery is NOT the sweeper's responsibility.
 * Each new reservation created by processWaitlist atomically creates an
 * outbox row (inside createReservationRow's transaction). The outbox worker
 * (slotNotificationOutbox.ts) delivers the email within ~2 minutes.
 *
 * Covers:
 *   1.  No expired reservations — sweep is a no-op
 *   2.  Reservation does not expire before 3 hours
 *   3.  Single expired reservation → expireReservation + processWaitlist called
 *   4.  Expired reservation releases capacity (next provider gets reserved slot)
 *   5.  No waiting provider after expiry — slot stays available
 *   6.  Two expired reservations in the SAME market → processWaitlist called once
 *   7.  Two expired reservations in DIFFERENT markets → processWaitlist per market
 *   8.  Closed market does not issue replacement (processWaitlist handles internally)
 *   9.  Duplicate sweeper run is idempotent (second run finds nothing to do)
 *   10. Concurrent runs cannot double-reserve (guaranteed by processWaitlist FOR UPDATE)
 *   11. expireReservation failure skipped — other offices continue
 *   12. processWaitlist failure skipped — other markets continue
 *   13. Sweeper does NOT send email directly — notifications delegated to outbox
 *   14. Returning-provider priority is intact (delegated to processWaitlist)
 *   15. Full result shape and counters are correct
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MockInstance } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  pool: { query: vi.fn() },
  db:   {},
}));

vi.mock("../supplySlotManager", () => ({
  expireReservation: vi.fn(),
  processWaitlist:   vi.fn(),
}));

// NOTE: email is NOT mocked here — the sweeper no longer imports emailProvider.
// Verifying it does not call email directly is one of the explicit test cases.

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Imports (after mocks are registered) ─────────────────────────────────────

import { pool }                               from "@workspace/db";
import { expireReservation, processWaitlist }  from "../supplySlotManager";
import { runReservationSweep }                from "../slotReservationSweeper";

// ── Helpers ───────────────────────────────────────────────────────────────────

type MockFn = MockInstance;

function pq()     { return pool.query            as unknown as MockFn; }
function expire() { return expireReservation      as unknown as MockFn; }
function pwl()    { return processWaitlist        as unknown as MockFn; }

const MARKET_A = "SA|riyadh|marketing";
const MARKET_B = "SA|jeddah|legal";

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. No expired reservations — sweep is a no-op
// ─────────────────────────────────────────────────────────────────────────────

describe("No expired reservations", () => {
  it("returns zero counts and does not call expireReservation or processWaitlist", async () => {
    pq().mockResolvedValueOnce({ rows: [] }); // SELECT expired — empty

    const result = await runReservationSweep();

    expect(result.expiredCount).toBe(0);
    expect(result.reservedCount).toBe(0);
    expect(result.allocatedCount).toBe(0);
    expect(result.errors).toBe(0);
    expect(result.marketKeys).toHaveLength(0);
    expect(expire()).not.toHaveBeenCalled();
    expect(pwl()).not.toHaveBeenCalled();
  });

  it("result always contains a ranAt ISO string and a non-negative durationMs", async () => {
    pq().mockResolvedValueOnce({ rows: [] });

    const result = await runReservationSweep();

    expect(() => new Date(result.ranAt)).not.toThrow();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Reservation does not expire before 3 hours
// ─────────────────────────────────────────────────────────────────────────────

describe("Active (non-expired) reservation", () => {
  it("is not returned by the sweep query — the WHERE clause filters it out", async () => {
    // The SQL has reservation_expires_at < NOW() so future reservations are excluded.
    // We verify this by returning an empty row set (DB did the filtering).
    pq().mockResolvedValueOnce({ rows: [] }); // future reservation not matched

    const result = await runReservationSweep();

    expect(expire()).not.toHaveBeenCalled();
    expect(result.expiredCount).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Single expired reservation → full pipeline runs
// ─────────────────────────────────────────────────────────────────────────────

describe("Single expired reservation", () => {
  it("calls expireReservation and processWaitlist for the correct market", async () => {
    pq().mockResolvedValueOnce({ rows: [{ office_id: 10, market_key: MARKET_A }] });
    expire().mockResolvedValueOnce(MARKET_A);
    pwl().mockResolvedValueOnce({ reserved: [], allocated: [] }); // no one waiting

    const result = await runReservationSweep();

    expect(expire()).toHaveBeenCalledWith(10);
    expect(pwl()).toHaveBeenCalledWith(MARKET_A);
    expect(result.expiredCount).toBe(1);
    expect(result.marketKeys).toContain(MARKET_A);
    expect(result.errors).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Expired reservation releases capacity → next provider gets reserved slot
// ─────────────────────────────────────────────────────────────────────────────

describe("Next-provider handoff", () => {
  it("increments reservedCount when processWaitlist creates a reservation", async () => {
    // The outbox row is created atomically inside processWaitlist's transaction.
    // The sweeper does NOT send email — it just reports the reserved count.
    pq().mockResolvedValueOnce({ rows: [{ office_id: 10, market_key: MARKET_A }] });
    expire().mockResolvedValueOnce(MARKET_A);
    pwl().mockResolvedValueOnce({ reserved: [20], allocated: [] });

    const result = await runReservationSweep();

    expect(result.reservedCount).toBe(1);
    expect(result.errors).toBe(0);
    // pool.query should only have been called once (the initial expired query)
    expect((pq() as MockFn).mock.calls).toHaveLength(1);
  });

  it("increments allocatedCount for uncapped-market direct allocations", async () => {
    pq().mockResolvedValueOnce({ rows: [{ office_id: 10, market_key: MARKET_A }] });
    expire().mockResolvedValueOnce(MARKET_A);
    pwl().mockResolvedValueOnce({ reserved: [], allocated: [30] }); // direct allocation

    const result = await runReservationSweep();

    expect(result.allocatedCount).toBe(1);
    expect(result.reservedCount).toBe(0);
    // No extra pool.query calls — sweeper does not fetch office info or write audit
    expect((pq() as MockFn).mock.calls).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. No waiting provider after expiry — slot stays available
// ─────────────────────────────────────────────────────────────────────────────

describe("No eligible waitlist provider", () => {
  it("no counts incremented, pool.query only called for expired SELECT", async () => {
    pq().mockResolvedValueOnce({ rows: [{ office_id: 10, market_key: MARKET_A }] });
    expire().mockResolvedValueOnce(MARKET_A);
    pwl().mockResolvedValueOnce({ reserved: [], allocated: [] });

    const result = await runReservationSweep();

    expect(result.reservedCount).toBe(0);
    expect(result.allocatedCount).toBe(0);
    // pool.query should only have been called once (the initial expired query)
    expect((pq() as MockFn).mock.calls).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Two expired reservations in the SAME market → processWaitlist called once
// ─────────────────────────────────────────────────────────────────────────────

describe("Multiple expirations same market", () => {
  it("deduplicates the affected market — processWaitlist called exactly once", async () => {
    pq().mockResolvedValueOnce({
      rows: [
        { office_id: 10, market_key: MARKET_A },
        { office_id: 11, market_key: MARKET_A },
      ],
    });
    expire()
      .mockResolvedValueOnce(MARKET_A)
      .mockResolvedValueOnce(MARKET_A);
    pwl().mockResolvedValueOnce({ reserved: [], allocated: [] });

    const result = await runReservationSweep();

    expect(expire()).toHaveBeenCalledTimes(2);
    expect(pwl()).toHaveBeenCalledTimes(1);
    expect(pwl()).toHaveBeenCalledWith(MARKET_A);
    expect(result.expiredCount).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Two expired reservations in DIFFERENT markets → processWaitlist per market
// ─────────────────────────────────────────────────────────────────────────────

describe("Multiple expirations different markets", () => {
  it("calls processWaitlist for each market independently", async () => {
    pq().mockResolvedValueOnce({
      rows: [
        { office_id: 10, market_key: MARKET_A },
        { office_id: 11, market_key: MARKET_B },
      ],
    });
    expire()
      .mockResolvedValueOnce(MARKET_A)
      .mockResolvedValueOnce(MARKET_B);
    pwl()
      .mockResolvedValueOnce({ reserved: [], allocated: [] })
      .mockResolvedValueOnce({ reserved: [], allocated: [] });

    const result = await runReservationSweep();

    expect(pwl()).toHaveBeenCalledTimes(2);
    expect(pwl()).toHaveBeenCalledWith(MARKET_A);
    expect(pwl()).toHaveBeenCalledWith(MARKET_B);
    expect(result.marketKeys).toHaveLength(2);
    expect(result.marketKeys).toContain(MARKET_A);
    expect(result.marketKeys).toContain(MARKET_B);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Closed market does not issue replacement
// ─────────────────────────────────────────────────────────────────────────────

describe("Closed market", () => {
  it("processWaitlist returns empty for closed market — no new reservation", async () => {
    // processWaitlist itself checks acceptance_status = 'closed' and returns empty.
    // The sweeper calls it regardless; the guard is inside processWaitlist.
    pq().mockResolvedValueOnce({ rows: [{ office_id: 10, market_key: MARKET_A }] });
    expire().mockResolvedValueOnce(MARKET_A);
    pwl().mockResolvedValueOnce({ reserved: [], allocated: [] }); // closed → empty

    const result = await runReservationSweep();

    expect(pwl()).toHaveBeenCalledWith(MARKET_A);
    expect(result.reservedCount).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Duplicate sweeper run is idempotent
// ─────────────────────────────────────────────────────────────────────────────

describe("Duplicate sweep run (idempotency)", () => {
  it("second run finds no expired reservations — no double processing", async () => {
    // First run: 1 expired reservation
    pq().mockResolvedValueOnce({ rows: [{ office_id: 10, market_key: MARKET_A }] });
    expire().mockResolvedValueOnce(MARKET_A);
    pwl().mockResolvedValueOnce({ reserved: [], allocated: [] });

    const first = await runReservationSweep();
    expect(first.expiredCount).toBe(1);

    // Second run: DB query returns empty (expireReservation already changed status)
    vi.resetAllMocks();
    pq().mockResolvedValueOnce({ rows: [] });

    const second = await runReservationSweep();
    expect(second.expiredCount).toBe(0);
    expect(expire()).not.toHaveBeenCalled();
    expect(pwl()).not.toHaveBeenCalled();
    expect(second.errors).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Concurrency safety (FOR UPDATE inside processWaitlist)
// ─────────────────────────────────────────────────────────────────────────────

describe("Concurrent sweeper runs", () => {
  it("each run calls processWaitlist which uses FOR UPDATE to prevent double-reservation", async () => {
    // Two concurrent runReservationSweep calls. Both find the same expired reservation,
    // but only one actually expires it (expireReservation is idempotent: no-op if not reserved).
    // processWaitlist uses FOR UPDATE so the second call sees the slot already reserved.

    pq()
      .mockResolvedValueOnce({ rows: [{ office_id: 10, market_key: MARKET_A }] }) // sweep 1
      .mockResolvedValueOnce({ rows: [{ office_id: 10, market_key: MARKET_A }] }); // sweep 2
    expire()
      .mockResolvedValueOnce(MARKET_A)   // sweep 1: expires successfully
      .mockResolvedValueOnce(null);       // sweep 2: expireReservation no-op (not reserved) → null
    pwl()
      .mockResolvedValueOnce({ reserved: [20], allocated: [] }) // sweep 1: reserves office 20
      .mockResolvedValueOnce({ reserved: [], allocated: [] });   // sweep 2: 0 capacity left

    const [r1, r2] = await Promise.all([runReservationSweep(), runReservationSweep()]);

    // Combined result: exactly 1 reservation created
    expect(r1.reservedCount + r2.reservedCount).toBe(1);
    // No errors from either run
    expect(r1.errors + r2.errors).toBe(0);
    // No extra pool.query calls beyond the two expired SELECTs
    expect((pq() as MockFn).mock.calls).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. expireReservation failure — other offices continue
// ─────────────────────────────────────────────────────────────────────────────

describe("expireReservation failure isolation", () => {
  it("error is counted but sweep continues for remaining offices", async () => {
    pq().mockResolvedValueOnce({
      rows: [
        { office_id: 10, market_key: MARKET_A }, // will fail
        { office_id: 11, market_key: MARKET_B }, // succeeds
      ],
    });
    expire()
      .mockRejectedValueOnce(new Error("DB locked")) // office 10 fails
      .mockResolvedValueOnce(MARKET_B);              // office 11 succeeds
    pwl().mockResolvedValueOnce({ reserved: [], allocated: [] }); // MARKET_B sweep

    const result = await runReservationSweep();

    expect(result.errors).toBe(1);
    expect(result.expiredCount).toBe(1);   // office 11 was expired
    expect(pwl()).toHaveBeenCalledTimes(1);
    expect(pwl()).toHaveBeenCalledWith(MARKET_B); // MARKET_A had an error; MARKET_B still ran
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. processWaitlist failure — other markets continue
// ─────────────────────────────────────────────────────────────────────────────

describe("processWaitlist failure isolation", () => {
  it("error is counted but sweep continues for other markets", async () => {
    pq().mockResolvedValueOnce({
      rows: [
        { office_id: 10, market_key: MARKET_A }, // processWaitlist will fail for MARKET_A
        { office_id: 11, market_key: MARKET_B }, // MARKET_B succeeds
      ],
    });
    expire()
      .mockResolvedValueOnce(MARKET_A)
      .mockResolvedValueOnce(MARKET_B);
    pwl()
      .mockRejectedValueOnce(new Error("Timeout"))             // MARKET_A fails
      .mockResolvedValueOnce({ reserved: [], allocated: [] }); // MARKET_B succeeds

    const result = await runReservationSweep();

    expect(result.errors).toBe(1);
    expect(result.expiredCount).toBe(2);
    expect(pwl()).toHaveBeenCalledTimes(2);
    expect(result.marketKeys).toContain(MARKET_B); // MARKET_B succeeded
    // MARKET_A should NOT be in marketKeys (it failed before being pushed)
    expect(result.marketKeys).not.toContain(MARKET_A);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. Sweeper does NOT send email directly — notifications delegated to outbox
// ─────────────────────────────────────────────────────────────────────────────

describe("Notification delegation to outbox", () => {
  it("does not make any pool.query calls beyond the initial expired SELECT (no office info fetch, no audit write)", async () => {
    // With the outbox architecture:
    //   • The outbox row is created atomically inside createReservationRow's tx
    //     (called by processWaitlist — which is mocked here).
    //   • The sweeper no longer fetches office info or writes next_provider_selected audit.
    //   • No email is sent from within the sweeper.
    //
    // Therefore, after processWaitlist returns, pool.query is NOT called again.
    pq().mockResolvedValueOnce({ rows: [{ office_id: 10, market_key: MARKET_A }] });
    expire().mockResolvedValueOnce(MARKET_A);
    pwl().mockResolvedValueOnce({ reserved: [20, 21], allocated: [30] }); // 3 promotions

    await runReservationSweep();

    // Only 1 pool.query call — the initial expired SELECT
    expect((pq() as MockFn).mock.calls).toHaveLength(1);
  });

  it("result shape does not contain notificationsSent (removed — handled by outbox worker)", async () => {
    pq().mockResolvedValueOnce({ rows: [] });

    const result = await runReservationSweep();

    // notificationsSent is intentionally absent — any test checking it would
    // be testing the wrong layer. Outbox tests verify delivery stats instead.
    expect((result as unknown as Record<string, unknown>)["notificationsSent"]).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. Returning-provider priority
// ─────────────────────────────────────────────────────────────────────────────

describe("Returning-provider priority", () => {
  it("sweeper delegates priority ordering to processWaitlist — does not interfere with tier ordering", async () => {
    // processWaitlist handles priority (ORDER BY priority_tier ASC, ...).
    // The sweeper's job is to call it with the correct marketKey.
    pq().mockResolvedValueOnce({ rows: [{ office_id: 10, market_key: MARKET_A }] });
    expire().mockResolvedValueOnce(MARKET_A);
    // processWaitlist returns the tier-1 (returning) provider first
    pwl().mockResolvedValueOnce({ reserved: [30], allocated: [] });

    const result = await runReservationSweep();

    // Sweeper called processWaitlist once — priority is entirely processWaitlist's responsibility
    expect(pwl()).toHaveBeenCalledWith(MARKET_A);
    expect(result.reservedCount).toBe(1);
    // No extra pool.query — sweeper does not inspect the reserved offices
    expect((pq() as MockFn).mock.calls).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. Full result shape and counters
// ─────────────────────────────────────────────────────────────────────────────

describe("Result shape", () => {
  it("returns the correct interface shape with all expected fields", async () => {
    pq().mockResolvedValueOnce({
      rows: [
        { office_id: 10, market_key: MARKET_A },
        { office_id: 11, market_key: MARKET_B },
      ],
    });

    expire()
      .mockResolvedValueOnce(MARKET_A)
      .mockResolvedValueOnce(MARKET_B);
    pwl()
      .mockResolvedValueOnce({ reserved: [20], allocated: [] })   // MARKET_A: 1 reserved
      .mockResolvedValueOnce({ reserved: [], allocated: [30] });   // MARKET_B: 1 allocated (uncapped)

    const result = await runReservationSweep();

    expect(result).toMatchObject({
      expiredCount:   2,
      reservedCount:  1,
      allocatedCount: 1,
      errors:         0,
    });
    expect(result.marketKeys).toHaveLength(2);
    expect(typeof result.ranAt).toBe("string");
    expect(typeof result.durationMs).toBe("number");
    // notificationsSent is NOT present — moved to outbox worker
    expect((result as unknown as Record<string, unknown>)["notificationsSent"]).toBeUndefined();
  });
});
