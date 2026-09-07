/**
 * Office Report Engine — comprehensive unit tests.
 *
 * Tests all pure functions (computeChange, metricPair, computeRatePair,
 * isProfileComplete, missingProfileItem, computeRecommendation,
 * computeOpportunity) and the period-parsing helper without any database.
 *
 * Route-level auth and ownership integration tests are in
 * officeReportRoute.test.ts — they require DATABASE_URL and are skipped
 * when the env var is absent.
 */

import { describe, it, expect } from "vitest";
import {
  computeChange,
  metricPair,
  computeRatePair,
  isProfileComplete,
  missingProfileItem,
  computeRecommendation,
  computeOpportunity,
  THRESHOLDS,
  type ProfileCompletenessInput,
  type RecommendationInput,
} from "../officeReportEngine";

// ── Helpers ───────────────────────────────────────────────────────────────────

const COMPLETE_PROFILE: ProfileCompletenessInput = {
  hasWhatsapp: true,
  hasDescription: true,
  hasCoverUrl: true,
  servicesCount: 3,
};

function recInput(
  overrides: Partial<RecommendationInput> = {},
): RecommendationInput {
  return {
    profile: COMPLETE_PROFILE,
    profileViews: 50,
    cardImpressions: 200,
    contactActions: 10,
    topService: null,
    topCity: null,
    ...overrides,
  };
}

// ── computeChange ─────────────────────────────────────────────────────────────

describe("computeChange", () => {
  it("returns positive percentage for growth", () => {
    expect(computeChange(110, 100)).toBe(10);
  });

  it("returns negative percentage for decline", () => {
    expect(computeChange(80, 100)).toBe(-20);
  });

  it("returns null when both are 0", () => {
    expect(computeChange(0, 0)).toBeNull();
  });

  it("returns null (New) when previous=0 and current>0", () => {
    expect(computeChange(5, 0)).toBeNull();
  });

  it("rounds to nearest integer", () => {
    expect(computeChange(103, 100)).toBe(3);
    expect(computeChange(107, 100)).toBe(7);
  });

  it("handles 100% growth correctly", () => {
    expect(computeChange(200, 100)).toBe(100);
  });

  it("handles large decline correctly", () => {
    expect(computeChange(1, 100)).toBe(-99);
  });
});

// ── metricPair ────────────────────────────────────────────────────────────────

describe("metricPair", () => {
  it("builds a pair with change", () => {
    const p = metricPair(120, 100);
    expect(p.current).toBe(120);
    expect(p.previous).toBe(100);
    expect(p.change).toBe(20);
  });

  it("change is null when both are 0", () => {
    const p = metricPair(0, 0);
    expect(p.change).toBeNull();
  });

  it("change is null (New) when previous was 0", () => {
    const p = metricPair(5, 0);
    expect(p.change).toBeNull();
  });
});

// ── computeRatePair ───────────────────────────────────────────────────────────

describe("computeRatePair", () => {
  it("computes rate percentages from counts", () => {
    const r = computeRatePair(10, 100, 5, 100);
    expect(r.current).toBeCloseTo(10, 5);
    expect(r.previous).toBeCloseTo(5, 5);
  });

  it("returns null current when views = 0", () => {
    const r = computeRatePair(0, 0, 5, 100);
    expect(r.current).toBeNull();
  });

  it("returns null previous when prev views = 0", () => {
    const r = computeRatePair(10, 100, 0, 0);
    expect(r.previous).toBeNull();
  });

  it("change is null when previous rate is null", () => {
    const r = computeRatePair(10, 100, 0, 0);
    expect(r.change).toBeNull();
  });

  it("computes change in rate (not absolute contacts)", () => {
    // Rate went from 5% to 10% → +100% change in rate
    const r = computeRatePair(10, 100, 5, 100);
    expect(r.change).toBe(100);
  });
});

// ── isProfileComplete ─────────────────────────────────────────────────────────

describe("isProfileComplete", () => {
  it("returns true when all fields present", () => {
    expect(isProfileComplete(COMPLETE_PROFILE)).toBe(true);
  });

  it("returns false when whatsapp missing", () => {
    expect(isProfileComplete({ ...COMPLETE_PROFILE, hasWhatsapp: false })).toBe(false);
  });

  it("returns false when description missing", () => {
    expect(isProfileComplete({ ...COMPLETE_PROFILE, hasDescription: false })).toBe(false);
  });

  it("returns false when cover missing", () => {
    expect(isProfileComplete({ ...COMPLETE_PROFILE, hasCoverUrl: false })).toBe(false);
  });

  it("returns false when no services", () => {
    expect(isProfileComplete({ ...COMPLETE_PROFILE, servicesCount: 0 })).toBe(false);
  });
});

// ── missingProfileItem ────────────────────────────────────────────────────────

describe("missingProfileItem", () => {
  it("returns null for complete profile", () => {
    expect(missingProfileItem(COMPLETE_PROFILE)).toBeNull();
  });

  it("returns contact when whatsapp missing (highest priority)", () => {
    const p = missingProfileItem({
      hasWhatsapp: false,
      hasDescription: false,
      hasCoverUrl: false,
      servicesCount: 0,
    });
    expect(p?.target).toBe("contact");
  });

  it("returns services when services=0 and contact present", () => {
    const p = missingProfileItem({
      hasWhatsapp: true,
      hasDescription: true,
      hasCoverUrl: true,
      servicesCount: 0,
    });
    expect(p?.target).toBe("services");
  });

  it("returns media when cover missing and contact+services present", () => {
    const p = missingProfileItem({
      hasWhatsapp: true,
      hasDescription: true,
      hasCoverUrl: false,
      servicesCount: 2,
    });
    expect(p?.target).toBe("media");
  });

  it("returns profile when only description missing", () => {
    const p = missingProfileItem({
      hasWhatsapp: true,
      hasDescription: false,
      hasCoverUrl: true,
      servicesCount: 2,
    });
    expect(p?.target).toBe("profile");
  });
});

// ── computeRecommendation ─────────────────────────────────────────────────────

describe("computeRecommendation — priority 1: incomplete profile", () => {
  it("fires when contact method missing — target=contact", () => {
    const r = computeRecommendation(
      recInput({ profile: { ...COMPLETE_PROFILE, hasWhatsapp: false } }),
    );
    expect(r.priority).toBe(1);
    expect(r.actionTarget).toBe("contact");
    expect(r.titleEn).toBeTruthy();
    expect(r.titleAr).toBeTruthy();
  });

  it("fires when services missing — target=services", () => {
    const r = computeRecommendation(
      recInput({ profile: { ...COMPLETE_PROFILE, servicesCount: 0 } }),
    );
    expect(r.priority).toBe(1);
    expect(r.actionTarget).toBe("services");
  });

  it("fires when cover missing — target=media", () => {
    const r = computeRecommendation(
      recInput({ profile: { ...COMPLETE_PROFILE, hasCoverUrl: false } }),
    );
    expect(r.priority).toBe(1);
    expect(r.actionTarget).toBe("media");
  });

  it("fires when description missing — target=profile", () => {
    const r = computeRecommendation(
      recInput({ profile: { ...COMPLETE_PROFILE, hasDescription: false } }),
    );
    expect(r.priority).toBe(1);
    expect(r.actionTarget).toBe("profile");
  });

  it("priority 1 beats insufficient data", () => {
    // Even with 0 profile views, incomplete profile should win
    const r = computeRecommendation(
      recInput({
        profile: { ...COMPLETE_PROFILE, hasWhatsapp: false },
        profileViews: 0,
      }),
    );
    expect(r.priority).toBe(1);
  });

  it("priority 1 beats low CTR", () => {
    // High impressions, low CTR, but profile incomplete
    const r = computeRecommendation(
      recInput({
        profile: { ...COMPLETE_PROFILE, hasCoverUrl: false },
        cardImpressions: 100,
        profileViews: 1,
      }),
    );
    expect(r.priority).toBe(1);
  });
});

describe("computeRecommendation — priority 2: insufficient data", () => {
  it("fires when profileViews < threshold and profile complete", () => {
    const r = computeRecommendation(
      recInput({ profileViews: THRESHOLDS.INSUFFICIENT_DATA_PROFILE_VIEWS - 1 }),
    );
    expect(r.priority).toBe(2);
    expect(r.actionTarget).toBe("copy_link");
  });

  it("does NOT fire at exactly the threshold", () => {
    const r = computeRecommendation(
      recInput({
        profileViews: THRESHOLDS.INSUFFICIENT_DATA_PROFILE_VIEWS,
        cardImpressions: 5,
        contactActions: 0,
      }),
    );
    // Should fall through to a different priority
    expect(r.priority).not.toBe(2);
  });

  it("priority 2 is overridden by priority 1 even with 0 views", () => {
    const r = computeRecommendation(
      recInput({
        profile: { ...COMPLETE_PROFILE, hasWhatsapp: false },
        profileViews: 0,
      }),
    );
    expect(r.priority).toBe(1);
  });
});

describe("computeRecommendation — priority 3: low card CTR", () => {
  it("fires when impressions >= threshold and CTR < 5%", () => {
    // profileViews must be >= INSUFFICIENT_DATA_PROFILE_VIEWS (5) so priority 2
    // does not fire first. 5/200 = 2.5% CTR < 5% threshold → priority 3.
    const r = computeRecommendation(
      recInput({
        cardImpressions: 200,
        profileViews: 5,
        contactActions: 0,
      }),
    );
    expect(r.priority).toBe(3);
    expect(r.actionTarget).toBe("media");
  });

  it("does NOT fire when impressions below threshold", () => {
    const r = computeRecommendation(
      recInput({
        cardImpressions: THRESHOLDS.MIN_IMPRESSIONS_FOR_RATE_ANALYSIS - 1,
        profileViews: 0,
        contactActions: 0,
      }),
    );
    expect(r.priority).not.toBe(3);
  });

  it("does NOT fire when CTR >= 5%", () => {
    // impressions=100, views=5 → CTR=5% exactly, should not trigger
    const r = computeRecommendation(
      recInput({ cardImpressions: 100, profileViews: 5, contactActions: 0 }),
    );
    expect(r.priority).not.toBe(3);
  });

  it("contains actual numbers in body text", () => {
    // profileViews: 5 passes priority-2 threshold (< 5 → priority 2).
    // 5/200 = 2.5% CTR → priority 3 fires and body should mention impressions.
    const r = computeRecommendation(
      recInput({ cardImpressions: 200, profileViews: 5, contactActions: 0 }),
    );
    expect(r.priority).toBe(3);
    expect(r.bodyEn).toContain("200");
  });
});

describe("computeRecommendation — priority 4: low contact conversion", () => {
  it("fires when views >= threshold and conversion < 5%", () => {
    // cardImpressions must not trigger priority 3 first.
    // With cardImpressions: 50 and profileViews: 10 → CTR = 20% (not < 5%),
    // so priority 3 is skipped. contactActions: 0 → 0% conversion → priority 4.
    const r = computeRecommendation(
      recInput({
        cardImpressions: 50,
        profileViews: THRESHOLDS.MIN_PROFILE_VIEWS_FOR_CONVERSION,
        contactActions: 0,
      }),
    );
    expect(r.priority).toBe(4);
    expect(r.actionTarget).toBe("contact");
  });

  it("does NOT fire when views below threshold", () => {
    const r = computeRecommendation(
      recInput({
        cardImpressions: 300,
        profileViews: THRESHOLDS.MIN_PROFILE_VIEWS_FOR_CONVERSION - 1,
        contactActions: 0,
      }),
    );
    expect(r.priority).not.toBe(4);
  });

  it("does NOT fire when conversion >= 5%", () => {
    // views=20, contacts=1 → 5% exactly, should not trigger
    const r = computeRecommendation(
      recInput({
        cardImpressions: 300,
        profileViews: 20,
        contactActions: 1,
      }),
    );
    expect(r.priority).not.toBe(4);
  });

  it("includes actual view and contact counts in body", () => {
    const r = computeRecommendation(
      recInput({
        cardImpressions: 300,
        profileViews: 32,
        contactActions: 1,
      }),
    );
    expect(r.priority).toBe(4);
    expect(r.bodyEn).toContain("32");
    expect(r.bodyEn).toContain("1");
  });
});

describe("computeRecommendation — priority 5: low visibility", () => {
  it("fires when impressions < 10 and profileViews >= 5", () => {
    const r = computeRecommendation(
      recInput({
        cardImpressions: THRESHOLDS.LOW_IMPRESSIONS - 1,
        profileViews: THRESHOLDS.INSUFFICIENT_DATA_PROFILE_VIEWS,
        contactActions: 0,
      }),
    );
    expect(r.priority).toBe(5);
    expect(r.actionTarget).toBe("copy_link");
  });

  it("does NOT fire when impressions >= 10", () => {
    const r = computeRecommendation(
      recInput({
        cardImpressions: THRESHOLDS.LOW_IMPRESSIONS,
        profileViews: 10,
        contactActions: 0,
      }),
    );
    expect(r.priority).not.toBe(5);
  });
});

describe("computeRecommendation — priority 6: dominant service", () => {
  const topService = {
    nameEn: "Legal Consultation",
    nameAr: "استشارات قانونية",
    count: 10,
    share: 0.65,
  };

  it("fires when service share >= 60% with enough events", () => {
    const r = computeRecommendation(recInput({ topService }));
    expect(r.priority).toBe(6);
    expect(r.actionTarget).toBe("services");
    expect(r.bodyEn).toContain("Legal Consultation");
    expect(r.bodyAr).toContain("استشارات قانونية");
  });

  it("does NOT fire when service share < 60%", () => {
    const r = computeRecommendation(
      recInput({ topService: { ...topService, share: 0.59 } }),
    );
    expect(r.priority).not.toBe(6);
  });

  it("does NOT fire when count below threshold (checked via null topService)", () => {
    // Route passes null for topService when count < MIN; engine sees null
    const r = computeRecommendation(recInput({ topService: null }));
    expect(r.priority).not.toBe(6);
  });

  it("priority 3/4 beats priority 6", () => {
    // profileViews: 5 passes priority-2 check. 5/200 = 2.5% CTR < 5% → priority 3
    // fires before priority 6 even when a dominant service exists.
    const r = computeRecommendation(
      recInput({
        cardImpressions: 200,
        profileViews: 5,
        contactActions: 0,
        topService,
      }),
    );
    expect(r.priority).toBe(3);
  });
});

describe("computeRecommendation — priority 7: dominant city", () => {
  const topCity = {
    cityId: "riyadh",
    nameEn: "Riyadh",
    nameAr: "الرياض",
    count: 15,
    share: 0.55,
  };

  it("fires when city share >= 50% with enough events", () => {
    const r = computeRecommendation(recInput({ topCity }));
    expect(r.priority).toBe(7);
    expect(r.bodyEn).toContain("Riyadh");
    expect(r.bodyAr).toContain("الرياض");
  });

  it("does NOT fire when city share < 50%", () => {
    const r = computeRecommendation(recInput({ topCity: { ...topCity, share: 0.49 } }));
    expect(r.priority).not.toBe(7);
  });

  it("priority 6 beats priority 7", () => {
    const r = computeRecommendation(
      recInput({
        topService: {
          nameEn: "Accounting",
          nameAr: "محاسبة",
          count: 10,
          share: 0.65,
        },
        topCity,
      }),
    );
    expect(r.priority).toBe(6);
  });
});

describe("computeRecommendation — priority 8: healthy", () => {
  it("fires when all other checks pass", () => {
    const r = computeRecommendation(
      recInput({
        cardImpressions: 200,
        profileViews: 50,
        contactActions: 10, // 20% conversion — not low
      }),
    );
    expect(r.priority).toBe(8);
    expect(r.actionTarget).toBe("public_profile");
  });

  it("includes profile views in body", () => {
    const r = computeRecommendation(
      recInput({ cardImpressions: 200, profileViews: 50, contactActions: 10 }),
    );
    expect(r.bodyEn).toContain("50");
    expect(r.bodyEn).toContain("10");
  });

  it("all bilingual fields are non-empty", () => {
    const r = computeRecommendation(recInput());
    expect(r.titleEn).toBeTruthy();
    expect(r.titleAr).toBeTruthy();
    expect(r.bodyEn).toBeTruthy();
    expect(r.bodyAr).toBeTruthy();
    expect(r.actionLabelEn).toBeTruthy();
    expect(r.actionLabelAr).toBeTruthy();
  });
});

describe("computeRecommendation — all recommendations are bilingual", () => {
  const cases: Array<[string, RecommendationInput]> = [
    ["priority 1 contact",      recInput({ profile: { ...COMPLETE_PROFILE, hasWhatsapp: false } })],
    ["priority 1 services",     recInput({ profile: { ...COMPLETE_PROFILE, servicesCount: 0 } })],
    ["priority 1 cover",        recInput({ profile: { ...COMPLETE_PROFILE, hasCoverUrl: false } })],
    ["priority 1 description",  recInput({ profile: { ...COMPLETE_PROFILE, hasDescription: false } })],
    ["priority 2 no data",      recInput({ profileViews: 2 })],
    ["priority 3 low CTR",      recInput({ cardImpressions: 50, profileViews: 1, contactActions: 0 })],
    ["priority 4 low conv",     recInput({ cardImpressions: 300, profileViews: 30, contactActions: 0 })],
    ["priority 5 low visibility", recInput({ cardImpressions: 5, profileViews: 5, contactActions: 0 })],
    ["priority 6 service",      recInput({ topService: { nameEn: "X", nameAr: "ي", count: 10, share: 0.7 } })],
    ["priority 7 city",         recInput({ topCity: { cityId: "dubai", nameEn: "Dubai", nameAr: "دبي", count: 15, share: 0.6 } })],
    ["priority 8 healthy",      recInput({ cardImpressions: 200, profileViews: 50, contactActions: 10 })],
  ];

  for (const [label, input] of cases) {
    it(`${label} — all bilingual fields present`, () => {
      const r = computeRecommendation(input);
      expect(r.titleEn, `${label}: titleEn`).toBeTruthy();
      expect(r.titleAr, `${label}: titleAr`).toBeTruthy();
      expect(r.bodyEn, `${label}: bodyEn`).toBeTruthy();
      expect(r.bodyAr, `${label}: bodyAr`).toBeTruthy();
      expect(r.actionLabelEn, `${label}: actionLabelEn`).toBeTruthy();
      expect(r.actionLabelAr, `${label}: actionLabelAr`).toBeTruthy();
    });
  }
});

// ── computeOpportunity ────────────────────────────────────────────────────────

describe("computeOpportunity", () => {
  it("returns null when profileViews < 20", () => {
    expect(computeOpportunity(19, 1)).toBeNull();
  });

  it("returns null at exactly 20 views with a valid rate — WAIT: should show", () => {
    // 20 views, 1 contact = 5% → below 10% target
    const o = computeOpportunity(20, 1);
    expect(o).not.toBeNull();
    expect(o!.targetRate).toBe(THRESHOLDS.OPPORTUNITY_BASE_TARGET);
  });

  it("uses base target of 10% when current rate < 10%", () => {
    const o = computeOpportunity(100, 5); // 5% rate
    expect(o!.targetRate).toBeCloseTo(0.10);
    expect(o!.currentRate).toBeCloseTo(0.05);
  });

  it("uses current+2pp target when rate is between 10% and 20%", () => {
    const o = computeOpportunity(100, 12); // 12% rate
    expect(o!.targetRate).toBeCloseTo(0.14);
    expect(o!.currentRate).toBeCloseTo(0.12);
  });

  it("returns null when current rate >= 20%", () => {
    const o = computeOpportunity(100, 20); // 20% rate
    expect(o).toBeNull();
  });

  it("returns null when estimated additional contacts < 1", () => {
    // 20 views, 1 contact = 5% → target 10% → estimated = round(20*0.10 - 1) = round(1) = 1
    // Let's try a case where it rounds to 0:
    // 20 views, 2 contacts = 10% → rate is exactly at base threshold → 10+2=12% target
    // estimated = round(20 * 0.12 - 2) = round(2.4 - 2) = round(0.4) = 0 → null
    const o = computeOpportunity(20, 2); // 10% current → target 12%
    // round(20 * 0.12 - 2) = round(0.4) = 0 → null
    expect(o).toBeNull();
  });

  it("returns correct estimated additional contacts", () => {
    // 100 views, 5 contacts = 5% → target 10% → round(100*0.10 - 5) = 5
    const o = computeOpportunity(100, 5);
    expect(o!.estimatedAdditionalContacts).toBe(5);
  });

  it("body text contains actual profile views and contacts", () => {
    const o = computeOpportunity(100, 5);
    expect(o!.bodyEn).toContain("100");
    expect(o!.bodyEn).toContain("5");
  });

  it("titleEn and titleAr are set", () => {
    const o = computeOpportunity(100, 5);
    expect(o!.titleEn).toBe("Your Opportunity This Month");
    expect(o!.titleAr).toBe("فرصتك هذا الشهر");
  });

  it("bodyAr is non-empty", () => {
    const o = computeOpportunity(100, 5);
    expect(o!.bodyAr).toBeTruthy();
  });

  it("contactActions includes only approved action types — this is enforced by the route, not engine", () => {
    // The engine receives contactActions as a pre-computed value.
    // The route computes: whatsapp + phone + map + share + videoCall (NOT copy_link).
    // Verify the opportunity correctly handles the computed value.
    const o = computeOpportunity(100, 3); // 3% conversion
    expect(o!.estimatedAdditionalContacts).toBe(7); // round(100*0.10 - 3) = 7
  });
});

// ── Privacy: response shape never contains raw visitor data ──────────────────

describe("privacy guardrails (engine level)", () => {
  it("recommendation contains no visitor ID fields", () => {
    const r = computeRecommendation(recInput());
    const keys = Object.keys(r);
    expect(keys).not.toContain("visitorId");
    expect(keys).not.toContain("sessionId");
    expect(keys).not.toContain("ipAddress");
    expect(keys).not.toContain("rawIp");
  });

  it("opportunity contains no visitor ID fields", () => {
    const o = computeOpportunity(100, 5);
    const keys = Object.keys(o!);
    expect(keys).not.toContain("visitorId");
    expect(keys).not.toContain("sessionId");
  });
});

// ── Zero-data states ──────────────────────────────────────────────────────────

describe("zero-data state handling", () => {
  it("complete profile with zero views → priority 2 (insufficient data)", () => {
    const r = computeRecommendation(
      recInput({ profileViews: 0, cardImpressions: 0, contactActions: 0 }),
    );
    expect(r.priority).toBe(2);
  });

  it("incomplete profile with zero views → priority 1 wins", () => {
    const r = computeRecommendation(
      recInput({
        profile: { ...COMPLETE_PROFILE, hasWhatsapp: false },
        profileViews: 0,
        cardImpressions: 0,
        contactActions: 0,
      }),
    );
    expect(r.priority).toBe(1);
  });

  it("computeOpportunity with zero views returns null", () => {
    expect(computeOpportunity(0, 0)).toBeNull();
  });

  it("computeRatePair with zero denominators returns null rates", () => {
    const r = computeRatePair(0, 0, 0, 0);
    expect(r.current).toBeNull();
    expect(r.previous).toBeNull();
    expect(r.change).toBeNull();
  });
});
