import type { NextFunction, Request, Response } from "express";
import type { SessionUser } from "../lib/auth";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

declare module "express-session" {
  interface SessionData {
    user?: SessionUser;
    /** Unix-ms timestamp when this session was first authenticated (login / register). */
    loginAt?: number;
    /** Unix-ms timestamp of the last request made while this session was authenticated. */
    lastSeenAt?: number;
  }
}

// ---------------------------------------------------------------------------
// Admin-specific session lifetime constants
// ---------------------------------------------------------------------------

/** Absolute maximum lifetime for an admin session, regardless of activity. */
const ADMIN_MAX_SESSION_MS = 8 * 60 * 60 * 1000; // 8 hours

/** Maximum idle time before an admin session is forcibly expired. */
const ADMIN_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Attaches `req.user` / `req.isAuthenticated()` from the session so downstream
 * code (including the object-storage routes, which expect this shape) can
 * check authentication uniformly. Role/permission checks always happen here,
 * server-side — the client never gets to declare its own role.
 */
export function attachSessionUser(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const sessionUser = req.session.user;
  (req as Request & { user?: SessionUser }).user = sessionUser;
  (req as Request & { isAuthenticated: () => boolean }).isAuthenticated = () =>
    !!sessionUser;
  next();
}

/**
 * HIGH-07 — Admin-specific session lifetime enforcement.
 *
 * Enforces two independent limits on admin sessions that go beyond the global
 * rolling maxAge applied to all roles:
 *
 *  1. Absolute lifetime  — 8 hours from the moment of login, regardless of
 *     how actively the admin is using the system.
 *  2. Idle timeout       — 30 minutes of inactivity (no authenticated request).
 *
 * On each valid admin request this middleware also refreshes `lastSeenAt` so
 * the idle clock resets correctly. Non-admin sessions pass through untouched.
 *
 * Register this middleware AFTER `attachSessionUser` and BEFORE any routes.
 */
export function enforceAdminSessionLimits(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const user = req.session.user;

  // Only apply to authenticated admin sessions.
  if (!user || user.role !== "admin") {
    next();
    return;
  }

  const now = Date.now();

  // 1. Absolute lifetime: 8 hours from login.
  const loginAt = req.session.loginAt;
  if (loginAt !== undefined && now - loginAt > ADMIN_MAX_SESSION_MS) {
    req.session.destroy(() => {
      res.status(401).json({
        error:
          "Admin session has expired (8-hour maximum). Please log in again.\n" +
          "انتهت صلاحية جلسة المسؤول (الحد الأقصى 8 ساعات). يرجى تسجيل الدخول مجددًا.",
        code: "SESSION_EXPIRED_ABSOLUTE",
      });
    });
    return;
  }

  // 2. Idle timeout: 30 minutes of inactivity.
  const lastSeenAt = req.session.lastSeenAt;
  if (lastSeenAt !== undefined && now - lastSeenAt > ADMIN_IDLE_TIMEOUT_MS) {
    req.session.destroy(() => {
      res.status(401).json({
        error:
          "Admin session expired due to inactivity (30-minute idle limit). Please log in again.\n" +
          "انتهت صلاحية جلسة المسؤول بسبب عدم النشاط (30 دقيقة). يرجى تسجيل الدخول مجددًا.",
        code: "SESSION_EXPIRED_IDLE",
      });
    });
    return;
  }

  // Refresh the idle clock on every valid admin request.
  req.session.lastSeenAt = now;
  next();
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.session.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

export function requireRole(...roles: SessionUser["role"][]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.session.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!roles.includes(user.role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}

/**
 * Guards customer-only actions that create a verified contact record
 * (contact events, video-call requests). Always re-reads status fresh from
 * the DB — an admin may have suspended/deactivated this customer mid-session,
 * and the session itself never carries status.
 */
export async function requireActiveCustomer(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const sessionUser = req.session.user;
  if (!sessionUser) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (sessionUser.role !== "customer") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const [user] = await db
    .select({ status: usersTable.status, statusReason: usersTable.statusReason })
    .from(usersTable)
    .where(eq(usersTable.id, sessionUser.id));

  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (user.status === "suspended") {
    res.status(403).json({
      error: "Your account has been suspended and cannot contact offices.",
      reason: user.statusReason ?? null,
    });
    return;
  }
  if (user.status === "deactivated") {
    res.status(403).json({ error: "Your account has been deactivated." });
    return;
  }

  next();
}
