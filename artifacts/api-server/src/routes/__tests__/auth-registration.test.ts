/**
 * CRIT-01: Automated tests for atomic registration.
 *
 * All external database calls are mocked — these tests run without a real
 * database. They verify:
 *
 *  1. Every DB write goes through a single db.transaction() call (no writes
 *     outside the transaction boundary).
 *  2. A failure anywhere inside the transaction propagates correctly (the
 *     handler returns an appropriate HTTP error; no partial writes committed).
 *  3. Postgres unique-constraint errors (code 23505) produce 409, not 500.
 *  4. A concurrent registration that slips past the application-level pre-check
 *     and hits the DB constraint still produces 409.
 *  5. Successful customer and office registrations return 201 with the correct
 *     shape and a sessionToken.
 *  6. Validation errors (missing fields, terms not accepted) return 400 without
 *     touching the database.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoist mock factories so vi.mock closures can reference them.
// vi.mock() calls are hoisted to the top of the compiled module; plain `const`
// declarations are not. vi.hoisted() runs before module imports resolve and
// returns values that are safe to reference inside vi.mock() factories.
// ---------------------------------------------------------------------------

const {
  mockDb,
  mockTx,
  mockHashPassword,
  mockFindUserByEmail,
  mockToAuthUser,
  mockRecordAuditLog,
  mockGenerateSlug,
} = vi.hoisted(() => {
  const tx = {
    insert: vi.fn(),
    select: vi.fn(),
  };

  const dbObj = {
    // transaction() runs the callback by default; individual tests override
    // this to simulate failures.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transaction: vi.fn(async <T>(cb: (tx: any) => Promise<T>): Promise<T> => cb(tx)),
    // These should NOT be called during registration — all writes go through tx.
    insert: vi.fn(),
    select: vi.fn(),
  };

  return {
    mockDb: dbObj,
    mockTx: tx,
    mockHashPassword: vi.fn().mockResolvedValue("$hashed"),
    mockFindUserByEmail: vi.fn().mockResolvedValue(null),
    mockToAuthUser: vi.fn(),
    mockRecordAuditLog: vi.fn().mockResolvedValue(undefined),
    mockGenerateSlug: vi.fn().mockResolvedValue("test-office-corp"),
  };
});

// ---------------------------------------------------------------------------
// Module mocks — declared before any import so they are hoisted correctly.
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: mockDb,
  usersTable: {},
  officesTable: {},
  auditLogTable: {},
}));

vi.mock("../../lib/auth", () => ({
  hashPassword: mockHashPassword,
  verifyPassword: vi.fn(),
  findUserByEmail: mockFindUserByEmail,
  toAuthUser: mockToAuthUser,
}));

vi.mock("../../lib/auditLog", () => ({
  recordAuditLog: mockRecordAuditLog,
}));

vi.mock("../../lib/slug", () => ({
  generateUniqueOfficeSlug: mockGenerateSlug,
  slugify: vi.fn((s: string) => s.toLowerCase()),
}));

vi.mock("../../lib/rateLimiter", () => ({
  registerIpLimiter: (_: unknown, __: unknown, next: NextFunction) => next(),
  loginIpLimiter: (_: unknown, __: unknown, next: NextFunction) => next(),
  changePasswordLimiter: (_: unknown, __: unknown, next: NextFunction) => next(),
  checkAccountLockout: () => ({ locked: false }),
  recordFailedLogin: () => ({ locked: false }),
  clearLoginFailures: vi.fn(),
  lockoutMessage: () => "Too many attempts",
  invalidCredentialsMessage: () => "Invalid credentials",
}));

vi.mock("../../lib/sessionInvalidate", () => ({
  invalidateAllSessions: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const MOCK_USER_CUSTOMER = {
  id: 42,
  role: "customer" as const,
  name: "Test Customer",
  email: "customer@example.com",
  phone: "+971501234567",
  passwordHash: "$hashed",
  status: "active" as const,
  statusReason: null,
  createdAt: new Date("2026-01-01"),
};

const MOCK_USER_OFFICE = {
  id: 99,
  role: "office" as const,
  name: "Test Office Corp",
  email: "office@example.com",
  phone: "+971509876543",
  passwordHash: "$hashed",
  status: "active" as const,
  statusReason: null,
  createdAt: new Date("2026-01-01"),
};

const MOCK_OFFICE = {
  id: 55,
  userId: 99,
  name: "Test Office Corp",
  slug: "test-office-corp",
  category: "translation" as const,
  city: "Dubai",
  status: "draft" as const,
  providerType: "office" as const,
};

const AUTH_USER_CUSTOMER = {
  id: 42,
  role: "customer" as const,
  name: "Test Customer",
  email: "customer@example.com",
  phone: null,
  officeId: null,
  status: "active" as const,
  statusReason: null,
  createdAt: new Date("2026-01-01"),
};

const AUTH_USER_OFFICE = {
  id: 99,
  role: "office" as const,
  name: "Test Office Corp",
  email: "office@example.com",
  phone: null,
  officeId: 55,
  status: "active" as const,
  statusReason: null,
  createdAt: new Date("2026-01-01"),
};

/** Valid request body for customer registration. */
const CUSTOMER_REG = {
  name: "Test Customer",
  email: "customer@example.com",
  password: "Password123!",
  phone: "+971501234567",
  termsAccepted: true,
};

/** Valid request body for office registration. */
const OFFICE_REG = {
  officeName: "Test Office Corp",
  email: "office@example.com",
  password: "Password123!",
  whatsapp: "+971509876543",
  category: "translation",
  city: "Dubai",
  providerType: "office",
  termsAccepted: true,
};

// ---------------------------------------------------------------------------
// Helpers for building mock insert chains
// ---------------------------------------------------------------------------

/** Returns a mock insert chain that resolves with the given rows. */
function insertReturning(rows: unknown[]) {
  return {
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue(rows),
    }),
  };
}

/** Returns a mock insert chain that rejects with the given error. */
function insertFailing(err: Error) {
  return {
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockRejectedValue(err),
    }),
  };
}

/** Postgres unique-constraint error (code 23505) — direct pg DatabaseError shape. */
function pgUniqueError() {
  return Object.assign(
    new Error("duplicate key value violates unique constraint"),
    { code: "23505" },
  );
}

/**
 * Drizzle-wrapped unique-constraint error — drizzle-orm@0.45.x wraps the pg
 * error in a _DrizzleQueryError whose .cause holds the original pg error.
 * Validated against the actual production error logged during CRIT-01 testing.
 */
function drizzleWrappedUniqueError() {
  const pgCause = Object.assign(
    new Error("duplicate key value violates unique constraint"),
    { code: "23505" },
  );
  const drizzleErr = new Error(
    "Failed query: insert into \"users\"...: duplicate key value violates unique constraint",
  );
  (drizzleErr as unknown as Record<string, unknown>).cause = pgCause;
  return drizzleErr;
}

// ---------------------------------------------------------------------------
// Test app factory
// ---------------------------------------------------------------------------

/**
 * Creates a minimal express app with:
 *  - A mock session injected on every request (no real session store needed)
 *  - The real auth router (but with all external deps mocked)
 *
 * Lazily imported so module mocks are in place before the router loads.
 */
let app: express.Express;

beforeAll(async () => {
  const { default: authRouter } = await import("../auth");

  app = express();
  app.use(express.json());

  // Inject a minimal mock session on every request. The mock supports
  // regenerate() (session-fixation fix) and save() (bearer-token shim).
  app.use((req: Request, _res: Response, next: NextFunction) => {
    let sessionId = "pre-auth-sid";

    const session: Record<string, unknown> & {
      regenerate: (cb: (err?: unknown) => void) => void;
      save: (cb: (err?: unknown) => void) => void;
      destroy: (cb?: (err?: unknown) => void) => void;
    } = {
      user: null,
      loginAt: undefined,
      lastSeenAt: undefined,
      regenerate(cb) {
        sessionId = "post-regen-sid";
        cb();
      },
      save(cb) {
        cb();
      },
      destroy(cb) {
        cb?.();
      },
    };

    Object.defineProperty(req, "session", {
      value: session,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(req, "sessionID", {
      get: () => sessionId,
      configurable: true,
    });

    next();
  });

  app.use(authRouter);
});

// ---------------------------------------------------------------------------
// Reset mocks before every test — prevents state leaking between tests.
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Default: no existing user/phone found
  mockFindUserByEmail.mockResolvedValue(null);
  mockDb.select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]), // phoneAlreadyRegistered → not found
    }),
  });

  // Default: helpers succeed
  mockHashPassword.mockResolvedValue("$hashed");
  mockRecordAuditLog.mockResolvedValue(undefined);
  mockGenerateSlug.mockResolvedValue("test-office-corp");

  // Default: toAuthUser returns the customer shape; office tests override
  mockToAuthUser.mockResolvedValue(AUTH_USER_CUSTOMER);

  // Default: db.transaction runs the callback (successful path)
  mockDb.transaction.mockImplementation(
    async <T>(cb: (tx: typeof mockTx) => Promise<T>): Promise<T> => cb(mockTx),
  );
});

// ===========================================================================
// Customer Registration
// ===========================================================================

describe("POST /auth/register/customer", () => {
  it("returns 201 with sessionToken on successful registration", async () => {
    mockTx.insert.mockReturnValue(insertReturning([MOCK_USER_CUSTOMER]));

    const res = await request(app)
      .post("/auth/register/customer")
      .send(CUSTOMER_REG);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("sessionToken", "post-regen-sid");
    expect(res.body.id).toBe(42);
    expect(res.body.role).toBe("customer");
  });

  it("uses db.transaction — all writes go through tx, not db directly", async () => {
    mockTx.insert.mockReturnValue(insertReturning([MOCK_USER_CUSTOMER]));

    await request(app).post("/auth/register/customer").send(CUSTOMER_REG);

    expect(mockDb.transaction).toHaveBeenCalledOnce();
    // No direct db.insert — atomicity enforced by the transaction boundary
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("records audit log inside the transaction (tx passed as second arg)", async () => {
    mockTx.insert.mockReturnValue(insertReturning([MOCK_USER_CUSTOMER]));

    await request(app).post("/auth/register/customer").send(CUSTOMER_REG);

    expect(mockRecordAuditLog).toHaveBeenCalledOnce();
    const [entry, txArg] = mockRecordAuditLog.mock.calls[0];
    expect(entry.action).toBe("customer.register");
    // The tx object must be passed so the audit log rolls back with the user
    expect(txArg).toBe(mockTx);
  });

  it("rolls back and returns 500 when user insert fails inside the transaction", async () => {
    mockTx.insert.mockReturnValue(insertFailing(new Error("disk full")));

    const res = await request(app)
      .post("/auth/register/customer")
      .send(CUSTOMER_REG);

    // Handler re-throws non-constraint errors → express 500
    expect(res.status).toBe(500);
    // Audit log must NOT have been written — user insert failed before it
    expect(mockRecordAuditLog).not.toHaveBeenCalled();
    // No writes bypassed the transaction
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("rolls back and returns 500 when audit log insert fails inside the transaction", async () => {
    mockTx.insert.mockReturnValue(insertReturning([MOCK_USER_CUSTOMER]));
    // Simulate audit log failure mid-transaction
    mockRecordAuditLog.mockRejectedValue(new Error("audit table unavailable"));

    const res = await request(app)
      .post("/auth/register/customer")
      .send(CUSTOMER_REG);

    // Transaction propagates the error → user row rolls back → 500
    expect(res.status).toBe(500);
  });

  it("returns 409 when email is already registered (application-level pre-check)", async () => {
    mockFindUserByEmail.mockResolvedValue({ id: 1, email: CUSTOMER_REG.email });

    const res = await request(app)
      .post("/auth/register/customer")
      .send(CUSTOMER_REG);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already registered/i);
    // Pre-check fires before the transaction
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("returns 409 when DB throws 23505 (concurrent registration race)", async () => {
    // Two requests pass the pre-check simultaneously; only one can commit.
    // The loser gets a 23505 unique constraint violation from Postgres.
    mockDb.transaction.mockRejectedValue(pgUniqueError());

    const res = await request(app)
      .post("/auth/register/customer")
      .send(CUSTOMER_REG);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already registered/i);
  });

  it("returns 409 when DB throws a Drizzle-wrapped _DrizzleQueryError around 23505 (concurrent race in production)", async () => {
    // drizzle-orm@0.45.x wraps the pg DatabaseError in _DrizzleQueryError.
    // The code is on .cause.code, not the top-level error. This test
    // verifies isDuplicateKeyError() handles both shapes.
    mockDb.transaction.mockRejectedValue(drizzleWrappedUniqueError());

    const res = await request(app)
      .post("/auth/register/customer")
      .send(CUSTOMER_REG);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already registered/i);
  });

  it("re-throws unexpected DB errors as 500 (non-23505 codes are not swallowed)", async () => {
    const unexpectedErr = Object.assign(new Error("connection reset"), {
      code: "08006",
    });
    mockDb.transaction.mockRejectedValue(unexpectedErr);

    const res = await request(app)
      .post("/auth/register/customer")
      .send(CUSTOMER_REG);

    expect(res.status).toBe(500);
  });

  it("returns 400 when termsAccepted is false — no DB writes attempted", async () => {
    const res = await request(app)
      .post("/auth/register/customer")
      .send({ ...CUSTOMER_REG, termsAccepted: false });

    expect(res.status).toBe(400);
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("returns 400 when required fields are missing — no DB writes attempted", async () => {
    const res = await request(app)
      .post("/auth/register/customer")
      .send({ email: "x@x.com", termsAccepted: true }); // missing name, password

    expect(res.status).toBe(400);
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Office Registration
// ===========================================================================

describe("POST /auth/register/office", () => {
  // Set up the two-call tx.insert sequence needed for office registration
  // (first call → user row, second call → office row) plus office-specific
  // toAuthUser mock.
  beforeEach(() => {
    mockTx.insert
      .mockReturnValueOnce(insertReturning([MOCK_USER_OFFICE]))
      .mockReturnValueOnce(insertReturning([MOCK_OFFICE]));

    mockToAuthUser.mockResolvedValue(AUTH_USER_OFFICE);
  });

  it("returns 201 with sessionToken on successful registration", async () => {
    const res = await request(app)
      .post("/auth/register/office")
      .send(OFFICE_REG);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("sessionToken", "post-regen-sid");
    expect(res.body.role).toBe("office");
    expect(res.body.officeId).toBe(55);
  });

  it("uses db.transaction for ALL writes — user, office, and both audit logs", async () => {
    await request(app).post("/auth/register/office").send(OFFICE_REG);

    expect(mockDb.transaction).toHaveBeenCalledOnce();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("records both audit logs inside the transaction", async () => {
    await request(app).post("/auth/register/office").send(OFFICE_REG);

    expect(mockRecordAuditLog).toHaveBeenCalledTimes(2);

    const [entry1, tx1] = mockRecordAuditLog.mock.calls[0];
    const [entry2, tx2] = mockRecordAuditLog.mock.calls[1];

    expect(entry1.action).toBe("office.register");
    expect(entry2.action).toBe("office.provider_type_selected");

    // Both audit logs must pass the tx object → they roll back together with
    // the user and office rows if anything fails in the transaction.
    expect(tx1).toBe(mockTx);
    expect(tx2).toBe(mockTx);
  });

  it("rolls back entirely when user insert fails (no orphaned records)", async () => {
    // Reset and make the first insert fail
    mockTx.insert.mockReset();
    mockTx.insert.mockReturnValue(insertFailing(new Error("user insert failed")));

    const res = await request(app).post("/auth/register/office").send(OFFICE_REG);

    expect(res.status).toBe(500);
    // Office insert and audit logs were never reached
    expect(mockRecordAuditLog).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("rolls back entirely when office insert fails — prevents orphaned user rows", async () => {
    mockTx.insert.mockReset();
    mockTx.insert
      .mockReturnValueOnce(insertReturning([MOCK_USER_OFFICE])) // user succeeds
      .mockReturnValueOnce(insertFailing(new Error("office insert failed"))); // office fails

    const res = await request(app).post("/auth/register/office").send(OFFICE_REG);

    expect(res.status).toBe(500);
    // Both user AND office rows roll back atomically; no orphan is left
    expect(mockRecordAuditLog).not.toHaveBeenCalled();
  });

  it("rolls back entirely when audit log fails — all three writes roll back", async () => {
    mockRecordAuditLog.mockRejectedValue(new Error("audit table unavailable"));

    const res = await request(app).post("/auth/register/office").send(OFFICE_REG);

    expect(res.status).toBe(500);
    // Drizzle transaction callback threw → user + office rows also roll back
  });

  it("returns 409 when email is already registered (application-level pre-check)", async () => {
    mockFindUserByEmail.mockResolvedValue({ id: 1 });

    const res = await request(app).post("/auth/register/office").send(OFFICE_REG);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already registered/i);
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("returns 409 when DB throws 23505 (concurrent registration race)", async () => {
    mockDb.transaction.mockRejectedValue(pgUniqueError());

    const res = await request(app).post("/auth/register/office").send(OFFICE_REG);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already registered/i);
  });

  it("returns 400 when termsAccepted is false — no DB writes attempted", async () => {
    const res = await request(app)
      .post("/auth/register/office")
      .send({ ...OFFICE_REG, termsAccepted: false });

    expect(res.status).toBe(400);
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("returns 400 when whatsapp is missing — no DB writes attempted", async () => {
    const { whatsapp: _omit, ...noWhatsapp } = OFFICE_REG;
    const res = await request(app)
      .post("/auth/register/office")
      .send(noWhatsapp);

    expect(res.status).toBe(400);
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });
});
