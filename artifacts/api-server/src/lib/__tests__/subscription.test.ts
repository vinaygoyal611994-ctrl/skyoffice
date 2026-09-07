/**
 * Subscription Lifecycle Tests
 *
 * Tests state machine transitions, expiry, reactivation, notification
 * deduplication, history immutability, and admin growth metrics calculations.
 *
 * Uses vi.mock to isolate database calls — no real DB writes in these unit tests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OfficeSubscription } from "@workspace/db";

// ── Hoisted mocks (must be declared before vi.mock factories) ─────────────────

const { mockDb, mockPool, mockEmailProvider, mockGetSlotStatus, mockConvertReservation } = vi.hoisted(() => {
  const mockDb = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  };
  const mockPool = {
    query: vi.fn(),
    connect: vi.fn(),
  };
  const mockEmailProvider = {
    sendSubscriptionExpiryReminder: vi.fn().mockResolvedValue(undefined),
  };
  const mockGetSlotStatus       = vi.fn();
  const mockConvertReservation  = vi.fn();
  return { mockDb, mockPool, mockEmailProvider, mockGetSlotStatus, mockConvertReservation };
});

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  db:                              mockDb,
  pool:                            mockPool,
  officeSubscriptionsTable:        { officeId: "office_id" },
  subscriptionHistoryTable:        {},
  subscriptionNotificationsTable:  {},
  systemConfigTable:               { key: "key", value: "value" },
  officesTable:                    {},
}));

vi.mock("../email", () => ({
  emailProvider: mockEmailProvider,
}));

vi.mock("../logger", () => ({
  logger: {
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
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

import {
  getSystemConfigValue,
  startTrial,
  markExpiring,
  expireSubscription,
  cancelSubscription,
  computeGrowthMetrics,
  checkAndSendReminders,
  SubscriptionLifecycleError,
  activatePaid,
  reactivate,
} from "../subscriptionLifecycle";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSub(overrides: Partial<OfficeSubscription> = {}): OfficeSubscription {
  return {
    id:                 1,
    officeId:           42,
    state:              "free",
    trialStartedAt:     null,
    trialEndsAt:        null,
    paidThroughDate:    null,
    expiresAt:          null,
    cancelledAt:        null,
    cancelledBy:        null,
    cancelReason:       null,
    hiddenAt:           null,
    notifiedReminders:  [],
    notes:              null,
    slotSyncNeededAt:   null,
    createdAt:          new Date("2026-01-01"),
    updatedAt:          new Date("2026-01-01"),
    ...overrides,
  };
}

/** Build a chainable Drizzle-like select mock that resolves to rows */
function makeSelectChain(rows: unknown[]) {
  const chain = {
    from:      vi.fn().mockReturnThis(),
    where:     vi.fn().mockResolvedValue(rows),
    returning: vi.fn().mockResolvedValue(rows),
  };
  return chain;
}

/** Build an update mock that .returning() resolves with rows */
function makeUpdateChain(rows: unknown[]) {
  return {
    set:       vi.fn().mockReturnThis(),
    where:     vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(rows),
  };
}

/** Build an insert mock whose .values() resolves (for history writes) */
function makeInsertChain() {
  return { values: vi.fn().mockResolvedValue(undefined) };
}

/**
 * Build a mock pg client for pool.connect().
 * Simulates BEGIN / UPDATE RETURNING rows / COMMIT / ROLLBACK / RELEASE.
 */
function makePoolClient(updateRows: unknown[] = []) {
  const client = {
    query: vi.fn().mockImplementation(async (sql: string) => {
      if (typeof sql === "string" && sql.trimStart().startsWith("UPDATE")) {
        return { rows: updateRows };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return client;
}

/** A paidThroughDate 30 days in the future — matches the webhook path */
function futurePaidThrough() {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
}

// ── System Config Tests ───────────────────────────────────────────────────────

describe("getSystemConfigValue", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns the stored value when the key exists", async () => {
    mockDb.select.mockReturnValue(makeSelectChain([{ value: "21" }]));
    const result = await getSystemConfigValue("trial_duration_days", "14");
    expect(result).toBe("21");
  });

  it("returns defaultValue when the key is not found", async () => {
    mockDb.select.mockReturnValue(makeSelectChain([]));
    const result = await getSystemConfigValue("missing_key", "7");
    expect(result).toBe("7");
  });
});

// ── State Machine: startTrial ─────────────────────────────────────────────────

describe("startTrial", () => {
  beforeEach(() => vi.resetAllMocks());

  it("transitions free → trial and sets trial_ends_at", async () => {
    // getSubscription: returns existing free sub
    mockDb.select.mockReturnValueOnce(makeSelectChain([makeSub({ state: "free" })]));
    // systemConfig for trial_duration_days
    mockDb.select.mockReturnValueOnce(makeSelectChain([{ value: "14" }]));
    // db.update → returns updated row
    const expected = makeSub({ state: "trial", trialEndsAt: new Date(), expiresAt: new Date() });
    mockDb.update.mockReturnValue(makeUpdateChain([expected]));
    // db.insert for history
    mockDb.insert.mockReturnValue(makeInsertChain());

    const result = await startTrial(42, 1);
    expect(result.state).toBe("trial");
  });

  it("throws INVALID_TRANSITION when office is already in trial", async () => {
    mockDb.select.mockReturnValue(makeSelectChain([makeSub({ state: "trial" })]));
    await expect(startTrial(42, 1)).rejects.toThrow(SubscriptionLifecycleError);
  });

  it("throws INVALID_TRANSITION when office has active_paid subscription", async () => {
    mockDb.select.mockReturnValue(makeSelectChain([makeSub({ state: "active_paid" })]));
    await expect(startTrial(42, 1)).rejects.toThrow(SubscriptionLifecycleError);
  });

  it("uses trialDaysOverride without hitting system_config", async () => {
    mockDb.select.mockReturnValueOnce(makeSelectChain([makeSub({ state: "free" })]));
    // No second select for system config — override skips it
    const now = new Date();
    const expected30d = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const returned = makeSub({ state: "trial", trialEndsAt: expected30d, expiresAt: expected30d });
    mockDb.update.mockReturnValue(makeUpdateChain([returned]));
    mockDb.insert.mockReturnValue(makeInsertChain());

    const result = await startTrial(42, 1, 30);
    expect(result.state).toBe("trial");
    // expiresAt should be ~30 days out
    expect(result.expiresAt!.getTime()).toBeGreaterThan(
      new Date(now.getTime() + 29 * 24 * 60 * 60 * 1000).getTime()
    );
  });
});

// ── State Machine: markExpiring ───────────────────────────────────────────────

describe("markExpiring", () => {
  beforeEach(() => vi.resetAllMocks());

  it("transitions active_paid → expiring", async () => {
    mockDb.select.mockReturnValue(makeSelectChain([makeSub({ state: "active_paid" })]));
    mockDb.update.mockReturnValue(makeUpdateChain([makeSub({ state: "expiring" })]));
    mockDb.insert.mockReturnValue(makeInsertChain());

    await expect(markExpiring(42)).resolves.not.toThrow();
    expect(mockDb.update).toHaveBeenCalledOnce();
  });

  it("is a no-op when state is already expired", async () => {
    mockDb.select.mockReturnValue(makeSelectChain([makeSub({ state: "expired" })]));
    await markExpiring(42);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("is a no-op when no subscription exists", async () => {
    mockDb.select.mockReturnValue(makeSelectChain([]));
    await markExpiring(42);
    expect(mockDb.update).not.toHaveBeenCalled();
  });
});

// ── State Machine: expireSubscription ────────────────────────────────────────

describe("expireSubscription", () => {
  beforeEach(() => vi.resetAllMocks());

  it("transitions expiring → expired", async () => {
    mockDb.select.mockReturnValue(makeSelectChain([makeSub({ state: "expiring" })]));
    mockDb.update.mockReturnValue(makeUpdateChain([makeSub({ state: "expired" })]));
    mockDb.insert.mockReturnValue(makeInsertChain());

    await expireSubscription(42);
    expect(mockDb.update).toHaveBeenCalledOnce();
  });

  it("is a no-op when already expired", async () => {
    mockDb.select.mockReturnValue(makeSelectChain([makeSub({ state: "expired" })]));
    await expireSubscription(42);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("works from trial state", async () => {
    mockDb.select.mockReturnValue(makeSelectChain([makeSub({ state: "trial" })]));
    mockDb.update.mockReturnValue(makeUpdateChain([makeSub({ state: "expired" })]));
    mockDb.insert.mockReturnValue(makeInsertChain());

    await expireSubscription(42);
    expect(mockDb.update).toHaveBeenCalledOnce();
  });
});

// ── State Machine: cancelSubscription ────────────────────────────────────────

describe("cancelSubscription", () => {
  beforeEach(() => vi.resetAllMocks());

  it("cancels from active_paid with reason", async () => {
    mockDb.select.mockReturnValue(makeSelectChain([makeSub({ state: "active_paid" })]));
    const updateChain = {
      set:   vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(undefined),
    };
    mockDb.update.mockReturnValue(updateChain);
    mockDb.insert.mockReturnValue(makeInsertChain());

    await cancelSubscription(42, 1, "Non-payment after 30 days");
    // Called twice: once for subscription state, once for is_subscription_hidden=true
    expect(mockDb.update).toHaveBeenCalledTimes(2);
  });

  it("can be called on a free subscription (to close the office permanently)", async () => {
    mockDb.select.mockReturnValue(makeSelectChain([makeSub({ state: "free" })]));
    mockDb.update.mockReturnValue({
      set:   vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(undefined),
    });
    mockDb.insert.mockReturnValue(makeInsertChain());

    await expect(cancelSubscription(42, 1)).resolves.not.toThrow();
  });
});

// ── Notification deduplication ────────────────────────────────────────────────

describe("checkAndSendReminders — deduplication", () => {
  beforeEach(() => vi.resetAllMocks());

  const makeSub7d = (): OfficeSubscription => {
    const expiresAt = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000); // 6 days out → inside 7d window
    return makeSub({ state: "expiring", expiresAt });
  };

  it("sends expiry_7d reminder when first encountered", async () => {
    // insert for dedup: succeeds (no constraint violation)
    mockDb.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });

    const office = { id: 42, email: "test@example.com", name: "Test Office", nameAr: "مكتب التجربة" };
    const results = await checkAndSendReminders(office, makeSub7d());

    const sent = results.filter(r => r.sent);
    expect(sent.length).toBeGreaterThan(0);
    expect(mockEmailProvider.sendSubscriptionExpiryReminder).toHaveBeenCalled();
  });

  it("does NOT send when dedup sentinel already exists (23505 constraint violation)", async () => {
    const dupErr = new Error("23505 duplicate key value violates unique constraint");
    mockDb.insert.mockReturnValue({ values: vi.fn().mockRejectedValue(dupErr) });

    const office = { id: 42, email: "test@example.com", name: "Test Office" };
    const results = await checkAndSendReminders(office, makeSub7d());

    const notSent = results.filter(r => !r.sent && r.reason === "Already sent (dedup)");
    expect(notSent.length).toBeGreaterThan(0);
    expect(mockEmailProvider.sendSubscriptionExpiryReminder).not.toHaveBeenCalled();
  });

  it("does NOT send reminders for free state subscriptions", async () => {
    const sub = makeSub({ state: "free" });
    const results = await checkAndSendReminders({ id: 42, email: "x@y.com", name: "X" }, sub);
    expect(results).toHaveLength(0);
    expect(mockEmailProvider.sendSubscriptionExpiryReminder).not.toHaveBeenCalled();
  });

  it("does NOT send reminders when expiresAt is null", async () => {
    const sub = makeSub({ state: "expiring", expiresAt: null });
    const results = await checkAndSendReminders({ id: 42, email: "x@y.com", name: "X" }, sub);
    expect(results).toHaveLength(0);
  });

  it("sends expiry_day reminder when daysLeft is 0 (already expired)", async () => {
    const expiresAt = new Date(Date.now() - 30 * 60 * 1000); // 30 minutes ago
    const sub = makeSub({ state: "expiring", expiresAt });
    mockDb.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });

    const results = await checkAndSendReminders({ id: 42, email: "x@y.com", name: "X" }, sub);
    expect(results.some(r => r.type === "expiry_day")).toBe(true);
  });
});

// ── Growth metrics ────────────────────────────────────────────────────────────

describe("computeGrowthMetrics", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns zero counts when there are no subscriptions", async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })                // current counts
      .mockResolvedValueOnce({ rows: [] })                // period history
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }] });     // prev period active

    const now   = new Date();
    const past  = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const prev  = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const metrics = await computeGrowthMetrics(past, now, prev, past);

    expect(metrics.currentCounts.total).toBe(0);
    expect(metrics.newSubscriptions).toBe(0);
    expect(metrics.churn).toBe(0);
    expect(metrics.netGrowth).toBe(0);
    expect(metrics.growthPct).toBeNull();
  });

  it("correctly counts new subscriptions, renewals, and churn", async () => {
    mockPool.query
      .mockResolvedValueOnce({
        rows: [
          { state: "trial",       cnt: 3 },
          { state: "active_paid", cnt: 2 },
          { state: "expiring",    cnt: 1 },
          { state: "expired",     cnt: 4 },
          { state: "cancelled",   cnt: 1 },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { to_state: "trial",       from_state: "free",     cnt: 2 },
          { to_state: "active_paid", from_state: "expiring", cnt: 1 },
          { to_state: "cancelled",   from_state: "trial",    cnt: 1 },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ cnt: 4 }] });

    const now  = new Date();
    const past = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const prev = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const metrics = await computeGrowthMetrics(past, now, prev, past);

    expect(metrics.currentCounts.trial).toBe(3);
    expect(metrics.currentCounts.activePaid).toBe(2);
    expect(metrics.currentCounts.expiring).toBe(1);
    expect(metrics.currentCounts.total).toBe(6);   // trial + active_paid + expiring
    expect(metrics.newSubscriptions).toBe(2);       // 2 new trials from free
    expect(metrics.renewals).toBe(1);               // 1 active_paid from expiring
    expect(metrics.churn).toBe(1);                  // 1 cancelled
    expect(metrics.netGrowth).toBe(2);              // 2 + 1 - 1
    expect(metrics.retentionRate).toBe(50);         // 1/(1+1)*100
  });

  it("computes correct growth percentage vs previous period", async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ state: "active_paid", cnt: 10 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ cnt: 5 }] }); // prev had 5 → growth = 100%

    const now  = new Date();
    const past = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const prev = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const metrics = await computeGrowthMetrics(past, now, prev, past);

    expect(metrics.growthPct).toBe(100);
    expect(metrics.momChange).toBe(5);
  });
});

// ── Safety invariants ─────────────────────────────────────────────────────────

describe("Safety invariants", () => {
  beforeEach(() => vi.resetAllMocks());

  it("SubscriptionLifecycleError has the correct code and name", () => {
    const err = new SubscriptionLifecycleError("test", "INVALID_TRANSITION");
    expect(err.name).toBe("SubscriptionLifecycleError");
    expect(err.code).toBe("INVALID_TRANSITION");
    expect(err instanceof Error).toBe(true);
  });

  it("startTrial from 'expiring' throws INVALID_TRANSITION", async () => {
    mockDb.select.mockReturnValue(makeSelectChain([makeSub({ state: "expiring" })]));
    await expect(startTrial(42, 1)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("startTrial from 'cancelled' throws INVALID_TRANSITION", async () => {
    mockDb.select.mockReturnValue(makeSelectChain([makeSub({ state: "cancelled" })]));
    await expect(startTrial(42, 1)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("startTrial from 'hidden_due_to_nonpayment' throws INVALID_TRANSITION", async () => {
    mockDb.select.mockReturnValue(makeSelectChain([makeSub({ state: "hidden_due_to_nonpayment" })]));
    await expect(startTrial(42, 1)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });
});

// ── activatePaid — fromState guard ────────────────────────────────────────────
//
// Helper: wire up all mocks needed for a single successful activatePaid() call.
//   state      — the current subscription state to return from getOrCreateSubscription
//   slotStatus — what the slot manager reports
//
function setupActivatePaid(
  state: OfficeSubscription["state"],
  slotStatus: { slotStatus: string | null; reservationExpiresAt?: Date | null } = { slotStatus: "allocated" },
) {
  const sub = makeSub({ state });
  // getOrCreateSubscription → single db.select() call
  mockDb.select.mockReturnValueOnce(makeSelectChain([sub]));
  // slot gate
  mockGetSlotStatus.mockResolvedValueOnce(slotStatus);
  // pool client for the atomic UPDATE
  const updatedSub = makeSub({ state: "active_paid", paidThroughDate: futurePaidThrough() });
  mockPool.connect.mockResolvedValueOnce(makePoolClient([updatedSub]));
  // history insert
  mockDb.insert.mockReturnValue(makeInsertChain());
  // offices table update (for not_required path)
  mockDb.update.mockReturnValue(makeUpdateChain([]));
  // convertReservationToAllocation (for reserved path)
  mockConvertReservation.mockResolvedValue(undefined);
  return { sub, updatedSub };
}

describe("activatePaid — valid source states", () => {
  beforeEach(() => vi.resetAllMocks());

  it("transitions free → active_paid (initial paid activation)", async () => {
    setupActivatePaid("free", { slotStatus: "not_required" });
    const result = await activatePaid(42, 1, futurePaidThrough());
    expect(result.state).toBe("active_paid");
  });

  it("transitions trial → active_paid (trial conversion)", async () => {
    setupActivatePaid("trial", { slotStatus: "allocated" });
    const result = await activatePaid(42, 1, futurePaidThrough());
    expect(result.state).toBe("active_paid");
  });

  it("transitions active_paid → active_paid (renewal — idempotent)", async () => {
    setupActivatePaid("active_paid", { slotStatus: "allocated" });
    const result = await activatePaid(42, 1, futurePaidThrough());
    expect(result.state).toBe("active_paid");
  });

  it("transitions expiring → active_paid (renewal in warning window)", async () => {
    setupActivatePaid("expiring", { slotStatus: "allocated" });
    const result = await activatePaid(42, 1, futurePaidThrough());
    expect(result.state).toBe("active_paid");
  });

  it("converts a valid slot reservation during activation", async () => {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
    setupActivatePaid("free", { slotStatus: "reserved", reservationExpiresAt: expiresAt });
    const result = await activatePaid(42, 1, futurePaidThrough());
    expect(result.state).toBe("active_paid");
    expect(mockConvertReservation).toHaveBeenCalledOnce();
  });
});

describe("activatePaid — blocked from terminated states", () => {
  beforeEach(() => vi.resetAllMocks());

  it("throws INVALID_TRANSITION from 'cancelled' (must use reactivate)", async () => {
    mockDb.select.mockReturnValueOnce(makeSelectChain([makeSub({ state: "cancelled" })]));
    await expect(activatePaid(42, 1, futurePaidThrough())).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
    // Slot gate must NOT be reached — no DB side-effects before the throw
    expect(mockGetSlotStatus).not.toHaveBeenCalled();
  });

  it("throws INVALID_TRANSITION from 'hidden_due_to_nonpayment' (must use reactivate)", async () => {
    mockDb.select.mockReturnValueOnce(makeSelectChain([makeSub({ state: "hidden_due_to_nonpayment" })]));
    await expect(activatePaid(42, 1, futurePaidThrough())).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
    expect(mockGetSlotStatus).not.toHaveBeenCalled();
  });

  it("throws INVALID_TRANSITION from 'expired' (must use reactivate)", async () => {
    mockDb.select.mockReturnValueOnce(makeSelectChain([makeSub({ state: "expired" })]));
    await expect(activatePaid(42, 1, futurePaidThrough())).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
    expect(mockGetSlotStatus).not.toHaveBeenCalled();
  });

  it("error message names the disallowed state and points to reactivate()", async () => {
    mockDb.select.mockReturnValueOnce(makeSelectChain([makeSub({ state: "cancelled" })]));
    await expect(activatePaid(42, 1, futurePaidThrough())).rejects.toThrow(
      /cancelled.*reactivate/i,
    );
  });
});

describe("activatePaid — idempotency (duplicate payment webhook)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("second call on active_paid succeeds without double-extending (slot = renewal, no slot change)", async () => {
    const paidThrough = futurePaidThrough();
    setupActivatePaid("active_paid", { slotStatus: "allocated" });

    const result = await activatePaid(42, 1, paidThrough);
    expect(result.state).toBe("active_paid");
    // slot action must be "renewal" — convertReservationToAllocation NOT called
    expect(mockConvertReservation).not.toHaveBeenCalled();
    // offices table NOT updated (no visibility change for renewal)
    // (update IS set up in setupActivatePaid but should only be called for not_required path)
    // History is written (insert called once for history)
    expect(mockDb.insert).toHaveBeenCalledOnce();
  });
});

// ── reactivate — fromState guard ──────────────────────────────────────────────

function setupReactivate(
  state: OfficeSubscription["state"],
  slotStatus: { slotStatus: string | null; reservationExpiresAt?: Date | null } = {
    slotStatus: "reserved",
    reservationExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
  },
) {
  const sub = makeSub({ state });
  // getSubscription → db.select() for reactivate's own fetch
  mockDb.select.mockReturnValueOnce(makeSelectChain([sub]));
  // slot gate
  mockGetSlotStatus.mockResolvedValueOnce(slotStatus);
  // pool client
  const updatedSub = makeSub({ state: "active_paid", paidThroughDate: futurePaidThrough() });
  mockPool.connect.mockResolvedValueOnce(makePoolClient([updatedSub]));
  // history insert
  mockDb.insert.mockReturnValue(makeInsertChain());
  // offices update (not_required path)
  mockDb.update.mockReturnValue(makeUpdateChain([]));
  // convertReservationToAllocation
  mockConvertReservation.mockResolvedValue(undefined);
  return { sub, updatedSub };
}

describe("reactivate — valid source states", () => {
  beforeEach(() => vi.resetAllMocks());

  it("reactivates from 'expired' → active_paid", async () => {
    setupReactivate("expired");
    const result = await reactivate(42, 1, futurePaidThrough());
    expect(result.state).toBe("active_paid");
  });

  it("reactivates from 'hidden_due_to_nonpayment' → active_paid", async () => {
    setupReactivate("hidden_due_to_nonpayment");
    const result = await reactivate(42, 1, futurePaidThrough());
    expect(result.state).toBe("active_paid");
  });

  it("reactivates from 'cancelled' → active_paid", async () => {
    setupReactivate("cancelled");
    const result = await reactivate(42, 1, futurePaidThrough());
    expect(result.state).toBe("active_paid");
  });
});

describe("reactivate — blocked from live states", () => {
  beforeEach(() => vi.resetAllMocks());

  it("throws INVALID_TRANSITION from 'active_paid'", async () => {
    mockDb.select.mockReturnValueOnce(makeSelectChain([makeSub({ state: "active_paid" })]));
    await expect(reactivate(42, 1, futurePaidThrough())).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
    expect(mockGetSlotStatus).not.toHaveBeenCalled();
  });

  it("throws INVALID_TRANSITION from 'expiring'", async () => {
    mockDb.select.mockReturnValueOnce(makeSelectChain([makeSub({ state: "expiring" })]));
    await expect(reactivate(42, 1, futurePaidThrough())).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
  });

  it("throws INVALID_TRANSITION from 'trial'", async () => {
    mockDb.select.mockReturnValueOnce(makeSelectChain([makeSub({ state: "trial" })]));
    await expect(reactivate(42, 1, futurePaidThrough())).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
  });

  it("throws INVALID_TRANSITION from 'free'", async () => {
    mockDb.select.mockReturnValueOnce(makeSelectChain([makeSub({ state: "free" })]));
    await expect(reactivate(42, 1, futurePaidThrough())).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
  });

  it("error message names the current state and points to activatePaid()", async () => {
    mockDb.select.mockReturnValueOnce(makeSelectChain([makeSub({ state: "active_paid" })]));
    await expect(reactivate(42, 1, futurePaidThrough())).rejects.toThrow(
      /active_paid.*activatePaid/i,
    );
  });
});

// ── Payment flow regression ───────────────────────────────────────────────────

describe("Payment webhook regression — activatePaid from payment-path states", () => {
  beforeEach(() => vi.resetAllMocks());

  // The Stripe webhook calls activatePaid() directly after marking the
  // transaction succeeded.  The office subscription is typically in one of
  // these states at the moment the webhook fires.

  it("webhook activates from 'expiring' (renewal just before deadline)", async () => {
    setupActivatePaid("expiring", { slotStatus: "allocated" });
    const result = await activatePaid(42, 1, futurePaidThrough(), "Gateway payment pi_test_123");
    expect(result.state).toBe("active_paid");
  });

  it("webhook activates from 'active_paid' (early renewal / duplicate event — idempotent)", async () => {
    setupActivatePaid("active_paid", { slotStatus: "allocated" });
    const result = await activatePaid(42, 1, futurePaidThrough(), "Gateway payment pi_test_456");
    expect(result.state).toBe("active_paid");
    expect(mockConvertReservation).not.toHaveBeenCalled();
  });

  it("webhook for a 'cancelled' office throws INVALID_TRANSITION (defensive — not a normal flow)", async () => {
    // A payment arriving after cancellation must fail explicitly so the webhook
    // sets the transaction to failed_no_slot and the admin can investigate.
    mockDb.select.mockReturnValueOnce(makeSelectChain([makeSub({ state: "cancelled" })]));
    await expect(
      activatePaid(42, 1, futurePaidThrough(), "Gateway payment pi_test_789"),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });
});

// ── Slot and visibility invariants ────────────────────────────────────────────

describe("Slot and visibility invariants after activatePaid", () => {
  beforeEach(() => vi.resetAllMocks());

  it("clears is_subscription_hidden when market is uncapped (not_required)", async () => {
    setupActivatePaid("expiring", { slotStatus: "not_required" });
    await activatePaid(42, 1, futurePaidThrough());
    // db.update should have been called (once for clearing isSubscriptionHidden)
    expect(mockDb.update).toHaveBeenCalledOnce();
  });

  it("does NOT touch offices table for renewal (allocated slot stays allocated)", async () => {
    // For renewal path, the slot is already allocated — no visibility change
    const sub = makeSub({ state: "active_paid" });
    mockDb.select.mockReturnValueOnce(makeSelectChain([sub]));
    mockGetSlotStatus.mockResolvedValueOnce({ slotStatus: "allocated" });
    const updatedSub = makeSub({ state: "active_paid" });
    mockPool.connect.mockResolvedValueOnce(makePoolClient([updatedSub]));
    mockDb.insert.mockReturnValue(makeInsertChain());

    await activatePaid(42, 1, futurePaidThrough());

    // db.update must NOT be called (no visibility change for renewal)
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("calls convertReservationToAllocation for reserved slot path", async () => {
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
    setupActivatePaid("free", { slotStatus: "reserved", reservationExpiresAt: expiresAt });
    await activatePaid(42, 1, futurePaidThrough());
    expect(mockConvertReservation).toHaveBeenCalledOnce();
    expect(mockConvertReservation).toHaveBeenCalledWith(42, 1);
  });

  it("throws when slot has expired reservation (no valid slot path)", async () => {
    const sub = makeSub({ state: "free" });
    mockDb.select.mockReturnValueOnce(makeSelectChain([sub]));
    // Reservation exists but has already expired
    const expiredAt = new Date(Date.now() - 60 * 1000);
    mockGetSlotStatus.mockResolvedValueOnce({
      slotStatus: "reserved",
      reservationExpiresAt: expiredAt,
    });

    await expect(activatePaid(42, 1, futurePaidThrough())).rejects.toThrow(
      /no valid slot reservation/i,
    );
    // Pool connection must NOT be acquired — no DB side-effects
    expect(mockPool.connect).not.toHaveBeenCalled();
  });
});
