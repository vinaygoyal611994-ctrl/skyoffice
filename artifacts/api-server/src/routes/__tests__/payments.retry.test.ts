/**
 * Payment Retry, Lock, and Idempotency Tests
 *
 * Verifies:
 *   1. Failed payment can retry safely (row updated, not inserted).
 *   2. Cancelled payment can retry safely.
 *   3. Succeeded payment blocks retry for same billing period (already_paid).
 *   4. Pending payment blocks concurrent duplicate (duplicate_pending).
 *   5. Duplicate webhook is idempotent (already-succeeded → no activation).
 *   6. Gateway errors clear the payment lock.
 *   7. Retry cannot create duplicate revenue (UPDATE, never INSERT, for retries).
 *   8. Payment lock is set on the reservation when checkout is created.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express, { type Application } from "express";
import { Router } from "express";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockPool,
  mockGateway,
  mockGetOfficeIdForUser,
  mockValidatePrePayment,
  mockGetOrCreateSubscription,
  mockActivatePaid,
  mockClearPaymentLock,
  mockGetWebhookSecret,
} = vi.hoisted(() => {
  const mockPool = { query: vi.fn() };
  const mockGateway = {
    isConfigured:          vi.fn(() => true),
    createCheckoutSession: vi.fn(),
    constructWebhookEvent: vi.fn(),
  };
  return {
    mockPool,
    mockGateway,
    mockGetOfficeIdForUser:      vi.fn<() => Promise<number | null>>(),
    mockValidatePrePayment:      vi.fn(),
    mockGetOrCreateSubscription: vi.fn(),
    mockActivatePaid:            vi.fn(),
    mockClearPaymentLock:        vi.fn(),
    mockGetWebhookSecret:        vi.fn(() => "whsec_test"),
  };
});

vi.mock("@workspace/db",                    () => ({ pool: mockPool }));
vi.mock("../../lib/paymentGateway",         () => ({ getPaymentGateway: () => mockGateway }));
vi.mock("../../lib/auth",                   () => ({ getOfficeIdForUser: mockGetOfficeIdForUser }));
vi.mock("../../lib/paymentValidator",       () => ({ validatePrePayment: mockValidatePrePayment }));
vi.mock("../../lib/subscriptionLifecycle",  () => ({
  getOrCreateSubscription: mockGetOrCreateSubscription,
  activatePaid:            mockActivatePaid,
}));
vi.mock("../../lib/supplySlotManager",      () => ({ clearPaymentLock: mockClearPaymentLock }));
vi.mock("../../lib/stripeClient",           () => ({ getWebhookSecret: mockGetWebhookSecret }));
vi.mock("../../lib/logger",                 () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../middlewares/authMiddleware", () => ({
  requireRole: (role: string) => (req: any, res: any, next: any) => {
    const user = req.session?.user;
    if (!user)              { res.status(401).json({ error: "Unauthorized" }); return; }
    if (user.role !== role) { res.status(403).json({ error: "Forbidden" });   return; }
    next();
  },
}));

import paymentsRouter, { webhookRawBodyMiddleware } from "../payments";

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_PLAN = {
  valid: true,
  path:  "new_reservation",
  plan:  { planId: 1, planName: "Pro", planNameAr: "برو", amountHalalas: 20_000, currency: "SAR" },
  idempotencyKey:       "7:1:2026-08",
  paidThroughDate:      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  reservationExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
  marketKey:            "SA|riyadh|coworking",
};

function buildCheckoutApp(): Application {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.session = { user: { id: 5, role: "office" } };
    next();
  });
  app.use(paymentsRouter);
  return app;
}

function buildWebhookApp(): Application {
  const app = express();
  const r = Router();
  r.post("/payments/webhook", webhookRawBodyMiddleware);
  app.use(r);
  app.use(paymentsRouter);
  return app;
}

function makeCompletedEvent(overrides: Record<string, unknown> = {}) {
  return {
    id:              "evt_test",
    type:            "checkout.completed",
    sessionId:       "cs_test_abc",
    paymentIntentId: "pi_test",
    amountTotal:     20_000,
    currency:        "SAR",
    metadata:        { idempotencyKey: "7:1:2026-08", renewalPath: "false" },
    failureMessage:  null,
    ...overrides,
  };
}

// ── Tests: checkout retry semantics ──────────────────────────────────────────

describe("POST /payments/checkout — retry and lock semantics", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGateway.isConfigured.mockReturnValue(true);
    mockGetOfficeIdForUser.mockResolvedValue(7);
    mockValidatePrePayment.mockResolvedValue(VALID_PLAN);
    mockGetOrCreateSubscription.mockResolvedValue({ id: 5 });
    mockGateway.createCheckoutSession.mockResolvedValue({
      sessionId:  "cs_test_abc123",
      sessionUrl: "https://checkout.example/test",
    });
    mockClearPaymentLock.mockResolvedValue(undefined);
  });

  // ── 1. Failed payment can retry ───────────────────────────────────────────
  it("allows retry when previous payment is failed — updates row, does not insert", async () => {
    const app = buildCheckoutApp();
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 42, status: "failed" }] })  // existing check
      .mockResolvedValueOnce({ rows: [{ name: "Test Office" }] })        // office name
      .mockResolvedValueOnce({ rows: [{ id: 42 }] })                    // UPDATE failed→pending
      .mockResolvedValueOnce({ rows: [] })                              // set lock
      .mockResolvedValueOnce({ rows: [] });                             // update session ID

    const res = await request(app).post("/payments/checkout").send({});
    expect(res.status).toBe(200);
    expect(res.body.sessionUrl).toBe("https://checkout.example/test");

    const sqls: string[] = mockPool.query.mock.calls.map((c) => c[0] as string);
    const updatedRetry = sqls.some((q) =>
      q.includes("UPDATE office_payment_transactions") &&
      q.includes("IN ('failed', 'cancelled')")
    );
    expect(updatedRetry).toBe(true);
    const inserted = sqls.some((q) => q.includes("INSERT INTO office_payment_transactions"));
    expect(inserted).toBe(false);
  });

  // ── 2. Cancelled payment can retry ───────────────────────────────────────
  it("allows retry when previous payment is cancelled", async () => {
    const app = buildCheckoutApp();
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 43, status: "cancelled" }] })
      .mockResolvedValueOnce({ rows: [{ name: "Test Office" }] })
      .mockResolvedValueOnce({ rows: [{ id: 43 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).post("/payments/checkout").send({});
    expect(res.status).toBe(200);
  });

  // ── 3. Succeeded payment blocks retry (already_paid) ─────────────────────
  it("returns 409 already_paid when succeeded row exists for billing period", async () => {
    const app = buildCheckoutApp();
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 44, status: "succeeded" }] });

    const res = await request(app).post("/payments/checkout").send({});
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe("already_paid");
    expect(mockGateway.createCheckoutSession).not.toHaveBeenCalled();
  });

  // ── 4. Pending row blocks concurrent duplicate ────────────────────────────
  it("returns 409 duplicate_pending when a pending row exists", async () => {
    const app = buildCheckoutApp();
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 45, status: "pending" }] });

    const res = await request(app).post("/payments/checkout").send({});
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe("duplicate_pending");
    expect(mockGateway.createCheckoutSession).not.toHaveBeenCalled();
  });

  // ── 5. Payment lock is set after pending row creation ─────────────────────
  it("sets payment_locked_until on market_slot_allocations after pending row", async () => {
    const app = buildCheckoutApp();
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })               // no existing
      .mockResolvedValueOnce({ rows: [{ name: "Off" }] }) // office name
      .mockResolvedValueOnce({ rows: [{ id: 50 }] })     // INSERT pending
      .mockResolvedValueOnce({ rows: [] })               // lock UPDATE
      .mockResolvedValueOnce({ rows: [] });              // session ID UPDATE

    await request(app).post("/payments/checkout").send({});

    const sqls: string[] = mockPool.query.mock.calls.map((c) => c[0] as string);
    const lockSql = sqls.find((q) =>
      q.includes("payment_locked_until") && q.includes("UPDATE market_slot_allocations")
    );
    expect(lockSql).toBeDefined();
    expect(lockSql).toMatch(/NOW\(\) \+ INTERVAL/);
  });

  // ── 6. Gateway error clears the payment lock ─────────────────────────────
  it("calls clearPaymentLock when gateway session creation fails", async () => {
    const app = buildCheckoutApp();
    mockGateway.createCheckoutSession.mockRejectedValueOnce(new Error("Timeout"));
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ name: "Off" }] })
      .mockResolvedValueOnce({ rows: [{ id: 51 }] })
      .mockResolvedValueOnce({ rows: [] }) // lock set
      .mockResolvedValueOnce({ rows: [] }); // cancel row

    const res = await request(app).post("/payments/checkout").send({});
    expect(res.status).toBe(502);
    expect(mockClearPaymentLock).toHaveBeenCalledWith(7);
  });

  // ── 7. Retry cannot create duplicate revenue ──────────────────────────────
  it("retry reuses the same row ID — no second INSERT possible", async () => {
    const app = buildCheckoutApp();
    // Existing failed row — retry should UPDATE, not INSERT
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 55, status: "failed" }] })
      .mockResolvedValueOnce({ rows: [{ name: "Office" }] })
      .mockResolvedValueOnce({ rows: [{ id: 55 }] }) // UPDATE returns same ID
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).post("/payments/checkout").send({});
    expect(res.status).toBe(200);

    const inserts = mockPool.query.mock.calls.filter(([sql]) =>
      typeof sql === "string" && sql.includes("INSERT INTO office_payment_transactions")
    );
    expect(inserts).toHaveLength(0);
  });
});

// ── Tests: webhook idempotency ────────────────────────────────────────────────

describe("POST /payments/webhook — idempotency", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetWebhookSecret.mockReturnValue("whsec_test");
    mockClearPaymentLock.mockResolvedValue(undefined);
    mockActivatePaid.mockResolvedValue(undefined);
  });

  it("returns 200 idempotent no-op when transaction already succeeded", async () => {
    const app = buildWebhookApp();
    mockGateway.constructWebhookEvent.mockReturnValue(makeCompletedEvent());
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        id: 1, office_id: 7, status: "succeeded",
        amount_halalas: 20_000, currency: "SAR",
        idempotency_key: "7:1:2026-08", plan_id: 1,
        metadata: {}, gateway_event_id: null,
      }],
    });

    const res = await request(app)
      .post("/payments/webhook")
      .set("stripe-signature", "sig_test")
      .send(Buffer.from("{}"));

    expect(res.status).toBe(200);
    expect(mockActivatePaid).not.toHaveBeenCalled();
  });

  it("returns 200 and no-ops when duplicate event ID matches stored gateway_event_id", async () => {
    const app = buildWebhookApp();
    mockGateway.constructWebhookEvent.mockReturnValue(makeCompletedEvent({ id: "evt_dup" }));
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        id: 1, office_id: 7, status: "pending",
        amount_halalas: 20_000, currency: "SAR",
        idempotency_key: "7:1:2026-08", plan_id: 1,
        metadata: {}, gateway_event_id: "evt_dup", // same as event.id → no-op
      }],
    });

    const res = await request(app)
      .post("/payments/webhook")
      .set("stripe-signature", "sig_test")
      .send(Buffer.from("{}"));

    expect(res.status).toBe(200);
    expect(mockActivatePaid).not.toHaveBeenCalled();
  });

  it("clears payment lock after successful activation", async () => {
    const app = buildWebhookApp();
    mockGateway.constructWebhookEvent.mockReturnValue(makeCompletedEvent());
    mockPool.query
      .mockResolvedValueOnce({
        rows: [{
          id: 1, office_id: 7, status: "pending",
          amount_halalas: 20_000, currency: "SAR",
          idempotency_key: "7:1:2026-08", plan_id: 1,
          metadata: {}, gateway_event_id: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE succeeded

    const res = await request(app)
      .post("/payments/webhook")
      .set("stripe-signature", "sig_test")
      .send(Buffer.from("{}"));

    expect(res.status).toBe(200);
    expect(mockClearPaymentLock).toHaveBeenCalledWith(7);
  });
});
