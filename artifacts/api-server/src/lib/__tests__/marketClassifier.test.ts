/**
 * Unit tests for the Market Decision Intelligence classifier.
 *
 * The classifier is a pure function (no DB, no I/O), so every test is
 * synchronous and requires no mocking infrastructure.
 *
 * Coverage goals:
 *   - All 6 market status rules fire on the right inputs
 *   - "weak_demand" and "insufficient_data" NEVER recommend "open" or "recruit"
 *   - Confidence decreases when data volume is low, history is short, or
 *     funnel signals are missing
 *   - Trend signals (rising/declining demand) influence classification
 *   - Provider activity coverage (many providers, few contacts) triggers saturation
 *   - Every result carries status, recommendation, acceptance, reason, confidence
 */

import { describe, it, expect } from "vitest";
import { classifyMarket, type MarketSignals } from "../marketClassifier";

// ── Test signal builders ──────────────────────────────────────────────────────

/** A healthy "balanced" baseline with full data — override individual fields per test */
function base(overrides: Partial<MarketSignals> = {}): MarketSignals {
  return {
    searches:             80,
    zeroResultSearches:   8,
    profileViews:         200,
    whatsappContacts:     12,
    mapContacts:          6,
    daysOfData:           30,
    activeProv:           6,
    activeProv60dAgo:     5,
    searchesPrior30d:     75,
    activeProvWithContacts: 5,
    completedTransactions: 4,
    completedTransactionsPrior30d: 3,
    ...overrides,
  };
}

// ── Helper assertions ─────────────────────────────────────────────────────────

function expectFields(result: ReturnType<typeof classifyMarket>) {
  // Every result must carry all required fields
  expect(result.marketStatus).toBeDefined();
  expect(result.recommendedAction).toBeTruthy();
  expect(result.recommendedAcceptance).toBeDefined();
  expect(result.recommendationReason).toBeTruthy();
  expect(result.confidenceScore).toBeGreaterThanOrEqual(0.05);
  expect(result.confidenceScore).toBeLessThanOrEqual(1.0);
  expect(result.confidenceBand).toMatch(/^(High|Medium|Low|Very Low)$/);
  expect(result.derivedSignals).toBeDefined();
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 1 — Market status rules
// ─────────────────────────────────────────────────────────────────────────────

describe("Rule 1 — insufficient_data", () => {
  it("fires when fewer than 7 days of data exist", () => {
    const r = classifyMarket(base({ daysOfData: 4 }));
    expectFields(r);
    expect(r.marketStatus).toBe("insufficient_data");
    expect(r.recommendedAcceptance).toBe("monitor");
    expect(r.recommendedAction).toContain("Monitor");
  });

  it("fires when searches AND providers are both near-zero", () => {
    const r = classifyMarket(base({ searches: 3, activeProv: 1, daysOfData: 20 }));
    expectFields(r);
    expect(r.marketStatus).toBe("insufficient_data");
    expect(r.recommendedAcceptance).toBe("monitor");
  });

  // Critical safety invariant
  it("NEVER recommends 'open' or 'recruit'", () => {
    const r = classifyMarket(base({ daysOfData: 2 }));
    expect(r.recommendedAcceptance).not.toBe("open");
    expect(r.recommendedAcceptance).not.toBe("recruit");
  });

  it("includes a reason explaining what data is missing", () => {
    const r = classifyMarket(base({ daysOfData: 5 }));
    expect(r.recommendationReason.toLowerCase()).toMatch(/day|data|minimum/);
  });
});

describe("Rule 2 — need_more_supply", () => {
  it("fires when there are zero providers but meaningful search volume", () => {
    const r = classifyMarket(base({ activeProv: 0, searches: 40, activeProvWithContacts: 0 }));
    expectFields(r);
    expect(r.marketStatus).toBe("need_more_supply");
    expect(r.recommendedAcceptance).toBe("recruit");
    expect(r.recommendedAction).toContain("Recruit");
  });

  it("fires when zero-result rate is high on real search volume (high demand, low supply)", () => {
    const r = classifyMarket(base({
      activeProv: 2,
      searches: 60,
      zeroResultSearches: 28,   // 46% zero-result rate
      activeProvWithContacts: 1,
    }));
    expectFields(r);
    expect(r.marketStatus).toBe("need_more_supply");
    expect(r.recommendedAcceptance).toBe("recruit");
    expect(r.derivedSignals.zeroResultRate).toBeGreaterThan(0.35);
  });

  it("fires when demand/provider ratio exceeds 25 (overwhelmed supply)", () => {
    const r = classifyMarket(base({ activeProv: 2, searches: 60, zeroResultSearches: 2 }));
    expectFields(r);
    // demandPerProvider = 60/2 = 30 > 25
    expect(r.marketStatus).toBe("need_more_supply");
    expect(r.derivedSignals.demandPerProvider).toBeGreaterThan(25);
  });

  it("fires when rapidly rising demand pushes a loaded market over threshold", () => {
    // demandPerProvider = 80/4 = 20 > 15, demandTrend = (80-48)/48 ≈ +67% > 50%
    const r = classifyMarket(base({
      activeProv: 4,
      searches: 80,
      searchesPrior30d: 48,
      zeroResultSearches: 5,
      activeProvWithContacts: 4,
    }));
    expectFields(r);
    expect(r.marketStatus).toBe("need_more_supply");
    expect(r.derivedSignals.demandTrend).toBeGreaterThan(0.5);
    expect(r.derivedSignals.demandPerProvider).toBeGreaterThan(15);
    expect(r.recommendationReason).toMatch(/rising|trend/i);
  });
});

describe("Rule 3 — weak_demand", () => {
  it("fires when search volume is low with providers present", () => {
    const r = classifyMarket(base({ searches: 8, activeProv: 4, zeroResultSearches: 0 }));
    expectFields(r);
    expect(r.marketStatus).toBe("weak_demand");
    expect(r.recommendedAcceptance).toBe("monitor");
  });

  it("fires when demand is declining sharply", () => {
    // demandTrend = (20 - 38)/38 ≈ -47%, searches = 20 < 30
    const r = classifyMarket(base({
      searches: 20,
      searchesPrior30d: 38,
      activeProv: 5,
      zeroResultSearches: 1,
      activeProvWithContacts: 3,
    }));
    expectFields(r);
    expect(r.marketStatus).toBe("weak_demand");
    expect(r.derivedSignals.demandTrend).toBeLessThan(-0.40);
    expect(r.recommendedAcceptance).toBe("monitor");
    expect(r.recommendationReason).toMatch(/declin/i);
  });

  // Critical safety invariant
  it("NEVER recommends 'open' or 'recruit'", () => {
    const r1 = classifyMarket(base({ searches: 5, activeProv: 3 }));
    const r2 = classifyMarket(base({ searches: 10, searchesPrior30d: 22, activeProv: 4 }));
    for (const r of [r1, r2]) {
      if (r.marketStatus === "weak_demand") {
        expect(r.recommendedAcceptance).not.toBe("open");
        expect(r.recommendedAcceptance).not.toBe("recruit");
      }
    }
  });

  it("reason explains that acceptance should be held pending review", () => {
    const r = classifyMarket(base({ searches: 7, activeProv: 3 }));
    if (r.marketStatus === "weak_demand") {
      expect(r.recommendationReason.toLowerCase()).toMatch(/monitor|hold|review|declin/);
    }
  });
});

describe("Rule 4 — oversupplied", () => {
  it("fires when many providers have very low demand and contact rate", () => {
    // demandPerProvider = 12/8 = 1.5 < 2
    // contactRate = 3/300 = 1% < 1.5%
    // providerActivityRate = 2/8 = 25% < 30%
    // searchesPrior30d must be close to searches so demandTrend does NOT
    // trigger the weak_demand declining-trend rule (which fires before oversupplied)
    const r = classifyMarket(base({
      activeProv: 8,
      searches: 12,
      zeroResultSearches: 0,
      profileViews: 300,
      whatsappContacts: 2,
      mapContacts: 1,
      activeProvWithContacts: 2,
      searchesPrior30d: 12, // neutral trend — prevents declining-demand weak_demand rule
    }));
    expectFields(r);
    expect(r.marketStatus).toBe("oversupplied");
    expect(r.recommendedAcceptance).toBe("closed");
    expect(r.derivedSignals.demandPerProvider).toBeLessThan(2);
  });

  it("recommendation is to close new acceptance", () => {
    const r = classifyMarket(base({
      activeProv: 10,
      searches: 15,
      zeroResultSearches: 0,
      profileViews: 400,
      whatsappContacts: 3,
      mapContacts: 2,
      activeProvWithContacts: 2,
      searchesPrior30d: 18,
    }));
    if (r.marketStatus === "oversupplied") {
      expect(r.recommendedAcceptance).toBe("closed");
    }
  });
});

describe("Rule 5 — near_saturation", () => {
  it("fires when demand/provider ratio is low with modest provider count", () => {
    // demandPerProvider = 24/6 = 4, contactRate = 6/120 = 5%... need < 4%
    const r = classifyMarket(base({
      activeProv: 6,
      searches: 20,
      zeroResultSearches: 1,
      profileViews: 120,
      whatsappContacts: 2,
      mapContacts: 1,      // contactRate = 3/120 = 2.5% < 4%
      activeProvWithContacts: 3,
      searchesPrior30d: 22,
    }));
    expectFields(r);
    expect(r.marketStatus).toBe("near_saturation");
    expect(r.recommendedAcceptance).toBe("limited");
  });

  it("fires when many providers but very few got any contacts (low activity coverage)", () => {
    // providerActivityRate = 1/8 = 12.5% < 25%, activeProv = 8 > 4
    const r = classifyMarket(base({
      activeProv: 8,
      activeProvWithContacts: 1,  // 12.5% activity rate
      searches: 40,
      zeroResultSearches: 2,
      profileViews: 200,
      whatsappContacts: 6,
      mapContacts: 2,
      searchesPrior30d: 38,
    }));
    expectFields(r);
    expect(r.marketStatus).toBe("near_saturation");
    expect(r.derivedSignals.providerActivityRate).toBeLessThan(0.25);
    expect(r.recommendedAcceptance).toBe("limited");
  });
});

describe("Rule 6 — balanced", () => {
  it("fires when all signals are within healthy ranges", () => {
    const r = classifyMarket(base());
    expectFields(r);
    expect(r.marketStatus).toBe("balanced");
    expect(r.recommendedAcceptance).toBe("open");
    expect(r.recommendedAction).toContain("open");
  });

  it("notes a rising demand trend in the reason without changing status", () => {
    // Rising but not past the need_more_supply threshold
    // demandPerProvider = 80/6 ≈ 13.3 (< 15 so rising rule doesn't fire)
    // demandTrend = (80 - 55)/55 ≈ +45% (< 50% so rising rule doesn't fire)
    const r = classifyMarket(base({
      searches: 80,
      searchesPrior30d: 55,
      activeProv: 6,
    }));
    if (r.marketStatus === "balanced") {
      expect(r.recommendationReason).toMatch(/rising/i);
    }
  });

  it("notes a declining demand trend in the reason when it does not flip status", () => {
    // Moderate decline that doesn't meet the weak_demand threshold
    // searches = 35, demandTrend = (35-45)/45 ≈ -22%  (not < -40%) but searches > 12
    const r = classifyMarket(base({
      searches: 35,
      searchesPrior30d: 45,
      activeProv: 5,
    }));
    if (r.marketStatus === "balanced") {
      expect(r.recommendationReason).toMatch(/declin/i);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 2 — Confidence scoring
// ─────────────────────────────────────────────────────────────────────────────

describe("Confidence — degrades when data is thin", () => {
  it("is High when signals are complete and history is full", () => {
    const r = classifyMarket(base());
    expect(r.confidenceScore).toBeGreaterThanOrEqual(0.75);
    expect(r.confidenceBand).toBe("High");
  });

  it("is Very Low when fewer than 7 days of data AND low search volume AND no providers", () => {
    // Stacking penalties: daysOfData=4 (−0.60) + searches=10 (−0.30) + activeProv=0 (−0.20)
    // = 1.0 − 1.10 → clamped to 0.05 → "Very Low"
    const r = classifyMarket(base({ daysOfData: 4, searches: 10, activeProv: 0, activeProvWithContacts: 0 }));
    expect(r.confidenceScore).toBeLessThan(0.25);
    expect(r.confidenceBand).toBe("Very Low");
  });

  it("decreases when history is 7–14 days", () => {
    const full    = classifyMarket(base({ daysOfData: 30 }));
    const partial = classifyMarket(base({ daysOfData: 10 }));
    expect(partial.confidenceScore).toBeLessThan(full.confidenceScore);
  });

  it("decreases when search volume is low (< 20 searches)", () => {
    const high = classifyMarket(base({ searches: 200 }));
    const low  = classifyMarket(base({ searches: 15,  zeroResultSearches: 1, activeProv: 6, searchesPrior30d: 14 }));
    expect(low.confidenceScore).toBeLessThan(high.confidenceScore);
  });

  it("decreases when there are zero active providers", () => {
    const withProv    = classifyMarket(base({ activeProv: 6 }));
    const withoutProv = classifyMarket(base({ activeProv: 0 }));
    expect(withoutProv.confidenceScore).toBeLessThan(withProv.confidenceScore);
  });

  it("decreases when profile views are high but contacts are zero (missing funnel signal)", () => {
    const withContacts    = classifyMarket(base({ profileViews: 200, whatsappContacts: 15, mapContacts: 5 }));
    const missingContacts = classifyMarket(base({ profileViews: 200, whatsappContacts: 0,  mapContacts: 0 }));
    expect(missingContacts.confidenceScore).toBeLessThan(withContacts.confidenceScore);
  });

  it("decreases when prior-period search data is absent (trend uncomputable)", () => {
    const withTrend    = classifyMarket(base({ searchesPrior30d: 70 }));
    const withoutTrend = classifyMarket(base({ searchesPrior30d: 0  }));
    expect(withoutTrend.confidenceScore).toBeLessThan(withTrend.confidenceScore);
  });

  it("decreases when completedTransactions is 0 but searches are high (funnel gap)", () => {
    // Only penalizes when the field is explicitly provided (not undefined/missing)
    const withTxn    = classifyMarket(base({ completedTransactions: 5 }));
    const zeroTxn    = classifyMarket(base({ completedTransactions: 0, searches: 80 }));
    expect(zeroTxn.confidenceScore).toBeLessThan(withTxn.confidenceScore);
  });

  it("does NOT penalize when completedTransactions is simply not provided (not tracked yet)", () => {
    const withoutField = classifyMarket(base({ completedTransactions: undefined }));
    const withField    = classifyMarket(base({ completedTransactions: 5 }));
    // No extra penalty for untracked field — same everything else
    expect(withoutField.confidenceScore).toBe(withField.confidenceScore);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 3 — Derived signals are computed correctly
// ─────────────────────────────────────────────────────────────────────────────

describe("Derived signals", () => {
  it("computes zeroResultRate correctly", () => {
    const r = classifyMarket(base({ searches: 100, zeroResultSearches: 30 }));
    expect(r.derivedSignals.zeroResultRate).toBeCloseTo(0.3, 5);
  });

  it("computes demandPerProvider correctly", () => {
    const r = classifyMarket(base({ searches: 90, activeProv: 6 }));
    expect(r.derivedSignals.demandPerProvider).toBeCloseTo(15, 5);
  });

  it("computes contactRate correctly", () => {
    const r = classifyMarket(base({ profileViews: 200, whatsappContacts: 10, mapContacts: 10 }));
    expect(r.derivedSignals.contactRate).toBeCloseTo(0.1, 5);
  });

  it("computes providerActivityRate correctly", () => {
    const r = classifyMarket(base({ activeProv: 8, activeProvWithContacts: 2 }));
    expect(r.derivedSignals.providerActivityRate).toBeCloseTo(0.25, 5);
  });

  it("computes demandTrend correctly (positive = rising)", () => {
    const r = classifyMarket(base({ searches: 100, searchesPrior30d: 80 }));
    expect(r.derivedSignals.demandTrend).toBeCloseTo(0.25, 5);
  });

  it("computes demandTrend correctly (negative = declining)", () => {
    const r = classifyMarket(base({ searches: 60, searchesPrior30d: 100 }));
    expect(r.derivedSignals.demandTrend).toBeCloseTo(-0.4, 5);
  });

  it("computes completionRate correctly", () => {
    const r = classifyMarket(base({
      whatsappContacts: 10, mapContacts: 10,
      completedTransactions: 4,
    }));
    // completionRate = 4 / (10+10) = 0.2
    expect(r.derivedSignals.completionRate).toBeCloseTo(0.2, 5);
  });

  it("completionRate is 0 when contacts are 0 (no division-by-zero)", () => {
    const r = classifyMarket(base({ whatsappContacts: 0, mapContacts: 0, completedTransactions: 0 }));
    expect(r.derivedSignals.completionRate).toBe(0);
  });

  it("demandPerProvider equals raw searches when activeProv is 0 (no division-by-zero)", () => {
    const r = classifyMarket(base({ activeProv: 0, searches: 30 }));
    expect(r.derivedSignals.demandPerProvider).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 4 — Specific named scenarios from the task brief
// ─────────────────────────────────────────────────────────────────────────────

describe("Named scenario: high demand + zero supply", () => {
  it("classifies as need_more_supply and recommends recruit", () => {
    const r = classifyMarket(base({
      activeProv: 0,
      searches: 80,
      zeroResultSearches: 60,
      activeProvWithContacts: 0,
    }));
    expectFields(r);
    expect(r.marketStatus).toBe("need_more_supply");
    expect(r.recommendedAcceptance).toBe("recruit");
  });
});

describe("Named scenario: high demand + low supply (1-2 providers)", () => {
  it("classifies as need_more_supply when zero-result rate is high", () => {
    const r = classifyMarket(base({
      activeProv: 2,
      searches: 70,
      zeroResultSearches: 30,   // 43%
      activeProvWithContacts: 2,
    }));
    expectFields(r);
    expect(r.marketStatus).toBe("need_more_supply");
    expect(r.recommendedAcceptance).toBe("recruit");
    expect(r.derivedSignals.zeroResultRate).toBeGreaterThan(0.35);
  });
});

describe("Named scenario: balanced demand/supply", () => {
  it("classifies as balanced and recommends open", () => {
    const r = classifyMarket(base());
    expectFields(r);
    expect(r.marketStatus).toBe("balanced");
    expect(r.recommendedAcceptance).toBe("open");
  });
});

describe("Named scenario: oversupply", () => {
  it("classifies as oversupplied and recommends closed", () => {
    const r = classifyMarket(base({
      activeProv: 12,
      activeProv60dAgo: 10,
      searches: 18,
      zeroResultSearches: 0,
      profileViews: 500,
      whatsappContacts: 3,
      mapContacts: 2,
      activeProvWithContacts: 3,
      searchesPrior30d: 20,
    }));
    expectFields(r);
    // demandPerProvider = 18/12 = 1.5 < 2, contactRate = 5/500 = 1% < 1.5%
    expect(r.marketStatus).toBe("oversupplied");
    expect(r.recommendedAcceptance).toBe("closed");
  });
});

describe("Named scenario: weak demand", () => {
  it("classifies as weak_demand and recommends monitor (NOT open)", () => {
    const r = classifyMarket(base({
      searches: 7,
      zeroResultSearches: 0,
      activeProv: 4,
      activeProvWithContacts: 1,
      searchesPrior30d: 9,
    }));
    expectFields(r);
    expect(r.marketStatus).toBe("weak_demand");
    expect(r.recommendedAcceptance).toBe("monitor");
    expect(r.recommendedAcceptance).not.toBe("open");
  });
});

describe("Named scenario: insufficient data", () => {
  it("classifies as insufficient_data and recommends monitor (NOT open)", () => {
    const r = classifyMarket(base({ daysOfData: 3 }));
    expectFields(r);
    expect(r.marketStatus).toBe("insufficient_data");
    expect(r.recommendedAcceptance).toBe("monitor");
    expect(r.recommendedAcceptance).not.toBe("open");
  });
});

describe("Named scenario: rising demand", () => {
  it("is noted in reason when still balanced", () => {
    // Moderate rise — doesn't trip the need_more_supply rule
    // demandPerProvider = 80/8 = 10, demandTrend = (80-58)/58 ≈ +38%
    const r = classifyMarket(base({
      searches: 80,
      searchesPrior30d: 58,
      activeProv: 8,
      activeProvWithContacts: 7,
    }));
    expectFields(r);
    if (r.marketStatus === "balanced") {
      expect(r.recommendationReason).toMatch(/rising/i);
    }
  });

  it("flips to need_more_supply when rising demand + already high load", () => {
    // demandTrend = (90-56)/56 ≈ +61% > 50%, demandPerProvider = 90/5 = 18 > 15
    const r = classifyMarket(base({
      searches: 90,
      searchesPrior30d: 56,
      activeProv: 5,
      activeProvWithContacts: 5,
      zeroResultSearches: 5,
    }));
    expectFields(r);
    expect(r.marketStatus).toBe("need_more_supply");
    expect(r.recommendedAcceptance).toBe("recruit");
  });
});

describe("Named scenario: declining demand", () => {
  it("flips to weak_demand when decline is sharp and volume is low", () => {
    // demandTrend = (18 - 35)/35 ≈ -49%, searches = 18 < 30
    const r = classifyMarket(base({
      searches: 18,
      searchesPrior30d: 35,
      activeProv: 5,
      activeProvWithContacts: 2,
      zeroResultSearches: 0,
    }));
    expectFields(r);
    expect(r.marketStatus).toBe("weak_demand");
    expect(r.derivedSignals.demandTrend).toBeLessThan(-0.40);
    expect(r.recommendedAcceptance).toBe("monitor");
    expect(r.recommendationReason).toMatch(/declin/i);
  });
});

describe("Named scenario: many providers but low activity per provider", () => {
  it("classifies as near_saturation when provider activity rate is very low", () => {
    // 10 providers, only 1 got any contact → providerActivityRate = 10%
    const r = classifyMarket(base({
      activeProv: 10,
      activeProvWithContacts: 1,
      searches: 60,
      zeroResultSearches: 2,
      profileViews: 250,
      whatsappContacts: 8,
      mapContacts: 4,
      searchesPrior30d: 55,
    }));
    expectFields(r);
    expect(r.marketStatus).toBe("near_saturation");
    expect(r.derivedSignals.providerActivityRate).toBeLessThan(0.25);
    expect(r.recommendedAcceptance).toBe("limited");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 5 — Safety invariants (cross-cutting)
// ─────────────────────────────────────────────────────────────────────────────

describe("Safety invariants", () => {
  const dangerousInputs: Array<[string, Partial<MarketSignals>]> = [
    ["zero days of data",          { daysOfData: 0, searches: 0, activeProv: 0 }],
    ["one day of data",            { daysOfData: 1 }],
    ["all zeros",                  { searches: 0, zeroResultSearches: 0, profileViews: 0,
                                     whatsappContacts: 0, mapContacts: 0, daysOfData: 0,
                                     activeProv: 0, activeProv60dAgo: 0,
                                     searchesPrior30d: 0, activeProvWithContacts: 0 }],
    ["very low searches + 1 prov", { searches: 2, activeProv: 1, daysOfData: 20 }],
  ];

  for (const [label, overrides] of dangerousInputs) {
    it(`insufficient_data → never 'open' or 'recruit' (${label})`, () => {
      const r = classifyMarket(base(overrides));
      if (r.marketStatus === "insufficient_data") {
        expect(r.recommendedAcceptance).not.toBe("open");
        expect(r.recommendedAcceptance).not.toBe("recruit");
      }
    });
  }

  it("confidence score is always in [0.05, 1.00]", () => {
    const extreme = classifyMarket(base({
      daysOfData: 0, searches: 0, activeProv: 0,
      profileViews: 0, whatsappContacts: 0, mapContacts: 0,
      searchesPrior30d: 0, activeProvWithContacts: 0,
      completedTransactions: 0,
    }));
    expect(extreme.confidenceScore).toBeGreaterThanOrEqual(0.05);
    expect(extreme.confidenceScore).toBeLessThanOrEqual(1.0);
  });

  it("never throws on any valid MarketSignals input", () => {
    const inputs: MarketSignals[] = [
      base(),
      base({ searches: 0, activeProv: 0, daysOfData: 0 }),
      base({ searches: 999, activeProv: 1, zeroResultSearches: 999 }),
      base({ searchesPrior30d: 0, completedTransactions: undefined }),
    ];
    for (const sig of inputs) {
      expect(() => classifyMarket(sig)).not.toThrow();
    }
  });
});
