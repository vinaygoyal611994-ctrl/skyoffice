/**
 * Payment Plans — Single source of truth for SkayOffice subscription pricing.
 *
 * Prices are stored and transmitted in halalas (1 SAR = 100 halalas) to avoid
 * floating-point representation issues.
 *
 * Canonical prices (2026):
 *   Office:     200 SAR/month = 20,000 halalas
 *   Freelancer: 120 SAR/month = 12,000 halalas
 *
 * DO NOT hard-code prices anywhere else — always import from this module.
 */

import { pool } from "@workspace/db";
import { logger } from "./logger";

// ── Price constants ───────────────────────────────────────────────────────────

export const PLAN_PRICES: Record<string, { amountHalalas: number; currency: string }> = {
  office:     { amountHalalas: 20_000, currency: "SAR" },  // 200 SAR
  freelancer: { amountHalalas: 12_000, currency: "SAR" },  // 120 SAR
};

export function getPriceForProviderType(
  providerType: string,
): { amountHalalas: number; currency: string } | null {
  return PLAN_PRICES[providerType] ?? null;
}

// ── Plan DB lookup ────────────────────────────────────────────────────────────

export interface ResolvedPlan {
  planId:        number;
  planName:      string;
  planNameAr:    string;
  providerType:  string;
  amountHalalas: number;
  currency:      string;
}

/**
 * Fetch the active plan for a given office from the DB.
 * Matches by provider_type; falls back to providerType-agnostic plans (NULL providerType).
 * Returns null if no active plan exists for this provider type.
 */
export async function getPlanForOffice(officeId: number): Promise<ResolvedPlan | null> {
  // Fetch office provider_type
  const officeRes = await pool.query<{
    provider_type: string;
    country:       string | null;
  }>(
    `SELECT provider_type, country FROM offices WHERE id = $1`,
    [officeId],
  );
  const office = officeRes.rows[0];
  if (!office) return null;

  const providerType = office.provider_type ?? "office";

  // Look up the matching active plan in the plans table.
  // Prefer an exact provider_type match; fall back to a NULL provider_type universal plan.
  const planRes = await pool.query<{
    id:            number;
    name:          string;
    name_ar:       string;
    provider_type: string | null;
    monthly_price: number;
    currency:      string;
  }>(
    `SELECT id, name, name_ar, provider_type, monthly_price, currency
     FROM plans
     WHERE is_active = true
       AND (provider_type = $1 OR provider_type IS NULL)
     ORDER BY
       CASE WHEN provider_type = $1 THEN 0 ELSE 1 END,
       sort_order, id
     LIMIT 1`,
    [providerType],
  );
  const plan = planRes.rows[0];

  // Use DB plan if found; otherwise fall back to canonical hard-coded prices
  const canonical = PLAN_PRICES[providerType];
  if (!plan && !canonical) {
    logger.warn({ officeId, providerType }, "[paymentPlans] No plan found for provider type");
    return null;
  }

  const amountHalalas = plan?.monthly_price ?? canonical!.amountHalalas;
  const currency      = plan?.currency      ?? canonical!.currency;

  if (!plan) {
    // No DB plan row — return a synthetic plan entry using canonical prices
    return {
      planId:        -1, // sentinel: no DB row
      planName:      providerType === "office" ? "Office Standard" : "Freelancer Standard",
      planNameAr:    providerType === "office" ? "المكتب الأساسي" : "المستقل الأساسي",
      providerType,
      amountHalalas,
      currency,
    };
  }

  return {
    planId:        plan.id,
    planName:      plan.name,
    planNameAr:    plan.name_ar,
    providerType,
    amountHalalas,
    currency,
  };
}

// ── Idempotency key ───────────────────────────────────────────────────────────

/**
 * Build the application-level idempotency key for a payment.
 * Format: "{officeId}:{planId}:{YYYY-MM}"
 * The YYYY-MM is the billing month of the paid_through_date (one month from now).
 *
 * If two concurrent browser tabs both POST /api/payments/checkout in the same
 * billing month, the unique constraint on idempotency_key prevents a second
 * pending row from being created.
 */
export function buildIdempotencyKey(
  officeId:     number,
  planId:       number,
  billingMonth: string, // "YYYY-MM"
): string {
  return `${officeId}:${planId}:${billingMonth}`;
}

/**
 * Return the YYYY-MM string for the next billing month
 * (i.e., the month of paid_through_date = now + 30 days).
 */
export function nextBillingMonth(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  const year  = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Return the paid_through_date: now + 30 days (one subscription month).
 */
export function nextPaidThroughDate(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d;
}
