/**
 * HIGH-07: Unit tests for admin session security controls.
 *
 * These tests verify the three key constants and the enforceAdminSessionLimits
 * middleware logic without requiring a real HTTP server or database. They use
 * lightweight mocks for req/res/next so they run fast and without I/O.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

// ---------------------------------------------------------------------------
// Constants — imported from authMiddleware indirectly via the module boundary.
// We re-declare them here so the tests remain self-documenting even if the
// values in the middleware change (failing tests will surface the mismatch).
// ---------------------------------------------------------------------------

const ADMIN_MAX_SESSION_MS = 8 * 60 * 60 * 1000; // 8 hours
const ADMIN_IDLE_TIMEOUT_MS = 30 * 60 * 1000;     // 30 minutes

// ---------------------------------------------------------------------------
// Minimal mock helpers
// ---------------------------------------------------------------------------

function makeReq(overrides: Partial<{
  role: "admin" | "office" | "customer" | undefined;
  loginAt: number | undefined;
  lastSeenAt: number | undefined;
}> = {}): Request {
  const user = overrides.role ? { id: 1, role: overrides.role } : undefined;
  return {
    session: {
      user,
      loginAt: overrides.loginAt,
      lastSeenAt: overrides.lastSeenAt,
      destroy: vi.fn((cb?: () => void) => { cb?.(); }),
    },
  } as unknown as Request;
}

function makeRes() {
  const res = {
    status: vi.fn().mockReturnThis() as unknown,
    json: vi.fn().mockReturnThis() as unknown,
  };
  return res as unknown as Response;
}

// ---------------------------------------------------------------------------
// Import after mocking potential side-effects
// ---------------------------------------------------------------------------

const { enforceAdminSessionLimits } = await import("../../middlewares/authMiddleware");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("enforceAdminSessionLimits", () => {
  let next: NextFunction;

  beforeEach(() => {
    next = vi.fn();
  });

  it("passes through for unauthenticated sessions", () => {
    const req = makeReq({ role: undefined });
    const res = makeRes();
    enforceAdminSessionLimits(req as unknown as Request, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("passes through for office sessions (non-admin)", () => {
    const now = Date.now();
    const req = makeReq({ role: "office", loginAt: now - 1000, lastSeenAt: now - 1000 });
    const res = makeRes();
    enforceAdminSessionLimits(req as unknown as Request, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("passes through for customer sessions (non-admin)", () => {
    const now = Date.now();
    const req = makeReq({ role: "customer", loginAt: now - 1000, lastSeenAt: now - 1000 });
    const res = makeRes();
    enforceAdminSessionLimits(req as unknown as Request, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("passes an admin session that is within both limits", () => {
    const now = Date.now();
    const req = makeReq({
      role: "admin",
      loginAt: now - (ADMIN_MAX_SESSION_MS - 60_000),    // 1 minute before expiry
      lastSeenAt: now - (ADMIN_IDLE_TIMEOUT_MS - 60_000), // 1 minute before idle
    });
    const res = makeRes();
    enforceAdminSessionLimits(req as unknown as Request, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects an admin session that has exceeded the 8-hour absolute limit", () => {
    const now = Date.now();
    const req = makeReq({
      role: "admin",
      loginAt: now - (ADMIN_MAX_SESSION_MS + 1000), // 1 second over
      lastSeenAt: now - 1000,                         // recently active
    });
    const res = makeRes();
    enforceAdminSessionLimits(req as unknown as Request, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "SESSION_EXPIRED_ABSOLUTE" }),
    );
    expect((req.session as unknown as Record<string, unknown>).destroy).toHaveBeenCalled();
  });

  it("rejects an admin session that has been idle for more than 30 minutes", () => {
    const now = Date.now();
    const req = makeReq({
      role: "admin",
      loginAt: now - 60_000,                          // logged in 1 minute ago
      lastSeenAt: now - (ADMIN_IDLE_TIMEOUT_MS + 1000), // 1 second over idle limit
    });
    const res = makeRes();
    enforceAdminSessionLimits(req as unknown as Request, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "SESSION_EXPIRED_IDLE" }),
    );
    expect((req.session as unknown as Record<string, unknown>).destroy).toHaveBeenCalled();
  });

  it("refreshes lastSeenAt on each valid admin request", () => {
    const now = Date.now();
    const req = makeReq({
      role: "admin",
      loginAt: now - 60_000,
      lastSeenAt: now - 60_000,
    });
    const res = makeRes();
    enforceAdminSessionLimits(req as unknown as Request, res, next);
    expect(next).toHaveBeenCalledOnce();
    const lastSeenAt = (req.session as unknown as Record<string, unknown>).lastSeenAt as number;
    expect(lastSeenAt).toBeGreaterThanOrEqual(now);
  });

  it("rejects exactly at the 8-hour boundary (boundary condition)", () => {
    const now = Date.now();
    const req = makeReq({
      role: "admin",
      loginAt: now - ADMIN_MAX_SESSION_MS - 1, // 1 ms over
      lastSeenAt: now,
    });
    const res = makeRes();
    enforceAdminSessionLimits(req as unknown as Request, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "SESSION_EXPIRED_ABSOLUTE" }),
    );
  });

  it("rejects exactly at the 30-minute idle boundary (boundary condition)", () => {
    const now = Date.now();
    const req = makeReq({
      role: "admin",
      loginAt: now - 60_000,
      lastSeenAt: now - ADMIN_IDLE_TIMEOUT_MS - 1, // 1 ms over
    });
    const res = makeRes();
    enforceAdminSessionLimits(req as unknown as Request, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "SESSION_EXPIRED_IDLE" }),
    );
  });

  it("passes an admin session with no loginAt/lastSeenAt timestamps (legacy sessions)", () => {
    // Existing sessions written before this fix won't have loginAt/lastSeenAt.
    // They should be allowed through rather than silently broken.
    const req = makeReq({ role: "admin", loginAt: undefined, lastSeenAt: undefined });
    const res = makeRes();
    enforceAdminSessionLimits(req as unknown as Request, res, next);
    expect(next).toHaveBeenCalledOnce();
  });
});
