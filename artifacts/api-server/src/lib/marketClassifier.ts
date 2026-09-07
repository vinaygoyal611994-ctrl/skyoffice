/**
 * Market Decision Intelligence — Classification Engine (rules-based, no AI/ML)
 *
 * A pure TypeScript function that takes raw market signals and returns a
 * market status classification, a recommended action, an explicit recommended
 * acceptance status, a confidence score, and a human-readable explanation of
 * which rule fired.
 *
 * This module has NO database dependency — it can be unit-tested in isolation.
 *
 * Design invariants:
 *   - "insufficient_data" never recommends expanding acceptance (→ monitor)
 *   - "weak_demand"       never recommends expanding acceptance (→ monitor)
 *   - Every recommendation includes status, action, acceptance, reason, confidence
 *   - Confidence degrades whenever funnel signals are missing, history is short,
 *     or data volume is thin — not just when providers are absent
 */

// ── Public types ──────────────────────────────────────────────────────────────

export type MarketStatus =
  | "insufficient_data"
  | "need_more_supply"
  | "weak_demand"
  | "oversupplied"
  | "near_saturation"
  | "balanced";

/**
 * What the classifier recommends the admin set as the acceptance gate.
 * "monitor" = do not change the current gate; review manually.
 */
export type RecommendedAcceptance =
  | "recruit"   // actively seek more providers
  | "open"      // normal acceptance
  | "limited"   // slow-roll new providers
  | "closed"    // pause new acceptance
  | "monitor";  // insufficient signal — do not change gate without manual review

export type MarketSignals = {
  // ── Analytics: last 30 days ─────────────────────────────────────────────
  searches:            number;   // total search events
  zeroResultSearches:  number;   // searches that returned 0 providers
  profileViews:        number;   // office detail-page views
  whatsappContacts:    number;   // WhatsApp tap events
  mapContacts:         number;   // map/directions tap events
  daysOfData:          number;   // distinct days with any data in the window

  // ── Provider supply ─────────────────────────────────────────────────────
  activeProv:          number;   // active providers right now
  activeProv60dAgo:    number;   // active providers ~60 days ago (supply trend)

  // ── Prior-period demand (for trend) ─────────────────────────────────────
  searchesPrior30d:    number;   // searches in the 30 days before the window

  // ── Provider engagement ─────────────────────────────────────────────────
  activeProvWithContacts: number; // providers with ≥1 contact event in window

  // ── Service funnel (optional — 0 when not yet tracked) ──────────────────
  completedTransactions?:        number; // confirmed bookings/completions last 30d
  completedTransactionsPrior30d?: number; // same, prior 30d (for transaction trend)
};

export type ClassificationResult = {
  marketStatus:         MarketStatus;
  recommendedAction:    string;          // human-readable advisory label
  recommendedAcceptance: RecommendedAcceptance; // machine-readable acceptance gate
  confidenceScore:      number;          // [0.05, 1.00], 2 dp
  confidenceBand:       "High" | "Medium" | "Low" | "Very Low";
  recommendationReason: string;          // which rule(s) fired, plain English
  derivedSignals: {
    zeroResultRate:       number;  // zeroResultSearches / searches
    demandPerProvider:    number;  // searches / activeProv
    contactRate:          number;  // contacts / profileViews
    providerActivityRate: number;  // activeProvWithContacts / activeProv
    demandTrend:          number;  // (searches - prior) / prior  (+ve = rising)
    supplyTrend:          number;  // (activeProv - prior) / prior
    completionRate:       number;  // completedTransactions / contacts (0 if unavail)
    transactionTrend:     number;  // (txn - priorTxn) / priorTxn (0 if unavail)
  };
};

// ── Recommended action text ───────────────────────────────────────────────────

const RECOMMENDED_ACTIONS: Record<MarketStatus, string> = {
  need_more_supply:  "Recruit more providers — demand exceeds supply",
  near_saturation:   "Limit new acceptance — market approaching saturation",
  oversupplied:      "Close new acceptance — supply far exceeds demand",
  balanced:          "Keep acceptance open — market is healthy",
  // These two must NOT default to expanding acceptance
  weak_demand:       "Monitor — low demand, hold new acceptance pending review",
  insufficient_data: "Monitor — insufficient data, do not change acceptance gate",
};

// ── Acceptance gate recommendation ───────────────────────────────────────────

const RECOMMENDED_ACCEPTANCE: Record<MarketStatus, RecommendedAcceptance> = {
  need_more_supply:  "recruit",
  balanced:          "open",
  near_saturation:   "limited",
  oversupplied:      "closed",
  // Safe defaults: never automatically open the market when data is poor or demand is low
  weak_demand:       "monitor",
  insufficient_data: "monitor",
};

// ── Confidence scoring ────────────────────────────────────────────────────────
//
// Start at 1.0 and subtract penalties for each data-quality weakness.
// The goal: a High-confidence result means the classification is reliable enough
// to act on without extra manual scrutiny.

function computeConfidence(signals: MarketSignals): number {
  let score = 1.0;
  const contacts = signals.whatsappContacts + signals.mapContacts;
  const txn = signals.completedTransactions ?? 0;

  // 1. History depth — a full 30-day window is the minimum reliable baseline
  if      (signals.daysOfData < 7)  score -= 0.60;
  else if (signals.daysOfData < 15) score -= 0.40;
  else if (signals.daysOfData < 30) score -= 0.20;

  // 2. Search volume — too few searches make rate-derived signals unreliable
  if      (signals.searches < 20)  score -= 0.30;
  else if (signals.searches < 50)  score -= 0.20;
  else if (signals.searches < 100) score -= 0.10;

  // 3. Active provider count — zero providers make supply signals vacuous
  if      (signals.activeProv === 0) score -= 0.20;
  else if (signals.activeProv <= 2)  score -= 0.10;
  else if (signals.activeProv <= 4)  score -= 0.05;

  // 4. Contact funnel — if profile views are meaningful but contacts are zero,
  //    we can't validate demand quality (bots, window-shoppers, etc.)
  if (signals.profileViews > 20 && contacts === 0) score -= 0.15;

  // 5. Trend signal — if prior-period searches are zero we can't assess momentum
  if (signals.searchesPrior30d === 0 && signals.searches > 0) score -= 0.10;

  // 6. Transaction data — if searches are substantial but we have no transaction
  //    signal at all, funnel depth is unverifiable (data gap, not necessarily bad market)
  if (signals.searches > 30 && txn === 0 && signals.completedTransactions !== undefined) {
    // Only penalize if the field was explicitly provided (0 is real data, not missing)
    score -= 0.10;
  }

  return Math.round(Math.max(0.05, Math.min(1.0, score)) * 100) / 100;
}

function confidenceBand(score: number): ClassificationResult["confidenceBand"] {
  if (score >= 0.75) return "High";
  if (score >= 0.50) return "Medium";
  if (score >= 0.25) return "Low";
  return "Very Low";
}

// ── Main classifier ───────────────────────────────────────────────────────────

export function classifyMarket(signals: MarketSignals): ClassificationResult {
  const {
    searches, zeroResultSearches, profileViews,
    whatsappContacts, mapContacts,
    activeProv, activeProv60dAgo,
    searchesPrior30d, activeProvWithContacts,
    daysOfData,
  } = signals;

  const txn      = signals.completedTransactions        ?? 0;
  const txnPrior = signals.completedTransactionsPrior30d ?? 0;
  const contacts = whatsappContacts + mapContacts;

  // ── Derived signals ────────────────────────────────────────────────────────
  const zeroResultRate       = searches > 0      ? zeroResultSearches / searches          : 0;
  const demandPerProvider    = activeProv > 0     ? searches / activeProv                 : searches;
  const contactRate          = profileViews > 0   ? contacts / profileViews               : 0;
  const providerActivityRate = activeProv > 0     ? activeProvWithContacts / activeProv   : 0;
  const demandTrend          = searchesPrior30d > 0 ? (searches - searchesPrior30d) / searchesPrior30d : 0;
  const supplyTrend          = activeProv60dAgo > 0 ? (activeProv - activeProv60dAgo) / activeProv60dAgo : 0;
  const completionRate       = contacts > 0        ? txn / contacts                        : 0;
  const transactionTrend     = txnPrior > 0        ? (txn - txnPrior) / txnPrior           : 0;

  const derived = {
    zeroResultRate,
    demandPerProvider,
    contactRate,
    providerActivityRate,
    demandTrend,
    supplyTrend,
    completionRate,
    transactionTrend,
  };

  const confidenceScore = computeConfidence(signals);
  const band            = confidenceBand(confidenceScore);

  // ── Classification rules (evaluated in strict priority order) ──────────────
  //
  // Rule 1 — Insufficient data: classify first, before any rate-based rule can
  //           produce a spurious result from a handful of events.
  // Rules 2–6 require at least a minimal data window.

  let marketStatus: MarketStatus;
  let reason:       string;

  // ── Rule 1: Insufficient data ──────────────────────────────────────────────
  if (daysOfData < 7 || (searches < 5 && activeProv < 2)) {
    marketStatus = "insufficient_data";
    reason = daysOfData < 7
      ? `Only ${daysOfData} day(s) of data available — minimum 7 required for any reliable classification. Do not change acceptance gate until more data accumulates.`
      : `Very low activity: ${searches} search(es) and ${activeProv} active provider(s). Signal volume is too thin to classify. Recommend manual review.`;

  // ── Rule 2: Need more supply ───────────────────────────────────────────────
  // Fires when demand clearly outstrips supply. Multiple independent triggers:
  //   a) Many searches with no providers at all — zero coverage
  //   b) High zero-result rate on meaningful search volume — customers can't find anyone
  //   c) Very high demand/provider ratio — each provider is overwhelmed
  //   d) Rising demand trend pushing a high-load market above the saturation threshold
  } else if (
    (activeProv === 0 && searches > 5) ||
    (zeroResultRate > 0.35 && searches > 10) ||
    demandPerProvider > 25 ||
    (demandTrend > 0.5 && demandPerProvider > 15)
  ) {
    marketStatus = "need_more_supply";
    if (activeProv === 0 && searches > 5) {
      reason = `No active providers, but ${searches} searches recorded — customers cannot be served at all.`;
    } else if (zeroResultRate > 0.35 && searches > 10) {
      reason = `${(zeroResultRate * 100).toFixed(0)}% of ${searches} searches returned zero results — customers cannot find providers.`;
    } else if (demandTrend > 0.5 && demandPerProvider > 15) {
      reason = `Rapidly rising demand (+${(demandTrend * 100).toFixed(0)}% vs prior 30d) pushing demand/provider ratio to ${demandPerProvider.toFixed(1)} — supply will be overwhelmed soon.`;
    } else {
      reason = `Demand/provider ratio is ${demandPerProvider.toFixed(1)} — demand far exceeds supply capacity.`;
    }

  // ── Rule 3: Weak demand ────────────────────────────────────────────────────
  // Fires when demand is genuinely low, OR when demand is in sharp decline.
  // SAFE DEFAULT: recommend "monitor", not "open".
  // Rationale: adding providers into a shrinking or thin market harms existing
  // provider revenue and reduces overall service quality.
  } else if (
    (searches < 12 && activeProv > 0) ||
    (demandTrend < -0.40 && searches < 30 && activeProv > 0)
  ) {
    marketStatus = "weak_demand";
    if (demandTrend < -0.40 && searches < 30) {
      reason = `Demand is declining sharply (${(demandTrend * 100).toFixed(0)}% vs prior 30d) with only ${searches} searches. Adding providers risks diluting a contracting market. Monitor before accepting more supply.`;
    } else {
      reason = `Low search volume (${searches} in 30 days) with ${activeProv} active provider(s). Demand does not justify new acceptance. Monitor before opening further.`;
    }

  // ── Rule 4: Oversupplied ───────────────────────────────────────────────────
  // Strong supply saturation: many providers, very little demand activity per provider,
  // and low contact rate confirming customers are not engaging.
  } else if (
    demandPerProvider < 2 &&
    activeProv > 5 &&
    contactRate < 0.015 &&
    providerActivityRate < 0.30
  ) {
    marketStatus = "oversupplied";
    reason = `Demand/provider ratio is ${demandPerProvider.toFixed(2)} with ${activeProv} providers. Contact rate (${(contactRate * 100).toFixed(1)}%) and provider activity coverage (${(providerActivityRate * 100).toFixed(0)}%) are both very low — market is clearly oversupplied.`;

  // ── Rule 5: Near saturation ────────────────────────────────────────────────
  // Softer saturation signal: ratio is low, or many providers have no contacts
  // at all, meaning most providers are idle.
  } else if (
    (demandPerProvider < 4 && activeProv > 3 && contactRate < 0.04) ||
    (providerActivityRate < 0.25 && activeProv > 4)
  ) {
    marketStatus = "near_saturation";
    if (providerActivityRate < 0.25 && activeProv > 4) {
      reason = `Only ${(providerActivityRate * 100).toFixed(0)}% of ${activeProv} providers received any contact in 30 days — most are idle. Market is approaching saturation.`;
    } else {
      reason = `Demand/provider ratio (${demandPerProvider.toFixed(2)}) is low with ${activeProv} providers and contact rate (${(contactRate * 100).toFixed(1)}%) is thin — market approaching saturation.`;
    }

  // ── Rule 6: Balanced (default) ────────────────────────────────────────────
  } else {
    marketStatus = "balanced";
    const trendNote = Math.abs(demandTrend) > 0.20
      ? ` Demand is ${demandTrend > 0 ? "rising" : "declining"} (${(demandTrend * 100).toFixed(0)}% vs prior 30d).`
      : "";
    reason = `Demand/provider ratio (${demandPerProvider.toFixed(1)}), zero-result rate (${(zeroResultRate * 100).toFixed(0)}%), and contact rate (${(contactRate * 100).toFixed(1)}%) are all within healthy ranges.${trendNote}`;
  }

  return {
    marketStatus,
    recommendedAction:    RECOMMENDED_ACTIONS[marketStatus],
    recommendedAcceptance: RECOMMENDED_ACCEPTANCE[marketStatus],
    confidenceScore,
    confidenceBand:       band,
    recommendationReason: reason,
    derivedSignals:       derived,
  };
}

// ── Supply Cap Recommendation ─────────────────────────────────────────────────
//
// A pure function that computes a conservative, explainable cap change
// recommendation from market classification signals.
//
// INVARIANT: The scheduled recompute stores this result in
// recommended_supply_cap / recommended_cap_change / cap_recommendation_reason.
// It MUST NEVER write it to supply_cap.  Only an explicit admin action
// (approve recommendation, set cap manually) may change supply_cap.
//
// Recommendation guardrails:
//   - Maximum +5 per recompute cycle regardless of demand magnitude.
//   - Low confidence (<50%)   → max +1 increment.
//   - Medium confidence (<65%)→ max +2 increment.
//   - Hold when: insufficient_data, weak_demand, near_saturation, oversupplied.
//   - Cautious +1 when: balanced market with demand rising >20%.
//   - Incremental scale when: need_more_supply, scaled by demandPerProvider.
//   - Rising demand bonus (+1, max 5 total) when trend >25% and conf ≥70%.

/** Output of the cap recommendation computation. */
export type CapRecommendation = {
  /** Recommended new supply cap value. Equals currentCap when holding. */
  recommendedCap: number;
  /** Recommended change from current cap (0 = hold, +n = expand). */
  capChange: number;
  /** Human-readable explanation of this recommendation. */
  reason: string;
  /** Inherits market classification confidence score. */
  confidence: number;
};

/**
 * Computes a conservative cap recommendation from classification output.
 *
 * @param cls               Market classification result.
 * @param currentCap        Admin-set supply cap, or null if uncapped.
 * @param currentActiveSupply  Current slot consumer count (approved + active).
 */
export function computeCapRecommendation(
  cls: ClassificationResult,
  currentCap: number | null,
  currentActiveSupply: number,
): CapRecommendation {
  const { marketStatus, confidenceScore, derivedSignals } = cls;
  const { demandPerProvider, demandTrend } = derivedSignals;

  // Cannot recommend when no cap is set — admin must set an initial cap first.
  if (currentCap === null) {
    return {
      recommendedCap: currentActiveSupply,
      capChange:      0,
      reason:
        "No supply cap set — recommendation cannot be computed. " +
        "Admin must set an initial cap before the intelligence can suggest changes.",
      confidence: confidenceScore,
    };
  }

  // ── Hold scenarios ────────────────────────────────────────────────────────
  const holdStatuses: MarketStatus[] = [
    "insufficient_data",
    "weak_demand",
    "near_saturation",
    "oversupplied",
  ];
  if ((holdStatuses as string[]).includes(marketStatus)) {
    const isSaturated =
      marketStatus === "near_saturation" || marketStatus === "oversupplied";
    const reason = isSaturated
      ? `Market at or approaching saturation (demand/provider = ${demandPerProvider.toFixed(1)}, ` +
        `${(confidenceScore * 100).toFixed(0)}% confidence) — hold cap and monitor attrition.`
      : `Insufficient data or weak demand — hold cap. ` +
        `${(confidenceScore * 100).toFixed(0)}% confidence.`;
    return { recommendedCap: currentCap, capChange: 0, reason, confidence: confidenceScore };
  }

  // ── Balanced: hold unless demand is rising ────────────────────────────────
  if (marketStatus === "balanced") {
    if (demandTrend > 0.20 && confidenceScore >= 0.60) {
      return {
        recommendedCap: currentCap + 1,
        capChange:      1,
        reason:
          `Balanced market with rising demand (+${(demandTrend * 100).toFixed(0)}% vs prior 30d) and ` +
          `${(confidenceScore * 100).toFixed(0)}% confidence — conservative +1 expansion recommended.`,
        confidence: confidenceScore,
      };
    }
    return {
      recommendedCap: currentCap,
      capChange:      0,
      reason:
        `Market balanced (demand/provider = ${demandPerProvider.toFixed(1)}) — hold cap.`,
      confidence: confidenceScore,
    };
  }

  // ── Need more supply: incremental expansion ───────────────────────────────
  if (marketStatus === "need_more_supply") {
    // Base increment from demand intensity
    let increment: number;
    if      (demandPerProvider > 50) increment = 5;
    else if (demandPerProvider > 30) increment = 3;
    else if (demandPerProvider > 15) increment = 2;
    else                              increment = 1;

    // Confidence band caps
    if      (confidenceScore < 0.50) increment = Math.min(increment, 1);
    else if (confidenceScore < 0.65) increment = Math.min(increment, 2);

    // Rising demand bonus (+1, hard cap at +5)
    if (demandTrend > 0.25 && confidenceScore >= 0.70) {
      increment = Math.min(increment + 1, 5);
    }

    return {
      recommendedCap: currentCap + increment,
      capChange:      increment,
      reason:
        `Undersupplied market: demand/provider = ${demandPerProvider.toFixed(1)}, ` +
        `demand trend = +${(demandTrend * 100).toFixed(0)}%, ` +
        `confidence = ${(confidenceScore * 100).toFixed(0)}% → +${increment} recommended.`,
      confidence: confidenceScore,
    };
  }

  // Default: hold
  return {
    recommendedCap: currentCap,
    capChange:      0,
    reason:         "No expansion signal — hold cap.",
    confidence:     confidenceScore,
  };
}
