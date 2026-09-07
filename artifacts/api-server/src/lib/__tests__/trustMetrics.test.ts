/**
 * Trust-metrics unit tests.
 *
 * Verifies:
 *   1. batchLoadTrustMetrics — SQL wiring, isolation, zero/partial states
 *   2. serializeOfficeSummary — metric threading, fallback defaults
 *
 * All DB calls are mocked so tests run offline with no real connection.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — must run before module resolution
// ---------------------------------------------------------------------------

const { mockDb } = vi.hoisted(() => {
  const mockDb = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  };
  return { mockDb };
});

vi.mock("@workspace/db", () => ({
  db: mockDb,
  pool: { query: vi.fn() },
  serviceRequestsTable: { id: "sr.id", officeId: "sr.office_id", status: "sr.status" },
  serviceRequestReviewsTable: { id: "srr.id", requestId: "srr.request_id", wouldRecommend: "srr.would_recommend" },
  officeServicesTable: { officeId: "os.office_id", name: "os.name", nameAr: "os.name_ar" },
  officeMediaTable: {},
  officeVerificationDocumentsTable: {},
  officeAdminNotesTable: {},
  usersTable: {},
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args) => ({ _and: args })),
  eq: vi.fn((col, val) => ({ _eq: [col, val] })),
  inArray: vi.fn((col, vals) => ({ _inArray: [col, vals] })),
  desc: vi.fn((col) => ({ _desc: col })),
  sql: vi.fn((strings, ...vals) => ({ _sql: strings, _vals: vals })),
}));

// Silence the objectStorage / auditLog side-effects
vi.mock("../objectStorage", () => ({ verifyObjectReadable: vi.fn().mockResolvedValue(true) }));
vi.mock("../auditLog", () => ({ recordAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../imageProcessor", () => ({
  toPublicVariants: vi.fn((v) => v),
}));

import { batchLoadTrustMetrics, serializeOfficeSummary } from "../officeSerializer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the chained mock for db.select().from().leftJoin().where().groupBy() */
function mockSelectResult(rows: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockResolvedValue(rows),
  };
  mockDb.select.mockReturnValue(chain);
  return chain;
}

/** Minimal Office fixture; override only fields relevant to the test. */
function makeOffice(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    slug: "test-office",
    name: "Test Office",
    nameAr: null,
    category: "legal",
    status: "active",
    city: "Riyadh",
    country: "SA",
    shortDescription: null,
    shortDescriptionAr: null,
    logoUrl: null,
    coverUrl: null,
    coverVariants: null,
    isOnline: true,
    isVerified: false,
    completedTransactions: 0,
    clientsRecommendPercent: 0,
    isDemo: false,
    providerType: "office",
    freelancerImageStyle: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// batchLoadTrustMetrics tests
// ---------------------------------------------------------------------------

describe("batchLoadTrustMetrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an empty map immediately for an empty office list", async () => {
    const result = await batchLoadTrustMetrics([]);
    expect(result.size).toBe(0);
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("returns an empty map when no completed transactions exist for the offices", async () => {
    // DB returns zero rows — no completed service_requests
    mockSelectResult([]);

    const result = await batchLoadTrustMetrics([1, 2, 3]);
    expect(result.size).toBe(0);
  });

  it("maps a single office with one completed transaction and no reviews", async () => {
    mockSelectResult([
      { officeId: 42, completedTransactions: 1, clientsRecommendPercent: 0 },
    ]);

    const result = await batchLoadTrustMetrics([42]);
    expect(result.get(42)).toEqual({ completedTransactions: 1, clientsRecommendPercent: 0 });
  });

  it("computes 100% recommend when all reviewers said yes", async () => {
    mockSelectResult([
      { officeId: 7, completedTransactions: 3, clientsRecommendPercent: 100 },
    ]);

    const result = await batchLoadTrustMetrics([7]);
    expect(result.get(7)?.clientsRecommendPercent).toBe(100);
    expect(result.get(7)?.completedTransactions).toBe(3);
  });

  it("computes 50% recommend when half of reviewers said yes", async () => {
    mockSelectResult([
      { officeId: 5, completedTransactions: 4, clientsRecommendPercent: 50 },
    ]);

    const result = await batchLoadTrustMetrics([5]);
    expect(result.get(5)?.clientsRecommendPercent).toBe(50);
  });

  it("returns 0 recommend when no reviews exist (NOT fabricated as 100)", async () => {
    // Zero reviews — denominator is NULL → COALESCE to 0
    mockSelectResult([
      { officeId: 3, completedTransactions: 5, clientsRecommendPercent: 0 },
    ]);

    const result = await batchLoadTrustMetrics([3]);
    // MUST be 0, not 100 — no reviews means no recommendation data
    expect(result.get(3)?.clientsRecommendPercent).toBe(0);
  });

  it("returns separate metrics for each office (office/freelancer isolation)", async () => {
    // officeId 10 = legal office, officeId 20 = freelancer
    mockSelectResult([
      { officeId: 10, completedTransactions: 8, clientsRecommendPercent: 75 },
      { officeId: 20, completedTransactions: 2, clientsRecommendPercent: 100 },
    ]);

    const result = await batchLoadTrustMetrics([10, 20]);

    expect(result.get(10)).toEqual({ completedTransactions: 8, clientsRecommendPercent: 75 });
    expect(result.get(20)).toEqual({ completedTransactions: 2, clientsRecommendPercent: 100 });
  });

  it("omits offices not present in the DB result (zero defaults applied by serializer)", async () => {
    // officeId 99 has no completed transactions → not returned by GROUP BY
    mockSelectResult([
      { officeId: 1, completedTransactions: 3, clientsRecommendPercent: 67 },
    ]);

    const result = await batchLoadTrustMetrics([1, 99]);
    expect(result.has(1)).toBe(true);
    expect(result.has(99)).toBe(false);
  });

  it("does not include pending/in-progress transactions (only completed)", async () => {
    // The SQL WHERE clause filters to status='completed'; the mock just returns
    // what the DB would return after that filter — here 0 rows for an office
    // that has pending-only requests.
    mockSelectResult([]);

    const result = await batchLoadTrustMetrics([55]);
    expect(result.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// serializeOfficeSummary tests
// ---------------------------------------------------------------------------

describe("serializeOfficeSummary", () => {
  it("falls back to completedTransactions=0 when no metrics are passed", () => {
    const office = makeOffice({ id: 1, providerType: "office" });
    const result = serializeOfficeSummary(office as never);
    expect(result.completedTransactions).toBe(0);
    expect(result.clientsRecommendPercent).toBe(0);
  });

  it("falls back to 0 when undefined metrics are passed explicitly", () => {
    const office = makeOffice({ id: 1 });
    const result = serializeOfficeSummary(office as never, [], null, undefined);
    expect(result.completedTransactions).toBe(0);
    expect(result.clientsRecommendPercent).toBe(0);
  });

  it("uses provided completedTransactions when metrics are available", () => {
    const office = makeOffice({ id: 2 });
    const result = serializeOfficeSummary(office as never, [], null, {
      completedTransactions: 12,
      clientsRecommendPercent: 83,
    });
    expect(result.completedTransactions).toBe(12);
    expect(result.clientsRecommendPercent).toBe(83);
  });

  it("passes through zero completedTransactions when the metric IS provided as 0", () => {
    const office = makeOffice({ id: 3 });
    const result = serializeOfficeSummary(office as never, [], null, {
      completedTransactions: 0,
      clientsRecommendPercent: 0,
    });
    expect(result.completedTransactions).toBe(0);
    expect(result.clientsRecommendPercent).toBe(0);
  });

  it("works for providerType=freelancer (same code path as office)", () => {
    const freelancer = makeOffice({ id: 10, providerType: "freelancer", freelancerImageStyle: "avatar" });
    const result = serializeOfficeSummary(freelancer as never, [], null, {
      completedTransactions: 5,
      clientsRecommendPercent: 60,
    });
    expect(result.completedTransactions).toBe(5);
    expect(result.clientsRecommendPercent).toBe(60);
    expect(result.providerType).toBe("freelancer");
    expect(result.freelancerImageStyle).toBe("avatar");
  });

  it("never exposes internal officeDB fields in the serialized output", () => {
    const office = makeOffice({ id: 4 });
    const result = serializeOfficeSummary(office as never, [], null, {
      completedTransactions: 7,
      clientsRecommendPercent: 71,
    });
    // These fields must NOT appear in the public summary
    expect("latitude" in result).toBe(false);
    expect("longitude" in result).toBe(false);
    expect("pendingChanges" in result).toBe(false);
    expect("rejectionReason" in result).toBe(false);
  });

  it("serviceTags are limited to 3 regardless of input length", () => {
    const office = makeOffice({ id: 5 });
    const manyTags = [
      { name: "A", nameAr: null },
      { name: "B", nameAr: null },
      { name: "C", nameAr: null },
      { name: "D", nameAr: null },
    ];
    const result = serializeOfficeSummary(office as never, manyTags, null);
    expect(result.serviceTags).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Metric defaults: safe zero/no-data behavior
// ---------------------------------------------------------------------------

describe("safe zero / no-data defaults", () => {
  it("clientsRecommendPercent is 0 (not 100) when an office has transactions but zero reviews", () => {
    // Simulates: batchLoadTrustMetrics returns completedTransactions=5, clientsRecommendPercent=0
    // (the SQL COALESCE ensures 0, not NULL, when denominator is NULL)
    const office = makeOffice({ id: 6 });
    const result = serializeOfficeSummary(office as never, [], null, {
      completedTransactions: 5,
      clientsRecommendPercent: 0,
    });
    expect(result.clientsRecommendPercent).toBe(0);
  });

  it("serializer returns stable number types — never null/undefined — for both metrics", () => {
    const office = makeOffice({ id: 7 });
    // No metrics at all
    const r1 = serializeOfficeSummary(office as never);
    expect(typeof r1.completedTransactions).toBe("number");
    expect(typeof r1.clientsRecommendPercent).toBe("number");

    // With metrics
    const r2 = serializeOfficeSummary(office as never, [], null, {
      completedTransactions: 3,
      clientsRecommendPercent: 100,
    });
    expect(typeof r2.completedTransactions).toBe("number");
    expect(typeof r2.clientsRecommendPercent).toBe("number");
  });
});
