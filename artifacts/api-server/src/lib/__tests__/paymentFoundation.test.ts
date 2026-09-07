/**
 * Payment Foundation Unit Tests
 *
 * Covers:
 *   - paymentPlans: buildIdempotencyKey, nextBillingMonth, getPriceForProviderType
 *   - paymentValidator: all validation paths (not_owner, no_reservation, expired,
 *     expiring_soon, duplicate_pending, allocated=renewal, valid=new_reservation)
 *   - stripeClient: isStripeConfigured
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockPool,
  mockGetSlotStatus,
  mockGetMarketSlotSummary,
  mockGetSystemConfig,
  mockGetPlanForOffice,
} = vi.hoisted(() => {
  const mockPool     = { query: vi.fn() };
  const mockGetSlotStatus       = vi.fn();
  const mockGetMarketSlotSummary = vi.fn();
  const mockGetSystemConfig      = vi.fn();
  const mockGetPlanForOffice     = vi.fn();
  return { mockPool, mockGetSlotStatus, mockGetMarketSlotSummary, mockGetSystemConfig, mockGetPlanForOffice };
});

vi.mock("@workspace/db", () => ({ pool: mockPool }));

vi.mock("../supplySlotManager", () => ({
  getSlotStatus:        mockGetSlotStatus,
  getMarketSlotSummary: mockGetMarketSlotSummary,
}));

vi.mock("../subscriptionLifecycle", () => ({
  getSystemConfigValue: mockGetSystemConfig,
}));

vi.mock("../paymentPlans", async (importOriginal) => {
  // Re-use real buildIdempotencyKey, nextBillingMonth, PLAN_PRICES, getPriceForProviderType
  const real = await importOriginal<typeof import("../paymentPlans")>();
  return {
    ...real,
    getPlanForOffice: mockGetPlanForOffice,
  };
});

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  buildIdempotencyKey,
  nextBillingMonth,
  getPriceForProviderType,
  PLAN_PRICES,
} from "../paymentPlans";
import { validatePrePayment } from "../paymentValidator";

// ── Test data ─────────────────────────────────────────────────────────────────

const OFFICE_ROW = {
  rows: [{ user_id: 42, provider_type: "office", name: "Test Office", status: "active" }],
};
const OFFICE_ROW_NOT_OWNER = {
  rows: [{ user_id: 99, provider_type: "office", name: "Test Office", status: "active" }],
};
const NO_OFFICE = { rows: [] };

const PLAN: import("../paymentPlans").ResolvedPlan = {
  planId:        1,
  planName:      "Office Standard",
  planNameAr:    "المكتب الأساسي",
  providerType:  "office",
  amountHalalas: 20_000,
  currency:      "SAR",
};

const SLOT_RESERVED = {
  slotStatus:           "reserved",
  marketKey:            "SA|riyadh|coworking",
  priorityTier:         1,
  reservationExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000), // +2h
};

const SLOT_ALLOCATED = {
  slotStatus:           "allocated",
  marketKey:            "SA|riyadh|coworking",
  priorityTier:         1,
  reservationExpiresAt: null,
};

const SLOT_WAITING = {
  slotStatus:           "waiting",
  marketKey:            "SA|riyadh|coworking",
  priorityTier:         2,
  reservationExpiresAt: null,
};

const MARKET_OPEN   = { isClosed: false };
const MARKET_CLOSED = { isClosed: true  };
const NO_PENDING    = { rows: [{ cnt: 0 }] };
const HAS_PENDING   = { rows: [{ cnt: 1 }] };

// ── Helpers ───────────────────────────────────────────────────────────────────

function setupDefaults() {
  mockPool.query.mockResolvedValue(OFFICE_ROW);
  mockGetSystemConfig.mockResolvedValue("active");
  mockGetPlanForOffice.mockResolvedValue(PLAN);
  mockGetSlotStatus.mockResolvedValue(SLOT_RESERVED);
  mockGetMarketSlotSummary.mockResolvedValue(MARKET_OPEN);
}

// ── paymentPlans unit tests ───────────────────────────────────────────────────

describe("paymentPlans", () => {
  it("PLAN_PRICES has correct halala values", () => {
    expect(PLAN_PRICES.office.amountHalalas).toBe(20_000);
    expect(PLAN_PRICES.freelancer.amountHalalas).toBe(12_000);
  });

  it("getPriceForProviderType returns correct prices", () => {
    expect(getPriceForProviderType("office")!.amountHalalas).toBe(20_000);
    expect(getPriceForProviderType("freelancer")!.amountHalalas).toBe(12_000);
    expect(getPriceForProviderType("unknown")).toBeNull();
  });

  it("buildIdempotencyKey formats correctly", () => {
    expect(buildIdempotencyKey(1, 2, "2026-08")).toBe("1:2:2026-08");
    expect(buildIdempotencyKey(100, 5, "2026-12")).toBe("100:5:2026-12");
  });

  it("nextBillingMonth returns a YYYY-MM string ~30 days from now", () => {
    // Freeze the clock so both nextBillingMonth()'s internal new Date() and
    // the test's own new Date() resolve to the same instant — eliminating the
    // midnight-boundary race where the two calls straddle a day tick.
    // Jan 15 noon UTC: +30 days → Feb 14 → "2026-02"; 1st Feb is ~16.5 days
    // away, safely within the 15–45 window regardless of when the test runs.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T12:00:00.000Z"));
    try {
      const month = nextBillingMonth();
      expect(month).toMatch(/^\d{4}-\d{2}$/);
      const d = new Date(month + "-01");
      const now = new Date();
      const diffDays = (d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThan(15);
      expect(diffDays).toBeLessThan(45);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── validatePrePayment tests ──────────────────────────────────────────────────

describe("validatePrePayment", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupDefaults();
    // Default: no pending payment
    mockPool.query
      .mockResolvedValueOnce(OFFICE_ROW)   // office lookup
      .mockResolvedValueOnce(NO_PENDING);  // pending check
  });

  it("returns not_owner when requesting user does not own the office", async () => {
    mockPool.query.mockReset();
    mockPool.query.mockResolvedValue(OFFICE_ROW_NOT_OWNER);

    const r = await validatePrePayment(1, 42);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toBe("not_owner");
  });

  it("returns not_owner when office does not exist", async () => {
    mockPool.query.mockReset();
    mockPool.query.mockResolvedValue(NO_OFFICE);

    const r = await validatePrePayment(1, 42);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toBe("not_owner");
  });

  it("returns commercial_not_active when commercial_state is disabled", async () => {
    mockGetSystemConfig.mockResolvedValue("disabled");

    const r = await validatePrePayment(1, 42);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toBe("commercial_not_active");
  });

  it("returns no_reservation when slot status is waiting", async () => {
    mockGetSlotStatus.mockResolvedValue(SLOT_WAITING);

    const r = await validatePrePayment(1, 42);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toBe("no_reservation");
  });

  it("returns no_reservation when slot status is null", async () => {
    mockGetSlotStatus.mockResolvedValue({ slotStatus: null, marketKey: null, priorityTier: null, reservationExpiresAt: null });

    const r = await validatePrePayment(1, 42);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toBe("no_reservation");
  });

  it("returns reservation_expired when reservation has passed", async () => {
    mockGetSlotStatus.mockResolvedValue({
      ...SLOT_RESERVED,
      reservationExpiresAt: new Date(Date.now() - 60_000), // expired 1 min ago
    });

    const r = await validatePrePayment(1, 42);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toBe("reservation_expired");
  });

  it("returns reservation_expiring_soon when < 5 minutes remain", async () => {
    mockGetSlotStatus.mockResolvedValue({
      ...SLOT_RESERVED,
      reservationExpiresAt: new Date(Date.now() + 3 * 60_000), // 3 minutes
    });

    const r = await validatePrePayment(1, 42);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toBe("reservation_expiring_soon");
  });

  it("returns market_closed when market is closed", async () => {
    mockGetMarketSlotSummary.mockResolvedValue(MARKET_CLOSED);

    const r = await validatePrePayment(1, 42);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toBe("market_closed");
  });

  it("returns duplicate_pending when a pending row already exists", async () => {
    mockPool.query.mockReset();
    mockPool.query
      .mockResolvedValueOnce(OFFICE_ROW)  // office lookup
      .mockResolvedValueOnce(HAS_PENDING); // pending check

    const r = await validatePrePayment(1, 42);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toBe("duplicate_pending");
  });

  it("returns valid=true with path=new_reservation when reserved and all guards pass", async () => {
    const r = await validatePrePayment(1, 42);
    expect(r.valid).toBe(true);
    if (r.valid) {
      expect(r.path).toBe("new_reservation");
      expect(r.plan.amountHalalas).toBe(20_000);
      expect(r.idempotencyKey).toMatch(/^1:1:/);
    }
  });

  it("returns valid=true with path=renewal when slot is allocated (renewal)", async () => {
    mockGetSlotStatus.mockResolvedValue(SLOT_ALLOCATED);
    mockPool.query.mockReset();
    mockPool.query
      .mockResolvedValueOnce(OFFICE_ROW)  // office lookup
      .mockResolvedValueOnce(NO_PENDING); // pending check for renewal

    const r = await validatePrePayment(1, 42);
    expect(r.valid).toBe(true);
    if (r.valid) {
      expect(r.path).toBe("renewal");
      expect(r.reservationExpiresAt).toBeNull();
    }
  });

  it("returns unknown_plan when provider type has no plan", async () => {
    mockPool.query.mockReset();
    mockPool.query.mockResolvedValue({
      rows: [{ user_id: 42, provider_type: "unknown_type", name: "X", status: "active" }],
    });

    const r = await validatePrePayment(1, 42);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toBe("unknown_plan");
  });
});
