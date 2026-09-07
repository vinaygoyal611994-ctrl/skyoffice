/**
 * Tests for POST /auth/change-password (admin-only).
 *
 * Covers:
 *  1. Unauthenticated request → 401
 *  2. Wrong role (office) → 403
 *  3. Missing / invalid body → 400 VALIDATION_ERROR
 *  4. Weak new password → 400 VALIDATION_ERROR
 *  5. Mismatched confirmPassword → 400 PASSWORD_MISMATCH
 *  6. Wrong current password → 401 WRONG_CURRENT_PASSWORD + audit logged
 *  7. Successful change → 204 + sessions invalidated + audit logged
 *  8. Rate-limited path → 429
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoist mock factories (vi.mock() is hoisted before imports)
// ---------------------------------------------------------------------------

const {
  mockDb,
  mockVerifyPassword,
  mockHashPassword,
  mockRecordAuditLog,
  mockInvalidateAllSessions,
  mockChangePasswordLimiter,
} = vi.hoisted(() => {
  return {
    mockDb: {
      select: vi.fn(),
      update: vi.fn(),
    },
    mockVerifyPassword: vi.fn(),
    mockHashPassword: vi.fn().mockResolvedValue("$hashed_new"),
    mockRecordAuditLog: vi.fn().mockResolvedValue(undefined),
    mockInvalidateAllSessions: vi.fn().mockResolvedValue(3),
    // Default: pass through (not rate-limited)
    mockChangePasswordLimiter: vi.fn(
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
}));

vi.mock("../../lib/auth", () => ({
  verifyPassword: mockVerifyPassword,
  hashPassword: mockHashPassword,
  findUserByEmail: vi.fn(),
  toAuthUser: vi.fn(),
}));

vi.mock("../../lib/auditLog", () => ({
  recordAuditLog: mockRecordAuditLog,
}));

vi.mock("../../lib/sessionInvalidate", () => ({
  invalidateAllSessions: mockInvalidateAllSessions,
}));

vi.mock("../../lib/rateLimiter", () => ({
  loginIpLimiter: (_: unknown, __: unknown, next: NextFunction) => next(),
  registerIpLimiter: (_: unknown, __: unknown, next: NextFunction) => next(),
  checkAccountLockout: () => ({ locked: false }),
  recordFailedLogin: () => ({ locked: false }),
  clearLoginFailures: vi.fn(),
  lockoutMessage: () => "Too many attempts",
  invalidCredentialsMessage: () => "Invalid credentials",
  changePasswordLimiter: (req: unknown, res: unknown, next: NextFunction) =>
    mockChangePasswordLimiter(req, res, next),
}));

vi.mock("../../lib/slug", () => ({
  generateUniqueOfficeSlug: vi.fn().mockResolvedValue("slug"),
  slugify: vi.fn((s: string) => s),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ADMIN_USER = {
  id: 1,
  role: "admin" as const,
  name: "Platform Admin",
  email: "admin@skayoffice.demo",
  passwordHash: "$2b$10$existing_hash",
  status: "active" as const,
  statusReason: null,
  createdAt: new Date("2026-01-01"),
};

const VALID_BODY = {
  currentPassword: "OldPass123",
  newPassword:     "NewPass456",
  confirmPassword: "NewPass456",
};

// ---------------------------------------------------------------------------
// Helper: mock the drizzle select chain for DB user lookup
// ---------------------------------------------------------------------------

function mockUserLookup(user: typeof ADMIN_USER | null) {
  mockDb.select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(user ? [user] : []),
    }),
  });
}

function mockUserUpdate() {
  mockDb.update.mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  });
}

// ---------------------------------------------------------------------------
// Test app factory — inject session per test via a middleware override
// ---------------------------------------------------------------------------

let app: express.Express;

/** Session state shared between the per-test session injector and each test. */
let currentSession: {
  user: { id: number; role: string } | null;
  destroyed: boolean;
};

beforeAll(async () => {
  const { default: authRouter } = await import("../auth");

  app = express();
  app.use(express.json());

  // Inject a controllable session on every request.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const session: Record<string, unknown> & {
      regenerate: (cb: (err?: unknown) => void) => void;
      save: (cb: (err?: unknown) => void) => void;
      destroy: (cb?: (err?: unknown) => void) => void;
    } = {
      get user() { return currentSession.user; },
      set user(v) { currentSession.user = v as typeof currentSession.user; },
      loginAt: Date.now(),
      lastSeenAt: Date.now(),
      regenerate(cb) { cb(); },
      save(cb) { cb(); },
      destroy(cb) {
        currentSession.destroyed = true;
        cb?.();
      },
    };

    Object.defineProperty(req, "session", {
      value: session,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(req, "sessionID", {
      get: () => "test-sid",
      configurable: true,
    });
    next();
  });

  app.use(authRouter);
});

beforeEach(() => {
  vi.clearAllMocks();

  // Default session: authenticated admin
  currentSession = { user: { id: 1, role: "admin" }, destroyed: false };

  // Default: change-password limiter passes
  mockChangePasswordLimiter.mockImplementation(
    (_req: unknown, _res: unknown, next: NextFunction) => next(),
  );

  // Default: new-password hash succeeds
  mockHashPassword.mockResolvedValue("$hashed_new");
  mockRecordAuditLog.mockResolvedValue(undefined);
  mockInvalidateAllSessions.mockResolvedValue(3);

  // Default: verifyPassword succeeds (individual tests override as needed)
  mockVerifyPassword.mockResolvedValue(true);

  mockUserLookup(ADMIN_USER);
  mockUserUpdate();
});

// ===========================================================================
// Auth guards
// ===========================================================================

describe("POST /auth/change-password — auth guards", () => {
  it("returns 401 when not authenticated", async () => {
    currentSession.user = null;

    const res = await request(app)
      .post("/auth/change-password")
      .send(VALID_BODY);

    expect(res.status).toBe(401);
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("returns 403 when authenticated as office role", async () => {
    currentSession.user = { id: 99, role: "office" };

    const res = await request(app)
      .post("/auth/change-password")
      .send(VALID_BODY);

    expect(res.status).toBe(403);
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("returns 403 when authenticated as customer role", async () => {
    currentSession.user = { id: 42, role: "customer" };

    const res = await request(app)
      .post("/auth/change-password")
      .send(VALID_BODY);

    expect(res.status).toBe(403);
    expect(mockDb.select).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Input validation
// ===========================================================================

describe("POST /auth/change-password — input validation", () => {
  it("returns 400 when currentPassword is missing", async () => {
    const { currentPassword: _omit, ...body } = VALID_BODY;

    const res = await request(app).post("/auth/change-password").send(body);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("returns 400 when newPassword is missing", async () => {
    const { newPassword: _omit, ...body } = VALID_BODY;

    const res = await request(app).post("/auth/change-password").send(body);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when newPassword is too short (< 8 chars)", async () => {
    const res = await request(app)
      .post("/auth/change-password")
      .send({ ...VALID_BODY, newPassword: "Ab1", confirmPassword: "Ab1" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.error).toMatch(/8 character/i);
  });

  it("returns 400 when newPassword has no letter", async () => {
    const res = await request(app)
      .post("/auth/change-password")
      .send({ ...VALID_BODY, newPassword: "12345678", confirmPassword: "12345678" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.error).toMatch(/letter/i);
  });

  it("returns 400 when newPassword has no number", async () => {
    const res = await request(app)
      .post("/auth/change-password")
      .send({ ...VALID_BODY, newPassword: "NoNumbers!", confirmPassword: "NoNumbers!" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.error).toMatch(/number/i);
  });

  it("returns 400 when confirmPassword does not match newPassword", async () => {
    const res = await request(app)
      .post("/auth/change-password")
      .send({ ...VALID_BODY, confirmPassword: "DifferentPass99" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PASSWORD_MISMATCH");
    // No DB access before mismatch check
    expect(mockDb.select).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Wrong current password
// ===========================================================================

describe("POST /auth/change-password — wrong current password", () => {
  it("returns 401 and writes a failure audit log when currentPassword is wrong", async () => {
    mockVerifyPassword.mockResolvedValue(false);

    const res = await request(app)
      .post("/auth/change-password")
      .send(VALID_BODY);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("WRONG_CURRENT_PASSWORD");

    // Must NOT update the password
    expect(mockHashPassword).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();

    // Must audit the failed attempt
    expect(mockRecordAuditLog).toHaveBeenCalledOnce();
    const [entry] = mockRecordAuditLog.mock.calls[0];
    expect(entry.action).toBe("auth.change_password_failed_wrong_current");
    expect(entry.targetId).toBe(1);
  });

  it("does not invalidate sessions on a failed attempt", async () => {
    mockVerifyPassword.mockResolvedValue(false);

    await request(app).post("/auth/change-password").send(VALID_BODY);

    expect(mockInvalidateAllSessions).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Successful password change
// ===========================================================================

describe("POST /auth/change-password — successful update", () => {
  it("returns 204 on a valid request", async () => {
    const res = await request(app)
      .post("/auth/change-password")
      .send(VALID_BODY);

    expect(res.status).toBe(204);
  });

  it("hashes the new password before writing to the DB", async () => {
    await request(app).post("/auth/change-password").send(VALID_BODY);

    expect(mockHashPassword).toHaveBeenCalledOnce();
    const [plaintext] = mockHashPassword.mock.calls[0];
    // Never log or expose the plaintext in assertions — just confirm it was called
    expect(typeof plaintext).toBe("string");
    expect(plaintext).not.toBe(ADMIN_USER.passwordHash);
  });

  it("invalidates all sessions after a successful change", async () => {
    await request(app).post("/auth/change-password").send(VALID_BODY);

    expect(mockInvalidateAllSessions).toHaveBeenCalledOnce();
    const [userId] = mockInvalidateAllSessions.mock.calls[0];
    expect(userId).toBe(1);
  });

  it("destroys the current in-memory session after a successful change", async () => {
    await request(app).post("/auth/change-password").send(VALID_BODY);

    expect(currentSession.destroyed).toBe(true);
  });

  it("writes a success audit log with the correct action and target", async () => {
    await request(app).post("/auth/change-password").send(VALID_BODY);

    expect(mockRecordAuditLog).toHaveBeenCalledOnce();
    const [entry] = mockRecordAuditLog.mock.calls[0];
    expect(entry.action).toBe("auth.password_changed");
    expect(entry.targetType).toBe("user");
    expect(entry.targetId).toBe(1);
    // Must NOT include any password or hash in metadata
    expect(JSON.stringify(entry.metadata ?? {})).not.toMatch(/password|hash/i);
  });

  it("does not expose any password or hash in the response body", async () => {
    const res = await request(app)
      .post("/auth/change-password")
      .send(VALID_BODY);

    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
    // Ensure the response text contains no hash-like or password-like strings
    expect(res.text).not.toMatch(/\$2[ab]\$|\bpassword\b|\bhash\b/i);
  });
});

// ===========================================================================
// Rate limiting
// ===========================================================================

describe("POST /auth/change-password — rate limiting", () => {
  it("returns 429 when the change-password rate limiter fires", async () => {
    mockChangePasswordLimiter.mockImplementation(
      (_req: unknown, res: Response) => {
        res.status(429).json({ error: "Too many password-change attempts." });
      },
    );

    const res = await request(app)
      .post("/auth/change-password")
      .send(VALID_BODY);

    expect(res.status).toBe(429);
    expect(mockDb.select).not.toHaveBeenCalled();
  });
});
