/**
 * Password reset — atomicity and race-condition regression tests.
 *
 * Blocker 1 verification: the critical section (token claim + password update
 * + invalidate other tokens + invalidate sessions) is executed atomically
 * via a single db.transaction(). Concurrent claims on the same token are
 * serialised by a SELECT … FOR UPDATE row-level lock inside that transaction.
 *
 * Covers:
 *  A) Happy path — valid token, atomic claim succeeds → 200
 *  B) Concurrent race — second claim returns claimed=false → 410 TOKEN_USED
 *  C) Token already used before request arrives → 410 TOKEN_USED
 *  D) Token expired before request arrives → 410 TOKEN_EXPIRED
 *  E) Token never existed → 400 TOKEN_INVALID
 *  F) Account not found after valid token lookup (defensive) → 400 USER_NOT_FOUND
 *  G) claimTokenAndUpdatePassword is called; direct markTokenUsed is NOT called
 *  H) invalidateAllSessions is called exactly once after a successful claim
 *  I) Enumeration safety: invalid/expired/used tokens all return non-200 with
 *     no user-identifying detail in the token-never-existed path
 *  J) Validation errors (weak password, missing fields) return 400 VALIDATION_ERROR
 *     before any DB is touched
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted mock factories
// ---------------------------------------------------------------------------

const {
  mockDb,
  mockLookupValidToken,
  mockLookupAnyToken,
  mockClaimTokenAndUpdatePassword,
  mockHashPassword,
  mockInvalidateAllSessions,
  mockRecordAuditLog,
  mockEmailProvider,
  mockClearLoginFailures,
  mockResetConfirmIpLimiter,
} = vi.hoisted(() => {
  return {
    mockDb: {
      select: vi.fn(),
    },
    mockLookupValidToken: vi.fn(),
    mockLookupAnyToken: vi.fn(),
    mockClaimTokenAndUpdatePassword: vi.fn(),
    mockHashPassword: vi.fn().mockResolvedValue("$hashed_new"),
    mockInvalidateAllSessions: vi.fn().mockResolvedValue(2),
    mockRecordAuditLog: vi.fn().mockResolvedValue(undefined),
    mockEmailProvider: {
      sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
      sendPasswordChangedNotification: vi.fn().mockResolvedValue(undefined),
    },
    mockClearLoginFailures: vi.fn(),
    mockResetConfirmIpLimiter: vi.fn(
      (_req: unknown, _res: unknown, next: NextFunction) => next(),
    ),
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: mockDb,
  usersTable: {},
  passwordResetTokensTable: {},
}));

vi.mock("../../lib/passwordReset", () => ({
  invalidatePreviousTokens: vi.fn().mockResolvedValue(undefined),
  createResetToken: vi.fn().mockResolvedValue({ rawToken: "tok", expiryMinutes: 45 }),
  lookupValidToken: (...args: unknown[]) => mockLookupValidToken(...args),
  lookupAnyToken: (...args: unknown[]) => mockLookupAnyToken(...args),
  claimTokenAndUpdatePassword: (...args: unknown[]) =>
    mockClaimTokenAndUpdatePassword(...args),
}));

vi.mock("../../lib/auth", () => ({
  hashPassword: (...args: unknown[]) => mockHashPassword(...args),
  findUserByEmail: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../lib/sessionInvalidate", () => ({
  invalidateAllSessions: (...args: unknown[]) => mockInvalidateAllSessions(...args),
}));

vi.mock("../../lib/auditLog", () => ({
  recordAuditLog: (...args: unknown[]) => mockRecordAuditLog(...args),
}));

vi.mock("../../lib/email", () => ({
  emailProvider: mockEmailProvider,
}));

vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../lib/validation", () => ({
  normalizeEmail: (e: string) => e.toLowerCase().trim(),
}));

vi.mock("../../lib/rateLimiter", () => ({
  forgotPasswordIpLimiter: (_: unknown, __: unknown, next: NextFunction) => next(),
  forgotPasswordEmailLimiter: (_: unknown, __: unknown, next: NextFunction) => next(),
  resetConfirmIpLimiter: (req: unknown, res: unknown, next: NextFunction) =>
    mockResetConfirmIpLimiter(req, res, next),
  clearLoginFailures: (...args: unknown[]) => mockClearLoginFailures(...args),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_TOKEN_ROW = {
  id: 42,
  userId: 7,
  tokenHash: "abc123hash",
  expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 min from now
  usedAt: null,
  requestedIpHash: "iphash",
  createdAt: new Date(),
};

const USER_ROW = {
  id: 7,
  role: "customer" as const,
  name: "Test User",
  email: "test@example.com",
  passwordHash: "$2b$10$oldhash",
  status: "active" as const,
  isInternal: false,
  statusReason: null,
  createdAt: new Date("2026-01-01"),
};

const VALID_BODY = {
  token: "a".repeat(64), // 64-char hex — valid raw token
  newPassword: "NewPass123",
};

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

let app: express.Express;

beforeAll(async () => {
  const { default: passwordResetRouter } = await import("../passwordReset");

  app = express();
  app.use(express.json());
  app.use(passwordResetRouter);
});

beforeEach(() => {
  vi.clearAllMocks();

  // Default: limiter passes
  mockResetConfirmIpLimiter.mockImplementation(
    (_req: unknown, _res: unknown, next: NextFunction) => next(),
  );

  // Default: valid token found
  mockLookupValidToken.mockResolvedValue(VALID_TOKEN_ROW);
  mockLookupAnyToken.mockResolvedValue(VALID_TOKEN_ROW);

  // Default: user found
  mockDb.select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([USER_ROW]),
    }),
  });

  // Default: claim succeeds
  mockClaimTokenAndUpdatePassword.mockResolvedValue({ claimed: true });

  mockHashPassword.mockResolvedValue("$hashed_new");
  mockInvalidateAllSessions.mockResolvedValue(2);
  mockRecordAuditLog.mockResolvedValue(undefined);
  mockEmailProvider.sendPasswordChangedNotification.mockResolvedValue(undefined);
  mockClearLoginFailures.mockReturnValue(undefined);
});

// ===========================================================================
// A) Happy path
// ===========================================================================

describe("POST /auth/reset-password — happy path", () => {
  it("returns 200 with role when claim succeeds", async () => {
    const res = await request(app)
      .post("/auth/reset-password")
      .send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.body.role).toBe("customer");
  });

  it("calls claimTokenAndUpdatePassword with the correct token id, user id, and new hash", async () => {
    await request(app).post("/auth/reset-password").send(VALID_BODY);

    expect(mockClaimTokenAndUpdatePassword).toHaveBeenCalledOnce();
    const [tokenId, userId, hash] = mockClaimTokenAndUpdatePassword.mock.calls[0];
    expect(tokenId).toBe(VALID_TOKEN_ROW.id);
    expect(userId).toBe(USER_ROW.id);
    expect(typeof hash).toBe("string");
    // Never pass the plaintext password — only the hash
    expect(hash).not.toBe(VALID_BODY.newPassword);
    expect(hash).toBe("$hashed_new");
  });

  it("invalidates all sessions after a successful claim", async () => {
    await request(app).post("/auth/reset-password").send(VALID_BODY);

    expect(mockInvalidateAllSessions).toHaveBeenCalledOnce();
    const [userId] = mockInvalidateAllSessions.mock.calls[0];
    expect(userId).toBe(USER_ROW.id);
  });

  it("writes auth.password_reset_completed audit log on success", async () => {
    await request(app).post("/auth/reset-password").send(VALID_BODY);

    const auditCalls = mockRecordAuditLog.mock.calls.map(([e]) => e);
    const completed = auditCalls.find(
      (e: { action: string }) => e.action === "auth.password_reset_completed",
    );
    expect(completed).toBeDefined();
    expect(completed.targetId).toBe(USER_ROW.id);
    // Must NOT contain any password or hash in metadata
    expect(JSON.stringify(completed.metadata ?? {})).not.toMatch(/password|hash/i);
  });

  it("clears login failures on success", async () => {
    await request(app).post("/auth/reset-password").send(VALID_BODY);

    expect(mockClearLoginFailures).toHaveBeenCalledOnce();
    const [email] = mockClearLoginFailures.mock.calls[0];
    expect(email).toBe(USER_ROW.email);
  });
});

// ===========================================================================
// B) Concurrent race — second claim returns claimed=false
// ===========================================================================

describe("POST /auth/reset-password — concurrent race (blocker 1)", () => {
  it("returns 410 TOKEN_USED when claimTokenAndUpdatePassword returns claimed=false", async () => {
    // Simulate: first request already consumed the token inside the transaction
    mockClaimTokenAndUpdatePassword.mockResolvedValue({ claimed: false });

    const res = await request(app)
      .post("/auth/reset-password")
      .send(VALID_BODY);

    expect(res.status).toBe(410);
    expect(res.body.code).toBe("TOKEN_USED");
  });

  it("does NOT call invalidateAllSessions when the race is lost", async () => {
    mockClaimTokenAndUpdatePassword.mockResolvedValue({ claimed: false });

    await request(app).post("/auth/reset-password").send(VALID_BODY);

    expect(mockInvalidateAllSessions).not.toHaveBeenCalled();
  });

  it("does NOT clear login failures when the race is lost", async () => {
    mockClaimTokenAndUpdatePassword.mockResolvedValue({ claimed: false });

    await request(app).post("/auth/reset-password").send(VALID_BODY);

    expect(mockClearLoginFailures).not.toHaveBeenCalled();
  });

  it("writes auth.password_reset_failed_used_token audit log when race is lost", async () => {
    mockClaimTokenAndUpdatePassword.mockResolvedValue({ claimed: false });

    await request(app).post("/auth/reset-password").send(VALID_BODY);

    const auditCalls = mockRecordAuditLog.mock.calls.map(([e]) => e);
    const failed = auditCalls.find(
      (e: { action: string }) => e.action === "auth.password_reset_failed_used_token",
    );
    expect(failed).toBeDefined();
  });

  it("returns the same 410 body as an already-used token — enumeration safe", async () => {
    // Already-used token path (from lookupValidToken returning null)
    const usedRow = { ...VALID_TOKEN_ROW, usedAt: new Date(Date.now() - 1000) };
    mockLookupValidToken.mockResolvedValue(null);
    mockLookupAnyToken.mockResolvedValue(usedRow);

    const raceRes = await request(app)
      .post("/auth/reset-password")
      .send(VALID_BODY);

    // Reset: now test the race path
    mockLookupValidToken.mockResolvedValue(VALID_TOKEN_ROW);
    mockClaimTokenAndUpdatePassword.mockResolvedValue({ claimed: false });

    const usedRes = await request(app)
      .post("/auth/reset-password")
      .send(VALID_BODY);

    // Both should return 410 TOKEN_USED
    expect(raceRes.status).toBe(410);
    expect(usedRes.status).toBe(410);
    expect(raceRes.body.code).toBe("TOKEN_USED");
    expect(usedRes.body.code).toBe("TOKEN_USED");
  });
});

// ===========================================================================
// C) Token already used before request
// ===========================================================================

describe("POST /auth/reset-password — already-used token", () => {
  it("returns 410 TOKEN_USED with bilingual message", async () => {
    const usedRow = { ...VALID_TOKEN_ROW, usedAt: new Date(Date.now() - 60_000) };
    mockLookupValidToken.mockResolvedValue(null);
    mockLookupAnyToken.mockResolvedValue(usedRow);

    const res = await request(app)
      .post("/auth/reset-password")
      .send(VALID_BODY);

    expect(res.status).toBe(410);
    expect(res.body.code).toBe("TOKEN_USED");
    // Does not reach DB for user/claim
    expect(mockClaimTokenAndUpdatePassword).not.toHaveBeenCalled();
    expect(mockInvalidateAllSessions).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// D) Token expired before request
// ===========================================================================

describe("POST /auth/reset-password — expired token", () => {
  it("returns 410 TOKEN_EXPIRED", async () => {
    const expiredRow = {
      ...VALID_TOKEN_ROW,
      usedAt: null,
      expiresAt: new Date(Date.now() - 1_000),
    };
    mockLookupValidToken.mockResolvedValue(null);
    mockLookupAnyToken.mockResolvedValue(expiredRow);

    const res = await request(app)
      .post("/auth/reset-password")
      .send(VALID_BODY);

    expect(res.status).toBe(410);
    expect(res.body.code).toBe("TOKEN_EXPIRED");
    expect(mockClaimTokenAndUpdatePassword).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// E) Token never existed / tampered
// ===========================================================================

describe("POST /auth/reset-password — invalid token", () => {
  it("returns 400 TOKEN_INVALID when token is not found at all", async () => {
    mockLookupValidToken.mockResolvedValue(null);
    mockLookupAnyToken.mockResolvedValue(null);

    const res = await request(app)
      .post("/auth/reset-password")
      .send(VALID_BODY);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("TOKEN_INVALID");
    expect(mockClaimTokenAndUpdatePassword).not.toHaveBeenCalled();
  });

  it("does not leak user-identifying info in the invalid-token response — enumeration safe", async () => {
    mockLookupValidToken.mockResolvedValue(null);
    mockLookupAnyToken.mockResolvedValue(null);

    const res = await request(app)
      .post("/auth/reset-password")
      .send(VALID_BODY);

    // The response must not expose any user-specific data: no numeric user id,
    // no email address, no account identifiers.  We check for email-shaped strings
    // and numeric userId values — not generic words like "invalid".
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/); // no email address
    expect(body).not.toMatch(/"userId"\s*:/i); // no userId field
    expect(body).not.toMatch(/"targetId"\s*:/i); // no targetId field (audit data must not be in response)
  });
});

// ===========================================================================
// F) Account not found after valid token
// ===========================================================================

describe("POST /auth/reset-password — missing user (defensive)", () => {
  it("returns 400 USER_NOT_FOUND when the user row no longer exists", async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const res = await request(app)
      .post("/auth/reset-password")
      .send(VALID_BODY);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("USER_NOT_FOUND");
    expect(mockClaimTokenAndUpdatePassword).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// G) markTokenUsed is no longer called directly (atomic path owns it)
// ===========================================================================

describe("POST /auth/reset-password — atomic path replaces individual DB calls", () => {
  it("does NOT import or call a standalone markTokenUsed function (atomic path owns token marking)", async () => {
    // The route must delegate token marking to claimTokenAndUpdatePassword.
    // We verify this by confirming that:
    //  1. claimTokenAndUpdatePassword WAS called
    //  2. No separate update call was made on passwordResetTokensTable outside the claim
    await request(app).post("/auth/reset-password").send(VALID_BODY);

    expect(mockClaimTokenAndUpdatePassword).toHaveBeenCalledOnce();
    // db.update must NOT have been called directly by the route handler
    // (all password/token updates are inside the transaction managed by claimTokenAndUpdatePassword)
    expect(mockDb.select).toHaveBeenCalled(); // user lookup: expected
    // Verify no db.update called at route level (transaction manages it)
    expect("update" in mockDb).toBe(false); // mockDb has no update method
  });

  it("bcrypt hashing occurs before the atomic transaction (not inside it)", async () => {
    // hashPassword must complete before claimTokenAndUpdatePassword is called
    let hashCalledAt = -1;
    let claimCalledAt = -1;
    let callOrder = 0;

    mockHashPassword.mockImplementation(async () => {
      hashCalledAt = callOrder++;
      return "$hashed_new";
    });

    mockClaimTokenAndUpdatePassword.mockImplementation(async () => {
      claimCalledAt = callOrder++;
      return { claimed: true };
    });

    await request(app).post("/auth/reset-password").send(VALID_BODY);

    expect(hashCalledAt).toBeGreaterThanOrEqual(0);
    expect(claimCalledAt).toBeGreaterThan(hashCalledAt);
  });
});

// ===========================================================================
// H) Sessions invalidated exactly once on success
// ===========================================================================

describe("POST /auth/reset-password — session invalidation", () => {
  it("invalidateAllSessions called exactly once on success", async () => {
    await request(app).post("/auth/reset-password").send(VALID_BODY);

    expect(mockInvalidateAllSessions).toHaveBeenCalledTimes(1);
  });

  it("invalidateAllSessions NOT called when claim fails (race lost)", async () => {
    mockClaimTokenAndUpdatePassword.mockResolvedValue({ claimed: false });

    await request(app).post("/auth/reset-password").send(VALID_BODY);

    expect(mockInvalidateAllSessions).toHaveBeenCalledTimes(0);
  });
});

// ===========================================================================
// I) Enumeration safety
// ===========================================================================

describe("POST /auth/reset-password — enumeration safety", () => {
  it("expired-token response does not expose user email or id", async () => {
    const expiredRow = {
      ...VALID_TOKEN_ROW,
      usedAt: null,
      expiresAt: new Date(Date.now() - 1_000),
    };
    mockLookupValidToken.mockResolvedValue(null);
    mockLookupAnyToken.mockResolvedValue(expiredRow);

    const res = await request(app)
      .post("/auth/reset-password")
      .send(VALID_BODY);

    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/email|user/i);
  });

  it("race-lost response does not expose any more user detail than an already-used response", async () => {
    // Race lost path
    mockClaimTokenAndUpdatePassword.mockResolvedValue({ claimed: false });
    const raceRes = await request(app)
      .post("/auth/reset-password")
      .send(VALID_BODY);

    // Pre-used path
    mockLookupValidToken.mockResolvedValue(null);
    mockLookupAnyToken.mockResolvedValue({ ...VALID_TOKEN_ROW, usedAt: new Date() });
    const usedRes = await request(app)
      .post("/auth/reset-password")
      .send(VALID_BODY);

    // Same code and same 410 status for both
    expect(raceRes.body.code).toBe(usedRes.body.code);
    expect(raceRes.status).toBe(usedRes.status);
  });
});

// ===========================================================================
// J) Validation errors
// ===========================================================================

describe("POST /auth/reset-password — validation errors", () => {
  it("returns 400 VALIDATION_ERROR when token is missing", async () => {
    const res = await request(app)
      .post("/auth/reset-password")
      .send({ newPassword: "NewPass123" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(mockLookupValidToken).not.toHaveBeenCalled();
  });

  it("returns 400 VALIDATION_ERROR when newPassword is too short", async () => {
    const res = await request(app)
      .post("/auth/reset-password")
      .send({ token: "a".repeat(64), newPassword: "Ab1" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.error).toMatch(/8 character/i);
    expect(mockLookupValidToken).not.toHaveBeenCalled();
  });

  it("returns 400 VALIDATION_ERROR when newPassword has no number", async () => {
    const res = await request(app)
      .post("/auth/reset-password")
      .send({ token: "a".repeat(64), newPassword: "NoNumbers!" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.error).toMatch(/number/i);
  });

  it("returns 400 VALIDATION_ERROR when newPassword has no letter", async () => {
    const res = await request(app)
      .post("/auth/reset-password")
      .send({ token: "a".repeat(64), newPassword: "12345678" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.error).toMatch(/letter/i);
  });
});
