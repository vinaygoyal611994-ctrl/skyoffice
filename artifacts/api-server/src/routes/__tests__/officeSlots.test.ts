/**
 * GET /supply-slots/status — provider slot-status endpoint
 *
 * Verifies that the endpoint:
 *   1. Exists and is mounted at the correct path (route exists).
 *   2. Requires office role (401/403 without auth).
 *   3. Returns null fields when no office is associated with the account.
 *   4. Returns null fields when no slot row exists in the DB.
 *   5. Returns the full contract required by Subscription.tsx.
 *   6. Correctly computes minutesRemaining from reservation_expires_at.
 *   7. Returns minutesRemaining = 0 when reservation is already expired.
 *   8. Includes paymentLockedUntil when a lock is set.
 *   9. Treats 'unassigned' marketKey as null.
 *  10. Response contains every key consumed by Subscription.tsx.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express, { type Application } from "express";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockPool, mockGetOfficeIdForUser } = vi.hoisted(() => ({
  mockPool:              { query: vi.fn() },
  mockGetOfficeIdForUser: vi.fn<() => Promise<number | null>>(),
}));

vi.mock("@workspace/db", () => ({ pool: mockPool }));
vi.mock("../../lib/auth",  () => ({ getOfficeIdForUser: mockGetOfficeIdForUser }));
vi.mock("../../middlewares/authMiddleware", () => ({
  requireRole: (role: string) => (req: any, res: any, next: any) => {
    const user = req.session?.user;
    if (!user)              { res.status(401).json({ error: "Unauthorized" }); return; }
    if (user.role !== role) { res.status(403).json({ error: "Forbidden" });   return; }
    next();
  },
}));

import officeSlotsRouter from "../officeSlots";

// ── App builder ───────────────────────────────────────────────────────────────

function buildApp(role: "office" | "admin" | null = "office"): Application {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.session = role ? { user: { id: 5, role } } : {};
    next();
  });
  app.use(officeSlotsRouter);
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /supply-slots/status", () => {
  beforeEach(() => vi.resetAllMocks());

  // ── 1. Route exists ───────────────────────────────────────────────────────
  it("route exists and responds (not 404)", async () => {
    mockGetOfficeIdForUser.mockResolvedValue(null);
    const app = buildApp("office");
    const res = await request(app).get("/supply-slots/status");
    expect(res.status).not.toBe(404);
  });

  // ── 2. Unauthenticated → 401 ──────────────────────────────────────────────
  it("returns 401 when not authenticated", async () => {
    const app = buildApp(null);
    const res = await request(app).get("/supply-slots/status");
    expect(res.status).toBe(401);
  });

  // ── 3. Wrong role → 403 ───────────────────────────────────────────────────
  it("returns 403 for non-office role (e.g. admin)", async () => {
    const app = buildApp("admin");
    const res = await request(app).get("/supply-slots/status");
    expect(res.status).toBe(403);
  });

  // ── 4. No office associated → null fields ─────────────────────────────────
  it("returns null fields when no office is associated with the account", async () => {
    mockGetOfficeIdForUser.mockResolvedValue(null);
    const app = buildApp("office");

    const res = await request(app).get("/supply-slots/status");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      slotStatus:           null,
      reservationExpiresAt: null,
      minutesRemaining:     null,
      marketKey:            null,
      priorityTier:         null,
      paymentLockedUntil:   null,
    });
  });

  // ── 5. No slot row in DB → null fields ────────────────────────────────────
  it("returns null fields when no slot record exists for the office", async () => {
    mockGetOfficeIdForUser.mockResolvedValue(7);
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const app = buildApp("office");

    const res = await request(app).get("/supply-slots/status");
    expect(res.status).toBe(200);
    expect(res.body.slotStatus).toBeNull();
    expect(res.body.marketKey).toBeNull();
    expect(res.body.minutesRemaining).toBeNull();
  });

  // ── 6. Full contract — reserved slot with time remaining ──────────────────
  it("returns full contract for a reserved slot with all required fields", async () => {
    mockGetOfficeIdForUser.mockResolvedValue(7);
    const expiresAt   = new Date(Date.now() + 90 * 60 * 1000); // 90 min
    const lockedUntil = new Date(Date.now() + 25 * 60 * 1000); // 25 min

    mockPool.query.mockResolvedValueOnce({
      rows: [{
        slot_status:            "reserved",
        market_key:             "SA|riyadh|coworking",
        priority_tier:          2,
        reservation_expires_at: expiresAt,
        payment_locked_until:   lockedUntil,
      }],
    });

    const app = buildApp("office");
    const res = await request(app).get("/supply-slots/status");

    expect(res.status).toBe(200);
    expect(res.body.slotStatus).toBe("reserved");
    expect(res.body.marketKey).toBe("SA|riyadh|coworking");
    expect(res.body.priorityTier).toBe(2);
    expect(res.body.reservationExpiresAt).toBe(expiresAt.toISOString());
    expect(res.body.paymentLockedUntil).toBe(lockedUntil.toISOString());
    expect(res.body.minutesRemaining).toBeGreaterThanOrEqual(89);
    expect(res.body.minutesRemaining).toBeLessThanOrEqual(91);
  });

  // ── 7. minutesRemaining = 0 for already-expired reservation ──────────────
  it("returns minutesRemaining = 0 when reservation has already expired", async () => {
    mockGetOfficeIdForUser.mockResolvedValue(7);
    const pastExpiry = new Date(Date.now() - 5 * 60 * 1000); // 5 min ago

    mockPool.query.mockResolvedValueOnce({
      rows: [{
        slot_status: "reserved", market_key: "SA|riyadh|coworking",
        priority_tier: 1, reservation_expires_at: pastExpiry, payment_locked_until: null,
      }],
    });

    const app = buildApp("office");
    const res = await request(app).get("/supply-slots/status");

    expect(res.status).toBe(200);
    expect(res.body.minutesRemaining).toBe(0);
    expect(res.body.paymentLockedUntil).toBeNull();
  });

  // ── 8. paymentLockedUntil is returned as ISO string when set ──────────────
  it("includes paymentLockedUntil as ISO string when a lock is active", async () => {
    mockGetOfficeIdForUser.mockResolvedValue(7);
    const lock = new Date(Date.now() + 20 * 60 * 1000);

    mockPool.query.mockResolvedValueOnce({
      rows: [{
        slot_status: "reserved", market_key: "SA|riyadh|coworking",
        priority_tier: 1, reservation_expires_at: new Date(Date.now() + 2700_000),
        payment_locked_until: lock,
      }],
    });

    const app = buildApp("office");
    const res = await request(app).get("/supply-slots/status");
    expect(res.body.paymentLockedUntil).toBe(lock.toISOString());
  });

  // ── 9. 'unassigned' marketKey → null ─────────────────────────────────────
  it("maps 'unassigned' marketKey to null for not_required offices", async () => {
    mockGetOfficeIdForUser.mockResolvedValue(7);
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        slot_status: "not_required", market_key: "unassigned",
        priority_tier: 3, reservation_expires_at: null, payment_locked_until: null,
      }],
    });

    const app = buildApp("office");
    const res = await request(app).get("/supply-slots/status");
    expect(res.body.slotStatus).toBe("not_required");
    expect(res.body.marketKey).toBeNull();
  });

  // ── 10. Waiting status — no expiry times ──────────────────────────────────
  it("returns waiting status with null expiry and lock fields", async () => {
    mockGetOfficeIdForUser.mockResolvedValue(7);
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        slot_status: "waiting", market_key: "SA|riyadh|coworking",
        priority_tier: 3, reservation_expires_at: null, payment_locked_until: null,
      }],
    });

    const app = buildApp("office");
    const res = await request(app).get("/supply-slots/status");
    expect(res.body.slotStatus).toBe("waiting");
    expect(res.body.reservationExpiresAt).toBeNull();
    expect(res.body.minutesRemaining).toBeNull();
  });

  // ── 11. All Subscription.tsx required fields present ─────────────────────
  it("response contains every field consumed by Subscription.tsx", async () => {
    mockGetOfficeIdForUser.mockResolvedValue(null); // returns null-field response
    const app = buildApp("office");
    const res = await request(app).get("/supply-slots/status");

    const requiredKeys = [
      "slotStatus", "reservationExpiresAt", "minutesRemaining",
      "marketKey", "priorityTier", "paymentLockedUntil",
    ];
    for (const key of requiredKeys) {
      expect(res.body).toHaveProperty(key);
    }
  });
});
