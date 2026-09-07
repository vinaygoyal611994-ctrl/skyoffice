/**
 * System-actor semantics tests.
 *
 * Verifies that webhook-triggered payment activation correctly records
 * `changedBy = null` (system/gateway) in subscription history and slot audit
 * log, while human-admin-triggered activation records the real admin user ID.
 *
 * Also verifies:
 *  - No dependency on a user with ID = 1 existing in the database.
 *  - No FK violation: null is stored cleanly (schema allows it).
 *  - Admin-triggered path still records the real admin ID.
 *  - Duplicate webhook call (idempotency) still completes without error.
 *  - convertReservationToAllocation receives null from activatePaidCore.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OfficeSubscription } from "@workspace/db";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockDb, mockPool, mockGetSlotStatus, mockConvertReservation } = vi.hoisted(() => {
  const mockDb = {
    select:  vi.fn(),
    insert:  vi.fn(),
    update:  vi.fn(),
    execute: vi.fn(),
  };
  const mockPool = {
    query:   vi.fn(),
    connect: vi.fn(),
  };
  const mockGetSlotStatus      = vi.fn();
  const mockConvertReservation = vi.fn();
  return { mockDb, mockPool, mockGetSlotStatus, mockConvertReservation };
});

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  db:                             mockDb,
  pool:                           mockPool,
  officeSubscriptionsTable:       { officeId: "office_id", id: "id" },
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

// ── Import after mocks ────────────────────────────────────────────────────────

import { activatePaid, SubscriptionLifecycleError } from "../subscriptionLifecycle";

// ── Helpers ───────────────────────────────────────────────────────────────────

const OFFICE_ID = 42;

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

/** Drizzle select chain that resolves to `rows` when awaited. */
function makeSelectChain(rows: unknown[]) {
  return {
    from:  vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(rows),
  };
}

/** Drizzle insert chain that .returning() resolves to `rows`. */
function makeInsertChain(rows: unknown[]) {
  const chain = {
    values:    vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(rows),
  };
  return chain;
}

/** Drizzle update chain. */
function makeUpdateChain() {
  return {
    set:   vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
  };
}

/** A pool client stub that simulates a successful transaction. */
function makePoolClient(updatedSub: OfficeSubscription) {
  return {
    query: vi.fn().mockImplementation((sql: string) => {
      if (sql.trim().startsWith("UPDATE")) {
        return Promise.resolve({ rows: [updatedSub] });
      }
      // BEGIN / COMMIT
      return Promise.resolve({ rows: [] });
    }),
    release: vi.fn(),
  };
}

const PAID_THROUGH = new Date("2027-01-15");

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();
});

// ===========================================================================
// System/gateway actor (null adminId)
// ===========================================================================

describe("activatePaid with null adminId (gateway/system action)", () => {
  it("records changedBy = null in subscription history for webhook-triggered activation", async () => {
    const sub = makeSub({ state: "free" });
    const updatedSub = makeSub({ state: "active_paid", paidThroughDate: PAID_THROUGH });

    // getOrCreateSubscription → SELECT returns existing sub
    mockDb.select.mockReturnValue(makeSelectChain([sub]));

    // getSlotStatus → uncapped market (no slot tracking required)
    mockGetSlotStatus.mockResolvedValue({ slotStatus: "not_required" });

    // Pool client for the subscription UPDATE transaction
    const fakeClient = makePoolClient(updatedSub);
    mockPool.connect.mockResolvedValue(fakeClient);

    // INSERT into subscription_history (recording changedBy)
    const insertValues: unknown[] = [];
    const insertChain = {
      values: vi.fn().mockImplementation((args: unknown) => {
        insertValues.push(args);
        return { returning: vi.fn().mockResolvedValue([]) };
      }),
    };
    mockDb.insert.mockReturnValue(insertChain);

    // UPDATE officesTable (visibility restore for uncapped market)
    mockDb.update.mockReturnValue(makeUpdateChain());

    await activatePaid(OFFICE_ID, null, PAID_THROUGH, "Gateway payment pi_test_123");

    // Exactly one history row inserted
    expect(insertValues).toHaveLength(1);
    const historyRow = insertValues[0] as Record<string, unknown>;

    // changedBy must be null — no dependency on any user row
    expect(historyRow.changedBy).toBeNull();

    // Transition recorded correctly
    expect(historyRow.fromState).toBe("free");
    expect(historyRow.toState).toBe("active_paid");
  });

  it("succeeds even when no user with ID = 1 exists (FK would not be violated)", async () => {
    // This test verifies the fix: we no longer pass adminId = 1.
    // null is stored as-is; no FK lookup is performed against the users table.
    const sub = makeSub({ state: "free" });
    const updatedSub = makeSub({ state: "active_paid" });

    mockDb.select.mockReturnValue(makeSelectChain([sub]));
    mockGetSlotStatus.mockResolvedValue({ slotStatus: "not_required" });
    mockPool.connect.mockResolvedValue(makePoolClient(updatedSub));

    const insertValues: unknown[] = [];
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockImplementation((args: unknown) => {
        insertValues.push(args);
        return { returning: vi.fn().mockResolvedValue([]) };
      }),
    });
    mockDb.update.mockReturnValue(makeUpdateChain());

    // Should complete without throwing — no user ID 1 required
    await expect(
      activatePaid(OFFICE_ID, null, PAID_THROUGH, "Gateway payment"),
    ).resolves.toBeDefined();

    // Verify changedBy never had a numeric value
    const historyRow = insertValues[0] as Record<string, unknown>;
    expect(typeof historyRow.changedBy).not.toBe("number");
    expect(historyRow.changedBy).toBeNull();
  });

  it("passes null to convertReservationToAllocation for gateway activations", async () => {
    const sub = makeSub({ state: "free" });
    const updatedSub = makeSub({ state: "active_paid" });
    const reservationExpiry = new Date(Date.now() + 3_600_000); // 1h from now

    mockDb.select.mockReturnValue(makeSelectChain([sub]));
    mockGetSlotStatus.mockResolvedValue({
      slotStatus:           "reserved",
      reservationExpiresAt: reservationExpiry,
    });
    mockPool.connect.mockResolvedValue(makePoolClient(updatedSub));
    mockConvertReservation.mockResolvedValue(undefined);

    mockDb.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
    });
    mockDb.update.mockReturnValue(makeUpdateChain());

    await activatePaid(OFFICE_ID, null, PAID_THROUGH, "Gateway payment");

    // convertReservationToAllocation must receive null as the adminId
    expect(mockConvertReservation).toHaveBeenCalledWith(OFFICE_ID, null);
    expect(mockConvertReservation).not.toHaveBeenCalledWith(OFFICE_ID, 1);
    expect(mockConvertReservation).not.toHaveBeenCalledWith(OFFICE_ID, expect.any(Number));
  });

  it("duplicate gateway call (idempotent webhook) completes without error", async () => {
    // Simulates a second webhook delivery when subscription is already active_paid.
    // activatePaid allows active_paid → active_paid (renewal/extension).
    const sub = makeSub({ state: "active_paid", paidThroughDate: new Date("2026-06-01") });
    const updatedSub = makeSub({ state: "active_paid", paidThroughDate: PAID_THROUGH });

    mockDb.select.mockReturnValue(makeSelectChain([sub]));
    mockGetSlotStatus.mockResolvedValue({ slotStatus: "allocated" });
    mockPool.connect.mockResolvedValue(makePoolClient(updatedSub));

    const insertValues: unknown[] = [];
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockImplementation((args: unknown) => {
        insertValues.push(args);
        return { returning: vi.fn().mockResolvedValue([]) };
      }),
    });
    mockDb.update.mockReturnValue(makeUpdateChain());

    await expect(
      activatePaid(OFFICE_ID, null, PAID_THROUGH, "Gateway payment (replay)"),
    ).resolves.toBeDefined();

    // History row still records null actor
    const historyRow = insertValues[0] as Record<string, unknown>;
    expect(historyRow.changedBy).toBeNull();
  });
});

// ===========================================================================
// Human admin actor (real user ID)
// ===========================================================================

describe("activatePaid with a real admin user ID (human action)", () => {
  const ADMIN_ID = 7;

  it("records changedBy = adminId in history for admin-triggered activation", async () => {
    const sub = makeSub({ state: "free" });
    const updatedSub = makeSub({ state: "active_paid" });

    mockDb.select.mockReturnValue(makeSelectChain([sub]));
    mockGetSlotStatus.mockResolvedValue({ slotStatus: "not_required" });
    mockPool.connect.mockResolvedValue(makePoolClient(updatedSub));

    const insertValues: unknown[] = [];
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockImplementation((args: unknown) => {
        insertValues.push(args);
        return { returning: vi.fn().mockResolvedValue([]) };
      }),
    });
    mockDb.update.mockReturnValue(makeUpdateChain());

    await activatePaid(OFFICE_ID, ADMIN_ID, PAID_THROUGH, "Admin manual activation");

    const historyRow = insertValues[0] as Record<string, unknown>;
    expect(historyRow.changedBy).toBe(ADMIN_ID);
    expect(historyRow.changedBy).not.toBeNull();
  });

  it("passes real adminId to convertReservationToAllocation for admin activations", async () => {
    const sub = makeSub({ state: "free" });
    const updatedSub = makeSub({ state: "active_paid" });
    const reservationExpiry = new Date(Date.now() + 3_600_000);

    mockDb.select.mockReturnValue(makeSelectChain([sub]));
    mockGetSlotStatus.mockResolvedValue({
      slotStatus:           "reserved",
      reservationExpiresAt: reservationExpiry,
    });
    mockPool.connect.mockResolvedValue(makePoolClient(updatedSub));
    mockConvertReservation.mockResolvedValue(undefined);

    mockDb.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
    });
    mockDb.update.mockReturnValue(makeUpdateChain());

    await activatePaid(OFFICE_ID, ADMIN_ID, PAID_THROUGH);

    expect(mockConvertReservation).toHaveBeenCalledWith(OFFICE_ID, ADMIN_ID);
  });

  it("rejects with INVALID_TRANSITION for a terminated state (cannot use activatePaid from expired)", async () => {
    const sub = makeSub({ state: "expired" });
    mockDb.select.mockReturnValue(makeSelectChain([sub]));

    await expect(
      activatePaid(OFFICE_ID, ADMIN_ID, PAID_THROUGH),
    ).rejects.toThrow(SubscriptionLifecycleError);
  });
});

// ===========================================================================
// Source-code guard: SYSTEM_ADMIN_ID no longer exists in payments route
// ===========================================================================

describe("P0-1 fix guard: SYSTEM_ADMIN_ID removed from payments route", () => {
  it("payments route does not import or define SYSTEM_ADMIN_ID", async () => {
    // Read the payments route source at test time to verify the constant is gone.
    // This acts as a regression guard that will fail if the constant is re-introduced.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");

    const routePath = path.resolve(
      import.meta.dirname ?? __dirname,
      "../../routes/payments.ts",
    );
    const source = await fs.readFile(routePath, "utf-8");

    expect(source).not.toMatch(/SYSTEM_ADMIN_ID/);
    // Verify null is passed to activatePaid in the webhook handler
    expect(source).toMatch(/activatePaid\s*\(\s*\n?\s*officeId\s*,\s*\n?\s*null\s*,/);
  });
});
