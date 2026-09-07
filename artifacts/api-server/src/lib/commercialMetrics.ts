/**
 * commercialMetrics.ts — Commercial Growth & Subscription Intelligence
 *
 * Single export: computeCommercialReport(periodStart, periodEnd, prevStart, prevEnd)
 *
 * All queries run in parallel via Promise.all.
 * No external imports beyond pool and PLAN_PRICES.
 * Demo offices (is_demo = true) excluded from every metric.
 * Failed / pending / cancelled / failed_no_slot payments excluded from revenue.
 */

import { pool } from "@workspace/db";
import { PLAN_PRICES } from "./paymentPlans";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProviderSplit {
  office:     number;
  freelancer: number;
  total:      number;
}

export interface SnapshotCounts {
  free:                    number;
  trial:                   number;
  activePaid:              number;
  expiring:                number;
  expired:                 number;
  hiddenDueToNonPayment:   number;
  cancelled:               number;
  totalEligible:           number;
}

export interface SnapshotByProvider {
  office:     SnapshotCounts;
  freelancer: SnapshotCounts;
  total:      SnapshotCounts;
}

export interface PeriodActivity {
  newTrial:       number;
  newPaid:        number;
  renewals:       number;
  reactivations:  number;
  churn:          number;
  netGrowth:      number;
}

export interface PeriodActivityByProvider {
  office:     PeriodActivity;
  freelancer: PeriodActivity;
  total:      PeriodActivity;
}

export interface MrrSnapshot {
  officeMrr:     number;  // SAR
  freelancerMrr: number;  // SAR
  totalMrr:      number;  // SAR
}

export interface RevenueMetrics {
  officeRevenue:     number;  // SAR
  freelancerRevenue: number;  // SAR
  totalRevenue:      number;  // SAR
}

export interface Rates {
  renewalRate:   number | null;  // renewals / (renewals + churn) * 100
  churnRate:     number | null;  // churn / (renewals + churn) * 100
  retentionRate: number | null;  // alias for renewalRate
  growthPct:     number | null;  // (current - prev activePaid) / prev activePaid * 100
}

export interface GrowthAlert {
  severity: "critical" | "warning" | "info";
  code:     string;
  message:  string;
}

export interface CommercialReport {
  period:          { start: string; end: string };
  previousPeriod:  { start: string; end: string };

  snapshot:        SnapshotByProvider;
  current:         PeriodActivityByProvider;
  previous:        PeriodActivityByProvider;
  mrr:             MrrSnapshot;
  currentRevenue:  RevenueMetrics;
  previousRevenue: RevenueMetrics;
  rates:           Rates;
  alerts:          GrowthAlert[];

  /** Cohort foundation: first paid month per office (not yet surfaced in UI). */
  cohortFoundationReady: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function emptyActivity(): PeriodActivity {
  return { newTrial: 0, newPaid: 0, renewals: 0, reactivations: 0, churn: 0, netGrowth: 0 };
}

function emptySnapshot(): SnapshotCounts {
  return { free: 0, trial: 0, activePaid: 0, expiring: 0, expired: 0, hiddenDueToNonPayment: 0, cancelled: 0, totalEligible: 0 };
}

function toSAR(halalas: number): number {
  return Math.round(halalas) / 100;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function computeRates(activity: PeriodActivity, snapshot: SnapshotCounts, prevActivePaid: number): Rates {
  const denominator = activity.renewals + activity.churn;
  const renewalRate   = denominator > 0 ? round1((activity.renewals / denominator) * 100) : null;
  const churnRate     = denominator > 0 ? round1((activity.churn    / denominator) * 100) : null;
  const currActivePaid = snapshot.activePaid + snapshot.expiring;  // "paid-tier" count
  const growthPct = prevActivePaid > 0
    ? round1(((currActivePaid - prevActivePaid) / prevActivePaid) * 100)
    : null;
  return { renewalRate, churnRate, retentionRate: renewalRate, growthPct };
}

function computeAlerts(
  current:  PeriodActivity,
  previous: PeriodActivity,
  snapshot: SnapshotCounts,
  prevActivePaid: number,
  currentRevenue: RevenueMetrics,
  previousRevenue: RevenueMetrics,
): GrowthAlert[] {
  const alerts: GrowthAlert[] = [];
  const currActivePaid = snapshot.activePaid + snapshot.expiring;

  // 1. Churn > renewals in period
  if (current.churn > current.renewals) {
    alerts.push({
      severity: "warning",
      code:     "CHURN_EXCEEDS_RENEWALS",
      message:  "New subscribers are only replacing churn — net retention is negative",
    });
  }

  // 2. Churn rate critical
  const denom = current.renewals + current.churn;
  const churnRate = denom > 0 ? (current.churn / denom) * 100 : 0;
  if (churnRate > 40) {
    alerts.push({
      severity: "critical",
      code:     "CHURN_RATE_CRITICAL",
      message:  `Churn rate critically high (${round1(churnRate)}%)`,
    });
  } else if (churnRate > 25) {
    alerts.push({
      severity: "warning",
      code:     "CHURN_RATE_ELEVATED",
      message:  `Churn rate elevated (${round1(churnRate)}%)`,
    });
  }

  // 3. Renewal rate dropped materially vs previous period
  const prevDenom = previous.renewals + previous.churn;
  if (prevDenom > 0) {
    const prevRenewalRate = (previous.renewals / prevDenom) * 100;
    const currRenewalRate = denom > 0 ? (current.renewals / denom) * 100 : 0;
    const drop = prevRenewalRate - currRenewalRate;
    if (drop > 20) {
      alerts.push({
        severity: "warning",
        code:     "RENEWAL_RATE_DROPPED",
        message:  `Renewal rate dropped ${round1(drop)} pts vs previous period`,
      });
    }
  }

  // 4. Paid subscribers declined vs previous period
  if (prevActivePaid > 0 && currActivePaid < prevActivePaid) {
    alerts.push({
      severity: "warning",
      code:     "PAID_SUBS_DECLINED",
      message:  `Paid subscribers declined vs previous period (${prevActivePaid} → ${currActivePaid})`,
    });
  }

  // 5. Freelancer growth outperforming office
  const freelancerNet = current.newPaid + current.renewals + current.reactivations - current.churn;
  // We'd need provider split here; this is computed at aggregate level as a proxy
  // (handled in UI using provider-split data)

  // 6. Active paid grew while revenue is flat
  if (prevActivePaid > 0 && currActivePaid > prevActivePaid && previousRevenue.totalRevenue > 0) {
    const subGrowth = ((currActivePaid - prevActivePaid) / prevActivePaid) * 100;
    const revGrowth = ((currentRevenue.totalRevenue - previousRevenue.totalRevenue) / previousRevenue.totalRevenue) * 100;
    if (subGrowth > 10 && revGrowth < subGrowth * 0.3) {
      alerts.push({
        severity: "info",
        code:     "SUBS_GROWING_REVENUE_FLAT",
        message:  "Active paid growing but revenue is flat — check for plan price mismatch",
      });
    }
  }

  // Cap at 5
  return alerts.slice(0, 5);
}

// ── Core query helpers ────────────────────────────────────────────────────────

type StateCountRow = { provider_type: string; state: string; cnt: string };
type HistoryRow    = { provider_type: string; to_state: string; from_state: string | null; cnt: string };
type RevenueRow    = { provider_type: string; total_halalas: string };

function parseStateRows(rows: StateCountRow[]): SnapshotByProvider {
  const office     = emptySnapshot();
  const freelancer = emptySnapshot();

  for (const row of rows) {
    const target = row.provider_type === "freelancer" ? freelancer : office;
    const cnt    = parseInt(row.cnt, 10) || 0;
    switch (row.state) {
      case "free":                     target.free                  += cnt; break;
      case "trial":                    target.trial                 += cnt; break;
      case "active_paid":              target.activePaid            += cnt; break;
      case "expiring":                 target.expiring              += cnt; break;
      case "expired":                  target.expired               += cnt; break;
      case "hidden_due_to_nonpayment": target.hiddenDueToNonPayment += cnt; break;
      case "cancelled":                target.cancelled             += cnt; break;
    }
    // totalEligible counts every office that has a subscription row
    target.totalEligible += cnt;
  }

  const total: SnapshotCounts = {
    free:                  office.free                  + freelancer.free,
    trial:                 office.trial                 + freelancer.trial,
    activePaid:            office.activePaid            + freelancer.activePaid,
    expiring:              office.expiring              + freelancer.expiring,
    expired:               office.expired               + freelancer.expired,
    hiddenDueToNonPayment: office.hiddenDueToNonPayment + freelancer.hiddenDueToNonPayment,
    cancelled:             office.cancelled             + freelancer.cancelled,
    totalEligible:         office.totalEligible         + freelancer.totalEligible,
  };

  return { office, freelancer, total };
}

function parseActivityRows(rows: HistoryRow[]): PeriodActivityByProvider {
  const office     = emptyActivity();
  const freelancer = emptyActivity();

  for (const row of rows) {
    const target    = row.provider_type === "freelancer" ? freelancer : office;
    const cnt       = parseInt(row.cnt, 10) || 0;
    const toState   = row.to_state;
    const fromState = row.from_state;

    const isNewTrial      = toState === "trial"       && (fromState === "free" || fromState === null);
    const isNewPaid       = toState === "active_paid" && (fromState === "free" || fromState === "trial");
    const isRenewal       = toState === "active_paid" && fromState === "expiring";
    const isReactivation  = toState === "active_paid" && (fromState === "expired" || fromState === "hidden_due_to_nonpayment" || fromState === "cancelled");

    // Churn = exit from a PAID-TIER state only.
    // Cancelling from free or trial is an admin cleanup, not a paid-subscriber loss.
    // Paid-tier sources: active_paid, expiring (currently paying),
    //                    expired, hidden_due_to_nonpayment (once-paying, in grace/hidden).
    const isPaidTierSource =
      fromState === "active_paid" ||
      fromState === "expiring"    ||
      fromState === "expired"     ||
      fromState === "hidden_due_to_nonpayment";
    const isChurn = (toState === "cancelled" || toState === "hidden_due_to_nonpayment") && isPaidTierSource;

    if (isNewTrial)     target.newTrial      += cnt;
    if (isNewPaid)      target.newPaid       += cnt;
    if (isRenewal)      target.renewals      += cnt;
    if (isReactivation) target.reactivations += cnt;
    if (isChurn)        target.churn         += cnt;
  }

  for (const t of [office, freelancer]) {
    // Renewals keep an existing expiring subscriber paid — they do NOT add a net new subscriber.
    // Net paid-subscriber change = new entrants (newPaid + reactivations) minus exits (churn).
    t.netGrowth = t.newPaid + t.reactivations - t.churn;
  }

  const total: PeriodActivity = {
    newTrial:      office.newTrial      + freelancer.newTrial,
    newPaid:       office.newPaid       + freelancer.newPaid,
    renewals:      office.renewals      + freelancer.renewals,
    reactivations: office.reactivations + freelancer.reactivations,
    churn:         office.churn         + freelancer.churn,
    netGrowth:     office.netGrowth     + freelancer.netGrowth,
  };

  return { office, freelancer, total };
}

function parseRevenueRows(rows: RevenueRow[]): RevenueMetrics {
  let officeHalalas = 0;
  let freelancerHalalas = 0;

  for (const row of rows) {
    const h = parseInt(row.total_halalas, 10) || 0;
    if (row.provider_type === "freelancer") {
      freelancerHalalas += h;
    } else {
      officeHalalas += h;
    }
  }

  return {
    officeRevenue:     toSAR(officeHalalas),
    freelancerRevenue: toSAR(freelancerHalalas),
    totalRevenue:      toSAR(officeHalalas + freelancerHalalas),
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function computeCommercialReport(
  periodStart: Date,
  periodEnd:   Date,
  prevStart:   Date,
  prevEnd:     Date,
): Promise<CommercialReport> {

  const [
    stateRes,
    activityRes,
    prevActivityRes,
    revenueRes,
    prevRevenueRes,
    prevActivePaidRes,
  ] = await Promise.all([

    // (a) Point-in-time state counts at periodEnd, reconstructed from subscription_history.
    //     Using DISTINCT ON (office_id ORDER BY created_at DESC) gives the last-known state
    //     per office before periodEnd. This is accurate for historical period modes
    //     (previous_month, prev_30d) and equivalent to the live table for current-period modes.
    pool.query<StateCountRow>(
      `WITH last_state AS (
         SELECT DISTINCT ON (sh.office_id)
           sh.office_id,
           sh.to_state  AS state,
           o.provider_type
         FROM subscription_history sh
         JOIN offices o ON o.id = sh.office_id
         WHERE o.is_demo = false
           AND sh.created_at < $1
         ORDER BY sh.office_id, sh.created_at DESC
       )
       SELECT provider_type, state, COUNT(*)::text AS cnt
       FROM last_state
       GROUP BY provider_type, state`,
      [periodEnd],
    ),

    // (b) Period activity from subscription_history, grouped by provider_type
    pool.query<HistoryRow>(
      `SELECT o.provider_type, sh.to_state, sh.from_state, COUNT(*)::text AS cnt
       FROM subscription_history sh
       JOIN offices o ON o.id = sh.office_id
       WHERE o.is_demo = false
         AND sh.created_at >= $1
         AND sh.created_at < $2
       GROUP BY o.provider_type, sh.to_state, sh.from_state`,
      [periodStart, periodEnd],
    ),

    // (c) Previous period activity
    pool.query<HistoryRow>(
      `SELECT o.provider_type, sh.to_state, sh.from_state, COUNT(*)::text AS cnt
       FROM subscription_history sh
       JOIN offices o ON o.id = sh.office_id
       WHERE o.is_demo = false
         AND sh.created_at >= $1
         AND sh.created_at < $2
       GROUP BY o.provider_type, sh.to_state, sh.from_state`,
      [prevStart, prevEnd],
    ),

    // (d) Revenue from succeeded payments in current period
    pool.query<RevenueRow>(
      `SELECT o.provider_type, COALESCE(SUM(t.amount_halalas), 0)::text AS total_halalas
       FROM office_payment_transactions t
       JOIN offices o ON o.id = t.office_id
       WHERE o.is_demo = false
         AND t.status = 'succeeded'
         AND t.paid_at >= $1
         AND t.paid_at < $2
       GROUP BY o.provider_type`,
      [periodStart, periodEnd],
    ),

    // (e) Revenue from succeeded payments in previous period
    pool.query<RevenueRow>(
      `SELECT o.provider_type, COALESCE(SUM(t.amount_halalas), 0)::text AS total_halalas
       FROM office_payment_transactions t
       JOIN offices o ON o.id = t.office_id
       WHERE o.is_demo = false
         AND t.status = 'succeeded'
         AND t.paid_at >= $1
         AND t.paid_at < $2
       GROUP BY o.provider_type`,
      [prevStart, prevEnd],
    ),

    // (f) Point-in-time activePaid count at prevEnd:
    //     For each office, find its last-known state before prevEnd via DISTINCT ON.
    //     Only count offices whose last state was 'active_paid' or 'expiring'.
    //     This prevents overcounting offices that later churned before the boundary.
    pool.query<{ provider_type: string; cnt: string }>(
      `WITH last_state AS (
         SELECT DISTINCT ON (sh.office_id)
           sh.office_id,
           sh.to_state,
           o.provider_type
         FROM subscription_history sh
         JOIN offices o ON o.id = sh.office_id
         WHERE o.is_demo = false
           AND sh.created_at < $1
         ORDER BY sh.office_id, sh.created_at DESC
       )
       SELECT provider_type, COUNT(*)::text AS cnt
       FROM last_state
       WHERE to_state IN ('active_paid', 'expiring')
       GROUP BY provider_type`,
      [prevEnd],
    ),
  ]);

  // Parse results
  const snapshot        = parseStateRows(stateRes.rows);
  const current         = parseActivityRows(activityRes.rows);
  const previous        = parseActivityRows(prevActivityRes.rows);
  const currentRevenue  = parseRevenueRows(revenueRes.rows);
  const previousRevenue = parseRevenueRows(prevRevenueRes.rows);

  // Previous period activePaid by provider
  let prevOfficePaid = 0, prevFreelancerPaid = 0;
  for (const row of prevActivePaidRes.rows) {
    const cnt = parseInt(row.cnt, 10) || 0;
    if (row.provider_type === "freelancer") prevFreelancerPaid += cnt;
    else prevOfficePaid += cnt;
  }
  const prevActivePaid = prevOfficePaid + prevFreelancerPaid;

  // MRR from current paid-tier counts × canonical prices
  const officePaidCount     = snapshot.office.activePaid     + snapshot.office.expiring;
  const freelancerPaidCount = snapshot.freelancer.activePaid + snapshot.freelancer.expiring;
  const officeMrr           = toSAR(officePaidCount     * PLAN_PRICES.office.amountHalalas);
  const freelancerMrr       = toSAR(freelancerPaidCount * PLAN_PRICES.freelancer.amountHalalas);
  const mrr: MrrSnapshot    = { officeMrr, freelancerMrr, totalMrr: officeMrr + freelancerMrr };

  // Rates
  const rates = computeRates(current.total, snapshot.total, prevActivePaid);

  // Alerts
  const alerts = computeAlerts(current.total, previous.total, snapshot.total, prevActivePaid, currentRevenue, previousRevenue);

  return {
    period:          { start: periodStart.toISOString(), end: periodEnd.toISOString() },
    previousPeriod:  { start: prevStart.toISOString(),   end: prevEnd.toISOString() },
    snapshot,
    current,
    previous,
    mrr,
    currentRevenue,
    previousRevenue,
    rates,
    alerts,
    cohortFoundationReady: true,
  };
}
