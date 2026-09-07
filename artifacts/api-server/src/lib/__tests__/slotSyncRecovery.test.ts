/**
 * Slot-sync recovery tests.
 *
 * Verifies that when convertReservationToAllocation() fails after subscription
 * activation, the inconsistency is recorded durably, the recovery sweeper can
 * detect and repair it, and no path produces a silent active_paid + no-slot state.
 *
 * Also covers:
 *   - activatePaidCore sets slot_sync_needed_at on conversion failure
 *   - Normal reserved activation clears no flag (happy path)
 *   - Renewal path (already allocated) is unaffected
 *   - Recovery is idempotent (already_allocated case)
 *   - Duplicate webhook remains safe (tested via activatePaid disallowed-state guard)
 *   - Supply-cap safety: sweeper never auto-allocates after reservation expiry
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OfficeSubscription } from "@workspace/db";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockPool,
  mockDb,
  mockGetSlotStatus,
  mockConvertReservation,
} = vi.hoisted(() => {
  const mockPool = {
    query:   vi.fn(),
    connect: vi.fn(),
  };
  const mockDb = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  };
  const mockGetSlotStatus      = vi.fn();
  const mockConvertReservation = vi.fn();
  return { mockPool, mockDb, mockGetSlotStatus, mockConvertReservation };
});

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  db:                             mockDb,
  pool:                           mockPool,
  officeSubscriptionsTable:       { officeId: "office_id" },
  subscriptionHistoryTable:       {},
  subscriptionNotificationsTable: {},
  systemConfigTable:              { key: "key", value: "value" },
  officesTable:                   {},
}));

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../email", () => ({
  emailProvider: {
    sendSubscriptionExpiryReminder: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../supplySlotManager", () => ({
  getSlotStatus:                  mockGetSlotStatus,
  convertReservationToAllocation: mockConvertReservation,
  releaseSlot:                    vi.fn().mockResolvedValue(undefined),
  cancelSlot:                     vi.fn().mockResolvedValue(undefined),
  processWaitlist:                vi.fn().mockResolvedValue(undefined),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { activatePaid } from "../subscriptionLifecycle";
import {
  recoverSlotSync,
  runSlotSyncSweep,
} from "../slotSyncRecovery";

// ── Helpers ───────────────────────────────────────────────────────────────────

const OFFICE_ID = 42;
const PAID_THROUGH = new Date("2027-06-01");

function makeSub(overrides: Partial<OfficeSubscription> = {}): OfficeSubscription {
  return {
    id:                1,
    officeId:          OFFICE_ID,
    state:             "free",
    trialStartedAt:    null,
    trialEndsAt:       null,
    paidThroughDate:   null,
    expiresAt:         null,
    cancelledAt:       null,
    cancelledBy:       null,
    cancelReason:      null,
    hiddenAt:          null,
    notifiedReminders: [],
    notes:             null,
    slotSyncNeededAt:  null,
    createdAt:         new Date("2026-01-01"),
    updatedAt:         new Date("2026-01-01"),
    ...overrides,
  };
}

function makeSelectChain(rows: unknown[]) {
  return { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(rows) };
}

function makeInsertChain() {
  return {
    values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
  };
}

function makeUpdateChain() {
  return { set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) };
}

function makePoolClient(updatedSub: OfficeSubscription) {
  return {
    query: vi.fn().mockImplementation((sql: string) => {
      if (typeof sql === "string" && sql.trim().startsWith("UPDATE")) {
        return Promise.resolve({ rows: [updatedSub] });
      }
      return Promise.resolve({ rows: [] });
    }),
    release: vi.fn(),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

// =============================================================================
// Part 1 — activatePaidCore: flag-setting on conversion failure
// =============================================================================

describe("activatePaidCore: slot_sync_needed_at flag on conversion failure", () => {
  it("sets slot_sync_needed_at when convertReservationToAllocation throws (failure is not silent)", async () => {
    const sub        = makeSub({ state: "free" });
    const updatedSub = makeSub({ state: "active_paid" });
    const expiry     = new Date(Date.now() + 3_600_000);

    mockDb.select.mockReturnValue(makeSelectChain([sub]));
    mockGetSlotStatus.mockResolvedValue({ slotStatus: "reserved", reservationExpiresAt: expiry });
    mockPool.connect.mockResolvedValue(makePoolClient(updatedSub));
    mockConvertReservation.mockRejectedValue(new Error("Reservation expired between gate and commit"));
    mockDb.insert.mockReturnValue(makeInsertChain());
    mockDb.update.mockReturnValue(makeUpdateChain());

    // pool.query tracks the UPDATE to set the flag
    const poolQueryCalls: Array<[string, unknown[]]> = [];
    mockPool.query.mockImplementation((sql: string, params: unknown[]) => {
      poolQueryCalls.push([sql, params]);
      return Promise.resolve({ rows: [] });
    });

    await activatePaid(OFFICE_ID, null, PAID_THROUGH, "Gateway payment");

    // Must have called pool.query to set slot_sync_needed_at
    const flagQuery = poolQueryCalls.find(([sql]) =>
      sql.includes("slot_sync_needed_at") && sql.includes("NOW()"),
    );
    expect(flagQuery).toBeDefined();
    expect(flagQuery![1]).toContain(OFFICE_ID);
  });

  it("does NOT set slot_sync_needed_at on successful reservation conversion", async () => {
    const sub        = makeSub({ state: "free" });
    const updatedSub = makeSub({ state: "active_paid" });
    const expiry     = new Date(Date.now() + 3_600_000);

    mockDb.select.mockReturnValue(makeSelectChain([sub]));
    mockGetSlotStatus.mockResolvedValue({ slotStatus: "reserved", reservationExpiresAt: expiry });
    mockPool.connect.mockResolvedValue(makePoolClient(updatedSub));
    mockConvertReservation.mockResolvedValue(undefined); // success
    mockDb.insert.mockReturnValue(makeInsertChain());
    mockDb.update.mockReturnValue(makeUpdateChain());

    const poolQueryCalls: string[] = [];
    mockPool.query.mockImplementation((sql: string) => {
      poolQueryCalls.push(sql);
      return Promise.resolve({ rows: [] });
    });

    await activatePaid(OFFICE_ID, null, PAID_THROUGH, "Gateway payment");

    const flagQuery = poolQueryCalls.find((sql) => sql.includes("slot_sync_needed_at"));
    expect(flagQuery).toBeUndefined();
  });

  it("does NOT set slot_sync_needed_at on renewal (already allocated — no conversion needed)", async () => {
    const sub        = makeSub({ state: "active_paid" });
    const updatedSub = makeSub({ state: "active_paid" });

    mockDb.select.mockReturnValue(makeSelectChain([sub]));
    mockGetSlotStatus.mockResolvedValue({ slotStatus: "allocated" }); // renewal path
    mockPool.connect.mockResolvedValue(makePoolClient(updatedSub));
    mockDb.insert.mockReturnValue(makeInsertChain());
    mockDb.update.mockReturnValue(makeUpdateChain());

    const poolQueryCalls: string[] = [];
    mockPool.query.mockImplementation((sql: string) => {
      poolQueryCalls.push(sql);
      return Promise.resolve({ rows: [] });
    });

    await activatePaid(OFFICE_ID, null, PAID_THROUGH, "Renewal");

    const flagQuery = poolQueryCalls.find((sql) => sql.includes("slot_sync_needed_at"));
    expect(flagQuery).toBeUndefined();
  });

  it("does NOT set slot_sync_needed_at on uncapped-market activation", async () => {
    const sub        = makeSub({ state: "free" });
    const updatedSub = makeSub({ state: "active_paid" });

    mockDb.select.mockReturnValue(makeSelectChain([sub]));
    mockGetSlotStatus.mockResolvedValue({ slotStatus: "not_required" });
    mockPool.connect.mockResolvedValue(makePoolClient(updatedSub));
    mockDb.insert.mockReturnValue(makeInsertChain());
    mockDb.update.mockReturnValue(makeUpdateChain());

    const poolQueryCalls: string[] = [];
    mockPool.query.mockImplementation((sql: string) => {
      poolQueryCalls.push(sql);
      return Promise.resolve({ rows: [] });
    });

    await activatePaid(OFFICE_ID, null, PAID_THROUGH, "Uncapped market");

    const flagQuery = poolQueryCalls.find((sql) => sql.includes("slot_sync_needed_at"));
    expect(flagQuery).toBeUndefined();
  });
});

// =============================================================================
// Part 2 — recoverSlotSync: individual recovery cases
// =============================================================================

describe("recoverSlotSync: already allocated (idempotent recovery)", () => {
  it("clears flag and restores visibility when slot is already allocated", async () => {
    mockGetSlotStatus.mockResolvedValue({ slotStatus: "allocated" });

    const poolQueryCalls: Array<[string, unknown[]]> = [];
    mockPool.query.mockImplementation((sql: string, params: unknown[] = []) => {
      poolQueryCalls.push([sql, params]);
      return Promise.resolve({ rows: [] });
    });

    const result = await recoverSlotSync(OFFICE_ID);

    expect(result.status).toBe("recovered_already_allocated");

    // Clears the flag
    const clearQuery = poolQueryCalls.find(([sql]) =>
      sql.includes("slot_sync_needed_at = NULL"),
    );
    expect(clearQuery).toBeDefined();
    expect(clearQuery![1]).toContain(OFFICE_ID);

    // Restores visibility
    const visQuery = poolQueryCalls.find(([sql]) =>
      sql.includes("is_subscription_hidden = false"),
    );
    expect(visQuery).toBeDefined();

    // Does NOT call convertReservationToAllocation
    expect(mockConvertReservation).not.toHaveBeenCalled();
  });
});

describe("recoverSlotSync: conversion retry", () => {
  it("retries conversion when reservation is still valid and clears flag on success", async () => {
    const expiry = new Date(Date.now() + 2 * 3_600_000); // 2h from now
    mockGetSlotStatus.mockResolvedValue({
      slotStatus:           "reserved",
      reservationExpiresAt: expiry,
    });
    mockConvertReservation.mockResolvedValue(undefined);

    const poolQueryCalls: Array<[string, unknown[]]> = [];
    mockPool.query.mockImplementation((sql: string, params: unknown[] = []) => {
      poolQueryCalls.push([sql, params]);
      return Promise.resolve({ rows: [] });
    });

    const result = await recoverSlotSync(OFFICE_ID);

    expect(result.status).toBe("recovered_conversion_retry");
    expect(mockConvertReservation).toHaveBeenCalledWith(OFFICE_ID, null);

    const clearQuery = poolQueryCalls.find(([sql]) =>
      sql.includes("slot_sync_needed_at = NULL"),
    );
    expect(clearQuery).toBeDefined();
  });

  it("does NOT clear flag when retry conversion also fails", async () => {
    const expiry = new Date(Date.now() + 2 * 3_600_000);
    mockGetSlotStatus.mockResolvedValue({
      slotStatus:           "reserved",
      reservationExpiresAt: expiry,
    });
    mockConvertReservation.mockRejectedValue(new Error("DB error on retry"));

    const poolQueryCalls: Array<[string, unknown[]]> = [];
    mockPool.query.mockImplementation((sql: string, params: unknown[] = []) => {
      poolQueryCalls.push([sql, params]);
      return Promise.resolve({ rows: [] });
    });

    const result = await recoverSlotSync(OFFICE_ID);

    expect(result.status).toBe("conversion_failed");

    // Flag must NOT be cleared — will retry on next sweep
    const clearQuery = poolQueryCalls.find(([sql]) =>
      sql.includes("slot_sync_needed_at = NULL"),
    );
    expect(clearQuery).toBeUndefined();
  });
});

describe("recoverSlotSync: uncapped market", () => {
  it("clears flag and restores visibility for not_required market", async () => {
    mockGetSlotStatus.mockResolvedValue({ slotStatus: "not_required" });

    const poolQueryCalls: Array<[string, unknown[]]> = [];
    mockPool.query.mockImplementation((sql: string, params: unknown[] = []) => {
      poolQueryCalls.push([sql, params]);
      return Promise.resolve({ rows: [] });
    });

    const result = await recoverSlotSync(OFFICE_ID);

    expect(result.status).toBe("recovered_uncapped_market");

    const clearQuery = poolQueryCalls.find(([sql]) =>
      sql.includes("slot_sync_needed_at = NULL"),
    );
    expect(clearQuery).toBeDefined();
  });
});

describe("recoverSlotSync: needs admin (reservation expired)", () => {
  it("returns needs_admin when reservation has expired — does NOT auto-allocate", async () => {
    const expiredAt = new Date(Date.now() - 3_600_000); // 1h ago
    mockGetSlotStatus.mockResolvedValue({
      slotStatus:           "reserved",
      reservationExpiresAt: expiredAt,
    });

    const poolQueryCalls: string[] = [];
    mockPool.query.mockImplementation((sql: string) => {
      poolQueryCalls.push(sql);
      return Promise.resolve({ rows: [] });
    });

    const result = await recoverSlotSync(OFFICE_ID);

    expect(result.status).toBe("needs_admin");
    expect(result.reason).toContain("reservation_expired_at_");

    // Must NOT clear the flag (admin must act)
    const clearQuery = poolQueryCalls.find((sql) =>
      sql.includes("slot_sync_needed_at = NULL"),
    );
    expect(clearQuery).toBeUndefined();

    // Must NOT attempt conversion (supply-cap safety)
    expect(mockConvertReservation).not.toHaveBeenCalled();
  });

  it("returns needs_admin when slot is released (cannot auto-fix, supply-cap risk)", async () => {
    mockGetSlotStatus.mockResolvedValue({ slotStatus: "released" });

    const poolQueryCalls: string[] = [];
    mockPool.query.mockImplementation((sql: string) => {
      poolQueryCalls.push(sql);
      return Promise.resolve({ rows: [] });
    });

    const result = await recoverSlotSync(OFFICE_ID);

    expect(result.status).toBe("needs_admin");
    expect(result.reason).toContain("slot_status_is_released");
    expect(mockConvertReservation).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Part 3 — runSlotSyncSweep
// =============================================================================

describe("runSlotSyncSweep", () => {
  it("returns immediately with candidateCount=0 when no pending offices", async () => {
    mockPool.query.mockResolvedValue({ rows: [] }); // no candidates

    const result = await runSlotSyncSweep();

    expect(result.candidateCount).toBe(0);
    expect(result.recoveredCount).toBe(0);
    expect(result.results).toHaveLength(0);
  });

  it("processes all candidate offices and reports counts correctly", async () => {
    // Two offices pending; one recovers (already allocated), one needs admin
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ office_id: 10 }, { office_id: 20 }] }) // candidates query
      .mockResolvedValue({ rows: [] }); // clearFlag + restoreVisibility calls

    mockGetSlotStatus
      .mockResolvedValueOnce({ slotStatus: "allocated" })           // office 10 → already allocated
      .mockResolvedValueOnce({ slotStatus: "released" });           // office 20 → needs admin

    const result = await runSlotSyncSweep();

    expect(result.candidateCount).toBe(2);
    expect(result.recoveredCount).toBe(1);   // office 10
    expect(result.needsAdminCount).toBe(1);  // office 20
    expect(result.failedCount).toBe(0);
    expect(result.results).toHaveLength(2);
    expect(result.results[0]?.status).toBe("recovered_already_allocated");
    expect(result.results[1]?.status).toBe("needs_admin");
  });

  it("is idempotent: second sweep of already-recovered offices is a no-op", async () => {
    // After first sweep, all offices have slot_status = allocated and flag cleared.
    // Second sweep finds no candidates.
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // no candidates on second run

    const result = await runSlotSyncSweep();

    expect(result.candidateCount).toBe(0);
    expect(result.recoveredCount).toBe(0);
  });

  it("gracefully skips sweep when migration 0036 is not yet applied (column missing)", async () => {
    mockPool.query.mockRejectedValue(new Error('column "slot_sync_needed_at" does not exist'));

    const result = await runSlotSyncSweep();

    expect(result.candidateCount).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    // No throw — graceful degradation
  });

  it("continues processing remaining offices when one recovery throws unexpectedly", async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ office_id: 11 }, { office_id: 22 }] })
      .mockResolvedValue({ rows: [] });

    mockGetSlotStatus
      .mockRejectedValueOnce(new Error("getSlotStatus network error")) // office 11 unexpected error
      .mockResolvedValueOnce({ slotStatus: "allocated" });             // office 22 recovers

    const result = await runSlotSyncSweep();

    expect(result.candidateCount).toBe(2);
    expect(result.recoveredCount).toBe(1);   // office 22
    expect(result.failedCount).toBe(1);      // office 11 (unexpected error)
    expect(result.needsAdminCount).toBe(0);
  });
});

// =============================================================================
// Part 4 — Duplicate webhook / no silent active_paid + no-slot state
// =============================================================================

describe("duplicate webhook safety", () => {
  it("activatePaid from active_paid state (duplicate webhook) does not set sync flag", async () => {
    // Duplicate webhook means subscription is already active_paid.
    // activatePaid allows active_paid → active_paid (renewal semantics).
    // Slot is already allocated — renewal path, no conversion, no flag.
    const sub        = makeSub({ state: "active_paid" });
    const updatedSub = makeSub({ state: "active_paid" });

    mockDb.select.mockReturnValue(makeSelectChain([sub]));
    mockGetSlotStatus.mockResolvedValue({ slotStatus: "allocated" }); // already allocated
    mockPool.connect.mockResolvedValue(makePoolClient(updatedSub));
    mockDb.insert.mockReturnValue(makeInsertChain());
    mockDb.update.mockReturnValue(makeUpdateChain());

    const poolQueryCalls: string[] = [];
    mockPool.query.mockImplementation((sql: string) => {
      poolQueryCalls.push(sql);
      return Promise.resolve({ rows: [] });
    });

    await expect(
      activatePaid(OFFICE_ID, null, PAID_THROUGH, "Duplicate webhook"),
    ).resolves.toBeDefined();

    const flagQuery = poolQueryCalls.find((sql) => sql.includes("slot_sync_needed_at"));
    expect(flagQuery).toBeUndefined();
    expect(mockConvertReservation).not.toHaveBeenCalled();
  });
});

describe("no silent active_paid + waiting/released state", () => {
  it("conversion failure always results in slot_sync_needed_at being set (not silently ignored)", async () => {
    const sub        = makeSub({ state: "trial" });
    const updatedSub = makeSub({ state: "active_paid" });
    const expiry     = new Date(Date.now() + 3_600_000);

    mockDb.select.mockReturnValue(makeSelectChain([sub]));
    mockGetSlotStatus.mockResolvedValue({ slotStatus: "reserved", reservationExpiresAt: expiry });
    mockPool.connect.mockResolvedValue(makePoolClient(updatedSub));
    mockConvertReservation.mockRejectedValue(new Error("Transient DB failure"));
    mockDb.insert.mockReturnValue(makeInsertChain());
    mockDb.update.mockReturnValue(makeUpdateChain());

    let flagSet = false;
    mockPool.query.mockImplementation((sql: string, params: unknown[] = []) => {
      if (sql.includes("slot_sync_needed_at") && sql.includes("NOW()") && params.includes(OFFICE_ID)) {
        flagSet = true;
      }
      return Promise.resolve({ rows: [] });
    });

    await activatePaid(OFFICE_ID, null, PAID_THROUGH, "Trial-to-paid conversion");

    // Flag must be set — no silent inconsistency
    expect(flagSet).toBe(true);
  });
});
