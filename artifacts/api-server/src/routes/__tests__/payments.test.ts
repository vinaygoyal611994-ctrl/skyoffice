/**
 * Payment Route Integration Tests
 *
 * Covers:
 *   - POST /payments/checkout: auth, gateway not configured, validation failure,
 *     DB race conflict, gateway error, success
 *   - POST /payments/webhook: missing sig, no secret, bad sig, unknown event type,
 *     checkout.completed success, failed_no_slot, already-succeeded idempotency
 *   - GET /payments/status: unauthenticated, no payment, succeeded payment + masked ref
 *   - GET /admin/payments/:officeId: auth, bad param, paginated history
 *
 * Note: webhook handler now uses PaymentGateway interface (NormalisedWebhookEvent),
 * not Stripe SDK types. Tests mock getPaymentGateway() accordingly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockPool,
  mockValidatePrePayment,
  mockGateway,
  mockGetWebhookSecret,
  mockGetOfficeIdForUser,
  mockActivatePaid,
  mockGetOrCreateSubscription,
  mockClearPaymentLock,
} = vi.hoisted(() => {
  const mockPool = { query: vi.fn() };
  const mockGateway = {
    isConfigured:           vi.fn(),
    createCheckoutSession:  vi.fn(),
    constructWebhookEvent:  vi.fn(),
  };
  return {
    mockPool,
    mockGateway,
    mockValidatePrePayment:      vi.fn(),
    mockGetWebhookSecret:        vi.fn(),
    mockGetOfficeIdForUser:      vi.fn(),
    mockActivatePaid:            vi.fn(),
    mockGetOrCreateSubscription: vi.fn(),
    mockClearPaymentLock:        vi.fn(),
  };
});

vi.mock("@workspace/db", () => ({ pool: mockPool }));
vi.mock("../../lib/paymentValidator",  () => ({ validatePrePayment: mockValidatePrePayment }));
vi.mock("../../lib/paymentGateway",    () => ({ getPaymentGateway: () => mockGateway }));
vi.mock("../../lib/stripeClient",      () => ({ getWebhookSecret: mockGetWebhookSecret }));
vi.mock("../../lib/auth",              () => ({ getOfficeIdForUser: mockGetOfficeIdForUser }));
vi.mock("../../lib/subscriptionLifecycle", () => ({
  activatePaid:            mockActivatePaid,
  getOrCreateSubscription: mockGetOrCreateSubscription,
}));
vi.mock("../../lib/supplySlotManager", () => ({ clearPaymentLock: mockClearPaymentLock }));
vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../middlewares/authMiddleware", () => ({
  requireRole: (role: string) => (req: any, res: any, next: any) => {
    const user = req.session?.user;
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (user.role !== role) { res.status(403).json({ error: "Forbidden" }); return; }
    next();
  },
}));

// ── Import AFTER mocks ────────────────────────────────────────────────────────
import paymentsRouter, { webhookRawBodyMiddleware } from "../../routes/payments";

// ── App builders ──────────────────────────────────────────────────────────────

function buildApp(role: "office" | "admin" | null = "office") {
  const app = express();
  app.use((req, _res, next) => {
    (req as any).session = { user: role ? { id: 42, role, isInternal: false } : null };
    next();
  });
  // Raw-body for webhook BEFORE json, mirroring routes/index.ts
  app.post("/payments/webhook", webhookRawBodyMiddleware);
  app.use(express.json());
  app.use(paymentsRouter);
  return app;
}

// ── Common helpers ────────────────────────────────────────────────────────────

const VALID_PLAN = {
  valid: true,
  path:  "new_reservation",
  plan: {
    planId:        1,
    planName:      "Office Standard",
    planNameAr:    "المكتب الأساسي",
    providerType:  "office",
    amountHalalas: 20_000,
    currency:      "SAR",
  },
  idempotencyKey:       "7:1:2026-08",
  paidThroughDate:      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  reservationExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
  marketKey:            "SA|riyadh|coworking",
};

/** Normalised event shape — matches NormalisedWebhookEvent interface */
function makeCheckoutCompletedEvent(overrides: Record<string, unknown> = {}) {
  return {
    id:             "evt_success",
    type:           "checkout.completed",
    sessionId:      "cs_test_abc",
    paymentIntentId: "pi_test_xyz",
    amountTotal:    20_000,
    currency:       "SAR",
    metadata:       { idempotencyKey: "7:1:2026-08", renewalPath: "false" },
    failureMessage: null,
    ...overrides,
  };
}

const PENDING_TX = {
  id: 1, office_id: 7, status: "pending",
  amount_halalas: 20_000, currency: "SAR",
  idempotency_key: "7:1:2026-08", plan_id: 1,
  metadata: {}, gateway_event_id: null,
};

// ── POST /payments/checkout ───────────────────────────────────────────────────

describe("POST /payments/checkout", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 401 when not authenticated", async () => {
    const app = buildApp(null);
    const res = await request(app).post("/payments/checkout").send({});
    expect(res.status).toBe(401);
  });

  it("returns 503 when gateway is not configured", async () => {
    mockGateway.isConfigured.mockReturnValue(false);
    mockGetOfficeIdForUser.mockResolvedValue(7);
    const app = buildApp("office");
    const res = await request(app).post("/payments/checkout").send({});
    expect(res.status).toBe(503);
  });

  it("returns 400 when user has no office", async () => {
    mockGateway.isConfigured.mockReturnValue(true);
    mockGetOfficeIdForUser.mockResolvedValue(null);
    const app = buildApp("office");
    const res = await request(app).post("/payments/checkout").send({});
    expect(res.status).toBe(400);
  });

  it("returns 409 on validation failure", async () => {
    mockGateway.isConfigured.mockReturnValue(true);
    mockGetOfficeIdForUser.mockResolvedValue(7);
    mockValidatePrePayment.mockResolvedValue({
      valid: false, reason: "no_reservation",
      messageEn: "No slot", messageAr: "لا مقعد",
    });
    const app = buildApp("office");
    const res = await request(app).post("/payments/checkout").send({});
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe("no_reservation");
  });

  it("returns 409 duplicate_pending on DB INSERT race condition", async () => {
    mockGateway.isConfigured.mockReturnValue(true);
    mockGetOfficeIdForUser.mockResolvedValue(7);
    mockValidatePrePayment.mockResolvedValue(VALID_PLAN);
    mockGetOrCreateSubscription.mockResolvedValue({ id: 5 });
    mockPool.query
      // 1. Check existing row → none
      .mockResolvedValueOnce({ rows: [] })
      // 2. Office name
      .mockResolvedValueOnce({ rows: [{ name: "Test Office" }] })
      // 3. INSERT → unique constraint violation (concurrent request)
      .mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "23505" }));
    const app = buildApp("office");
    const res = await request(app).post("/payments/checkout").send({});
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe("duplicate_pending");
  });

  it("returns 502 on gateway session creation error", async () => {
    mockGateway.isConfigured.mockReturnValue(true);
    mockGetOfficeIdForUser.mockResolvedValue(7);
    mockValidatePrePayment.mockResolvedValue(VALID_PLAN);
    mockGetOrCreateSubscription.mockResolvedValue({ id: 5 });
    mockGateway.createCheckoutSession.mockRejectedValue(new Error("Gateway timeout"));
    mockClearPaymentLock.mockResolvedValue(undefined);
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })               // check existing
      .mockResolvedValueOnce({ rows: [{ name: "Test" }] }) // office name
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })      // INSERT pending
      .mockResolvedValueOnce({ rows: [] })               // set lock
      .mockResolvedValueOnce({ rows: [] });              // cancel row
    const app = buildApp("office");
    const res = await request(app).post("/payments/checkout").send({});
    expect(res.status).toBe(502);
    expect(mockClearPaymentLock).toHaveBeenCalledWith(7);
  });

  it("returns 200 with sessionUrl on success", async () => {
    mockGateway.isConfigured.mockReturnValue(true);
    mockGetOfficeIdForUser.mockResolvedValue(7);
    mockValidatePrePayment.mockResolvedValue(VALID_PLAN);
    mockGetOrCreateSubscription.mockResolvedValue({ id: 5 });
    mockGateway.createCheckoutSession.mockResolvedValue({
      sessionId:  "cs_test_abc",
      sessionUrl: "https://gateway.example/test",
    });
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })               // check existing
      .mockResolvedValueOnce({ rows: [{ name: "Test" }] }) // office name
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })      // INSERT pending
      .mockResolvedValueOnce({ rows: [] })               // set lock
      .mockResolvedValueOnce({ rows: [] });              // update session ID
    const app = buildApp("office");
    const res = await request(app).post("/payments/checkout").send({});
    expect(res.status).toBe(200);
    expect(res.body.sessionUrl).toBe("https://gateway.example/test");
  });
});

// ── POST /payments/webhook ────────────────────────────────────────────────────

describe("POST /payments/webhook", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 400 when signature header is missing", async () => {
    mockGetWebhookSecret.mockReturnValue("whsec_test");
    const app = buildApp(null);
    const res = await request(app)
      .post("/payments/webhook")
      .set("Content-Type", "application/json")
      .send("{}");
    expect(res.status).toBe(400);
  });

  it("returns 400 when webhook secret is not configured", async () => {
    mockGetWebhookSecret.mockReturnValue("");
    const app = buildApp(null);
    const res = await request(app)
      .post("/payments/webhook")
      .set("stripe-signature", "sig_test")
      .send("{}");
    expect(res.status).toBe(400);
  });

  it("returns 400 on invalid signature", async () => {
    mockGetWebhookSecret.mockReturnValue("whsec_test");
    mockGateway.constructWebhookEvent.mockImplementation(() => { throw new Error("Invalid sig"); });
    const app = buildApp(null);
    const res = await request(app)
      .post("/payments/webhook")
      .set("stripe-signature", "sig_test")
      .set("Content-Type", "application/json")
      .send(Buffer.from("{}"));
    expect(res.status).toBe(400);
  });

  it("returns 200 for unknown event types (silently acknowledged)", async () => {
    mockGetWebhookSecret.mockReturnValue("whsec_test");
    mockGateway.constructWebhookEvent.mockReturnValue({
      id: "evt_1", type: "unknown",
      sessionId: null, paymentIntentId: null,
      amountTotal: null, currency: null, metadata: {}, failureMessage: null,
    });
    const app = buildApp(null);
    const res = await request(app)
      .post("/payments/webhook")
      .set("stripe-signature", "sig_test")
      .set("Content-Type", "application/json")
      .send(Buffer.from("{}"));
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });

  it("returns 200 and activates subscription on checkout.completed", async () => {
    mockGetWebhookSecret.mockReturnValue("whsec_test");
    mockGateway.constructWebhookEvent.mockReturnValue(makeCheckoutCompletedEvent());
    mockActivatePaid.mockResolvedValue(undefined);
    mockClearPaymentLock.mockResolvedValue(undefined);
    mockPool.query
      .mockResolvedValueOnce({ rows: [PENDING_TX] })  // session lookup
      .mockResolvedValueOnce({ rows: [] })             // UPDATE succeeded
      .mockResolvedValueOnce({ rows: [] });            // clearPaymentLock no-op (via pool)
    const app = buildApp(null);
    const res = await request(app)
      .post("/payments/webhook")
      .set("stripe-signature", "sig_test")
      .set("Content-Type", "application/json")
      .send(Buffer.from("{}"));
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
    expect(mockActivatePaid).toHaveBeenCalled();
    expect(mockClearPaymentLock).toHaveBeenCalledWith(7);
  });

  it("returns 200 and sets failed_no_slot when activatePaid throws", async () => {
    mockGetWebhookSecret.mockReturnValue("whsec_test");
    mockGateway.constructWebhookEvent.mockReturnValue(makeCheckoutCompletedEvent());
    mockActivatePaid.mockRejectedValue(new Error("Slot expired"));
    mockClearPaymentLock.mockResolvedValue(undefined);
    mockPool.query
      .mockResolvedValueOnce({ rows: [PENDING_TX] })  // session lookup
      .mockResolvedValueOnce({ rows: [] })             // UPDATE succeeded
      .mockResolvedValueOnce({ rows: [] });            // UPDATE failed_no_slot
    const app = buildApp(null);
    const res = await request(app)
      .post("/payments/webhook")
      .set("stripe-signature", "sig_test")
      .set("Content-Type", "application/json")
      .send(Buffer.from("{}"));
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
    expect(mockClearPaymentLock).toHaveBeenCalledWith(7);
  });

  it("returns 200 immediately (idempotent) for already-succeeded transaction", async () => {
    mockGetWebhookSecret.mockReturnValue("whsec_test");
    mockGateway.constructWebhookEvent.mockReturnValue(makeCheckoutCompletedEvent({ id: "evt_dup" }));
    mockPool.query.mockResolvedValueOnce({
      rows: [{ ...PENDING_TX, status: "succeeded", gateway_event_id: "evt_dup" }],
    });
    const app = buildApp(null);
    const res = await request(app)
      .post("/payments/webhook")
      .set("stripe-signature", "sig_test")
      .set("Content-Type", "application/json")
      .send(Buffer.from("{}"));
    expect(res.status).toBe(200);
    expect(mockActivatePaid).not.toHaveBeenCalled();
  });
});

// ── GET /payments/status ──────────────────────────────────────────────────────

describe("GET /payments/status", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 401 when not authenticated", async () => {
    const app = buildApp(null);
    const res = await request(app).get("/payments/status");
    expect(res.status).toBe(401);
  });

  it("returns { payment: null } when no transactions", async () => {
    mockGetOfficeIdForUser.mockResolvedValue(7);
    mockPool.query.mockResolvedValue({ rows: [] });
    const app = buildApp("office");
    const res = await request(app).get("/payments/status");
    expect(res.status).toBe(200);
    expect(res.body.payment).toBeNull();
  });

  it("returns latest transaction with masked gateway ref (last 8 chars only)", async () => {
    mockGetOfficeIdForUser.mockResolvedValue(7);
    mockPool.query.mockResolvedValue({
      rows: [{
        id: 1, status: "succeeded", amount_halalas: 20_000, currency: "SAR",
        plan_name: "Office Standard", plan_name_ar: "المكتب الأساسي",
        paid_at: new Date("2026-08-01"), failed_at: null, failure_reason: null,
        created_at: new Date("2026-08-01"), metadata: null,
        gateway_session_id: "cs_test_abcdefgh12345678",
        reservation_expires_at: null,
      }],
    });
    const app = buildApp("office");
    const res = await request(app).get("/payments/status");
    expect(res.status).toBe(200);
    expect(res.body.payment.status).toBe("succeeded");
    expect(res.body.payment.amountSar).toBe(200);
    expect(res.body.payment.gatewayRef).toBe("12345678"); // last 8 only
    expect(res.body.payment.gatewayRef).toHaveLength(8);
  });
});

// ── GET /admin/payments/:officeId ─────────────────────────────────────────────

describe("GET /admin/payments/:officeId", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 401 for unauthenticated requests", async () => {
    const app = buildApp(null);
    const res = await request(app).get("/admin/payments/7");
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-admin role", async () => {
    const app = buildApp("office");
    const res = await request(app).get("/admin/payments/7");
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid officeId", async () => {
    const app = buildApp("admin");
    const res = await request(app).get("/admin/payments/abc");
    expect(res.status).toBe(400);
  });

  it("returns paginated payment history for admin", async () => {
    mockPool.query
      .mockResolvedValueOnce({
        rows: [{
          id: 1, status: "succeeded", amount_halalas: 20_000, currency: "SAR",
          paid_at: new Date(), failed_at: null, failure_reason: null,
          created_at: new Date(), gateway_ref: "12345678",
          plan_name: "Office Standard", plan_name_ar: null, metadata: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ cnt: 1 }] });
    const app = buildApp("admin");
    const res = await request(app).get("/admin/payments/7");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].amountSar).toBe(200);
  });
});
