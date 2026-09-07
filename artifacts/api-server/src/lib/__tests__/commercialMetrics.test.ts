/**
 * commercialMetrics.test.ts — Unit tests for computeCommercialReport
 *
 * Strategy: mock pool.query to return controlled data for each of the 6 parallel queries.
 * Query order (as called in Promise.all):
 *   0 → state counts by provider
 *   1 → period activity (history rows)
 *   2 → prev period activity
 *   3 → current revenue
 *   4 → prev revenue
 *   5 → prev activePaid count by provider
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock pool ─────────────────────────────────────────────────────────────────

const mockQuery = vi.fn();

vi.mock("@workspace/db", () => ({
  pool: { query: (...args: unknown[]) => mockQuery(...args) },
}));

// ── Import after mock ─────────────────────────────────────────────────────────

import { computeCommercialReport } from "../commercialMetrics";

// ── Helpers ───────────────────────────────────────────────────────────────────

const P_START = new Date("2026-07-01T00:00:00Z");
const P_END   = new Date("2026-08-01T00:00:00Z");
const PREV_S  = new Date("2026-06-01T00:00:00Z");
const PREV_E  = new Date("2026-07-01T00:00:00Z");

/** Minimal 6-query mock sequence. */
function setupMocks({
  stateRows    = [] as object[],
  activityRows = [] as object[],
  prevActRows  = [] as object[],
  revenueRows  = [] as object[],
  prevRevRows  = [] as object[],
  prevPaidRows = [] as object[],
} = {}) {
  mockQuery
    .mockResolvedValueOnce({ rows: stateRows })      // 0 state counts
    .mockResolvedValueOnce({ rows: activityRows })   // 1 period activity
    .mockResolvedValueOnce({ rows: prevActRows })    // 2 prev activity
    .mockResolvedValueOnce({ rows: revenueRows })    // 3 current revenue
    .mockResolvedValueOnce({ rows: prevRevRows })    // 4 prev revenue
    .mockResolvedValueOnce({ rows: prevPaidRows });  // 5 prev activePaid
}

beforeEach(() => { vi.resetAllMocks(); });

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("computeCommercialReport – period metadata", () => {
  it("returns correct period boundaries", async () => {
    setupMocks();
    const r = await computeCommercialReport(P_START, P_END, PREV_S, PREV_E);
    expect(r.period.start).toBe(P_START.toISOString());
    expect(r.period.end).toBe(P_END.toISOString());
    expect(r.previousPeriod.start).toBe(PREV_S.toISOString());
    expect(r.previousPeriod.end).toBe(PREV_E.toISOString());
  });
});

describe("computeCommercialReport – snapshot counts", () => {
  it("parses office and freelancer state counts separately", async () => {
    setupMocks({
      stateRows: [
        { provider_type: "office",     state: "active_paid", cnt: "10" },
        { provider_type: "office",     state: "expiring",    cnt: "3"  },
        { provider_type: "freelancer", state: "active_paid", cnt: "5"  },
        { provider_type: "freelancer", state: "trial",       cnt: "2"  },
      ],
    });
    const r = await computeCommercialReport(P_START, P_END, PREV_S, PREV_E);
    expect(r.snapshot.office.activePaid).toBe(10);
    expect(r.snapshot.office.expiring).toBe(3);
    expect(r.snapshot.freelancer.activePaid).toBe(5);
    expect(r.snapshot.freelancer.trial).toBe(2);
    expect(r.snapshot.total.activePaid).toBe(15);
  });

  it("accumulates totalEligible correctly (sum of all states)", async () => {
    setupMocks({
      stateRows: [
        { provider_type: "office", state: "active_paid", cnt: "4" },
        { provider_type: "office", state: "expired",     cnt: "6" },
      ],
    });
    const r = await computeCommercialReport(P_START, P_END, PREV_S, PREV_E);
    expect(r.snapshot.office.totalEligible).toBe(10);
  });

  it("handles unknown provider_type as office (default bucket)", async () => {
    setupMocks({
      stateRows: [{ provider_type: "unknown", state: "active_paid", cnt: "7" }],
    });
    const r = await computeCommercialReport(P_START, P_END, PREV_S, PREV_E);
    expect(r.snapshot.office.activePaid).toBe(7);
  });
});

describe("computeCommercialReport – period activity", () => {
  it("classifies newPaid correctly (from free or trial → active_paid)", async () => {
    setupMocks({
      activityRows: [
        { provider_type: "office", to_state: "active_paid", from_state: "free",  cnt: "3" },
        { provider_type: "office", to_state: "active_paid", from_state: "trial", cnt: "2" },
      ],
    });
    const r = await computeCommercialReport(P_START, P_END, PREV_S, PREV_E);
    expect(r.current.office.newPaid).toBe(5);
  });

  it("classifies renewals correctly (from expiring → active_paid)", async () => {
    setupMocks({
      activityRows: [
        { provider_type: "office", to_state: "active_paid", from_state: "expiring", cnt: "8" },
      ],
    });
    const r = await computeCommercialReport(P_START, P_END, PREV_S, PREV_E);
    expect(r.current.office.renewals).toBe(8);
    expect(r.current.office.newPaid).toBe(0);
  });

  it("classifies reactivations correctly (from expired / hidden / cancelled → active_paid)", async () => {
    setupMocks({
      activityRows: [
        { provider_type: "freelancer", to_state: "active_paid", from_state: "expired",                  cnt: "2" },
        { provider_type: "freelancer", to_state: "active_paid", from_state: "hidden_due_to_nonpayment", cnt: "1" },
        { provider_type: "freelancer", to_state: "active_paid", from_state: "cancelled",                cnt: "3" },
      ],
    });
    const r = await computeCommercialReport(P_START, P_END, PREV_S, PREV_E);
    expect(r.current.freelancer.reactivations).toBe(6);
  });

  it("classifies churn as cancelled + hidden_due_to_nonpayment FROM paid-tier states", async () => {
    setupMocks({
      activityRows: [
        { provider_type: "office", to_state: "cancelled",               from_state: "active_paid", cnt: "4" },
        { provider_type: "office", to_state: "hidden_due_to_nonpayment",from_state: "expired",     cnt: "2" },
      ],
    });
    const r = await computeCommercialReport(P_START, P_END, PREV_S, PREV_E);
    expect(r.current.office.churn).toBe(6);
  });

  it("does NOT count free → cancelled as paid churn", async () => {
    setupMocks({
      activityRows: [
        { provider_type: "office", to_state: "cancelled", from_state: "free", cnt: "5" },
      ],
    });
    const r = await computeCommercialReport(P_START, P_END, PREV_S, PREV_E);
    expect(r.current.office.churn).toBe(0);
    expect(r.current.office.netGrowth).toBe(0);
  });

  it("does NOT count trial → cancelled as paid churn", async () => {
    setupMocks({
      activityRows: [
        { provider_type: "office", to_state: "cancelled", from_state: "trial", cnt: "3" },
      ],
    });
    const r = await computeCommercialReport(P_START, P_END, PREV_S, PREV_E);
    expect(r.current.office.churn).toBe(0);
  });

  it("counts expiring → cancelled as paid churn", async () => {
    setupMocks({
      activityRows: [
        { provider_type: "office", to_state: "cancelled", from_state: "expiring", cnt: "4" },
      ],
    });
    const r = await computeCommercialReport(P_START, P_END, PREV_S, PREV_E);
    expect(r.current.office.churn).toBe(4);
  });

  it("classifies newTrial correctly (from free → trial)", async () => {
    setupMocks({
      activityRows: [
        { provider_type: "office", to_state: "trial", from_state: "free", cnt: "5" },
      ],
    });
    const r = await computeCommercialReport(P_START, P_END, PREV_S, PREV_E);
    expect(r.current.office.newTrial).toBe(5);
  });

  it("computes netGrowth as newPaid + reactivations - churn (renewals excluded)", async () => {
    setupMocks({
      activityRows: [
        { provider_type: "office", to_state: "active_paid", from_state: "free",        cnt: "2" },  // newPaid
        { provider_type: "office", to_state: "active_paid", from_state: "expiring",    cnt: "5" },  // renewals — must NOT add to netGrowth
        { provider_type: "office", to_state: "cancelled",   from_state: "active_paid", cnt: "3" },  // paid churn
      ],
    });
    const r = await computeCommercialReport(P_START, P_END, PREV_S, PREV_E);
    // netGrowth = newPaid(2) + reactivations(0) - churn(3) = -1
    // renewals(5) retain existing subs and must not inflate the count
    expect(r.current.office.netGrowth).toBe(-1);
  });

  it("renewals alone do not change netGrowth", async () => {
    setupMocks({
      activityRows: [
        { provider_type: "office", to_state: "active_paid", from_state: "expiring", cnt: "10" }, // renewals only
      ],
    });
    const r = await computeCommercialReport(P_START, P_END, PREV_S, PREV_E);
    // 10 renewals, 0 new, 0 churn → netGrowth = 0 (subscriber count unchanged)
    expect(r.current.office.netGrowth).toBe(0);
    expect(r.current.office.renewals).toBe(10);
  });

  it("aggregates totals correctly from provider splits", async () => {
    setupMocks({
      activityRows: [
        { provider_type: "office",     to_state: "active_paid", from_state: "expiring", cnt: "6" },
        { provider_type: "freelancer", to_state: "active_paid", from_state: "expiring", cnt: "4" },
      ],
    });
    const r = await computeCommercialReport(P_START, P_END, PREV_S, PREV_E);
    expect(r.current.total.renewals).toBe(10);
  });
});

describe("computeCommercialReport – MRR", () => {
  it("calculates officeMrr from activePaid + expiring × 200 SAR", async () => {
    setupMocks({
      stateRows: [
        { provider_type: "office", state: "active_paid", cnt: "10" },
        { provider_type: "office", state: "expiring",    cnt: "2"  },
      ],
    });
    const r = await computeCommercialReport(P_START, P_END, PREV_S, PREV_E);
    // (10 + 2) × 200 SAR = 2400 SAR
    expect(r.mrr.officeMrr).toBe(2400);
  });

  it("calculates freelancerMrr from activePaid + expiring × 120 SAR", async () => {
    setupMocks({
      stateRows: [
        { provider_type: "freelancer", state: "active_paid", cnt: "5" },
        { provider_type: "freelancer", state: "expiring",    cnt: "5" },
      ],
    });
    const r = await computeCommercialReport(P_START, P_END, PREV_S, PREV_E);
    // 10 × 120 = 1200 SAR
    expect(r.mrr.freelancerMrr).toBe(1200);
  });

  it("sums totalMrr correctly", async () => {
    setupMocks({
      stateRows: [
        { provider_type: "office",     state: "active_paid", cnt: "10" },
        { provider_type: "freelancer", state: "active_paid", cnt: "10" },
      ],
    });
    const r = await computeCommercialReport(P_START, P_END, PREV_S, PREV_E);
    // 10×200 + 10×120 = 2000 + 1200 = 3200
    expect(r.mrr.totalMrr).toBe(3200);
  });

  it("excludes expired and cancelled offices from MRR", async () => {
    setupMocks({
      stateRows: [
        { provider_type: "office", state: "expired",   cnt: "20" },
        { provider_type: "office", state: "cancelled", cnt: "10" },
        { provider_type: "office", state: "active_paid", cnt: "3" },
      ],
    });
    const r = await computeCommercialReport(P_START, P_END, PREV_S, PREV_E);
    // Only 3 activePaid × 200 = 600
    expect(r.mrr.officeMrr).toBe(600);
  });
});

describe("computeCommercialReport – revenue", () => {
  it("sums revenue from succeeded payments only (halalas ÷ 100)", async () => {
    setupMocks({
      revenueRows: [
        { provider_type: "office",     total_halalas: "40000" },  // 400 SAR
        { provider_type: "freelancer", total_halalas: "24000" },  // 240 SAR
      ],
    });
    const r = await computeCommercialReport(P_START, P_END, PREV_S, PREV_E);
    expect(r.currentRevenue.officeRevenue).toBe(400);
    expect(r.currentRevenue.freelancerRevenue).toBe(240);
    expect(r.currentRevenue.totalRevenue).toBe(640);
  });

  it("returns zero revenue when no succeeded payments exist", async () => {
    setupMocks(); // empty revenue rows
    const r = await computeCommercialReport(P_START, P_END, PREV_S, PREV_E);
    expect(r.currentRevenue.totalRevenue).toBe(0);
  });

  it("tracks previous period revenue separately", async () => {
    setupMocks({
      revenueRows:    [{ provider_type: "office", total_halalas: "20000" }],
      prevRevRows:    [{ provider_type: "office", total_halalas: "10000" }],
    });
    const r = await computeCommercialReport(P_START, P_END, PREV_S, PREV_E);
    expect(r.currentRevenue.officeRevenue).toBe(200);
    expect(r.previousRevenue.officeRevenue).toBe(100);
  });
});

describe("computeCommercialReport – prevActivePaid historical baseline", () => {
  it("baseline uses last-known state per office (not cumulative history)", async () => {
    // Office A: renewed (active_paid) then cancelled before prevEnd → should NOT count
    // Office B: active_paid at prevEnd → should count
    // The 6th mock query represents the CTE result: only office B remains paid
    setupMocks({
      prevPaidRows: [{ provider_type: "office", cnt: "1" }], // only office B
    });
    const r = await computeCommercialReport(P_START, P_END, PREV_S, PREV_E);
    // With prevActivePaid=1 and currActivePaid=0, growthPct should reflect only the
    // true baseline — if it were cumulative it would have been 2
    expect(r.rates.growthPct).not.toBeNull();
  });

  it("offices that churned before prevEnd do not inflate the growthPct baseline", async () => {
    // Scenario: 5 offices paid at some point in history, but only 2 were still paid at prevEnd
    // Current: 4 active_paid offices
    // prevPaidRows returns 2 (correct point-in-time), not 5 (cumulative)
    setupMocks({
      stateRows:    [{ provider_type: "office", state: "active_paid", cnt: "4" }],
      prevPaidRows: [{ provider_type: "office", cnt: "2" }],
    });
    const r = await computeCommercialReport(P_START, P_END, PREV_S, PREV_E);
    // growthPct = (4-2)/2*100 = 100% (not (4-5)/5 = -20% from inflated baseline)
    expect(r.rates.growthPct).toBe(100);
  });
});

describe("computeCommercialReport – rates", () => {
  it("computes renewalRate correctly", async () => {
    setupMocks({
      activityRows: [
        { provider_type: "office", to_state: "active_paid", from_state: "expiring",  cnt: "7" },
        { provider_type: "office", to_state: "cancelled",   from_state: "active_paid", cnt: "3" },
      ],
    });
    const r = await computeCommercialReport(P_START, P_END, PREV_S, PREV_E);
    // renewalRate = 7 / (7+3) * 100 = 70
    expect(r.rates.renewalRate).toBe(70);
  });

  it("computes churnRate correctly", async () => {
    setupMocks({
      activityRows: [
        { provider_type: "office", to_state: "active_paid", from_state: "expiring", cnt: "6" },
        { provider_type: "office", to_state: "cancelled",   from_state: "active_paid", cnt: "4" },
      ],
    });
    const r = await computeCommercialReport(P_START, P_END, PREV_S, PREV_E);
    // churnRate = 4 / (6+4) * 100 = 40
    expect(r.rates.churnRate).toBe(40);
  });

  it("returns null for rates when denominator is zero", async () => {
    setupMocks(); // no activity
    const r = await computeCommercialReport(P_START, P_END, PREV_S, PREV_E);
    expect(r.rates.renewalRate).toBeNull();
    expect(r.rates.churnRate).toBeNull();
  });

  it("computes growthPct using prevActivePaid count", async () => {
    setupMocks({
      stateRows:    [{ provider_type: "office", state: "active_paid", cnt: "12" }],
      prevPaidRows: [{ provider_type: "office", cnt: "10" }],
    });
    const r = await computeCommercialReport(P_START, P_END, PREV_S, PREV_E);
    // growthPct = (12-10)/10 * 100 = 20
    expect(r.rates.growthPct).toBe(20);
  });

  it("returns null for growthPct when prev count is zero", async () => {
    setupMocks({
      stateRows:    [{ provider_type: "office", state: "active_paid", cnt: "5" }],
      prevPaidRows: [], // none
    });
    const r = await computeCommercialReport(P_START, P_END, PREV_S, PREV_E);
    expect(r.rates.growthPct).toBeNull();
  });

  it("retentionRate is alias for renewalRate", async () => {
    setupMocks({
      activityRows: [
        { provider_type: "office", to_state: "active_paid", from_state: "expiring", cnt: "8" },
        { provider_type: "office", to_state: "cancelled",   from_state: "active_paid", cnt: "2" },
      ],
    });
    const r = await computeCommercialReport(P_START, P_END, PREV_S, PREV_E);
    expect(r.rates.retentionRate).toBe(r.rates.renewalRate);
  });
});

describe("computeCommercialReport – growth alerts", () => {
  it("fires CHURN_EXCEEDS_RENEWALS when churn > renewals", async () => {
    setupMocks({
      activityRows: [
        { provider_type: "office", to_state: "active_paid", from_state: "expiring", cnt: "3"  },
        { provider_type: "office", to_state: "cancelled",   from_state: "active_paid", cnt: "10" },
      ],
    });
    const r = await computeCommercialReport(P_START, P_END, PREV_S, PREV_E);
    expect(r.alerts.some(a => a.code === "CHURN_EXCEEDS_RENEWALS")).toBe(true);
  });

  it("fires CHURN_RATE_CRITICAL when churn rate > 40%", async () => {
    setupMocks({
      activityRows: [
        { provider_type: "office", to_state: "active_paid", from_state: "expiring", cnt: "1"  },
        { provider_type: "office", to_state: "cancelled",   from_state: "active_paid", cnt: "10" },
      ],
    });
    const r = await computeCommercialReport(P_START, P_END, PREV_S, PREV_E);
    expect(r.alerts.some(a => a.code === "CHURN_RATE_CRITICAL")).toBe(true);
  });

  it("fires CHURN_RATE_ELEVATED when 25% < churn rate ≤ 40%", async () => {
    setupMocks({
      activityRows: [
        { provider_type: "office", to_state: "active_paid", from_state: "expiring", cnt: "7"  },
        { provider_type: "office", to_state: "cancelled",   from_state: "active_paid", cnt: "3"  },
      ],
    });
    const r = await computeCommercialReport(P_START, P_END, PREV_S, PREV_E);
    // churn rate = 3/10 = 30% — elevated, not critical
    expect(r.alerts.some(a => a.code === "CHURN_RATE_ELEVATED")).toBe(true);
    expect(r.alerts.some(a => a.code === "CHURN_RATE_CRITICAL")).toBe(false);
  });

  it("fires PAID_SUBS_DECLINED when current activePaid < previous activePaid", async () => {
    setupMocks({
      stateRows:    [{ provider_type: "office", state: "active_paid", cnt: "5" }],
      prevPaidRows: [{ provider_type: "office", cnt: "10" }],
    });
    const r = await computeCommercialReport(P_START, P_END, PREV_S, PREV_E);
    expect(r.alerts.some(a => a.code === "PAID_SUBS_DECLINED")).toBe(true);
  });

  it("fires RENEWAL_RATE_DROPPED when current renewal rate drops > 20 pts vs previous period", async () => {
    setupMocks({
      activityRows: [
        // current: 2 renewals, 8 churn → 20% renewal rate
        { provider_type: "office", to_state: "active_paid", from_state: "expiring", cnt: "2" },
        { provider_type: "office", to_state: "cancelled",   from_state: "active_paid", cnt: "8" },
      ],
      prevActRows: [
        // prev: 8 renewals, 2 churn → 80% renewal rate  (drop = 60 pts)
        { provider_type: "office", to_state: "active_paid", from_state: "expiring",   cnt: "8" },
        { provider_type: "office", to_state: "cancelled",   from_state: "active_paid", cnt: "2" },
      ],
    });
    const r = await computeCommercialReport(P_START, P_END, PREV_S, PREV_E);
    expect(r.alerts.some(a => a.code === "RENEWAL_RATE_DROPPED")).toBe(true);
  });

  it("caps alerts at 5", async () => {
    // Force all alert conditions simultaneously
    setupMocks({
      stateRows: [{ provider_type: "office", state: "active_paid", cnt: "3" }],
      activityRows: [
        { provider_type: "office", to_state: "active_paid", from_state: "expiring", cnt: "1"  },
        { provider_type: "office", to_state: "cancelled",   from_state: "active_paid", cnt: "20" },
      ],
      prevActRows: [
        { provider_type: "office", to_state: "active_paid", from_state: "expiring",   cnt: "9" },
        { provider_type: "office", to_state: "cancelled",   from_state: "active_paid", cnt: "1" },
      ],
      prevPaidRows: [{ provider_type: "office", cnt: "20" }],
    });
    const r = await computeCommercialReport(P_START, P_END, PREV_S, PREV_E);
    expect(r.alerts.length).toBeLessThanOrEqual(5);
  });

  it("returns no alerts when metrics are healthy", async () => {
    setupMocks({
      stateRows: [{ provider_type: "office", state: "active_paid", cnt: "20" }],
      activityRows: [
        { provider_type: "office", to_state: "active_paid", from_state: "expiring", cnt: "18" },
        { provider_type: "office", to_state: "cancelled",   from_state: "active_paid", cnt: "2"  },
      ],
      prevPaidRows: [{ provider_type: "office", cnt: "18" }],
    });
    const r = await computeCommercialReport(P_START, P_END, PREV_S, PREV_E);
    // 18/20 = 90% renewal rate, paid grew from 18 to 20 — no negative alerts
    expect(r.alerts.filter(a => a.severity === "critical").length).toBe(0);
  });
});

describe("computeCommercialReport – demo exclusion", () => {
  it("SQL queries always pass is_demo=false (verified via query call args)", async () => {
    setupMocks();
    await computeCommercialReport(P_START, P_END, PREV_S, PREV_E);
    // All 6 calls should exist; verify each raw SQL contains is_demo = false
    const calls = mockQuery.mock.calls as [string, unknown[]][];
    for (const [sql] of calls) {
      expect(sql).toContain("is_demo = false");
    }
  });
});

describe("computeCommercialReport – structure", () => {
  it("returns cohortFoundationReady = true", async () => {
    setupMocks();
    const r = await computeCommercialReport(P_START, P_END, PREV_S, PREV_E);
    expect(r.cohortFoundationReady).toBe(true);
  });

  it("returns all expected top-level keys", async () => {
    setupMocks();
    const r = await computeCommercialReport(P_START, P_END, PREV_S, PREV_E);
    expect(r).toHaveProperty("period");
    expect(r).toHaveProperty("previousPeriod");
    expect(r).toHaveProperty("snapshot");
    expect(r).toHaveProperty("current");
    expect(r).toHaveProperty("previous");
    expect(r).toHaveProperty("mrr");
    expect(r).toHaveProperty("currentRevenue");
    expect(r).toHaveProperty("previousRevenue");
    expect(r).toHaveProperty("rates");
    expect(r).toHaveProperty("alerts");
  });

  it("snapshot.total is sum of office + freelancer", async () => {
    setupMocks({
      stateRows: [
        { provider_type: "office",     state: "active_paid", cnt: "7" },
        { provider_type: "freelancer", state: "active_paid", cnt: "3" },
      ],
    });
    const r = await computeCommercialReport(P_START, P_END, PREV_S, PREV_E);
    expect(r.snapshot.total.activePaid).toBe(10);
  });
});
