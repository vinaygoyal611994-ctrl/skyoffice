/**
 * Office-facing analytics report — Phase 1.
 *
 * GET /api/analytics/office/report
 *
 * Returns a period-based report for the authenticated office only.
 * Combines pre-aggregated daily rows (analytics_daily_by_office) with
 * lightweight targeted raw queries for metrics not yet in the aggregate
 * table (copy_link, phone_click, top service, top city).
 *
 * Auth: requireRole("office") — session user → offices.user_id lookup.
 * Ownership: every query is scoped to the resolved officeId; the client
 * never supplies an officeId parameter.
 *
 * Privacy:
 * - No visitor IDs, raw IPs, or session tokens in response.
 * - No other office's data can appear (all WHERE clauses enforce officeId).
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  officesTable,
  officeServicesTable,
  analyticsEventsTable,
  analyticsDailyByOfficeTable,
  contactEventsTable,
  serviceTaxonomyTable,
} from "@workspace/db";
import { and, eq, gte, lte, sql, sum } from "drizzle-orm";
import { requireRole } from "../middlewares/authMiddleware";
import { logger } from "../lib/logger";
import {
  computeChange,
  computeOpportunity,
  computeRecommendation,
  computeRatePair,
  metricPair,
  isProfileComplete,
  CITY_DISPLAY_NAMES,
  THRESHOLDS,
  type OfficeReportResponse,
} from "../lib/officeReportEngine";

const router: IRouter = Router();

// ── Period helpers ────────────────────────────────────────────────────────────

type PeriodKey = "7d" | "30d" | "90d";

function parsePeriod(raw: unknown): PeriodKey | null {
  if (raw === "7d" || raw === "30d" || raw === "90d") return raw;
  return null;
}

/**
 * Returns date strings (YYYY-MM-DD, UTC) for the selected and comparison windows.
 * The selected period ends yesterday (the most recent complete aggregated day).
 */
function buildDateRanges(periodKey: PeriodKey): {
  days: number;
  currentFrom: Date;
  currentTo: Date;
  prevFrom: Date;
  prevTo: Date;
  currentFromStr: string;
  currentToStr: string;
  prevFromStr: string;
  prevToStr: string;
} {
  const days = periodKey === "7d" ? 7 : periodKey === "30d" ? 30 : 90;

  // yesterday UTC midnight
  const yesterday = new Date();
  yesterday.setUTCHours(0, 0, 0, 0);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  const currentTo = new Date(yesterday);
  const currentFrom = new Date(yesterday);
  currentFrom.setUTCDate(currentFrom.getUTCDate() - (days - 1));

  const prevTo = new Date(yesterday);
  prevTo.setUTCDate(prevTo.getUTCDate() - days);
  const prevFrom = new Date(yesterday);
  prevFrom.setUTCDate(prevFrom.getUTCDate() - (2 * days - 1));

  const toDateStr = (d: Date) => d.toISOString().slice(0, 10);

  return {
    days,
    currentFrom,
    currentTo,
    prevFrom,
    prevTo,
    currentFromStr: toDateStr(currentFrom),
    currentToStr:   toDateStr(currentTo),
    prevFromStr:    toDateStr(prevFrom),
    prevToStr:      toDateStr(prevTo),
  };
}

/** Convert a date-only boundary to a UTC timestamp for raw event queries. */
function toTimestamp(d: Date, endOfDay = false): Date {
  const t = new Date(d);
  if (endOfDay) {
    // Inclusive end: use start of the NEXT day as exclusive upper bound
    t.setUTCDate(t.getUTCDate() + 1);
  }
  t.setUTCHours(0, 0, 0, 0);
  return t;
}

// ── Aggregate helper (analytics_daily_by_office) ──────────────────────────────

interface DailyAggregateTotals {
  cardImpressions: number;
  profileViews: number;
  uniqueVisitors: number;
  whatsappClicks: number;
  mapClicks: number;
  shareClicks: number;
  videoCallRequests: number;
  qrVisits: number;
  rowCount: number; // used for dataAvailabilityNote
}

async function queryAggregateTotals(
  officeId: number,
  fromDate: Date,
  toDate: Date,
): Promise<DailyAggregateTotals> {
  const rows = await db
    .select({
      cardImpressions:   sum(analyticsDailyByOfficeTable.cardImpressions).mapWith(Number),
      profileViews:      sum(analyticsDailyByOfficeTable.profileViews).mapWith(Number),
      uniqueVisitors:    sum(analyticsDailyByOfficeTable.uniqueVisitorsApprox).mapWith(Number),
      whatsappClicks:    sum(analyticsDailyByOfficeTable.whatsappClicks).mapWith(Number),
      mapClicks:         sum(analyticsDailyByOfficeTable.mapClicks).mapWith(Number),
      shareClicks:       sum(analyticsDailyByOfficeTable.shareClicks).mapWith(Number),
      videoCallRequests: sum(analyticsDailyByOfficeTable.videoCallRequests).mapWith(Number),
      qrVisits:          sum(analyticsDailyByOfficeTable.qrVisits).mapWith(Number),
      rowCount:          sql<number>`COUNT(*)::int`,
    })
    .from(analyticsDailyByOfficeTable)
    .where(
      and(
        eq(analyticsDailyByOfficeTable.officeId, officeId),
        gte(analyticsDailyByOfficeTable.date, fromDate),
        lte(analyticsDailyByOfficeTable.date, toDate),
      ),
    );

  const r = rows[0] ?? {};
  return {
    cardImpressions:   r.cardImpressions   ?? 0,
    profileViews:      r.profileViews      ?? 0,
    uniqueVisitors:    r.uniqueVisitors     ?? 0,
    whatsappClicks:    r.whatsappClicks     ?? 0,
    mapClicks:         r.mapClicks          ?? 0,
    shareClicks:       r.shareClicks        ?? 0,
    videoCallRequests: r.videoCallRequests  ?? 0,
    qrVisits:          r.qrVisits           ?? 0,
    rowCount:          r.rowCount           ?? 0,
  };
}

// ── Raw query helpers ─────────────────────────────────────────────────────────

async function queryPhoneClicks(
  officeId: number,
  from: Date,
  to: Date,
): Promise<number> {
  // phone_click is not yet in contactEventActionTypeEnum but we query it
  // defensively for forward-compatibility. Currently always returns 0.
  const rows = await db.execute(sql`
    SELECT COUNT(*)::int AS cnt
    FROM contact_events
    WHERE office_id = ${officeId}
      AND action_type = 'phone_click'
      AND created_at >= ${from.toISOString()}::timestamptz
      AND created_at < ${toTimestamp(to, true).toISOString()}::timestamptz
  `);
  return (rows.rows[0] as { cnt: number })?.cnt ?? 0;
}

async function queryCopyLinkClicks(
  officeId: number,
  from: Date,
  to: Date,
): Promise<number> {
  const rows = await db.execute(sql`
    SELECT COUNT(*)::int AS cnt
    FROM analytics_events
    WHERE office_id = ${officeId}
      AND event_name = 'copy_link'
      AND is_bot = false
      AND occurred_at >= ${from.toISOString()}::timestamptz
      AND occurred_at < ${toTimestamp(to, true).toISOString()}::timestamptz
  `);
  return (rows.rows[0] as { cnt: number })?.cnt ?? 0;
}

async function queryTopService(
  officeId: number,
  from: Date,
  to: Date,
): Promise<{ serviceKey: string; nameEn: string; nameAr: string; count: number; share: number } | null> {
  const rows = await db.execute(sql`
    SELECT
      ae.service_id,
      COUNT(*)::int AS cnt,
      SUM(COUNT(*)) OVER ()::int AS total_cnt
    FROM analytics_events ae
    WHERE ae.office_id = ${officeId}
      AND ae.event_name = 'office_profile_view'
      AND ae.service_id IS NOT NULL
      AND ae.is_bot = false
      AND ae.occurred_at >= ${from.toISOString()}::timestamptz
      AND ae.occurred_at < ${toTimestamp(to, true).toISOString()}::timestamptz
    GROUP BY ae.service_id
    ORDER BY cnt DESC
    LIMIT 1
  `);

  const row = rows.rows[0] as { service_id: string; cnt: number; total_cnt: number } | undefined;
  if (!row) return null;

  const total = row.total_cnt ?? 1;
  const count = row.cnt;
  if (count < THRESHOLDS.MIN_EVENTS_FOR_SERVICE_SIGNAL) return null;

  // Resolve taxonomy name
  const taxonomy = await db
    .select({ nameEn: serviceTaxonomyTable.nameEn, nameAr: serviceTaxonomyTable.nameAr })
    .from(serviceTaxonomyTable)
    .where(eq(serviceTaxonomyTable.serviceKey, row.service_id))
    .limit(1);

  if (!taxonomy.length) return null;

  return {
    serviceKey: row.service_id,
    nameEn: taxonomy[0].nameEn,
    nameAr: taxonomy[0].nameAr,
    count,
    share: count / total,
  };
}

async function queryTopCity(
  officeId: number,
  from: Date,
  to: Date,
): Promise<{ cityId: string; nameEn?: string; nameAr?: string; count: number; share: number } | null> {
  const rows = await db.execute(sql`
    SELECT
      city_id,
      COUNT(*)::int AS cnt,
      SUM(COUNT(*)) OVER ()::int AS total_cnt
    FROM analytics_events
    WHERE office_id = ${officeId}
      AND is_bot = false
      AND city_id IS NOT NULL
      AND occurred_at >= ${from.toISOString()}::timestamptz
      AND occurred_at < ${toTimestamp(to, true).toISOString()}::timestamptz
    GROUP BY city_id
    ORDER BY cnt DESC
    LIMIT 1
  `);

  const row = rows.rows[0] as { city_id: string; cnt: number; total_cnt: number } | undefined;
  if (!row) return null;

  const total = row.total_cnt ?? 1;
  const count = row.cnt;
  if (count < THRESHOLDS.MIN_EVENTS_FOR_CITY_SIGNAL) return null;

  const share = count / total;
  if (share < 0.30) return null; // Per spec: top city must be ≥30% to qualify as a signal

  const displayNames = CITY_DISPLAY_NAMES[row.city_id];
  return {
    cityId: row.city_id,
    nameEn: displayNames?.nameEn,
    nameAr: displayNames?.nameAr,
    count,
    share,
  };
}

async function queryDailyTrend(
  officeId: number,
  from: Date,
  to: Date,
): Promise<Array<{ date: string; profileViews: number; contactActions: number }>> {
  const rows = await db
    .select({
      date:             analyticsDailyByOfficeTable.date,
      profileViews:     analyticsDailyByOfficeTable.profileViews,
      whatsappClicks:   analyticsDailyByOfficeTable.whatsappClicks,
      mapClicks:        analyticsDailyByOfficeTable.mapClicks,
      shareClicks:      analyticsDailyByOfficeTable.shareClicks,
      videoCallRequests: analyticsDailyByOfficeTable.videoCallRequests,
    })
    .from(analyticsDailyByOfficeTable)
    .where(
      and(
        eq(analyticsDailyByOfficeTable.officeId, officeId),
        gte(analyticsDailyByOfficeTable.date, from),
        lte(analyticsDailyByOfficeTable.date, to),
      ),
    )
    .orderBy(analyticsDailyByOfficeTable.date);

  return rows.map((r) => ({
    date: (r.date as unknown as Date).toISOString().slice(0, 10),
    profileViews: r.profileViews,
    contactActions:
      (r.whatsappClicks ?? 0) +
      (r.mapClicks ?? 0) +
      (r.shareClicks ?? 0) +
      (r.videoCallRequests ?? 0),
  }));
}

// ── Route ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/analytics/office/report
 *
 * Query params:
 *   period=7d|30d|90d  (default: 30d)
 *
 * Returns the office performance report for the authenticated office.
 * The client must not supply an officeId — it is resolved from the session.
 */
router.get(
  "/analytics/office/report",
  requireRole("office"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const periodKey = parsePeriod(req.query["period"] ?? "30d");
      if (!periodKey) {
        res.status(400).json({ error: "Invalid period. Use 7d, 30d, or 90d." });
        return;
      }

      // ── Resolve the authenticated office ───────────────────────────────────
      const officeRows = await db
        .select()
        .from(officesTable)
        .where(eq(officesTable.userId, req.session.user!.id))
        .limit(1);

      if (!officeRows.length) {
        res.status(404).json({ error: "Office not found" });
        return;
      }

      const office = officeRows[0];
      const officeId = office.id;

      // ── Build date ranges ──────────────────────────────────────────────────
      const range = buildDateRanges(periodKey);

      // ── Fan out all queries in parallel ───────────────────────────────────
      const [
        currentAgg,
        prevAgg,
        currentPhoneClicks,
        prevPhoneClicks,
        currentCopyLink,
        prevCopyLink,
        topService,
        topCity,
        dailyTrend,
        servicesResult,
      ] = await Promise.all([
        queryAggregateTotals(officeId, range.currentFrom, range.currentTo),
        queryAggregateTotals(officeId, range.prevFrom,    range.prevTo),
        queryPhoneClicks(officeId, range.currentFrom, range.currentTo),
        queryPhoneClicks(officeId, range.prevFrom,    range.prevTo),
        queryCopyLinkClicks(officeId, range.currentFrom, range.currentTo),
        queryCopyLinkClicks(officeId, range.prevFrom,    range.prevTo),
        queryTopService(officeId, range.currentFrom, range.currentTo),
        queryTopCity(officeId, range.currentFrom, range.currentTo),
        queryDailyTrend(officeId, range.currentFrom, range.currentTo),
        db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(officeServicesTable)
          .where(eq(officeServicesTable.officeId, officeId)),
      ]);

      const servicesCount = servicesResult[0]?.count ?? 0;

      // ── Compute contactActions (per spec: excludes copy_link) ──────────────
      const currentContactActions =
        currentAgg.whatsappClicks +
        currentPhoneClicks +
        currentAgg.mapClicks +
        currentAgg.shareClicks +
        currentAgg.videoCallRequests;

      const prevContactActions =
        prevAgg.whatsappClicks +
        prevPhoneClicks +
        prevAgg.mapClicks +
        prevAgg.shareClicks +
        prevAgg.videoCallRequests;

      // ── Data availability ──────────────────────────────────────────────────
      let dataAvailabilityNote: "full" | "partial" | "none";
      if (currentAgg.rowCount === 0) {
        dataAvailabilityNote = "none";
      } else if (currentAgg.rowCount < range.days) {
        dataAvailabilityNote = "partial";
      } else {
        dataAvailabilityNote = "full";
      }

      // ── Profile completeness ───────────────────────────────────────────────
      const profileCompleteness = {
        hasWhatsapp:    !!office.whatsapp,
        hasDescription: !!(office.description || office.shortDescription),
        hasCoverUrl:    !!office.coverUrl,
        servicesCount,
      };

      // ── Recommendation ─────────────────────────────────────────────────────
      const recommendation = computeRecommendation({
        profile: profileCompleteness,
        profileViews:   currentAgg.profileViews,
        cardImpressions: currentAgg.cardImpressions,
        contactActions: currentContactActions,
        topService: topService
          ? { nameEn: topService.nameEn, nameAr: topService.nameAr, count: topService.count, share: topService.share }
          : null,
        topCity: topCity
          ? { cityId: topCity.cityId, nameEn: topCity.nameEn, nameAr: topCity.nameAr, count: topCity.count, share: topCity.share }
          : null,
      });

      // ── Opportunity card ───────────────────────────────────────────────────
      const opportunity = computeOpportunity(
        currentAgg.profileViews,
        currentContactActions,
      );

      // ── Build response ─────────────────────────────────────────────────────
      const response: OfficeReportResponse = {
        period: {
          from: range.currentFromStr,
          to:   range.currentToStr,
          days: range.days,
        },
        comparisonPeriod: {
          from: range.prevFromStr,
          to:   range.prevToStr,
        },
        dataAvailabilityNote,
        metrics: {
          cardImpressions: metricPair(currentAgg.cardImpressions, prevAgg.cardImpressions),
          profileViews:    metricPair(currentAgg.profileViews,    prevAgg.profileViews),
          uniqueVisitors:  metricPair(currentAgg.uniqueVisitors,  prevAgg.uniqueVisitors),
          contactActions:  metricPair(currentContactActions,      prevContactActions),
          whatsappClicks:  metricPair(currentAgg.whatsappClicks,  prevAgg.whatsappClicks),
          phoneClicks: office.acceptsPhoneCalls
            ? metricPair(currentPhoneClicks, prevPhoneClicks)
            : null,
          shareClicks:    metricPair(currentAgg.shareClicks,   prevAgg.shareClicks),
          copyLinkClicks: metricPair(currentCopyLink,          prevCopyLink),
          qrVisits:       metricPair(currentAgg.qrVisits,      prevAgg.qrVisits),
          visitToContactRate: computeRatePair(
            currentContactActions, currentAgg.profileViews,
            prevContactActions,    prevAgg.profileViews,
          ),
        },
        topSignals: { topService, topCity },
        dailyTrend,
        recommendation,
        opportunity,
      };

      res.json(response);
    } catch (err) {
      logger.error({ err }, "[office-report] Unhandled error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export { router as analyticsOfficeReportRouter };
