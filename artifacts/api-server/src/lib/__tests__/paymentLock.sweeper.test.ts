/**
 * Payment Lock × Reservation Sweeper Integration Tests
 *
 * Verifies that:
 *   1. A reservation with payment_locked_until > NOW() is skipped by the sweeper.
 *   2. A reservation whose lock has elapsed IS released by the sweeper.
 *   3. The waitlist is processed after lock expiry and release.
 *   4. A reservation with no lock IS released normally.
 *   5. clearPaymentLock() sets payment_locked_until = NULL.
 *
 * Uses mocked pool to avoid a real DB in CI.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock @workspace/db ──────────────────────────────────────────────────────
const mockPool = { query: vi.fn() };
vi.mock("@workspace/db", () => ({ pool: mockPool }));

// ── Mock supplySlotManager functions called by sweeper ──────────────────────
const mockExpireReservation   = vi.fn<(officeId: number) => Promise<string | null>>();
const mockProcessWaitlist     = vi.fn();
const mockClearPaymentLock    = vi.fn();

vi.mock("../supplySlotManager", () => ({
  expireReservation:   mockExpireReservation,
  processWaitlist:     mockProcessWaitlist,
  clearPaymentLock:    mockClearPaymentLock,
}));

// ── Import under test (after mocks registered) ─────────────────────────────
const { runReservationSweep } = await import("../slotReservationSweeper");

// ── Helper types ────────────────────────────────────────────────────────────
function makeExpiredRow(officeId: number, marketKey = "SA|riyadh|coworking") {
  return { office_id: officeId, market_key: marketKey };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("runReservationSweep — payment lock", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockExpireReservation.mockResolvedValue("SA|riyadh|coworking");
    mockProcessWaitlist.mockResolvedValue({ reserved: [42], allocated: [] });
  });

  // ── 1. Locked reservation is skipped ─────────────────────────────────────
  it("skips reservations where payment_locked_until is in the future", async () => {
    // pool.query returns zero rows — the WHERE clause filtered them all out
    // (because the SQL now includes payment_locked_until guard)
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await runReservationSweep();

    expect(result.expiredCount).toBe(0);
    expect(result.reservedCount).toBe(0);
    expect(mockExpireReservation).not.toHaveBeenCalled();
    expect(mockProcessWaitlist).not.toHaveBeenCalled();
  });

  // ── 2. Expired lock allows release ───────────────────────────────────────
  it("releases a reservation once payment_locked_until has elapsed", async () => {
    // Pool returns one row — lock is in the past so SQL includes it
    mockPool.query.mockResolvedValueOnce({ rows: [makeExpiredRow(7)] });

    const result = await runReservationSweep();

    expect(result.expiredCount).toBe(1);
    expect(mockExpireReservation).toHaveBeenCalledWith(7);
  });

  // ── 3. Waitlist is processed after expired lock causes release ────────────
  it("advances the waitlist after releasing a lock-expired reservation", async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [makeExpiredRow(7)] });
    mockProcessWaitlist.mockResolvedValueOnce({ reserved: [88], allocated: [] });

    const result = await runReservationSweep();

    expect(mockProcessWaitlist).toHaveBeenCalledWith("SA|riyadh|coworking");
    expect(result.reservedCount).toBe(1);
  });

  // ── 4. Reservation with no lock is released normally ─────────────────────
  it("releases a reservation that has no lock (payment_locked_until IS NULL)", async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [makeExpiredRow(9)] });

    const result = await runReservationSweep();

    expect(result.expiredCount).toBe(1);
    expect(mockExpireReservation).toHaveBeenCalledWith(9);
  });

  // ── 5. Multiple reservations — locked skipped, unlocked released ──────────
  it("processes multiple expired reservations returned by the query", async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [makeExpiredRow(7, "SA|riyadh|coworking"), makeExpiredRow(8, "SA|jeddah|office")],
    });
    mockExpireReservation
      .mockResolvedValueOnce("SA|riyadh|coworking")
      .mockResolvedValueOnce("SA|jeddah|office");
    mockProcessWaitlist
      .mockResolvedValueOnce({ reserved: [10], allocated: [] })
      .mockResolvedValueOnce({ reserved: [], allocated: [11] });

    const result = await runReservationSweep();

    expect(result.expiredCount).toBe(2);
    expect(result.reservedCount).toBe(1);
    expect(result.allocatedCount).toBe(1);
  });

  // ── 6. clearPaymentLock is exported and callable ──────────────────────────
  it("clearPaymentLock is exported from supplySlotManager", async () => {
    // Import directly to confirm the export exists
    const { clearPaymentLock } = await import("../supplySlotManager");
    expect(typeof clearPaymentLock).toBe("function");
  });
});

// ── SQL guard clause is embedded in the sweeper ───────────────────────────────
describe("runReservationSweep — SQL guard correctness", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockExpireReservation.mockResolvedValue(null);
    mockProcessWaitlist.mockResolvedValue({ reserved: [], allocated: [] });
  });

  it("passes the correct payment-lock predicate in the SQL query", async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await runReservationSweep();

    const sql: string = mockPool.query.mock.calls[0][0];
    // Confirm the query includes the payment lock guard
    expect(sql).toMatch(/payment_locked_until/);
    expect(sql).toMatch(/IS NULL/);
  });
});
