/**
 * Analytics daily aggregation engine — Phase 1.
 *
 * Reads raw data from analytics_events, contact_events, favourites,
 * audit_log, service_request_reviews, and offices for a single UTC calendar
 * day, then writes pre-aggregated rows to the 5 dimensional tables.
 *
 * Concurrency safety: uses PostgreSQL advisory locks (pg_try_advisory_lock)
 * so multiple server instances cannot double-aggregate the same date.
 *
 * Scheduler: setInterval + .unref() (same pattern as backup.ts).
 * Each hour the scheduler checks whether "yesterday UTC" has been aggregated
 * yet; if not, it runs the aggregation.
 *
 * Exported public API:
 *   runAggregationForDate(date, trigger) — single-date aggregation
 *   scheduleAnalyticsAggregation()       — production scheduler
 *   backfillMissedDates()                — catch up missed past dates on startup
 */

import { db, pool } from "@workspace/db";

// Minimal interface for the dedicated advisory-lock connection.
// Avoids importing PoolClient from "pg" directly (it's a transitive dep only).
interface DBLockClient {
  query<T = unknown>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
  release(destroy?: boolean): void;
}
import {
  analyticsEventsTable,
  analyticsDailyGlobalTable,
  analyticsDailyByOfficeTable,
  analyticsDailyByMarketTable,
  analyticsDailyBySourceTable,
  analyticsDailyBySearchTable,
  analyticsAggregationJobsTable,
  contactEventsTable,
  favouritesTable,
  auditLogTable,
  officesTable,
  serviceRequestReviewsTable,
} from "@workspace/db";
import { sql, eq, and } from "drizzle-orm";
import { logger } from "./logger";
import {
  AGGREGATION_VERSION,
  AGGREGATION_BACKFILL_DAYS,
  AGGREGATION_CHECK_INTERVAL_MS,
} from "./analyticsConfig";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Format a Date as a YYYY-MM-DD string (UTC) */
function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Get a stable integer lock key for a given calendar date (days since epoch). */
function lockKeyForDate(d: Date): number {
  // Days since Unix epoch — unique per calendar day, fits in a PostgreSQL int4
  return Math.floor(d.getTime() / (1000 * 60 * 60 * 24));
}

// ── Job tracking ──────────────────────────────────────────────────────────────

async function createJob(
  date: Date,
  trigger: string,
): Promise<number> {
  const [job] = await db
    .insert(analyticsAggregationJobsTable)
    .values({
      dateStart: date,
      dateEnd: date,
      trigger,
      status: "running",
      aggregationVersion: AGGREGATION_VERSION,
    })
    .returning({ id: analyticsAggregationJobsTable.id });
  return job.id;
}

async function completeJob(
  jobId: number,
  startMs: number,
  rowsProcessed: number,
): Promise<void> {
  await db
    .update(analyticsAggregationJobsTable)
    .set({
      status: "completed",
      completedAt: new Date(),
      rowsProcessed,
      durationMs: Date.now() - startMs,
    })
    .where(eq(analyticsAggregationJobsTable.id, jobId));
}

async function failJob(jobId: number, startMs: number, errorMessage: string): Promise<void> {
  await db
    .update(analyticsAggregationJobsTable)
    .set({
      status: "failed",
      failedAt: new Date(),
      errorMessage,
      durationMs: Date.now() - startMs,
    })
    .where(eq(analyticsAggregationJobsTable.id, jobId));
}

// ── Global daily aggregation ──────────────────────────────────────────────────

async function aggregateGlobal(dateStr: string): Promise<number> {
  const [
    aeMetrics,
    contactMetrics,
    favMetrics,
    auditMetrics,
    reviewMetrics,
    officeSnapshots,
  ] = await Promise.all([
    // analytics_events
    db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE event_name = 'search_performed')::int AS searches,
        COUNT(*) FILTER (WHERE event_name = 'search_performed' AND search_results_count = 0)::int AS zero_result_searches,
        COUNT(*) FILTER (WHERE event_name = 'office_profile_view')::int AS profile_views,
        COUNT(*) FILTER (WHERE event_name = 'office_card_click')::int AS card_clicks,
        COUNT(*) FILTER (WHERE event_name = 'office_card_impression')::int AS card_impressions,
        COUNT(DISTINCT visitor_id) FILTER (WHERE visitor_id IS NOT NULL)::int AS unique_visitors_approx,
        COUNT(*) FILTER (WHERE event_name = 'video_start')::int AS video_starts,
        COUNT(*) FILTER (WHERE event_name = 'video_complete')::int AS video_completions,
        COUNT(*) FILTER (WHERE event_name = 'copy_link')::int AS copy_link_clicks,
        COUNT(*) FILTER (WHERE event_name = 'gallery_interaction')::int AS gallery_interactions,
        COUNT(*) FILTER (WHERE event_name = 'office_profile_view' AND source = 'qr')::int AS qr_visits,
        COUNT(*) FILTER (WHERE event_name = 'office_registration_started')::int AS registration_starts,
        COUNT(*) FILTER (WHERE event_name = 'search_performed' AND input_method = 'voice')::int AS voice_searches,
        COUNT(*) FILTER (WHERE event_name = 'search_performed' AND input_method = 'typed')::int AS typed_searches,
        COUNT(*) FILTER (WHERE event_name = 'favorite_remove')::int AS favourites_removed
      FROM analytics_events
      WHERE is_bot = false
        AND is_self_view = false
        AND is_internal_actor = false
        AND DATE(occurred_at AT TIME ZONE 'UTC') = ${dateStr}::date
    `),
    // contact_events — exclude internal/seed users to keep metrics clean
    db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE action_type = 'whatsapp_click')::int AS whatsapp_clicks,
        COUNT(*) FILTER (WHERE action_type = 'location_click')::int AS map_clicks,
        COUNT(*) FILTER (WHERE action_type = 'share_click')::int AS share_clicks,
        COUNT(*) FILTER (WHERE action_type = 'video_call_request')::int AS video_call_requests
      FROM contact_events
      WHERE DATE(created_at AT TIME ZONE 'UTC') = ${dateStr}::date
        AND customer_user_id NOT IN (SELECT id FROM users WHERE is_internal = true)
    `),
    // favourites — exclude internal/seed users
    db.execute(sql`
      SELECT COUNT(*)::int AS favourites_added
      FROM favourites
      WHERE DATE(created_at AT TIME ZONE 'UTC') = ${dateStr}::date
        AND customer_user_id NOT IN (SELECT id FROM users WHERE is_internal = true)
    `),
    // audit_log
    db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE action = 'office.register')::int AS registrations_completed,
        COUNT(*) FILTER (WHERE action = 'office.application.submit')::int AS profiles_submitted,
        COUNT(*) FILTER (WHERE action = 'office.application.approve')::int AS profiles_approved,
        COUNT(*) FILTER (WHERE action = 'office.application.reject')::int AS profiles_rejected,
        COUNT(*) FILTER (WHERE action = 'office.application.activate')::int AS offices_activated,
        COUNT(*) FILTER (WHERE action = 'office.application.suspend')::int AS offices_suspended
      FROM audit_log
      WHERE DATE(created_at AT TIME ZONE 'UTC') = ${dateStr}::date
    `),
    // service_request_reviews
    db.execute(sql`
      SELECT COUNT(*)::int AS reviews_submitted
      FROM service_request_reviews
      WHERE DATE(created_at AT TIME ZONE 'UTC') = ${dateStr}::date
    `),
    // office snapshots (current counts at aggregation time)
    db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'active')::int AS active_offices,
        COUNT(*) FILTER (WHERE status IN ('approved', 'under_review'))::int AS approved_offices
      FROM offices
    `),
  ]);

  const ae = (aeMetrics.rows[0] ?? {}) as Record<string, number>;
  const ce = (contactMetrics.rows[0] ?? {}) as Record<string, number>;
  const fav = (favMetrics.rows[0] ?? {}) as Record<string, number>;
  const al = (auditMetrics.rows[0] ?? {}) as Record<string, number>;
  const rev = (reviewMetrics.rows[0] ?? {}) as Record<string, number>;
  const snap = (officeSnapshots.rows[0] ?? {}) as Record<string, number>;

  await db
    .insert(analyticsDailyGlobalTable)
    .values({
      date: new Date(dateStr),
      searches: ae.searches ?? 0,
      zeroResultSearches: ae.zero_result_searches ?? 0,
      profileViews: ae.profile_views ?? 0,
      cardClicks: ae.card_clicks ?? 0,
      cardImpressions: ae.card_impressions ?? 0,
      uniqueVisitorsApprox: ae.unique_visitors_approx ?? 0,
      videoStarts: ae.video_starts ?? 0,
      videoCompletions: ae.video_completions ?? 0,
      copyLinkClicks: ae.copy_link_clicks ?? 0,
      galleryInteractions: ae.gallery_interactions ?? 0,
      qrVisits: ae.qr_visits ?? 0,
      registrationStarts: ae.registration_starts ?? 0,
      voiceSearches: ae.voice_searches ?? 0,
      typedSearches: ae.typed_searches ?? 0,
      favouritesRemoved: ae.favourites_removed ?? 0,
      whatsappClicks: ce.whatsapp_clicks ?? 0,
      mapClicks: ce.map_clicks ?? 0,
      shareClicks: ce.share_clicks ?? 0,
      videoCallRequests: ce.video_call_requests ?? 0,
      favouritesAdded: fav.favourites_added ?? 0,
      registrationsCompleted: al.registrations_completed ?? 0,
      profilesSubmitted: al.profiles_submitted ?? 0,
      profilesApproved: al.profiles_approved ?? 0,
      profilesRejected: al.profiles_rejected ?? 0,
      officesActivated: al.offices_activated ?? 0,
      officesSuspended: al.offices_suspended ?? 0,
      reviewsSubmitted: rev.reviews_submitted ?? 0,
      activeOfficesSnapshot: snap.active_offices ?? null,
      approvedOfficesSnapshot: snap.approved_offices ?? null,
      lastAggregatedAt: new Date(),
      aggregationVersion: AGGREGATION_VERSION,
    })
    .onConflictDoUpdate({
      target: analyticsDailyGlobalTable.date,
      set: {
        searches: sql`EXCLUDED.searches`,
        zeroResultSearches: sql`EXCLUDED.zero_result_searches`,
        profileViews: sql`EXCLUDED.profile_views`,
        cardClicks: sql`EXCLUDED.card_clicks`,
        cardImpressions: sql`EXCLUDED.card_impressions`,
        uniqueVisitorsApprox: sql`EXCLUDED.unique_visitors_approx`,
        videoStarts: sql`EXCLUDED.video_starts`,
        videoCompletions: sql`EXCLUDED.video_completions`,
        copyLinkClicks: sql`EXCLUDED.copy_link_clicks`,
        galleryInteractions: sql`EXCLUDED.gallery_interactions`,
        qrVisits: sql`EXCLUDED.qr_visits`,
        registrationStarts: sql`EXCLUDED.registration_starts`,
        voiceSearches: sql`EXCLUDED.voice_searches`,
        typedSearches: sql`EXCLUDED.typed_searches`,
        favouritesRemoved: sql`EXCLUDED.favourites_removed`,
        whatsappClicks: sql`EXCLUDED.whatsapp_clicks`,
        mapClicks: sql`EXCLUDED.map_clicks`,
        shareClicks: sql`EXCLUDED.share_clicks`,
        videoCallRequests: sql`EXCLUDED.video_call_requests`,
        favouritesAdded: sql`EXCLUDED.favourites_added`,
        registrationsCompleted: sql`EXCLUDED.registrations_completed`,
        profilesSubmitted: sql`EXCLUDED.profiles_submitted`,
        profilesApproved: sql`EXCLUDED.profiles_approved`,
        profilesRejected: sql`EXCLUDED.profiles_rejected`,
        officesActivated: sql`EXCLUDED.offices_activated`,
        officesSuspended: sql`EXCLUDED.offices_suspended`,
        reviewsSubmitted: sql`EXCLUDED.reviews_submitted`,
        activeOfficesSnapshot: sql`EXCLUDED.active_offices_snapshot`,
        approvedOfficesSnapshot: sql`EXCLUDED.approved_offices_snapshot`,
        lastAggregatedAt: sql`NOW()`,
        aggregationVersion: sql`EXCLUDED.aggregation_version`,
      },
    });

  return 1;
}

// ── Per-office aggregation ────────────────────────────────────────────────────

async function aggregateByOffice(dateStr: string): Promise<number> {
  // Get all office_ids that had any analytics activity on this date
  const officeIdsResult = await db.execute(sql`
    SELECT DISTINCT office_id
    FROM analytics_events
    WHERE is_bot = false
      AND is_self_view = false
      AND is_internal_actor = false
      AND DATE(occurred_at AT TIME ZONE 'UTC') = ${dateStr}::date
      AND office_id IS NOT NULL
    UNION
    SELECT DISTINCT office_id
    FROM contact_events
    WHERE DATE(created_at AT TIME ZONE 'UTC') = ${dateStr}::date
      AND customer_user_id NOT IN (SELECT id FROM users WHERE is_internal = true)
    UNION
    SELECT DISTINCT office_id
    FROM favourites
    WHERE DATE(created_at AT TIME ZONE 'UTC') = ${dateStr}::date
      AND customer_user_id NOT IN (SELECT id FROM users WHERE is_internal = true)
  `);

  const officeIds = (officeIdsResult.rows as Array<{ office_id: number }>)
    .map((r) => r.office_id)
    .filter(Boolean);

  if (officeIds.length === 0) return 0;

  // Load office metadata snapshots
  const offices = await db.execute(sql`
    SELECT id, country, city, category, status
    FROM offices
    WHERE id = ANY(${sql.raw(`ARRAY[${officeIds.join(",")}]::integer[]`)})
  `);
  const officeMetaMap = new Map<number, { country: string; city: string; category: string; status: string }>(
    (offices.rows as Array<{ id: number; country: string; city: string; category: string; status: string }>)
      .map((o) => [o.id, { country: o.country, city: o.city, category: o.category, status: o.status }]),
  );

  // Aggregate analytics_events per office
  const aeResult = await db.execute(sql`
    SELECT
      office_id,
      COUNT(*) FILTER (WHERE event_name = 'office_profile_view')::int AS profile_views,
      COUNT(*) FILTER (WHERE event_name = 'office_card_click')::int AS card_clicks,
      COUNT(*) FILTER (WHERE event_name = 'office_card_impression')::int AS card_impressions,
      COUNT(DISTINCT visitor_id) FILTER (WHERE visitor_id IS NOT NULL)::int AS unique_visitors_approx,
      COUNT(*) FILTER (WHERE event_name = 'video_start')::int AS video_starts,
      COUNT(*) FILTER (WHERE event_name = 'video_complete')::int AS video_completions,
      COUNT(*) FILTER (WHERE event_name = 'office_profile_view' AND source = 'qr')::int AS qr_visits
    FROM analytics_events
    WHERE is_bot = false
      AND is_self_view = false
      AND is_internal_actor = false
      AND DATE(occurred_at AT TIME ZONE 'UTC') = ${dateStr}::date
      AND office_id IS NOT NULL
    GROUP BY office_id
  `);

  const aeMap = new Map<number, Record<string, number>>(
    (aeResult.rows as Array<{ office_id: number } & Record<string, number>>)
      .map((r) => [r.office_id, r]),
  );

  // Aggregate contact_events per office
  const ceResult = await db.execute(sql`
    SELECT
      office_id,
      COUNT(*) FILTER (WHERE action_type = 'whatsapp_click')::int AS whatsapp_clicks,
      COUNT(*) FILTER (WHERE action_type = 'location_click')::int AS map_clicks,
      COUNT(*) FILTER (WHERE action_type = 'share_click')::int AS share_clicks,
      COUNT(*) FILTER (WHERE action_type = 'video_call_request')::int AS video_call_requests
    FROM contact_events
    WHERE DATE(created_at AT TIME ZONE 'UTC') = ${dateStr}::date
      AND customer_user_id NOT IN (SELECT id FROM users WHERE is_internal = true)
    GROUP BY office_id
  `);

  const ceMap = new Map<number, Record<string, number>>(
    (ceResult.rows as Array<{ office_id: number } & Record<string, number>>)
      .map((r) => [r.office_id, r]),
  );

  // Aggregate favourites per office
  const favResult = await db.execute(sql`
    SELECT office_id, COUNT(*)::int AS favourites_added
    FROM favourites
    WHERE DATE(created_at AT TIME ZONE 'UTC') = ${dateStr}::date
      AND customer_user_id NOT IN (SELECT id FROM users WHERE is_internal = true)
    GROUP BY office_id
  `);

  const favMap = new Map<number, number>(
    (favResult.rows as Array<{ office_id: number; favourites_added: number }>)
      .map((r) => [r.office_id, r.favourites_added]),
  );

  // Aggregate favorite_remove events
  const removedResult = await db.execute(sql`
    SELECT office_id, COUNT(*)::int AS favourites_removed
    FROM analytics_events
    WHERE is_bot = false
      AND is_self_view = false
      AND is_internal_actor = false
      AND event_name = 'favorite_remove'
      AND DATE(occurred_at AT TIME ZONE 'UTC') = ${dateStr}::date
      AND office_id IS NOT NULL
    GROUP BY office_id
  `);

  const removedMap = new Map<number, number>(
    (removedResult.rows as Array<{ office_id: number; favourites_removed: number }>)
      .map((r) => [r.office_id, r.favourites_removed]),
  );

  // Write one row per office
  for (const officeId of officeIds) {
    const ae = aeMap.get(officeId) ?? {};
    const ce = ceMap.get(officeId) ?? {};
    const meta = officeMetaMap.get(officeId);

    await db
      .insert(analyticsDailyByOfficeTable)
      .values({
        date: new Date(dateStr),
        officeId,
        officeCountryCode: meta?.country ?? null,
        officeCityId: meta?.city?.toLowerCase().replace(/\s+/g, "_") ?? null,
        officeCategoryId: meta?.category ?? null,
        officeStatusSnapshot: meta?.status ?? null,
        profileViews: (ae.profile_views as number) ?? 0,
        cardClicks: (ae.card_clicks as number) ?? 0,
        cardImpressions: (ae.card_impressions as number) ?? 0,
        uniqueVisitorsApprox: (ae.unique_visitors_approx as number) ?? 0,
        videoStarts: (ae.video_starts as number) ?? 0,
        videoCompletions: (ae.video_completions as number) ?? 0,
        qrVisits: (ae.qr_visits as number) ?? 0,
        whatsappClicks: (ce.whatsapp_clicks as number) ?? 0,
        mapClicks: (ce.map_clicks as number) ?? 0,
        shareClicks: (ce.share_clicks as number) ?? 0,
        videoCallRequests: (ce.video_call_requests as number) ?? 0,
        favouritesAdded: favMap.get(officeId) ?? 0,
        favouritesRemoved: removedMap.get(officeId) ?? 0,
        lastAggregatedAt: new Date(),
        aggregationVersion: AGGREGATION_VERSION,
      })
      .onConflictDoUpdate({
        target: [analyticsDailyByOfficeTable.date, analyticsDailyByOfficeTable.officeId],
        set: {
          officeCountryCode: sql`EXCLUDED.office_country_code`,
          officeCityId: sql`EXCLUDED.office_city_id`,
          officeCategoryId: sql`EXCLUDED.office_category_id`,
          officeStatusSnapshot: sql`EXCLUDED.office_status_snapshot`,
          profileViews: sql`EXCLUDED.profile_views`,
          cardClicks: sql`EXCLUDED.card_clicks`,
          cardImpressions: sql`EXCLUDED.card_impressions`,
          uniqueVisitorsApprox: sql`EXCLUDED.unique_visitors_approx`,
          videoStarts: sql`EXCLUDED.video_starts`,
          videoCompletions: sql`EXCLUDED.video_completions`,
          qrVisits: sql`EXCLUDED.qr_visits`,
          whatsappClicks: sql`EXCLUDED.whatsapp_clicks`,
          mapClicks: sql`EXCLUDED.map_clicks`,
          shareClicks: sql`EXCLUDED.share_clicks`,
          videoCallRequests: sql`EXCLUDED.video_call_requests`,
          favouritesAdded: sql`EXCLUDED.favourites_added`,
          favouritesRemoved: sql`EXCLUDED.favourites_removed`,
          lastAggregatedAt: sql`NOW()`,
          aggregationVersion: sql`EXCLUDED.aggregation_version`,
        },
      });
  }

  return officeIds.length;
}

// ── Per-market aggregation ────────────────────────────────────────────────────

async function aggregateByMarket(dateStr: string): Promise<number> {
  const result = await db.execute(sql`
    SELECT
      COALESCE(country_code, '__ALL__') AS country_code,
      COALESCE(city_id, '__ALL__') AS city_id,
      COALESCE(category_id, '__ALL__') AS category_id,
      COUNT(*) FILTER (WHERE event_name = 'search_performed')::int AS searches,
      COUNT(*) FILTER (WHERE event_name = 'search_performed' AND search_results_count = 0)::int AS zero_result_searches,
      COUNT(*) FILTER (WHERE event_name = 'office_profile_view')::int AS profile_views,
      COUNT(*) FILTER (WHERE event_name = 'office_card_click')::int AS card_clicks,
      COUNT(DISTINCT visitor_id) FILTER (WHERE visitor_id IS NOT NULL)::int AS unique_visitors_approx,
      COUNT(*) FILTER (WHERE event_name = 'office_profile_view' AND source = 'qr')::int AS qr_visits,
      COUNT(*) FILTER (WHERE event_name = 'search_performed' AND input_method = 'voice')::int AS voice_searches
    FROM analytics_events
    WHERE is_bot = false
      AND is_self_view = false
      AND is_internal_actor = false
      AND DATE(occurred_at AT TIME ZONE 'UTC') = ${dateStr}::date
    GROUP BY GROUPING SETS (
      (country_code, city_id, category_id),
      (country_code, city_id),
      (country_code),
      ()
    )
  `);

  // Also get global aggregate separately for the __ALL__/__ALL__/__ALL__ row
  type MarketRow = {
    country_code: string;
    city_id: string;
    category_id: string;
    searches: number;
    zero_result_searches: number;
    profile_views: number;
    card_clicks: number;
    unique_visitors_approx: number;
    qr_visits: number;
    voice_searches: number;
  };

  const rows = result.rows as MarketRow[];
  let written = 0;

  for (const row of rows) {
    const countryCode = row.country_code ?? "__ALL__";
    const cityId = row.city_id ?? "__ALL__";
    const categoryId = row.category_id ?? "__ALL__";

    await db
      .insert(analyticsDailyByMarketTable)
      .values({
        date: new Date(dateStr),
        countryCode,
        cityId,
        categoryId,
        searches: row.searches ?? 0,
        zeroResultSearches: row.zero_result_searches ?? 0,
        profileViews: row.profile_views ?? 0,
        cardClicks: row.card_clicks ?? 0,
        uniqueVisitorsApprox: row.unique_visitors_approx ?? 0,
        qrVisits: row.qr_visits ?? 0,
        voiceSearches: row.voice_searches ?? 0,
        lastAggregatedAt: new Date(),
        aggregationVersion: AGGREGATION_VERSION,
      })
      .onConflictDoUpdate({
        target: [
          analyticsDailyByMarketTable.date,
          analyticsDailyByMarketTable.countryCode,
          analyticsDailyByMarketTable.cityId,
          analyticsDailyByMarketTable.categoryId,
        ],
        set: {
          searches: sql`EXCLUDED.searches`,
          zeroResultSearches: sql`EXCLUDED.zero_result_searches`,
          profileViews: sql`EXCLUDED.profile_views`,
          cardClicks: sql`EXCLUDED.card_clicks`,
          uniqueVisitorsApprox: sql`EXCLUDED.unique_visitors_approx`,
          qrVisits: sql`EXCLUDED.qr_visits`,
          voiceSearches: sql`EXCLUDED.voice_searches`,
          lastAggregatedAt: sql`NOW()`,
          aggregationVersion: sql`EXCLUDED.aggregation_version`,
        },
      });
    written++;
  }

  return written;
}

// ── Per-source aggregation ────────────────────────────────────────────────────

async function aggregateBySource(dateStr: string): Promise<number> {
  const result = await db.execute(sql`
    SELECT
      COALESCE(source, 'unknown') AS source,
      COALESCE(utm_campaign, '__NONE__') AS utm_campaign,
      COALESCE(qr_campaign_id, '__NONE__') AS qr_campaign_id,
      COUNT(DISTINCT session_id) FILTER (WHERE session_id IS NOT NULL)::int AS sessions,
      COUNT(*) FILTER (WHERE event_name = 'office_profile_view')::int AS profile_views,
      COUNT(DISTINCT visitor_id) FILTER (WHERE visitor_id IS NOT NULL)::int AS unique_visitors_approx,
      COUNT(*) FILTER (WHERE event_name = 'office_profile_view' AND source = 'qr')::int AS qr_visits
    FROM analytics_events
    WHERE is_bot = false
      AND is_self_view = false
      AND is_internal_actor = false
      AND DATE(occurred_at AT TIME ZONE 'UTC') = ${dateStr}::date
    GROUP BY
      COALESCE(source, 'unknown'),
      COALESCE(utm_campaign, '__NONE__'),
      COALESCE(qr_campaign_id, '__NONE__')
  `);

  type SourceRow = {
    source: string;
    utm_campaign: string;
    qr_campaign_id: string;
    sessions: number;
    profile_views: number;
    unique_visitors_approx: number;
    qr_visits: number;
  };

  const rows = result.rows as SourceRow[];

  for (const row of rows) {
    // Get whatsapp_clicks from contact_events joined via session or just aggregate
    await db
      .insert(analyticsDailyBySourceTable)
      .values({
        date: new Date(dateStr),
        source: row.source ?? "unknown",
        utmCampaign: row.utm_campaign ?? "__NONE__",
        qrCampaignId: row.qr_campaign_id ?? "__NONE__",
        sessions: row.sessions ?? 0,
        profileViews: row.profile_views ?? 0,
        uniqueVisitorsApprox: row.unique_visitors_approx ?? 0,
        qrVisits: row.qr_visits ?? 0,
        lastAggregatedAt: new Date(),
        aggregationVersion: AGGREGATION_VERSION,
      })
      .onConflictDoUpdate({
        target: [
          analyticsDailyBySourceTable.date,
          analyticsDailyBySourceTable.source,
          analyticsDailyBySourceTable.utmCampaign,
          analyticsDailyBySourceTable.qrCampaignId,
        ],
        set: {
          sessions: sql`EXCLUDED.sessions`,
          profileViews: sql`EXCLUDED.profile_views`,
          uniqueVisitorsApprox: sql`EXCLUDED.unique_visitors_approx`,
          qrVisits: sql`EXCLUDED.qr_visits`,
          lastAggregatedAt: sql`NOW()`,
          aggregationVersion: sql`EXCLUDED.aggregation_version`,
        },
      });
  }

  return rows.length;
}

// ── Per-search aggregation ────────────────────────────────────────────────────

async function aggregateBySearch(dateStr: string): Promise<number> {
  const result = await db.execute(sql`
    SELECT
      search_query_normalized,
      COALESCE(country_code, '__ALL__') AS country_code,
      COALESCE(city_id, '__ALL__') AS city_id,
      COUNT(*)::int AS search_count,
      COUNT(*) FILTER (WHERE search_results_count = 0)::int AS zero_result_count,
      COUNT(*) FILTER (WHERE input_method = 'voice')::int AS voice_count,
      COUNT(*) FILTER (WHERE input_method = 'typed')::int AS typed_count,
      MODE() WITHIN GROUP (ORDER BY category_id) AS dominant_category_id,
      MODE() WITHIN GROUP (ORDER BY interface_language) AS dominant_interface_language
    FROM analytics_events
    WHERE is_bot = false
      AND is_self_view = false
      AND is_internal_actor = false
      AND event_name = 'search_performed'
      AND search_query_normalized IS NOT NULL
      AND search_query_normalized != ''
      AND DATE(occurred_at AT TIME ZONE 'UTC') = ${dateStr}::date
    GROUP BY
      search_query_normalized,
      COALESCE(country_code, '__ALL__'),
      COALESCE(city_id, '__ALL__')
    ORDER BY search_count DESC
    LIMIT 1000
  `);

  type SearchRow = {
    search_query_normalized: string;
    country_code: string;
    city_id: string;
    search_count: number;
    zero_result_count: number;
    voice_count: number;
    typed_count: number;
    dominant_category_id: string | null;
    dominant_interface_language: string | null;
  };

  const rows = result.rows as SearchRow[];

  for (const row of rows) {
    await db
      .insert(analyticsDailyBySearchTable)
      .values({
        date: new Date(dateStr),
        searchQueryNormalized: row.search_query_normalized,
        countryCode: row.country_code ?? "__ALL__",
        cityId: row.city_id ?? "__ALL__",
        searchCount: row.search_count ?? 0,
        zeroResultCount: row.zero_result_count ?? 0,
        voiceCount: row.voice_count ?? 0,
        typedCount: row.typed_count ?? 0,
        dominantCategoryId: row.dominant_category_id ?? null,
        dominantInterfaceLanguage: row.dominant_interface_language ?? null,
        lastAggregatedAt: new Date(),
        aggregationVersion: AGGREGATION_VERSION,
      })
      .onConflictDoUpdate({
        target: [
          analyticsDailyBySearchTable.date,
          analyticsDailyBySearchTable.searchQueryNormalized,
          analyticsDailyBySearchTable.countryCode,
          analyticsDailyBySearchTable.cityId,
        ],
        set: {
          searchCount: sql`EXCLUDED.search_count`,
          zeroResultCount: sql`EXCLUDED.zero_result_count`,
          voiceCount: sql`EXCLUDED.voice_count`,
          typedCount: sql`EXCLUDED.typed_count`,
          dominantCategoryId: sql`EXCLUDED.dominant_category_id`,
          dominantInterfaceLanguage: sql`EXCLUDED.dominant_interface_language`,
          lastAggregatedAt: sql`NOW()`,
          aggregationVersion: sql`EXCLUDED.aggregation_version`,
        },
      });
  }

  return rows.length;
}

// ── Main aggregation function ─────────────────────────────────────────────────

/**
 * Run all 5 dimensional aggregations for a single UTC calendar date.
 * Creates a job record, acquires an advisory lock, runs aggregation,
 * then releases the lock and marks the job complete.
 *
 * Never throws — all errors are caught, logged, and stored in the job record.
 */
export async function runAggregationForDate(
  date: Date,
  trigger: string,
): Promise<void> {
  const dateStr = toDateString(date);
  const lockKey = lockKeyForDate(date);
  const startMs = Date.now();

  logger.info({ date: dateStr, trigger }, "[analytics-agg] Starting aggregation");

  let jobId: number | null = null;
  // Single dedicated DB client for the advisory lock — ensures acquire and
  // release run on the SAME PostgreSQL session.  Advisory locks are
  // session-scoped: pool.query() can route consecutive calls to different
  // connections, which would silently leave the lock permanently held.
  let lockClient: DBLockClient | null = null;
  let lockAcquired = false;

  try {
    jobId = await createJob(date, trigger);

    // Check out a dedicated connection. The aggregation work itself still uses
    // the shared pool via db/pool — only the lock needs this affinity guarantee.
    lockClient = await pool.connect();
    const lockResult = await lockClient.query<{ pg_try_advisory_lock: boolean }>(
      "SELECT pg_try_advisory_lock($1)",
      [lockKey],
    );
    lockAcquired = lockResult.rows[0]?.pg_try_advisory_lock === true;

    if (!lockAcquired) {
      logger.info(
        { date: dateStr },
        "[analytics-agg] Advisory lock busy — skipping (another instance is aggregating this date)",
      );
      // Return the dedicated connection before the early return — no lock was acquired.
      lockClient.release();
      lockClient = null;
      await db
        .update(analyticsAggregationJobsTable)
        .set({ status: "skipped", completedAt: new Date() })
        .where(eq(analyticsAggregationJobsTable.id, jobId));
      return;
    }

    let totalRows = 0;
    const dimensionErrors: string[] = [];

    // Run each dimension independently — collect failures rather than
    // swallowing them.  If any dimension fails the job is marked failed (not
    // completed) so Platform Health surfaces the partial outage and retrying
    // the same date is safe (all aggregators use upsert semantics).
    try {
      const n = await aggregateGlobal(dateStr);
      totalRows += n;
    } catch (err) {
      const msg = (err as Error).message;
      logger.error({ err: msg, date: dateStr }, "[analytics-agg] Failed to aggregate global");
      dimensionErrors.push(`global: ${msg}`);
    }

    try {
      const n = await aggregateByOffice(dateStr);
      totalRows += n;
    } catch (err) {
      const msg = (err as Error).message;
      logger.error({ err: msg, date: dateStr }, "[analytics-agg] Failed to aggregate by_office");
      dimensionErrors.push(`by_office: ${msg}`);
    }

    try {
      const n = await aggregateByMarket(dateStr);
      totalRows += n;
    } catch (err) {
      const msg = (err as Error).message;
      logger.error({ err: msg, date: dateStr }, "[analytics-agg] Failed to aggregate by_market");
      dimensionErrors.push(`by_market: ${msg}`);
    }

    try {
      const n = await aggregateBySource(dateStr);
      totalRows += n;
    } catch (err) {
      const msg = (err as Error).message;
      logger.error({ err: msg, date: dateStr }, "[analytics-agg] Failed to aggregate by_source");
      dimensionErrors.push(`by_source: ${msg}`);
    }

    try {
      const n = await aggregateBySearch(dateStr);
      totalRows += n;
    } catch (err) {
      const msg = (err as Error).message;
      logger.error({ err: msg, date: dateStr }, "[analytics-agg] Failed to aggregate by_search");
      dimensionErrors.push(`by_search: ${msg}`);
    }

    if (dimensionErrors.length > 0) {
      // Partial failure: at least one dimension failed.  Mark job failed so
      // Platform Health / consecutiveFailures logic surfaces the problem.
      const errorMessage =
        `Partial failure in ${dimensionErrors.length} dimension(s): ` +
        dimensionErrors.join("; ").slice(0, 500);
      await failJob(jobId, startMs, errorMessage);
      logger.warn(
        { date: dateStr, failures: dimensionErrors.length, durationMs: Date.now() - startMs },
        "[analytics-agg] Aggregation partially failed — job marked failed",
      );
    } else {
      await completeJob(jobId, startMs, totalRows);
      logger.info(
        { date: dateStr, durationMs: Date.now() - startMs, totalRows },
        "[analytics-agg] Aggregation completed",
      );
    }
  } catch (err) {
    const errorMessage = (err as Error).message;
    logger.error(
      { err: errorMessage, date: dateStr },
      "[analytics-agg] Aggregation failed",
    );
    if (jobId !== null) {
      try {
        await failJob(jobId, startMs, errorMessage);
      } catch {
        // Ignore errors in error handling
      }
    }
  } finally {
    // Release the advisory lock on the SAME connection it was acquired on.
    // If unlock fails, destroy the connection — PostgreSQL auto-releases
    // session-level locks when a connection is closed.
    const clientToRelease = lockClient;
    lockClient = null;
    if (lockAcquired && clientToRelease) {
      try {
        await clientToRelease.query("SELECT pg_advisory_unlock($1)", [lockKey]);
        clientToRelease.release();
      } catch {
        clientToRelease.release(true); // destroy → session ends → lock auto-releases
      }
    } else if (clientToRelease) {
      clientToRelease.release();
    }
  }
}

// ── Backfill ──────────────────────────────────────────────────────────────────

/**
 * On startup: aggregate any dates in the last AGGREGATION_BACKFILL_DAYS
 * that don't yet have a row in analytics_daily_global.
 * Runs silently — any errors are logged but don't fail startup.
 */
export async function backfillMissedDates(): Promise<void> {
  try {
    const now = new Date();
    const datesToCheck: Date[] = [];

    for (let i = 1; i <= AGGREGATION_BACKFILL_DAYS; i++) {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - i);
      d.setUTCHours(0, 0, 0, 0);
      datesToCheck.push(d);
    }

    for (const date of datesToCheck) {
      const dateStr = toDateString(date);
      try {
        // Check if already aggregated
        const existing = await db.execute(sql`
          SELECT 1 FROM analytics_daily_global WHERE date = ${dateStr}::date LIMIT 1
        `);
        if (existing.rows.length === 0) {
          logger.info({ date: dateStr }, "[analytics-agg] Backfilling missed date");
          await runAggregationForDate(date, "backfill");
        }
      } catch (err) {
        logger.warn(
          { err: (err as Error).message, date: dateStr },
          "[analytics-agg] Backfill check failed for date — skipping",
        );
      }
    }
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "[analytics-agg] Backfill startup failed — skipping",
    );
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

/**
 * Register the hourly aggregation scheduler.
 *
 * Mirrors the pattern from backup.ts:
 *   - Initial delay before first check (AGGREGATION_CHECK_INTERVAL_MS / 4)
 *   - Then checks every AGGREGATION_CHECK_INTERVAL_MS
 *   - .unref() so it doesn't keep the process alive
 *   - Only runs when NODE_ENV === 'production'
 */
export function scheduleAnalyticsAggregation(): void {
  if (process.env.NODE_ENV !== "production") {
    logger.warn(
      "[analytics-agg] Not production environment — aggregation scheduler NOT started. " +
      "Run runAggregationForDate() manually for testing.",
    );
    return;
  }

  const initialDelay = AGGREGATION_CHECK_INTERVAL_MS / 4; // 15 min

  logger.info(
    {
      initialDelayMs: initialDelay,
      intervalMs: AGGREGATION_CHECK_INTERVAL_MS,
    },
    "[analytics-agg] Aggregation scheduler registered",
  );

  // Check function: run aggregation for yesterday UTC if not yet done
  const check = async () => {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    yesterday.setUTCHours(0, 0, 0, 0);
    const dateStr = toDateString(yesterday);

    try {
      const existing = await db.execute(sql`
        SELECT 1 FROM analytics_daily_global WHERE date = ${dateStr}::date LIMIT 1
      `);
      if (existing.rows.length === 0) {
        await runAggregationForDate(yesterday, "scheduled");
      } else {
        logger.debug(
          { date: dateStr },
          "[analytics-agg] Yesterday already aggregated — skipping scheduled check",
        );
      }
    } catch (err) {
      logger.warn(
        { err: (err as Error).message },
        "[analytics-agg] Scheduled aggregation check failed — will retry next interval",
      );
    }
  };

  // Initial delay then periodic
  const initialTimer = setTimeout(() => {
    void check();
    const interval = setInterval(() => {
      void check();
    }, AGGREGATION_CHECK_INTERVAL_MS);
    interval.unref();
  }, initialDelay);

  initialTimer.unref();
}
