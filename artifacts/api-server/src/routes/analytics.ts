/**
 * Analytics API routes — Phase 1.
 *
 * Two categories of endpoints:
 *
 *   A. Event ingestion (public, rate-limited by existing middleware)
 *      POST /api/analytics/events          — client-side event batch
 *
 *   B. Admin intelligence queries (requires role='admin')
 *      GET /api/analytics/admin/overview         — global KPI summary
 *      GET /api/analytics/admin/market           — demand/supply by market
 *      GET /api/analytics/admin/search           — search intelligence
 *      GET /api/analytics/admin/offices          — per-office performance table
 *      GET /api/analytics/admin/sources          — traffic source breakdown
 *      GET /api/analytics/admin/aggregation-jobs — job history + status
 *      POST /api/analytics/admin/aggregate       — trigger manual aggregation
 *      GET /api/analytics/admin/reports          — list historical snapshots
 *      POST /api/analytics/admin/reports         — generate new snapshot
 *
 * Design notes:
 *   - Ingestion endpoint accepts batches of ≤20 events from the frontend
 *   - All admin endpoints use pre-aggregated daily tables for speed
 *   - Raw event queries are only used for drill-down (deferred to Phase 2)
 *   - Analytics failures never return errors to users (ingestion silently
 *     discards bad events with logging; admin endpoints return proper errors)
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  analyticsEventsTable,
  analyticsDailyGlobalTable,
  analyticsDailyByOfficeTable,
  analyticsDailyByMarketTable,
  analyticsDailyBySourceTable,
  analyticsDailyBySearchTable,
  analyticsAggregationJobsTable,
  analyticsAdminReportsTable,
} from "@workspace/db";
import { and, eq, gte, lte, desc, sum, sql } from "drizzle-orm";
import { z } from "zod";
import { logger } from "../lib/logger";
import { requireRole } from "../middlewares/authMiddleware";
import { analyticsIpLimiter } from "../lib/rateLimiter";
import {
  fireAnalyticsEventBatch,
  extractRequestContext,
  type AnalyticsEventPayload,
} from "../lib/analyticsWriter";
import { getOrCreateVisitorId, readVisitorId } from "../lib/visitorSession";
import { analyticsEventNameSchema } from "../lib/analyticsEventTaxonomy";
import { runAggregationForDate } from "../lib/analyticsAggregator";

const router: IRouter = Router();

// ── Shared filter schema ──────────────────────────────────────────────────────

const dateRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD required"),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD required"),
  country: z.string().length(2).toUpperCase().optional(),
  city: z.string().optional(),
  category: z.string().optional(),
  source: z.string().optional(),
  language: z.enum(["ar", "en"]).optional(),
  device: z.enum(["desktop", "mobile", "tablet", "unknown"]).optional(),
});

function parseDateRange(
  query: Record<string, unknown>,
): { from: Date; to: Date; filters: Record<string, string | undefined> } | null {
  // Default: last 30 days
  const now = new Date();
  const defaultTo = now.toISOString().slice(0, 10);
  const defaultFrom = new Date(now.setDate(now.getDate() - 30))
    .toISOString()
    .slice(0, 10);

  const parsed = dateRangeSchema.safeParse({
    from: query["from"] ?? defaultFrom,
    to: query["to"] ?? defaultTo,
    ...query,
  });
  if (!parsed.success) return null;

  return {
    from: new Date(parsed.data.from),
    to: new Date(parsed.data.to),
    filters: {
      country: parsed.data.country,
      city: parsed.data.city,
      category: parsed.data.category,
      source: parsed.data.source,
      language: parsed.data.language,
      device: parsed.data.device,
    },
  };
}

// ── A. Event Ingestion ────────────────────────────────────────────────────────

/**
 * Client-side analytics event batch ingestion.
 *
 * Accepts batches of up to 20 events from the frontend JS.
 * Validates event names. Silently drops invalid events (logged at warn).
 * Returns 204 even when all events are dropped — analytics failures must
 * never surface as errors to the user.
 *
 * Expected body:
 * {
 *   events: [
 *     {
 *       eventName: string,       // one of ANALYTICS_EVENT_NAMES
 *       eventId: string,         // client-generated UUID (for deduplication)
 *       occurredAt: string,      // ISO8601 UTC
 *       visitorId?: string,      // read from _skay_vid cookie if not set
 *       sessionId?: string,
 *       searchSessionId?: string,
 *       officeId?: number,
 *       countryCode?: string,
 *       cityId?: string,
 *       categoryId?: string,
 *       source?: string,
 *       entryPoint?: string,
 *       referrerDomain?: string,
 *       qrCampaignId?: string,
 *       utmSource?: string,
 *       utmMedium?: string,
 *       utmCampaign?: string,
 *       interfaceLanguage?: 'ar' | 'en',
 *       deviceCategory?: string,
 *       metadata?: object,
 *       // search_performed specific:
 *       searchQueryOriginal?: string,
 *       searchQueryNormalized?: string,
 *       searchResultsCount?: number,
 *       inputMethod?: 'typed' | 'voice',
 *       // card_impression specific:
 *       resultPosition?: number,
 *     },
 *     ...
 *   ]
 * }
 */

const ClientEventSchema = z.object({
  eventName: analyticsEventNameSchema,
  eventId: z.string().uuid(),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  visitorId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
  searchSessionId: z.string().uuid().optional(),
  officeId: z.number().int().positive().optional(),
  countryCode: z.string().length(2).toUpperCase().optional(),
  cityId: z.string().max(100).optional(),
  categoryId: z.string().max(100).optional(),
  source: z
    .enum([
      "direct",
      "internal_search",
      "qr",
      "social",
      "referral",
      "paid_campaign",
      "organic_search",
      "whatsapp_share",
      "unknown",
    ])
    .optional(),
  entryPoint: z.string().max(50).optional(),
  referrerDomain: z.string().max(200).optional(),
  qrCampaignId: z
    .string()
    .regex(/^[a-z0-9-]{1,64}$/)
    .optional(),
  utmSource: z.string().max(200).optional(),
  utmMedium: z.string().max(200).optional(),
  utmCampaign: z.string().max(200).optional(),
  utmContent: z.string().max(200).optional(),
  utmTerm: z.string().max(200).optional(),
  interfaceLanguage: z.enum(["ar", "en"]).optional(),
  deviceCategory: z
    .enum(["desktop", "mobile", "tablet", "unknown"])
    .optional(),
  searchQueryOriginal: z.string().max(200).optional(),
  searchQueryNormalized: z.string().max(200).optional(),
  searchResultsCount: z.number().int().min(0).optional(),
  inputMethod: z.enum(["typed", "voice"]).optional(),
  resultPosition: z.number().int().min(1).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const BatchBodySchema = z.object({
  events: z.array(ClientEventSchema).max(20),
});

router.post(
  "/analytics/events",
  analyticsIpLimiter,
  async (req: Request, res: Response): Promise<void> => {
    // Create (or read) the visitor cookie BEFORE sending the response so it
    // is included in Set-Cookie headers. This ensures visitor_id is populated
    // for video/gallery events that fire from the listing page without a prior
    // profile-view GET (which was the only place getOrCreateVisitorId ran before).
    const cookieVisitorId = getOrCreateVisitorId(req, res);

    // Always return 204 regardless of outcome — analytics must never block UX
    res.sendStatus(204);

    // Process after response is sent
    try {
      const parsed = BatchBodySchema.safeParse(req.body);
      if (!parsed.success) {
        logger.debug(
          { error: parsed.error.message },
          "[analytics] Invalid batch body — dropped",
        );
        return;
      }

      const ctx = extractRequestContext(req);
      // Skip admin sessions (already covered) AND internal/seed accounts.
      // Internal actors must not contribute to business metrics.
      if (req.session?.user?.role === "admin" || req.session?.user?.isInternal) return;

      const payloads: AnalyticsEventPayload[] = parsed.data.events.map(
        (ev) => ({
          eventName: ev.eventName,
          eventId: ev.eventId,
          occurredAt: ev.occurredAt ? new Date(ev.occurredAt) : undefined,
          visitorId: ev.visitorId ?? cookieVisitorId ?? undefined,
          sessionId: ev.sessionId ?? undefined,
          searchSessionId: ev.searchSessionId ?? undefined,
          authenticatedUserId: ctx.authenticatedUserId ?? undefined,
          officeId: ev.officeId ?? undefined,
          countryCode: ev.countryCode ?? undefined,
          cityId: ev.cityId ?? undefined,
          categoryId: ev.categoryId ?? undefined,
          source: ev.source ?? undefined,
          entryPoint: ev.entryPoint ?? undefined,
          referrerDomain: ev.referrerDomain ?? ctx.referrerDomain ?? undefined,
          qrCampaignId: ev.qrCampaignId ?? ctx.qrCampaignId ?? undefined,
          utmSource: ev.utmSource ?? ctx.utmSource ?? undefined,
          utmMedium: ev.utmMedium ?? ctx.utmMedium ?? undefined,
          utmCampaign: ev.utmCampaign ?? ctx.utmCampaign ?? undefined,
          utmContent: ev.utmContent ?? ctx.utmContent ?? undefined,
          utmTerm: ev.utmTerm ?? ctx.utmTerm ?? undefined,
          interfaceLanguage: ev.interfaceLanguage ?? ctx.interfaceLanguage ?? undefined,
          deviceCategory: ev.deviceCategory ?? ctx.deviceCategory ?? undefined,
          osFamily: ctx.osFamily ?? undefined,
          browserFamily: ctx.browserFamily ?? undefined,
          searchQueryOriginal: ev.searchQueryOriginal ?? undefined,
          searchQueryNormalized: ev.searchQueryNormalized ?? undefined,
          searchResultsCount: ev.searchResultsCount ?? undefined,
          inputMethod: ev.inputMethod ?? undefined,
          resultPosition: ev.resultPosition ?? undefined,
          metadata: ev.metadata ?? undefined,
          isBot: ctx.isBot,
          botDetectionVersion: ctx.botDetectionVersion,
          exclusionReason: ctx.exclusionReason ?? undefined,
        }),
      );

      fireAnalyticsEventBatch(payloads);
    } catch (err) {
      logger.warn(
        { err: (err as Error).message },
        "[analytics] Error processing event batch — suppressed",
      );
    }
  },
);

// ── B. Admin intelligence endpoints ──────────────────────────────────────────

/**
 * GET /api/analytics/admin/overview
 * Global KPI summary for the Executive Overview panel.
 * Returns totals and growth rates from analytics_daily_global.
 */
router.get(
  "/analytics/admin/overview",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const range = parseDateRange(req.query as Record<string, unknown>);
    if (!range) {
      res.status(400).json({ error: "Invalid date range" });
      return;
    }

    const [current, snapshots] = await Promise.all([
      db
        .select({
          searches: sum(analyticsDailyGlobalTable.searches).mapWith(Number),
          zeroResultSearches: sum(analyticsDailyGlobalTable.zeroResultSearches).mapWith(Number),
          profileViews: sum(analyticsDailyGlobalTable.profileViews).mapWith(Number),
          cardClicks: sum(analyticsDailyGlobalTable.cardClicks).mapWith(Number),
          cardImpressions: sum(analyticsDailyGlobalTable.cardImpressions).mapWith(Number),
          uniqueVisitorsApprox: sum(analyticsDailyGlobalTable.uniqueVisitorsApprox).mapWith(Number),
          videoStarts: sum(analyticsDailyGlobalTable.videoStarts).mapWith(Number),
          videoCompletions: sum(analyticsDailyGlobalTable.videoCompletions).mapWith(Number),
          whatsappClicks: sum(analyticsDailyGlobalTable.whatsappClicks).mapWith(Number),
          mapClicks: sum(analyticsDailyGlobalTable.mapClicks).mapWith(Number),
          shareClicks: sum(analyticsDailyGlobalTable.shareClicks).mapWith(Number),
          videoCallRequests: sum(analyticsDailyGlobalTable.videoCallRequests).mapWith(Number),
          qrVisits: sum(analyticsDailyGlobalTable.qrVisits).mapWith(Number),
          registrationStarts: sum(analyticsDailyGlobalTable.registrationStarts).mapWith(Number),
          registrationsCompleted: sum(analyticsDailyGlobalTable.registrationsCompleted).mapWith(Number),
          profilesApproved: sum(analyticsDailyGlobalTable.profilesApproved).mapWith(Number),
          officesActivated: sum(analyticsDailyGlobalTable.officesActivated).mapWith(Number),
          favouritesAdded: sum(analyticsDailyGlobalTable.favouritesAdded).mapWith(Number),
          reviewsSubmitted: sum(analyticsDailyGlobalTable.reviewsSubmitted).mapWith(Number),
          voiceSearches: sum(analyticsDailyGlobalTable.voiceSearches).mapWith(Number),
          typedSearches: sum(analyticsDailyGlobalTable.typedSearches).mapWith(Number),
        })
        .from(analyticsDailyGlobalTable)
        .where(
          and(
            gte(analyticsDailyGlobalTable.date, range.from),
            lte(analyticsDailyGlobalTable.date, range.to),
          ),
        ),
      // Latest snapshot for current counts
      db
        .select({
          activeOffices: analyticsDailyGlobalTable.activeOfficesSnapshot,
          approvedOffices: analyticsDailyGlobalTable.approvedOfficesSnapshot,
          date: analyticsDailyGlobalTable.date,
        })
        .from(analyticsDailyGlobalTable)
        .orderBy(desc(analyticsDailyGlobalTable.date))
        .limit(1),
    ]);

    const totals = current[0] ?? {};
    const latest = snapshots[0];

    // Compute derived rates — zero denominator → null (displayed as "—")
    const contactActions =
      (totals.whatsappClicks ?? 0) +
      (totals.mapClicks ?? 0) +
      (totals.shareClicks ?? 0) +
      (totals.videoCallRequests ?? 0);

    const clickThroughRate =
      totals.cardImpressions
        ? ((totals.cardClicks ?? 0) / totals.cardImpressions) * 100
        : null;

    const profileToContactRate =
      totals.profileViews
        ? (contactActions / totals.profileViews) * 100
        : null;

    const videoCompletionRate =
      totals.videoStarts
        ? ((totals.videoCompletions ?? 0) / totals.videoStarts) * 100
        : null;

    const zeroResultRate =
      totals.searches
        ? ((totals.zeroResultSearches ?? 0) / totals.searches) * 100
        : null;

    const voiceSearchRate =
      totals.searches
        ? ((totals.voiceSearches ?? 0) / totals.searches) * 100
        : null;

    res.json({
      period: { from: range.from, to: range.to },
      totals: {
        ...totals,
        contactActions,
      },
      rates: {
        clickThroughRate,
        profileToContactRate,
        videoCompletionRate,
        zeroResultRate,
        voiceSearchRate,
      },
      snapshots: {
        activeOffices: latest?.activeOffices ?? null,
        approvedOffices: latest?.approvedOffices ?? null,
        asOf: latest?.date ?? null,
      },
    });
  },
);

/**
 * GET /api/analytics/admin/market
 * Demand / supply breakdown by country, city, and category.
 */
router.get(
  "/analytics/admin/market",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const range = parseDateRange(req.query as Record<string, unknown>);
    if (!range) {
      res.status(400).json({ error: "Invalid date range" });
      return;
    }

    const conditions = [
      gte(analyticsDailyByMarketTable.date, range.from),
      lte(analyticsDailyByMarketTable.date, range.to),
    ];
    if (range.filters.country) {
      conditions.push(
        eq(analyticsDailyByMarketTable.countryCode, range.filters.country),
      );
    }
    if (range.filters.city) {
      conditions.push(
        eq(analyticsDailyByMarketTable.cityId, range.filters.city),
      );
    }
    if (range.filters.category) {
      conditions.push(
        eq(analyticsDailyByMarketTable.categoryId, range.filters.category),
      );
    }

    const rows = await db
      .select({
        countryCode: analyticsDailyByMarketTable.countryCode,
        cityId: analyticsDailyByMarketTable.cityId,
        categoryId: analyticsDailyByMarketTable.categoryId,
        searches: sum(analyticsDailyByMarketTable.searches).mapWith(Number),
        zeroResultSearches: sum(analyticsDailyByMarketTable.zeroResultSearches).mapWith(Number),
        profileViews: sum(analyticsDailyByMarketTable.profileViews).mapWith(Number),
        whatsappClicks: sum(analyticsDailyByMarketTable.whatsappClicks).mapWith(Number),
        qrVisits: sum(analyticsDailyByMarketTable.qrVisits).mapWith(Number),
        voiceSearches: sum(analyticsDailyByMarketTable.voiceSearches).mapWith(Number),
        activeOfficesSnapshot: sql<number>`MAX(${analyticsDailyByMarketTable.activeOfficesSnapshot})`.mapWith(Number),
      })
      .from(analyticsDailyByMarketTable)
      .where(and(...conditions))
      .groupBy(
        analyticsDailyByMarketTable.countryCode,
        analyticsDailyByMarketTable.cityId,
        analyticsDailyByMarketTable.categoryId,
      )
      .orderBy(desc(sql`SUM(${analyticsDailyByMarketTable.searches})`))
      .limit(200);

    res.json({ period: { from: range.from, to: range.to }, rows });
  },
);

/**
 * GET /api/analytics/admin/search
 * Top search queries with zero-result rate and intent breakdown.
 */
router.get(
  "/analytics/admin/search",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const range = parseDateRange(req.query as Record<string, unknown>);
    if (!range) {
      res.status(400).json({ error: "Invalid date range" });
      return;
    }

    const conditions = [
      gte(analyticsDailyBySearchTable.date, range.from),
      lte(analyticsDailyBySearchTable.date, range.to),
    ];
    if (range.filters.country) {
      conditions.push(
        eq(analyticsDailyBySearchTable.countryCode, range.filters.country),
      );
    }
    if (range.filters.city) {
      conditions.push(
        eq(analyticsDailyBySearchTable.cityId, range.filters.city),
      );
    }

    const rows = await db
      .select({
        query: analyticsDailyBySearchTable.searchQueryNormalized,
        totalSearches: sum(analyticsDailyBySearchTable.searchCount).mapWith(Number),
        zeroResults: sum(analyticsDailyBySearchTable.zeroResultCount).mapWith(Number),
        clicks: sum(analyticsDailyBySearchTable.clickCount).mapWith(Number),
        voiceCount: sum(analyticsDailyBySearchTable.voiceCount).mapWith(Number),
        typedCount: sum(analyticsDailyBySearchTable.typedCount).mapWith(Number),
        dominantCategory: sql<string>`MODE() WITHIN GROUP (ORDER BY ${analyticsDailyBySearchTable.dominantCategoryId})`,
        dominantLanguage: sql<string>`MODE() WITHIN GROUP (ORDER BY ${analyticsDailyBySearchTable.dominantInterfaceLanguage})`,
      })
      .from(analyticsDailyBySearchTable)
      .where(and(...conditions))
      .groupBy(analyticsDailyBySearchTable.searchQueryNormalized)
      .orderBy(desc(sql`SUM(${analyticsDailyBySearchTable.searchCount})`))
      .limit(100);

    res.json({ period: { from: range.from, to: range.to }, rows });
  },
);

/**
 * GET /api/analytics/admin/offices
 * Per-office performance table for the Office Performance panel.
 */
router.get(
  "/analytics/admin/offices",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const range = parseDateRange(req.query as Record<string, unknown>);
    if (!range) {
      res.status(400).json({ error: "Invalid date range" });
      return;
    }

    const conditions = [
      gte(analyticsDailyByOfficeTable.date, range.from),
      lte(analyticsDailyByOfficeTable.date, range.to),
    ];
    if (range.filters.country) {
      conditions.push(
        eq(analyticsDailyByOfficeTable.officeCountryCode, range.filters.country),
      );
    }
    if (range.filters.city) {
      conditions.push(
        eq(analyticsDailyByOfficeTable.officeCityId, range.filters.city),
      );
    }
    if (range.filters.category) {
      conditions.push(
        eq(analyticsDailyByOfficeTable.officeCategoryId, range.filters.category),
      );
    }

    const rows = await db
      .select({
        officeId: analyticsDailyByOfficeTable.officeId,
        countryCode: analyticsDailyByOfficeTable.officeCountryCode,
        cityId: analyticsDailyByOfficeTable.officeCityId,
        categoryId: analyticsDailyByOfficeTable.officeCategoryId,
        statusSnapshot: analyticsDailyByOfficeTable.officeStatusSnapshot,
        profileViews: sum(analyticsDailyByOfficeTable.profileViews).mapWith(Number),
        cardClicks: sum(analyticsDailyByOfficeTable.cardClicks).mapWith(Number),
        cardImpressions: sum(analyticsDailyByOfficeTable.cardImpressions).mapWith(Number),
        whatsappClicks: sum(analyticsDailyByOfficeTable.whatsappClicks).mapWith(Number),
        mapClicks: sum(analyticsDailyByOfficeTable.mapClicks).mapWith(Number),
        videoCallRequests: sum(analyticsDailyByOfficeTable.videoCallRequests).mapWith(Number),
        qrVisits: sum(analyticsDailyByOfficeTable.qrVisits).mapWith(Number),
        favouritesAdded: sum(analyticsDailyByOfficeTable.favouritesAdded).mapWith(Number),
      })
      .from(analyticsDailyByOfficeTable)
      .where(and(...conditions))
      .groupBy(
        analyticsDailyByOfficeTable.officeId,
        analyticsDailyByOfficeTable.officeCountryCode,
        analyticsDailyByOfficeTable.officeCityId,
        analyticsDailyByOfficeTable.officeCategoryId,
        analyticsDailyByOfficeTable.officeStatusSnapshot,
      )
      .orderBy(desc(sql`SUM(${analyticsDailyByOfficeTable.profileViews})`))
      .limit(200);

    // Compute CTR and contact rate server-side
    const enriched = rows.map((r) => ({
      ...r,
      clickThroughRate:
        r.cardImpressions
          ? ((r.cardClicks ?? 0) / r.cardImpressions) * 100
          : null,
      contactRate:
        r.profileViews
          ? (((r.whatsappClicks ?? 0) + (r.mapClicks ?? 0) + (r.videoCallRequests ?? 0)) /
              r.profileViews) *
            100
          : null,
    }));

    res.json({ period: { from: range.from, to: range.to }, rows: enriched });
  },
);

/**
 * GET /api/analytics/admin/sources
 * Traffic source breakdown.
 */
router.get(
  "/analytics/admin/sources",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const range = parseDateRange(req.query as Record<string, unknown>);
    if (!range) {
      res.status(400).json({ error: "Invalid date range" });
      return;
    }

    const rows = await db
      .select({
        source: analyticsDailyBySourceTable.source,
        utmCampaign: analyticsDailyBySourceTable.utmCampaign,
        sessions: sum(analyticsDailyBySourceTable.sessions).mapWith(Number),
        profileViews: sum(analyticsDailyBySourceTable.profileViews).mapWith(Number),
        uniqueVisitors: sum(analyticsDailyBySourceTable.uniqueVisitorsApprox).mapWith(Number),
        whatsappClicks: sum(analyticsDailyBySourceTable.whatsappClicks).mapWith(Number),
        qrVisits: sum(analyticsDailyBySourceTable.qrVisits).mapWith(Number),
      })
      .from(analyticsDailyBySourceTable)
      .where(
        and(
          gte(analyticsDailyBySourceTable.date, range.from),
          lte(analyticsDailyBySourceTable.date, range.to),
        ),
      )
      .groupBy(
        analyticsDailyBySourceTable.source,
        analyticsDailyBySourceTable.utmCampaign,
      )
      .orderBy(desc(sql`SUM(${analyticsDailyBySourceTable.sessions})`));

    res.json({ period: { from: range.from, to: range.to }, rows });
  },
);

/**
 * GET /api/analytics/admin/aggregation-jobs
 * Recent aggregation job history for the system health panel.
 */
router.get(
  "/analytics/admin/aggregation-jobs",
  requireRole("admin"),
  async (_req: Request, res: Response): Promise<void> => {
    const jobs = await db
      .select()
      .from(analyticsAggregationJobsTable)
      .orderBy(desc(analyticsAggregationJobsTable.startedAt))
      .limit(50);

    res.json({ jobs });
  },
);

/**
 * POST /api/analytics/admin/aggregate
 * Trigger a manual aggregation run for a specific date.
 * Body: { date: "YYYY-MM-DD" }
 */
router.post(
  "/analytics/admin/aggregate",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const body = z
      .object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
      .safeParse(req.body);

    if (!body.success) {
      res.status(400).json({ error: "Invalid body: provide date (YYYY-MM-DD)" });
      return;
    }

    const targetDate = new Date(body.data.date);
    logger.info(
      { date: body.data.date, adminId: req.session.user?.id },
      "[analytics] Manual aggregation triggered by admin",
    );

    // Run async — respond immediately with 202 Accepted
    res.status(202).json({
      message: "Aggregation started",
      date: body.data.date,
    });

    runAggregationForDate(targetDate, "manual").catch((err: Error) => {
      logger.error(
        { err: err.message, date: body.data.date },
        "[analytics] Manual aggregation failed",
      );
    });
  },
);

/**
 * GET /api/analytics/admin/reports
 * List historical KPI snapshots.
 */
router.get(
  "/analytics/admin/reports",
  requireRole("admin"),
  async (_req: Request, res: Response): Promise<void> => {
    const reports = await db
      .select({
        id: analyticsAdminReportsTable.id,
        reportType: analyticsAdminReportsTable.reportType,
        periodStart: analyticsAdminReportsTable.periodStart,
        periodEnd: analyticsAdminReportsTable.periodEnd,
        label: analyticsAdminReportsTable.label,
        generatedAt: analyticsAdminReportsTable.generatedAt,
        isFinal: analyticsAdminReportsTable.isFinal,
        notes: analyticsAdminReportsTable.notes,
      })
      .from(analyticsAdminReportsTable)
      .orderBy(desc(analyticsAdminReportsTable.periodStart))
      .limit(100);

    res.json({ reports });
  },
);

export default router;
