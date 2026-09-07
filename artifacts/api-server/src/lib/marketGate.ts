/**
 * Market Supply Control — Application Gate
 *
 * Enforces the admin-approved acceptance_status from market_supply_control
 * when a provider submits a new application.
 *
 * Gate rules:
 *   "recruit"  → allowed (encourage applications)
 *   "open"     → allowed
 *   "limited"  → allowed, but application is flagged for selective admin review
 *   "closed"   → BLOCKED unless an admin override is recorded on the office
 *   (no row)   → no_data → allowed (conservative default)
 *
 * Critical invariants:
 *   1. Only acceptance_status is read — never pending_recommendation or
 *      market_status.  A pending recommendation has NO gate effect.
 *   2. "closed" affects ONLY new applications for the exact
 *      country + canonical city + category combination.
 *      It never affects existing providers, approved offices,
 *      previously submitted applications, other cities, or other categories.
 *   3. Country must be resolved before a gate check is possible.
 *      Offices whose country cannot be resolved to SA or AE pass through
 *      with outcome "no_data" — they are never silently blocked.
 */

import { pool } from "@workspace/db";
import { classifyCityId } from "./searchNormalizer";
import { countAllocatedSlotsForMarket } from "./supplySlotManager";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Valid launch market country codes. */
export const VALID_GATE_COUNTRIES = ["SA", "AE"] as const;
export type GateCountry = (typeof VALID_GATE_COUNTRIES)[number];

/**
 * Maps canonical city IDs (as returned by classifyCityId) to their
 * country code.  Used to resolve country when offices.country is NULL.
 *
 * Key: canonical city ID (lowercase, stable)
 * Value: ISO 3166-1 alpha-2 country code
 *
 * This map is the single source of truth for city→country inference.
 * Only SA and AE are launch markets; any city not listed here cannot be
 * inferred and will produce outcome "no_data" (safe default).
 */
export const CANONICAL_CITY_COUNTRY: Record<string, GateCountry> = {
  // Saudi Arabia
  riyadh:          "SA",
  jeddah:          "SA",
  mecca:           "SA",
  medina:          "SA",
  dammam:          "SA",
  khobar:          "SA",
  dhahran:         "SA",
  tabuk:           "SA",
  abha:            "SA",
  qassim:          "SA",
  hail:            "SA",
  najran:          "SA",
  jizan:           "SA",
  taif:            "SA",
  yanbu:           "SA",
  jubail:          "SA",
  // United Arab Emirates
  dubai:           "AE",
  abu_dhabi:       "AE",
  sharjah:         "AE",
  ajman:           "AE",
  ras_al_khaimah:  "AE",
  fujairah:        "AE",
  umm_al_quwain:   "AE",
};

// ── Types ─────────────────────────────────────────────────────────────────────

/** Outcome of a gate check for a single application. */
export type GateOutcome = "allowed" | "limited" | "blocked" | "no_data";

export type GateResult = {
  /** Decision for this application. */
  outcome: GateOutcome;
  /**
   * The acceptance_status value read from market_supply_control.
   * NULL when no row exists for this market (outcome will be "no_data").
   */
  acceptanceStatus: string | null;
  /**
   * Stable compound market key: "<countryCode>|<canonicalCityId>|<categoryId>".
   * NULL when country or city could not be resolved.
   */
  marketKey: string | null;
};

export type ResolvedMarket = {
  countryCode: GateCountry;
  canonicalCityId: string;
};

// ── City / country resolution ─────────────────────────────────────────────────

/**
 * Resolves a raw city string and optional country code into a canonical
 * market key pair.
 *
 * Resolution order:
 *   1. If rawCountry is in VALID_GATE_COUNTRIES, trust it directly.
 *   2. Otherwise, attempt to infer country from the canonical city ID
 *      using CANONICAL_CITY_COUNTRY.
 *   3. If neither succeeds, return null (gate outcome will be "no_data").
 *
 * City normalization: classifyCityId() maps Arabic/English/transliteration
 * variants to the same stable key used in analytics_daily_by_market.
 * Examples: "الرياض" / "Riyadh" / "riyadh" → "riyadh"
 *           "أبوظبي" / "Abu Dhabi" / "abu dhabi" → "abu_dhabi"
 */
export function resolveMarket(
  rawCity: string,
  rawCountry: string | null | undefined,
): ResolvedMarket | null {
  const trimmed         = rawCity.trim();
  const canonicalCityId = classifyCityId(trimmed.toLowerCase()) ?? trimmed.toLowerCase();

  // Prefer the stored country when it's a valid launch market
  let countryCode: GateCountry | null = null;
  if (rawCountry && (VALID_GATE_COUNTRIES as readonly string[]).includes(rawCountry)) {
    countryCode = rawCountry as GateCountry;
  } else {
    // Attempt inference from canonical city
    countryCode = CANONICAL_CITY_COUNTRY[canonicalCityId] ?? null;
  }

  if (!countryCode) return null;
  return { countryCode, canonicalCityId };
}

// ── Gate check ────────────────────────────────────────────────────────────────

/**
 * Checks the market gate for a given resolved market + category.
 *
 * Reads ONLY acceptance_status from market_supply_control.
 * pending_recommendation and market_status are intentionally NOT read:
 *   - pending_recommendation = classifier's suggestion, awaiting admin decision
 *   - market_status          = computed classification label
 * Neither has any gate effect until an admin explicitly approves via the
 * decision endpoint, which updates acceptance_status.
 */
export async function checkMarketGate(
  countryCode: string,
  canonicalCityId: string,
  categoryId: string,
): Promise<GateResult> {
  const marketKey = `${countryCode}|${canonicalCityId}|${categoryId}`;

  const result = await pool.query<{ acceptance_status: string }>(
    `SELECT acceptance_status
     FROM market_supply_control
     WHERE country_code = $1
       AND city_id      = $2
       AND category_id  = $3
     LIMIT 1`,
    [countryCode, canonicalCityId, categoryId],
  );

  if (result.rows.length === 0) {
    // No supply control record for this market — default to allow
    return { outcome: "no_data", acceptanceStatus: null, marketKey };
  }

  const acceptanceStatus = result.rows[0].acceptance_status;

  switch (acceptanceStatus) {
    case "closed":
      return { outcome: "blocked",  acceptanceStatus, marketKey };
    case "limited":
      return { outcome: "limited",  acceptanceStatus, marketKey };
    case "recruit":
    case "open":
    default:
      // "recruit", "open", unknown/future values → allow
      return { outcome: "allowed",  acceptanceStatus, marketKey };
  }
}

/**
 * Convenience wrapper: resolves city+country for an office object and
 * runs the gate check in one call.
 *
 * Used in the submit route.  The office object must have city, country,
 * and category populated (all required before submit is possible).
 */
export async function checkMarketGateForOffice(office: {
  city: string;
  country: string | null | undefined;
  category: string;
}): Promise<GateResult> {
  const resolved = resolveMarket(office.city, office.country);

  if (!resolved) {
    // Cannot resolve market — allow through with "no_data" (do not block)
    return { outcome: "no_data", acceptanceStatus: null, marketKey: null };
  }

  return checkMarketGate(
    resolved.countryCode,
    resolved.canonicalCityId,
    office.category,
  );
}

// ── Bilingual blocked-market error payload ────────────────────────────────────

/**
 * Structured error payload returned to the client when a market is closed.
 *
 * Both English and Arabic strings are returned so the frontend can display
 * the appropriate language without a server round-trip.
 */
export type MarketClosedError = {
  error:        "market_closed";
  message:      string;   // English
  messageAr:    string;   // Arabic
  marketKey:    string;
  canChooseOther: true;
};

export function buildMarketClosedError(
  marketKey: string,
): MarketClosedError {
  // marketKey format: "SA|riyadh|marketing"
  return {
    error:     "market_closed",
    message:   "New applications for this category in this city are temporarily closed — current supply is sufficient. You may apply in another city or category.",
    messageAr: "تم إغلاق طلبات التسجيل الجديدة لهذه الفئة في هذه المدينة مؤقتًا نظرًا لكفاية العرض الحالي. يمكنك التقديم في مدينة أو فئة أخرى.",
    marketKey,
    canChooseOther: true,
  };
}

// ── Supply Cap Status ─────────────────────────────────────────────────────────

/**
 * Computes cap_status from the supply cap and current slot-consumer count.
 *
 * Slot consumers = offices WHERE status IN ('approved','active') AND is_demo=false
 * for the exact country + canonical city + category market key.
 *
 * Return values:
 *   available  — below cap, or uncapped
 *   near_cap   — remaining ≤ max(2, ceil(cap × 0.20))
 *   full       — consumers = cap
 *   over_cap   — consumers > cap (cap was lowered; NO providers removed)
 *
 * Note: "paused" is an admin-only state set manually via the cap API; it
 * is never computed here.
 */
export function computeCapStatus(
  supplyCap: number | null,
  currentSlotConsumers: number,
): string {
  if (supplyCap === null)                 return "available"; // uncapped
  if (currentSlotConsumers > supplyCap)   return "over_cap";
  if (currentSlotConsumers >= supplyCap)  return "full";
  const remaining        = supplyCap - currentSlotConsumers;
  const nearCapThreshold = Math.max(2, Math.ceil(supplyCap * 0.2));
  if (remaining <= nearCapThreshold)      return "near_cap";
  return "available";
}

// ── Supply Cap Check ──────────────────────────────────────────────────────────

export type CapGateOutcome = "allowed" | "near_cap" | "blocked_cap";

export type CapCheckResult = {
  outcome:              CapGateOutcome;
  supplyCap:            number | null;
  currentSlotConsumers: number;
  remainingSlots:       number | null;
  capStatus:            string;
};

/**
 * Checks whether a new application can enter a market given its supply cap.
 *
 * Slot consumers definition (invariant):
 *   - status IN ('approved', 'active')
 *   - is_demo = false
 *   - Drafts, under_review, changes_requested, rejected, suspended: NOT counted.
 *     → "do NOT affect existing providers" — suspended providers free a slot.
 *     → under_review doesn't consume: overbooking is prevented at approval time
 *       via a SELECT … FOR UPDATE transaction, not at submit time.
 *
 * Counting strategy:
 *   - Uses supply_gate_market_key (set at submit time) for exact canonical city
 *     matching without SQL-level alias resolution.
 *   - Offices submitted before migration 0026 (supply_gate_market_key = NULL)
 *     are NOT counted — they are grandfathered and do not consume cap slots.
 *     This implements "Do NOT affect existing providers."
 *
 * Near-cap threshold: max(2, ceil(cap × 0.20))
 *   Examples: cap=10 → near if remaining ≤2, cap=15 → near if ≤3, cap=50 → near if ≤10
 */
export async function checkCapForMarket(
  countryCode: string,
  canonicalCityId: string,
  categoryId: string,
  marketKey: string,
): Promise<CapCheckResult> {
  // Fetch cap setting from market_supply_control
  const capRes = await pool.query<{ supply_cap: number | null; cap_status: string }>(
    `SELECT supply_cap, cap_status
     FROM market_supply_control
     WHERE country_code = $1 AND city_id = $2 AND category_id = $3
     LIMIT 1`,
    [countryCode, canonicalCityId, categoryId],
  );

  const row      = capRes.rows[0];
  const supplyCap = row?.supply_cap ?? null;

  if (supplyCap === null) {
    // No cap set — uncapped market, always allow
    return {
      outcome:              "allowed",
      supplyCap:            null,
      currentSlotConsumers: 0,
      remainingSlots:       null,
      capStatus:            "available",
    };
  }

  // Count allocated slots from market_slot_allocations
  // (replaces the old offices.status count — hidden offices no longer consume slots)
  const currentSlotConsumers = await countAllocatedSlotsForMarket(marketKey);
  const remaining            = supplyCap - currentSlotConsumers;
  const capStatus            = computeCapStatus(supplyCap, currentSlotConsumers);

  if (currentSlotConsumers >= supplyCap) {
    return {
      outcome:              "blocked_cap",
      supplyCap,
      currentSlotConsumers,
      remainingSlots:       0,
      capStatus,
    };
  }

  const nearCapThreshold = Math.max(2, Math.ceil(supplyCap * 0.2));
  return {
    outcome:              remaining <= nearCapThreshold ? "near_cap" : "allowed",
    supplyCap,
    currentSlotConsumers,
    remainingSlots:       Math.max(0, remaining),
    capStatus,
  };
}

// ── Full Gate (acceptance_status + supply cap) ────────────────────────────────

/**
 * Combined outcome of the full gate (both acceptance_status and supply cap).
 *   allowed   — normal admission
 *   near_cap  — admitted but market is approaching its cap; admin can see this
 *   limited   — limited market (selective review), below cap
 *   blocked   — blocked; see blockReason for why
 *   no_data   — no market row or unresolvable country/city → allowed
 */
export type FullGateOutcome = "allowed" | "near_cap" | "limited" | "blocked" | "no_data";

export type FullGateResult = {
  outcome:          FullGateOutcome;
  /**
   * Present when outcome = "blocked"; explains WHY:
   *   market_closed — acceptance_status = "closed" (Supply Control gate)
   *   cap_full      — supply cap reached or exceeded (Hybrid Cap gate)
   */
  blockReason:      "market_closed" | "cap_full" | null;
  acceptanceStatus: string | null;
  marketKey:        string | null;
  capInfo:          CapCheckResult | null;
};

/**
 * Combined acceptance_status + supply cap gate for a new provider application.
 *
 * Precedence (evaluated top-to-bottom; first match wins):
 *   1. Country or city cannot be resolved → no_data  → ALLOWED
 *   2. acceptance_status = "closed" (and no admin override) → BLOCKED  (market_closed)
 *   3. supply cap set AND slot consumers ≥ cap           → BLOCKED  (cap_full)
 *      Cap enforcement applies even for "limited" markets.
 *   4. acceptance_status = "limited" AND below cap       → LIMITED
 *   5. supply cap set AND within near-cap threshold      → NEAR_CAP (allowed)
 *   6. Everything else                                   → ALLOWED
 *
 * Admin override (supplyGateOverrideBy on the office) bypasses rule 2
 * (acceptance_status gate) but NOT rule 3 (cap enforcement).  An override
 * lets one application through a closed market; it does not expand capacity.
 */
export async function checkFullGate(office: {
  city:                string;
  country:             string | null | undefined;
  category:            string;
  supplyGateOverrideBy?: number | null;
}): Promise<FullGateResult> {
  const resolved = resolveMarket(office.city, office.country);

  if (!resolved) {
    return {
      outcome:          "no_data",
      blockReason:      null,
      acceptanceStatus: null,
      marketKey:        null,
      capInfo:          null,
    };
  }

  const { countryCode, canonicalCityId } = resolved;
  const marketKey = `${countryCode}|${canonicalCityId}|${office.category}`;

  // Rule 2 — acceptance_status check
  const gateResult = await checkMarketGate(countryCode, canonicalCityId, office.category);

  if (gateResult.outcome === "blocked" && !office.supplyGateOverrideBy) {
    return {
      outcome:          "blocked",
      blockReason:      "market_closed",
      acceptanceStatus: gateResult.acceptanceStatus,
      marketKey,
      capInfo:          null,
    };
  }

  // Rule 3 — cap check (runs even for limited markets and overridden offices)
  const capResult = await checkCapForMarket(countryCode, canonicalCityId, office.category, marketKey);

  if (capResult.outcome === "blocked_cap") {
    return {
      outcome:          "blocked",
      blockReason:      "cap_full",
      acceptanceStatus: gateResult.acceptanceStatus,
      marketKey,
      capInfo:          capResult,
    };
  }

  // Rule 4 — limited + below cap
  if (gateResult.outcome === "limited") {
    return {
      outcome:          "limited",
      blockReason:      null,
      acceptanceStatus: gateResult.acceptanceStatus,
      marketKey,
      capInfo:          capResult,
    };
  }

  // Rule 5 — near cap (allowed but informational)
  if (capResult.outcome === "near_cap") {
    return {
      outcome:          "near_cap",
      blockReason:      null,
      acceptanceStatus: gateResult.acceptanceStatus,
      marketKey,
      capInfo:          capResult,
    };
  }

  // Rule 1 sub-case — no supply control record
  if (gateResult.outcome === "no_data") {
    return {
      outcome:          "no_data",
      blockReason:      null,
      acceptanceStatus: null,
      marketKey,
      capInfo:          capResult,
    };
  }

  // Rule 6 — allowed (open / recruit / admin override used)
  return {
    outcome:          "allowed",
    blockReason:      null,
    acceptanceStatus: gateResult.acceptanceStatus,
    marketKey,
    capInfo:          capResult,
  };
}

// ── Cap-full error payload ────────────────────────────────────────────────────

export type CapFullError = {
  error:                "cap_full";
  message:              string;   // English
  messageAr:            string;   // Arabic
  marketKey:            string;
  supplyCap:            number;
  currentSlotConsumers: number;
  remainingSlots:       0;
  canChooseOther:       true;
};

/**
 * Bilingual 403 error payload returned when a market's supply cap is full.
 * Both languages are returned so the client can display the correct one
 * without a round-trip.
 */
export function buildCapFullError(
  marketKey: string,
  supplyCap: number,
  currentSlotConsumers: number,
): CapFullError {
  return {
    error: "cap_full",
    message:
      `New provider intake for this category in this city is temporarily full ` +
      `(${currentSlotConsumers}/${supplyCap} capacity). ` +
      `You may apply in another available city or category.`,
    messageAr:
      `اكتمل الحد الأقصى لمزودي الخدمة في هذه الفئة وهذه المدينة مؤقتًا ` +
      `(${currentSlotConsumers}/${supplyCap}). ` +
      `يمكنك التقديم في مدينة أو فئة أخرى متاحة.`,
    marketKey,
    supplyCap,
    currentSlotConsumers,
    remainingSlots:  0,
    canChooseOther:  true,
  };
}
