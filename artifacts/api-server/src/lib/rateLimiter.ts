import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";

/**
 * Auth rate limiting.
 *
 * Two independent layers protect /auth/login and /auth/register/*:
 *  1. Per-IP throttling (express-rate-limit, below) — catches scripted
 *     abuse from a single source without needing to know which account is
 *     being targeted.
 *  2. Per-account lockout (`accountLockout` below) — catches credential
 *     stuffing / brute force against one email spread across many IPs.
 *     Admin accounts get a stricter threshold and a longer lockout.
 *
 * Both are generous enough that a normal user mistyping a password a
 * couple of times, or a family sharing one IP, never gets blocked.
 *
 * Storage is in-memory (default express-rate-limit store / a plain Map).
 * That is fine for this single-instance pilot deployment; if the API server
 * is ever scaled to multiple instances, swap in a shared store (e.g. Redis)
 * so limits are enforced consistently across instances.
 */

function bilingual(ar: string, en: string): string {
  return `${ar}\n${en}`;
}

/**
 * Development-only rate-limit bypass.
 *
 * When NODE_ENV is NOT 'production' and the request carries the header
 *   `X-Smoke-Test: bypass`
 * all rate limiters are disabled for that request.
 *
 * This is intentionally inert in production (the condition short-circuits on
 * NODE_ENV === 'production') and is only used by the smoke test script to
 * avoid exhausting in-memory limits during a single test run.
 */
function skipForSmokeTest(req: Request): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    req.headers["x-smoke-test"] === "bypass"
  );
}

/** Per-IP limiter for login attempts. Generous — this is a backstop, not the primary defense (see accountLockout). */
export const loginIpLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipForSmokeTest,
  keyGenerator: (req: Request) => `login:ip:${ipKeyGenerator(req.ip ?? "")}`,
  handler: (_req, res) => {
    res.status(429).json({
      error: bilingual(
        "محاولات دخول كثيرة جدًا من هذا الجهاز. يرجى المحاولة مرة أخرى بعد بضع دقائق.",
        "Too many login attempts from this device. Please try again in a few minutes.",
      ),
    });
  },
});

/** Per-IP limiter for registration. Prevents scripted mass account creation. */
export const registerIpLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipForSmokeTest,
  keyGenerator: (req: Request) => `register:ip:${ipKeyGenerator(req.ip ?? "")}`,
  handler: (_req, res) => {
    res.status(429).json({
      error: bilingual(
        "محاولات إنشاء حساب كثيرة جدًا من هذا الجهاز. يرجى المحاولة مرة أخرى لاحقًا.",
        "Too many registration attempts from this device. Please try again later.",
      ),
    });
  },
});

type LockoutRole = "admin" | "office" | "customer" | undefined;

interface LockoutEntry {
  failures: number;
  windowStart: number;
  lockedUntil?: number;
}

const attemptsByEmail = new Map<string, LockoutEntry>();

// Standard accounts: 8 failed attempts in 15 minutes locks the *account*
// (not the IP) for 15 minutes. Admin accounts are held to a tighter
// threshold and a longer lockout, since they are the highest-value target.
const STANDARD_WINDOW_MS = 15 * 60_000;
const STANDARD_MAX_FAILURES = 8;
const STANDARD_LOCKOUT_MS = 15 * 60_000;

const ADMIN_WINDOW_MS = 15 * 60_000;
const ADMIN_MAX_FAILURES = 5;
const ADMIN_LOCKOUT_MS = 30 * 60_000;

function thresholdsFor(role: LockoutRole) {
  if (role === "admin") {
    return { windowMs: ADMIN_WINDOW_MS, maxFailures: ADMIN_MAX_FAILURES, lockoutMs: ADMIN_LOCKOUT_MS };
  }
  return { windowMs: STANDARD_WINDOW_MS, maxFailures: STANDARD_MAX_FAILURES, lockoutMs: STANDARD_LOCKOUT_MS };
}

// Periodically drop stale entries so this Map doesn't grow unbounded.
setInterval(
  () => {
    const now = Date.now();
    for (const [key, entry] of attemptsByEmail) {
      const stillLocked = entry.lockedUntil && entry.lockedUntil > now;
      const windowActive = now - entry.windowStart < ADMIN_WINDOW_MS;
      if (!stillLocked && !windowActive) attemptsByEmail.delete(key);
    }
  },
  10 * 60_000,
).unref();

export interface LockoutStatus {
  locked: boolean;
  retryAfterSeconds?: number;
}

/**
 * Checks whether `email` is currently locked out. Call this before doing
 * any password verification. `role`, if known from a prior lookup, selects
 * the admin-vs-standard threshold; pass undefined when the account's role
 * isn't known yet (e.g. before the DB lookup) — the stricter admin lockout
 * will still apply retroactively once `recordFailure` is called with the
 * real role.
 */
export function checkAccountLockout(email: string, role: LockoutRole = undefined): LockoutStatus {
  const entry = attemptsByEmail.get(email);
  if (!entry?.lockedUntil) return { locked: false };
  const now = Date.now();
  if (entry.lockedUntil <= now) return { locked: false };
  void role;
  return { locked: true, retryAfterSeconds: Math.ceil((entry.lockedUntil - now) / 1000) };
}

/** Records a failed login attempt for `email` and locks it out if the threshold is crossed. */
export function recordFailedLogin(email: string, role: LockoutRole = undefined): LockoutStatus {
  const now = Date.now();
  const { windowMs, maxFailures, lockoutMs } = thresholdsFor(role);
  const existing = attemptsByEmail.get(email);

  const entry: LockoutEntry =
    existing && now - existing.windowStart < windowMs
      ? existing
      : { failures: 0, windowStart: now };

  entry.failures += 1;
  if (entry.failures >= maxFailures) {
    entry.lockedUntil = now + lockoutMs;
  }
  attemptsByEmail.set(email, entry);

  if (entry.lockedUntil && entry.lockedUntil > now) {
    return { locked: true, retryAfterSeconds: Math.ceil((entry.lockedUntil - now) / 1000) };
  }
  return { locked: false };
}

/** Clears failure tracking for `email` after a successful login. */
export function clearLoginFailures(email: string): void {
  attemptsByEmail.delete(email);
}

export function lockoutMessage(): string {
  return bilingual(
    "تم إيقاف الدخول مؤقتًا بسبب محاولات فاشلة متكررة. يرجى المحاولة لاحقًا.",
    "Login has been temporarily locked due to repeated failed attempts. Please try again later.",
  );
}

export function invalidCredentialsMessage(): string {
  return bilingual("البريد الإلكتروني أو كلمة المرور غير صحيحة.", "Invalid email or password.");
}

// ---------------------------------------------------------------------------
// Password-reset rate limiters
// ---------------------------------------------------------------------------

/**
 * Per-IP limiter for /auth/forgot-password.
 * 15 requests per IP per hour — generous enough for normal use but blocks
 * scripted mass-enumeration attacks from a single source.
 */
export const forgotPasswordIpLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipForSmokeTest,
  keyGenerator: (req: Request) =>
    `forgot:ip:${ipKeyGenerator(req.ip ?? "")}`,
  handler: (_req, res) => {
    res.status(429).json({
      error: bilingual(
        "محاولات كثيرة جدًا. يرجى المحاولة مرة أخرى بعد ساعة.",
        "Too many requests. Please try again after an hour.",
      ),
    });
  },
});

/**
 * Per-email limiter for /auth/forgot-password.
 * 5 requests per email address per hour — prevents flooding one target
 * address with reset emails even if the requests come from different IPs.
 * Still returns a generic message regardless — limit is abuse-prevention
 * only, not email-existence disclosure.
 */
export const forgotPasswordEmailLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipForSmokeTest,
  keyGenerator: (req: Request) => {
    const rawEmail =
      typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    // Fall back to IP if email is missing/invalid so the limiter still works.
    return rawEmail
      ? `forgot:email:${rawEmail}`
      : `forgot:ip_fallback:${ipKeyGenerator(req.ip ?? "")}`;
  },
  handler: (_req, res) => {
    // Generic 429 — does not reveal whether the email has an account.
    res.status(429).json({
      error: bilingual(
        "محاولات كثيرة جدًا. يرجى المحاولة مرة أخرى بعد ساعة.",
        "Too many requests. Please try again after an hour.",
      ),
    });
  },
});

/**
 * MED-06: Per-IP limiter for signed upload-URL generation.
 *
 * Without a limit, any authenticated user can call POST /storage/uploads/request-url
 * in a tight loop, minting arbitrarily many signed GCS URLs and burning
 * storage quota at no cost.  20 requests per minute is generous for normal
 * use (a full office profile rarely has more than ~10 assets) while still
 * providing a practical ceiling.
 */
export const uploadUrlLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipForSmokeTest,
  keyGenerator: (req: Request) =>
    `upload-url:ip:${ipKeyGenerator(req.ip ?? "")}`,
  handler: (_req, res) => {
    res.status(429).json({
      error: bilingual(
        "طلبات رفع كثيرة جدًا. يرجى المحاولة لاحقًا.",
        "Too many upload-URL requests. Please try again later.",
      ),
    });
  },
});

/**
 * Per-IP limiter for the authenticated same-origin upload relay. This is
 * separate from uploadUrlLimiter because one successful file uses both
 * endpoints and should not consume the URL-issuance budget twice.
 */
export const directUploadLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipForSmokeTest,
  keyGenerator: (req: Request) =>
    `direct-upload:ip:${ipKeyGenerator(req.ip ?? "")}`,
  handler: (_req, res) => {
    res.status(429).json({
      error: bilingual(
        "محاولات رفع كثيرة جدًا. يرجى الانتظار دقيقة ثم المحاولة مرة أخرى.",
        "Too many upload attempts. Please wait a minute and try again.",
      ),
    });
  },
});

/**
 * Per-user limiter for /auth/change-password.
 *
 * Keyed by the authenticated user's ID (available because requireAuth runs
 * before this middleware) so the limit is per-account rather than per-IP.
 * Admin accounts are the highest-value target, so the window is strict:
 * 5 attempts per 15 minutes before a 429 is returned.
 */
export const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipForSmokeTest,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  keyGenerator: (req: Request) => {
    const userId = (req.session as any)?.user?.id;
    return userId
      ? `change-pw:user:${userId}`
      : `change-pw:ip:${ipKeyGenerator(req.ip ?? "")}`;
  },
  handler: (_req, res) => {
    res.status(429).json({
      error: bilingual(
        "محاولات كثيرة جدًا لتغيير كلمة المرور. يرجى المحاولة بعد 15 دقيقة.",
        "Too many password-change attempts. Please try again in 15 minutes.",
      ),
    });
  },
});

/**
 * Per-IP limiter for /auth/reset-password.
 * Strict: 10 requests per IP per 15 minutes.
 * Token-verification bruteforce is the primary threat here — even 1 in 10
 * would be a significant fraction of the 32-byte token space over any
 * useful time window, so this is defense-in-depth alongside the DB expiry.
 */
export const resetConfirmIpLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipForSmokeTest,
  keyGenerator: (req: Request) =>
    `reset:ip:${ipKeyGenerator(req.ip ?? "")}`,
  handler: (_req, res) => {
    res.status(429).json({
      error: bilingual(
        "محاولات كثيرة جدًا. يرجى المحاولة مرة أخرى بعد قليل.",
        "Too many requests. Please try again shortly.",
      ),
    });
  },
});

/**
 * Per-IP limiter for the analytics event ingestion endpoint.
 *
 * Prevents a single client from flooding the analytics DB. Generous limit
 * (120 per minute = 2/second) since the frontend batches events and sends
 * them infrequently.
 *
 * Returns 204 instead of 429 — analytics failures must never surface as
 * errors to the user; excess events are silently dropped.
 */
export const analyticsIpLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: false,
  legacyHeaders: false,
  skip: skipForSmokeTest,
  keyGenerator: (req: Request) => `analytics:ip:${ipKeyGenerator(req.ip ?? "")}`,
  handler: (_req, res) => {
    // Silent 204 — analytics events are fire-and-forget, never block UX
    res.sendStatus(204);
  },
});
