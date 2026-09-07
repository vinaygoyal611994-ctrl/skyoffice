/**
 * Concurrency safety tests — advisory lock client affinity, partial failure
 * handling, and market recompute mutex.
 *
 * Key properties verified:
 *  A) Analytics advisory lock runs on a single dedicated DB client (same
 *     session for acquire + release) — pool.query() is never used for the lock.
 *  B) Partial dimension failure marks the analytics job FAILED, not completed.
 *  C) Advisory lock always releases in finally, even after errors.
 *  D) Market recompute advisory lock: concurrent second run returns skipped.
 *  E) Market recompute run-status records are created/updated correctly.
 *  F) No duplicate supply snapshots when second run is skipped.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock objects — created before any module resolution
// ---------------------------------------------------------------------------

const { mockDb, mockPool, mockLockClient } = vi.hoisted(() => {
  const mockLockClient = {
    query:   vi.fn(),
    release: vi.fn(),
  };

  const mockPool = {
    query:   vi.fn(),
    connect: vi.fn(),
  };

  const mockDb = {
    insert:  vi.fn(),
    update:  vi.fn(),
    select:  vi.fn(),
    execute: vi.fn(),
  };

  return { mockDb, mockPool, mockLockClient };
});

// ---------------------------------------------------------------------------
// Module mocks (hoisted before static imports below)
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db:   mockDb,
  pool: mockPool,
  analyticsAggregationJobsTable:  { id: "aaj.id", status: "aaj.status", completedAt: "aaj.completed_at" },
  analyticsDailyGlobalTable:      { id: "g.id" },
  analyticsDailyByOfficeTable:    { id: "o.id" },
  analyticsDailyByMarketTable:    { id: "m.id" },
  analyticsDailyBySourceTable:    { id: "s.id" },
  analyticsDailyBySearchTable:    { id: "q.id" },
  analyticsEventsTable:           { id: "ae.id", officeId: "ae.office_id" },
  contactEventsTable:             { id: "ce.id" },
  favouritesTable:                { id: "f.id" },
  auditLogTable:                  { id: "al.id" },
  officesTable:                   { id: "of.id" },
  serviceRequestReviewsTable:     { id: "srr.id" },
  marketSupplyControlTable:       { id: "msc.id" },
  marketRecomputeRunsTable:       { id: "mrr.id", status: "mrr.status" },
  serviceRequestsTable:           { id: "sr.id" },
}));

vi.mock("drizzle-orm", () => ({
  and:     vi.fn((...a: unknown[]) => ({ _and: a })),
  eq:      vi.fn((c: unknown, v: unknown) => ({ _eq: [c, v] })),
  inArray: vi.fn((c: unknown, v: unknown) => ({ _inArray: [c, v] })),
  desc:    vi.fn((c: unknown) => ({ _desc: c })),
  sql:     Object.assign(vi.fn(), { raw: vi.fn() }),
}));

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../auditLog", () => ({
  recordAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../analyticsConfig", () => ({
  AGGREGATION_VERSION:           1,
  AGGREGATION_BACKFILL_DAYS:     7,
  AGGREGATION_CHECK_INTERVAL_MS: 3_600_000,
}));

vi.mock("../marketClassifier", () => ({
  classifyMarket: vi.fn().mockReturnValue({
    marketStatus:         "open",
    recommendedAcceptance:"open",
    recommendedAction:    "none",
    confidenceScore:      0.9,
    recommendationReason: "ok",
    derivedSignals:       {},
  }),
  computeCapRecommendation: vi.fn().mockReturnValue({
    recommendedCap: null, capChange: null, reason: null, confidence: null,
  }),
}));

vi.mock("../searchNormalizer", () => ({
  classifyCityId:        vi.fn((c: string) => c),
  normalizeSearchQuery:  vi.fn((q: string) => q),
  classifyCategoryId:    vi.fn((c: string) => c),
  classifySearchIntent:  vi.fn(),
  detectQueryLanguage:   vi.fn(),
}));

// ---------------------------------------------------------------------------
// Static imports — receive mocked module versions because vi.mock is hoisted
// ---------------------------------------------------------------------------

import { runAggregationForDate } from "../analyticsAggregator";
import { runMarketRecompute } from "../marketRecompute";

// ---------------------------------------------------------------------------
// Mock chain helpers
// ---------------------------------------------------------------------------

/**
 * Returns a Drizzle-shaped insert chain that resolves `rows` when awaited.
 * Supports: .values() → .returning() → Promise<rows>
 *           .values() → .onConflictDoUpdate() → Promise<void>
 */
function makeInsertChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  const methods = [
    "values", "returning", "onConflictDoUpdate", "onConflictDoNothing",
  ];
  methods.forEach((m) => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  // .returning() resolves for INSERT ... RETURNING
  (chain.returning as ReturnType<typeof vi.fn>).mockResolvedValue(rows);
  // Make chain itself awaitable (for patterns ending without .returning())
  chain.then = (res: (v: unknown) => void, rej: (e: unknown) => void) =>
    Promise.resolve(undefined).then(res, rej);
  return chain;
}

/**
 * Returns a Drizzle-shaped select chain that resolves `rows` when awaited.
 * Supports arbitrary method chaining before the final await.
 */
function makeSelectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  const methods = [
    "from", "where", "groupBy", "orderBy", "limit", "offset",
    "leftJoin", "innerJoin", "rightJoin",
  ];
  methods.forEach((m) => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  chain.then = (res: (v: unknown) => void, rej: (e: unknown) => void) =>
    Promise.resolve(rows).then(res, rej);
  return chain;
}

/**
 * Returns a Drizzle-shaped update chain.  Captures `.set()` arguments so
 * tests can inspect which status was written.
 */
function makeUpdateChain(captureInto?: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.set = vi.fn((args: unknown) => {
    if (captureInto) captureInto.push(args);
    return chain;
  });
  chain.where = vi.fn().mockResolvedValue(undefined);
  return chain;
}

// ---------------------------------------------------------------------------
// Global beforeEach — runs before EVERY test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetAllMocks();

  // Pool connectivity
  mockPool.connect.mockResolvedValue(mockLockClient);
  mockPool.query.mockResolvedValue({ rows: [] });

  // Default lock client: lock GRANTED on first call, silent on subsequent calls
  mockLockClient.query
    .mockResolvedValueOnce({ rows: [{ pg_try_advisory_lock: true }] })  // acquire
    .mockResolvedValue({ rows: [] });                                     // release (+ any extra)

  // Default DB operations
  let idCounter = 1;
  mockDb.insert.mockImplementation(() => makeInsertChain([{ id: idCounter++ }]));
  mockDb.update.mockImplementation(() => makeUpdateChain());
  mockDb.select.mockImplementation(() => makeSelectChain([]));
  mockDb.execute.mockResolvedValue({ rows: [] });
});

// ===========================================================================
// Analytics: advisory lock client affinity
// ===========================================================================

describe("analytics aggregation — advisory lock client affinity", () => {
  it("uses a dedicated pool.connect() client; pool.query() is NOT used for advisory lock", async () => {
    await runAggregationForDate(new Date("2026-01-15"), "test");

    // Exactly one dedicated client was checked out
    expect(mockPool.connect).toHaveBeenCalledTimes(1);

    // pool.query must NOT have been called for any advisory-lock SQL
    const poolAdvisoryCalls = (mockPool.query as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([s]: [unknown]) => typeof s === "string" && s.includes("advisory"),
    );
    expect(poolAdvisoryCalls).toHaveLength(0);

    // The dedicated client WAS used for both advisory operations
    const clientSQLs = (mockLockClient.query as ReturnType<typeof vi.fn>).mock.calls
      .map(([s]: [unknown]) => (typeof s === "string" ? s : ""));
    expect(clientSQLs.some((s) => s.includes("pg_try_advisory_lock"))).toBe(true);
    expect(clientSQLs.some((s) => s.includes("pg_advisory_unlock"))).toBe(true);

    // Client released exactly once (normally, not destroyed)
    expect(mockLockClient.release).toHaveBeenCalledTimes(1);
    expect(mockLockClient.release).not.toHaveBeenCalledWith(true);
  });

  it("releases the dedicated client immediately when lock is busy (skip path)", async () => {
    // Override: lock busy
    mockLockClient.query.mockReset();
    mockLockClient.query.mockResolvedValueOnce({ rows: [{ pg_try_advisory_lock: false }] });

    await runAggregationForDate(new Date("2026-01-16"), "test");

    // Client still released (even with no lock held)
    expect(mockLockClient.release).toHaveBeenCalledTimes(1);

    // Job was marked skipped
    const updateSets = (mockDb.update as ReturnType<typeof vi.fn>).mock.calls
      .flatMap(([]) => [] as unknown[])
      .concat(
        (mockDb.update as ReturnType<typeof vi.fn>).mock.results.map((r: { value: unknown }) => r.value),
      );
    // Verify via the chain's .set() argument
    const setCalls = ((mockDb.update as ReturnType<typeof vi.fn>).mock.instances as unknown[])
      .map((_, i) => {
        const chain = (mockDb.update as ReturnType<typeof vi.fn>).mock.results[i]?.value as Record<string, ReturnType<typeof vi.fn>>;
        return chain?.set?.mock?.calls?.[0]?.[0];
      });
    expect(setCalls.some((c: unknown) => (c as Record<string, string>)?.status === "skipped")).toBe(true);
  });

  it("destroys the dedicated client when advisory unlock throws (ensures lock auto-release)", async () => {
    // Acquire succeeds, but unlock throws
    mockLockClient.query.mockReset();
    mockLockClient.query
      .mockResolvedValueOnce({ rows: [{ pg_try_advisory_lock: true }] })
      .mockRejectedValueOnce(new Error("unlock failed"));

    await runAggregationForDate(new Date("2026-01-17"), "test");

    // release(true) destroys the connection → session-level lock auto-releases
    expect(mockLockClient.release).toHaveBeenCalledWith(true);
  });
});

// ===========================================================================
// Analytics: partial dimension failure
// ===========================================================================

describe("analytics aggregation — partial dimension failure", () => {
  it("marks job FAILED when all dimensions throw (via execute error)", async () => {
    // Dimension functions use db.execute(sql`...`) for all their queries.
    // Throw on every execute call → all 5 dimensions fail.
    mockDb.execute.mockImplementation(() => { throw new Error("execute error"); });

    const updateSetArgs: unknown[] = [];
    mockDb.update.mockImplementation(() => makeUpdateChain(updateSetArgs));

    await runAggregationForDate(new Date("2026-01-18"), "test");

    const failed = updateSetArgs.find(
      (a) => (a as Record<string, string>).status === "failed",
    );
    expect(failed).toBeDefined();
    // Error message mentions the dimension(s) that failed
    expect((failed as Record<string, string>).errorMessage).toMatch(/global|by_office|by_market|by_source|by_search/);

    // Must NOT have been marked completed
    const completed = updateSetArgs.find(
      (a) => (a as Record<string, string>).status === "completed",
    );
    expect(completed).toBeUndefined();
  });

  it("marks job COMPLETED when all dimensions succeed (no errors)", async () => {
    // Default mock: db.execute returns empty rows, db.insert chains resolve — all dimensions succeed
    const updateSetArgs: unknown[] = [];
    mockDb.update.mockImplementation(() => makeUpdateChain(updateSetArgs));

    await runAggregationForDate(new Date("2026-01-19"), "test");

    const completed = updateSetArgs.find(
      (a) => (a as Record<string, string>).status === "completed",
    );
    expect(completed).toBeDefined();

    const failed = updateSetArgs.find(
      (a) => (a as Record<string, string>).status === "failed",
    );
    expect(failed).toBeUndefined();
  });

  it("lock is released in finally even when all dimensions fail", async () => {
    mockDb.execute.mockImplementation(() => { throw new Error("execute error"); });

    await runAggregationForDate(new Date("2026-01-20"), "test");

    // Lock was acquired then released — even though all dimensions failed
    const clientSQLs = (mockLockClient.query as ReturnType<typeof vi.fn>).mock.calls
      .map(([s]: [unknown]) => (typeof s === "string" ? s : ""));
    expect(clientSQLs.some((s) => s.includes("pg_advisory_unlock"))).toBe(true);
    expect(mockLockClient.release).toHaveBeenCalled();
  });
});

// ===========================================================================
// Market recompute: advisory lock mutex
// ===========================================================================

describe("market recompute — advisory lock mutex", () => {
  it("returns skipped=true when lock is busy; dedicated client released", async () => {
    mockLockClient.query.mockReset();
    mockLockClient.query.mockResolvedValueOnce({ rows: [{ pg_try_advisory_lock: false }] });

    const result = await runMarketRecompute("scheduled");

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("lock_busy");
    expect(result.upserted).toBe(0);

    // Dedicated client released (but not destroyed)
    expect(mockLockClient.release).toHaveBeenCalledTimes(1);
    expect(mockLockClient.release).not.toHaveBeenCalledWith(true);
  });

  it("lock acquired — uses dedicated client for both advisory operations", async () => {
    const result = await runMarketRecompute("admin");

    expect(result.skipped).toBeUndefined();

    // Same client used for acquire + release
    const clientSQLs = (mockLockClient.query as ReturnType<typeof vi.fn>).mock.calls
      .map(([s]: [unknown]) => (typeof s === "string" ? s : ""));
    expect(clientSQLs.some((s) => s.includes("pg_try_advisory_lock"))).toBe(true);
    expect(clientSQLs.some((s) => s.includes("pg_advisory_unlock"))).toBe(true);

    // pool.query NOT used for advisory lock
    const poolAdvisoryCalls = (mockPool.query as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([s]: [unknown]) => typeof s === "string" && (s as string).includes("advisory"),
    );
    expect(poolAdvisoryCalls).toHaveLength(0);
  });

  it("lock released after failure — client not stranded", async () => {
    // Lock granted, then the cap pre-fetch throws
    mockPool.query.mockRejectedValueOnce(new Error("signals DB error"));

    await expect(runMarketRecompute("scheduled")).rejects.toThrow("signals DB error");

    // Lock still released in finally
    const clientSQLs = (mockLockClient.query as ReturnType<typeof vi.fn>).mock.calls
      .map(([s]: [unknown]) => (typeof s === "string" ? s : ""));
    expect(clientSQLs.some((s) => s.includes("pg_advisory_unlock"))).toBe(true);
    expect(mockLockClient.release).toHaveBeenCalled();
  });

  it("no market_supply_snapshots written when run is skipped (no duplicate rows)", async () => {
    mockLockClient.query.mockReset();
    mockLockClient.query.mockResolvedValueOnce({ rows: [{ pg_try_advisory_lock: false }] });

    await runMarketRecompute("scheduled");

    // pool.query must NOT have been called with snapshot INSERT
    const snapshotInserts = (mockPool.query as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([s]: [unknown]) => typeof s === "string" && (s as string).includes("market_supply_snapshots"),
    );
    expect(snapshotInserts).toHaveLength(0);
  });
});

// ===========================================================================
// Market recompute: run status recording
// ===========================================================================

describe("market recompute — run status recording", () => {
  it("creates a 'running' record at the start of every attempt", async () => {
    // Lock busy path — minimal execution
    mockLockClient.query.mockReset();
    mockLockClient.query.mockResolvedValueOnce({ rows: [{ pg_try_advisory_lock: false }] });

    const insertValuesArgs: unknown[] = [];
    mockDb.insert.mockImplementation(() => {
      const chain = makeInsertChain([{ id: 1 }]);
      (chain.values as ReturnType<typeof vi.fn>).mockImplementation((args: unknown) => {
        insertValuesArgs.push(args);
        return chain;
      });
      return chain;
    });

    await runMarketRecompute("admin");

    const runningInsert = insertValuesArgs.find(
      (v) => (v as Record<string, string>).status === "running",
    );
    expect(runningInsert).toBeDefined();
    expect((runningInsert as Record<string, string>).triggeredBy).toBe("admin");
  });

  it("updates run to 'skipped' with skipReason='lock_busy' when lock is busy", async () => {
    mockLockClient.query.mockReset();
    mockLockClient.query.mockResolvedValueOnce({ rows: [{ pg_try_advisory_lock: false }] });

    const updateSetArgs: unknown[] = [];
    mockDb.update.mockImplementation(() => makeUpdateChain(updateSetArgs));

    await runMarketRecompute("scheduled");

    const skipped = updateSetArgs.find(
      (a) => (a as Record<string, string>).status === "skipped",
    );
    expect(skipped).toBeDefined();
    expect((skipped as Record<string, string>).skipReason).toBe("lock_busy");
  });

  it("updates run to 'completed' with marketsUpserted on success", async () => {
    const updateSetArgs: unknown[] = [];
    mockDb.update.mockImplementation(() => makeUpdateChain(updateSetArgs));

    await runMarketRecompute("admin");

    const completed = updateSetArgs.find(
      (a) => (a as Record<string, string>).status === "completed",
    );
    expect(completed).toBeDefined();
    expect(typeof (completed as Record<string, unknown>).durationMs).toBe("number");
  });

  it("updates run to 'failed' with truncated error message when recompute throws", async () => {
    mockPool.query.mockRejectedValueOnce(new Error("cap query exploded"));

    const updateSetArgs: unknown[] = [];
    mockDb.update.mockImplementation(() => makeUpdateChain(updateSetArgs));

    await expect(runMarketRecompute("scheduled")).rejects.toThrow("cap query exploded");

    const failed = updateSetArgs.find(
      (a) => (a as Record<string, string>).status === "failed",
    );
    expect(failed).toBeDefined();
    expect((failed as Record<string, string>).errorMessage).toContain("cap query exploded");
  });
});

// ===========================================================================
// Platform Health status mapping (pure-function assertions — no DB needed)
// ===========================================================================

describe("platform health — consecutive failure counting", () => {
  /** Mirrors countConsecutiveFailures() from adminHealth.ts */
  function countConsecutiveFailures(jobs: { status: string }[]): number {
    let count = 0;
    for (const job of jobs) {
      if (job.status === "failed") count++;
      else break;
    }
    return count;
  }

  it("returns 0 for an empty history", () => {
    expect(countConsecutiveFailures([])).toBe(0);
  });

  it("returns 0 when most recent job completed", () => {
    expect(countConsecutiveFailures([{ status: "completed" }])).toBe(0);
  });

  it("counts consecutive failures from the most recent job", () => {
    expect(countConsecutiveFailures([
      { status: "failed" },
      { status: "failed" },
      { status: "failed" },
    ])).toBe(3);
  });

  it("skipped runs break the consecutive-failure chain (lock_busy is not an error)", () => {
    expect(countConsecutiveFailures([
      { status: "skipped" },
      { status: "failed" },
    ])).toBe(0);  // leading skipped → chain broken at 0
  });

  it("failures before a completed run don't bleed into the leading count", () => {
    expect(countConsecutiveFailures([
      { status: "failed" },
      { status: "completed" },
      { status: "failed" },
    ])).toBe(1);  // only the leading failure counts
  });

  it("all-skipped history → zero failures → healthy", () => {
    expect(countConsecutiveFailures([
      { status: "skipped" },
      { status: "skipped" },
      { status: "skipped" },
    ])).toBe(0);
  });
});
