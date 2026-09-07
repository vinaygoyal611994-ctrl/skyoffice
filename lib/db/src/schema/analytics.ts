/**
 * SkayOffice Analytics Schema — Phase 1
 *
 * Drizzle ORM definitions for all analytics tables created in migration 0011.
 * These types are used by the analytics writer, aggregator, and API routes.
 *
 * Design principles:
 * - All timestamps stored in UTC
 * - Stable IDs for offices, cities, categories, services, campaigns
 * - No PII in analytics tables (visitor_id is anonymous UUID cookie)
 * - FK ON DELETE SET NULL to preserve history after entity deletion
 * - Controlled enums enforced at DB level via CHECK constraints
 */

import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { officesTable } from "./offices";

// ── Enums (mirrors CHECK constraints in migration) ────────────────────────────

export const analyticsEventNames = [
  "search_performed",
  "office_profile_view",
  "office_card_impression",
  "office_card_click",
  "video_start",
  "video_complete",
  "gallery_interaction",
  "copy_link",
  "office_registration_started",
  "favorite_remove",
] as const;
export type AnalyticsEventName = (typeof analyticsEventNames)[number];

export const analyticsSourceEnum = [
  "direct",
  "internal_search",
  "qr",
  "social",
  "referral",
  "paid_campaign",
  "organic_search",
  "whatsapp_share",
  "unknown",
] as const;
export type AnalyticsSource = (typeof analyticsSourceEnum)[number];

export const analyticsInputMethodEnum = ["typed", "voice"] as const;
export type AnalyticsInputMethod = (typeof analyticsInputMethodEnum)[number];

export const analyticsInterfaceLanguageEnum = ["ar", "en"] as const;
export type AnalyticsInterfaceLanguage =
  (typeof analyticsInterfaceLanguageEnum)[number];

export const analyticsDeviceCategoryEnum = [
  "desktop",
  "mobile",
  "tablet",
  "unknown",
] as const;
export type AnalyticsDeviceCategory =
  (typeof analyticsDeviceCategoryEnum)[number];

export const analyticsSearchIntentEnum = [
  "find_office",
  "find_nearest",
  "find_highest_rated",
  "find_specific_service",
  "compare_offices",
  "general_question",
  "unknown",
] as const;
export type AnalyticsSearchIntent = (typeof analyticsSearchIntentEnum)[number];

export const analyticsAggregationTriggerEnum = [
  "scheduled",
  "manual",
  "backfill",
  "startup",
] as const;

export const analyticsAggregationStatusEnum = [
  "running",
  "completed",
  "failed",
  "skipped",
] as const;

// ── service_taxonomy ──────────────────────────────────────────────────────────

export const serviceTaxonomyTable = pgTable(
  "service_taxonomy",
  {
    id: serial("id").primaryKey(),
    serviceKey: text("service_key").notNull().unique(),
    categoryKey: text("category_key").notNull(),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: smallint("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_service_taxonomy_category_key").on(table.categoryKey),
  ],
);

export type ServiceTaxonomyRow = typeof serviceTaxonomyTable.$inferSelect;

// ── analytics_events ──────────────────────────────────────────────────────────

export const analyticsEventsTable = pgTable(
  "analytics_events",
  {
    // Identity
    id: bigserial("id", { mode: "number" }).primaryKey(),
    eventId: uuid("event_id").notNull().defaultRandom(),
    eventName: text("event_name").notNull(),
    eventVersion: smallint("event_version").notNull().default(1),

    // Time
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    // Journey identity
    visitorId: uuid("visitor_id"),
    sessionId: uuid("session_id"),
    searchSessionId: uuid("search_session_id"),
    authenticatedUserId: integer("authenticated_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),

    // Market dimensions (stable IDs, not translated labels)
    officeId: integer("office_id").references(() => officesTable.id, {
      onDelete: "set null",
    }),
    countryCode: text("country_code"),
    regionId: text("region_id"),
    cityId: text("city_id"),
    categoryId: text("category_id"),
    serviceId: text("service_id"),
    detectedServiceId: text("detected_service_id"),

    // Attribution
    source: text("source"),
    sessionSource: text("session_source"),
    entryPoint: text("entry_point"),
    referrerDomain: text("referrer_domain"),
    qrCampaignId: text("qr_campaign_id"),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    utmContent: text("utm_content"),
    utmTerm: text("utm_term"),

    // Search fields (null for non-search events)
    searchQueryOriginal: text("search_query_original"),
    searchQueryNormalized: text("search_query_normalized"),
    detectedLanguage: text("detected_language"),
    inputMethod: text("input_method"),
    searchIntent: text("search_intent"),
    intentConfidence: real("intent_confidence"),
    serviceDetectionConfidence: real("service_detection_confidence"),
    parserVersion: text("parser_version"),
    searchResultsCount: integer("search_results_count"),
    resultPosition: integer("result_position"),
    selectedOfficeId: integer("selected_office_id").references(
      () => officesTable.id,
      { onDelete: "set null" },
    ),
    zeroResultReason: text("zero_result_reason"),

    // UX context
    interfaceLanguage: text("interface_language"),
    deviceCategory: text("device_category"),
    osFamily: text("os_family"),
    browserFamily: text("browser_family"),

    // Data quality
    isBot: boolean("is_bot").notNull().default(false),
    botDetectionVersion: text("bot_detection_version"),
    exclusionReason: text("exclusion_reason"),
    // Set to true when the authenticated user is the owner of the office being
    // viewed. Excluded from discovery/reach aggregations so offices cannot
    // inflate their own profile-view counts.
    isSelfView: boolean("is_self_view").notNull().default(false),
    // Denormalised copy of users.is_internal at event-write time. Avoids a
    // join in every aggregation query; kept in sync at the write layer.
    isInternalActor: boolean("is_internal_actor").notNull().default(false),

    // Secondary metadata
    metadata: jsonb("metadata"),
  },
  (table) => [
    uniqueIndex("analytics_events_event_id_unique").on(table.eventId),
    index("idx_ae_occurred_at").on(table.occurredAt),
    index("idx_ae_event_name_occurred_at").on(table.eventName, table.occurredAt),
    index("idx_ae_office_id_occurred_at").on(table.officeId, table.occurredAt),
    index("idx_ae_visitor_id_occurred_at").on(table.visitorId, table.occurredAt),
    index("idx_ae_search_query_normalized").on(
      table.searchQueryNormalized,
      table.occurredAt,
    ),
    index("idx_ae_city_id_occurred_at").on(table.cityId, table.occurredAt),
    index("idx_ae_source_occurred_at").on(table.source, table.occurredAt),
    index("idx_ae_search_session_id").on(table.searchSessionId, table.occurredAt),
    index("idx_ae_non_bot_event_occurred_at").on(
      table.eventName,
      table.occurredAt,
    ),
  ],
);

export type AnalyticsEvent = typeof analyticsEventsTable.$inferSelect;
export type InsertAnalyticsEvent = typeof analyticsEventsTable.$inferInsert;

// ── analytics_daily_global ────────────────────────────────────────────────────

export const analyticsDailyGlobalTable = pgTable(
  "analytics_daily_global",
  {
    id: serial("id").primaryKey(),
    date: date("date", { mode: "date" }).notNull(),

    // From analytics_events
    searches: integer("searches").notNull().default(0),
    zeroResultSearches: integer("zero_result_searches").notNull().default(0),
    profileViews: integer("profile_views").notNull().default(0),
    cardClicks: integer("card_clicks").notNull().default(0),
    cardImpressions: integer("card_impressions").notNull().default(0),
    uniqueVisitorsApprox: integer("unique_visitors_approx").notNull().default(0),
    videoStarts: integer("video_starts").notNull().default(0),
    videoCompletions: integer("video_completions").notNull().default(0),
    copyLinkClicks: integer("copy_link_clicks").notNull().default(0),
    galleryInteractions: integer("gallery_interactions").notNull().default(0),
    qrVisits: integer("qr_visits").notNull().default(0),
    registrationStarts: integer("registration_starts").notNull().default(0),
    voiceSearches: integer("voice_searches").notNull().default(0),
    typedSearches: integer("typed_searches").notNull().default(0),

    // From contact_events
    whatsappClicks: integer("whatsapp_clicks").notNull().default(0),
    mapClicks: integer("map_clicks").notNull().default(0),
    shareClicks: integer("share_clicks").notNull().default(0),
    videoCallRequests: integer("video_call_requests").notNull().default(0),

    // From favourites table
    favouritesAdded: integer("favourites_added").notNull().default(0),
    favouritesRemoved: integer("favourites_removed").notNull().default(0),

    // From audit_log
    registrationsCompleted: integer("registrations_completed").notNull().default(0),
    profilesSubmitted: integer("profiles_submitted").notNull().default(0),
    profilesApproved: integer("profiles_approved").notNull().default(0),
    profilesRejected: integer("profiles_rejected").notNull().default(0),
    officesActivated: integer("offices_activated").notNull().default(0),
    officesSuspended: integer("offices_suspended").notNull().default(0),

    // From service_request_reviews
    reviewsSubmitted: integer("reviews_submitted").notNull().default(0),

    // Point-in-time snapshots
    activeOfficesSnapshot: integer("active_offices_snapshot"),
    approvedOfficesSnapshot: integer("approved_offices_snapshot"),

    lastAggregatedAt: timestamp("last_aggregated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    aggregationVersion: smallint("aggregation_version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("analytics_daily_global_date_unique").on(table.date),
    index("idx_adg_date").on(table.date),
  ],
);

export type AnalyticsDailyGlobal =
  typeof analyticsDailyGlobalTable.$inferSelect;

// ── analytics_daily_by_office ─────────────────────────────────────────────────

export const analyticsDailyByOfficeTable = pgTable(
  "analytics_daily_by_office",
  {
    id: serial("id").primaryKey(),
    date: date("date", { mode: "date" }).notNull(),
    officeId: integer("office_id").notNull(),

    // Snapshot of office metadata at aggregation time
    officeCountryCode: text("office_country_code"),
    officeCityId: text("office_city_id"),
    officeCategoryId: text("office_category_id"),
    officeStatusSnapshot: text("office_status_snapshot"),

    // Metrics
    profileViews: integer("profile_views").notNull().default(0),
    cardClicks: integer("card_clicks").notNull().default(0),
    cardImpressions: integer("card_impressions").notNull().default(0),
    uniqueVisitorsApprox: integer("unique_visitors_approx").notNull().default(0),
    videoStarts: integer("video_starts").notNull().default(0),
    videoCompletions: integer("video_completions").notNull().default(0),
    qrVisits: integer("qr_visits").notNull().default(0),
    whatsappClicks: integer("whatsapp_clicks").notNull().default(0),
    mapClicks: integer("map_clicks").notNull().default(0),
    shareClicks: integer("share_clicks").notNull().default(0),
    videoCallRequests: integer("video_call_requests").notNull().default(0),
    favouritesAdded: integer("favourites_added").notNull().default(0),
    favouritesRemoved: integer("favourites_removed").notNull().default(0),

    lastAggregatedAt: timestamp("last_aggregated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    aggregationVersion: smallint("aggregation_version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("analytics_daily_by_office_unique").on(table.date, table.officeId),
    index("idx_adbo_date").on(table.date),
    index("idx_adbo_office_id_date").on(table.officeId, table.date),
  ],
);

export type AnalyticsDailyByOffice =
  typeof analyticsDailyByOfficeTable.$inferSelect;

// ── analytics_daily_by_market ─────────────────────────────────────────────────

export const analyticsDailyByMarketTable = pgTable(
  "analytics_daily_by_market",
  {
    id: serial("id").primaryKey(),
    date: date("date", { mode: "date" }).notNull(),
    countryCode: text("country_code").notNull().default("__ALL__"),
    cityId: text("city_id").notNull().default("__ALL__"),
    categoryId: text("category_id").notNull().default("__ALL__"),

    // Demand signals
    searches: integer("searches").notNull().default(0),
    zeroResultSearches: integer("zero_result_searches").notNull().default(0),
    profileViews: integer("profile_views").notNull().default(0),
    cardClicks: integer("card_clicks").notNull().default(0),
    uniqueVisitorsApprox: integer("unique_visitors_approx").notNull().default(0),
    whatsappClicks: integer("whatsapp_clicks").notNull().default(0),
    mapClicks: integer("map_clicks").notNull().default(0),
    qrVisits: integer("qr_visits").notNull().default(0),
    voiceSearches: integer("voice_searches").notNull().default(0),

    // Supply snapshot
    activeOfficesSnapshot: integer("active_offices_snapshot"),

    lastAggregatedAt: timestamp("last_aggregated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    aggregationVersion: smallint("aggregation_version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("analytics_daily_by_market_unique").on(
      table.date,
      table.countryCode,
      table.cityId,
      table.categoryId,
    ),
    index("idx_adbm_date").on(table.date),
    index("idx_adbm_country_city").on(table.countryCode, table.cityId, table.date),
    index("idx_adbm_category").on(table.categoryId, table.date),
  ],
);

export type AnalyticsDailyByMarket =
  typeof analyticsDailyByMarketTable.$inferSelect;

// ── analytics_daily_by_source ─────────────────────────────────────────────────

export const analyticsDailyBySourceTable = pgTable(
  "analytics_daily_by_source",
  {
    id: serial("id").primaryKey(),
    date: date("date", { mode: "date" }).notNull(),
    source: text("source").notNull().default("unknown"),
    utmCampaign: text("utm_campaign").notNull().default("__NONE__"),
    qrCampaignId: text("qr_campaign_id").notNull().default("__NONE__"),

    sessions: integer("sessions").notNull().default(0),
    profileViews: integer("profile_views").notNull().default(0),
    uniqueVisitorsApprox: integer("unique_visitors_approx").notNull().default(0),
    whatsappClicks: integer("whatsapp_clicks").notNull().default(0),
    qrVisits: integer("qr_visits").notNull().default(0),

    lastAggregatedAt: timestamp("last_aggregated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    aggregationVersion: smallint("aggregation_version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("analytics_daily_by_source_unique").on(
      table.date,
      table.source,
      table.utmCampaign,
      table.qrCampaignId,
    ),
    index("idx_adbs_date_source").on(table.date, table.source),
  ],
);

export type AnalyticsDailyBySource =
  typeof analyticsDailyBySourceTable.$inferSelect;

// ── analytics_daily_by_search ─────────────────────────────────────────────────

export const analyticsDailyBySearchTable = pgTable(
  "analytics_daily_by_search",
  {
    id: serial("id").primaryKey(),
    date: date("date", { mode: "date" }).notNull(),
    searchQueryNormalized: text("search_query_normalized").notNull(),
    countryCode: text("country_code").notNull().default("__ALL__"),
    cityId: text("city_id").notNull().default("__ALL__"),

    searchCount: integer("search_count").notNull().default(0),
    zeroResultCount: integer("zero_result_count").notNull().default(0),
    clickCount: integer("click_count").notNull().default(0),
    voiceCount: integer("voice_count").notNull().default(0),
    typedCount: integer("typed_count").notNull().default(0),

    dominantCategoryId: text("dominant_category_id"),
    dominantServiceId: text("dominant_service_id"),
    dominantInterfaceLanguage: text("dominant_interface_language"),

    lastAggregatedAt: timestamp("last_aggregated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    aggregationVersion: smallint("aggregation_version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("analytics_daily_by_search_unique").on(
      table.date,
      table.searchQueryNormalized,
      table.countryCode,
      table.cityId,
    ),
    index("idx_adbs_search_date").on(table.date, table.searchCount),
    index("idx_adbs_query").on(table.searchQueryNormalized, table.date),
  ],
);

export type AnalyticsDailyBySearch =
  typeof analyticsDailyBySearchTable.$inferSelect;

// ── analytics_aggregation_jobs ────────────────────────────────────────────────

export const analyticsAggregationJobsTable = pgTable(
  "analytics_aggregation_jobs",
  {
    id: serial("id").primaryKey(),
    dateStart: date("date_start", { mode: "date" }).notNull(),
    dateEnd: date("date_end", { mode: "date" }).notNull(),
    trigger: text("trigger").notNull(),
    status: text("status").notNull().default("running"),
    aggregationVersion: smallint("aggregation_version").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    rowsProcessed: integer("rows_processed"),
    errorMessage: text("error_message"),
    durationMs: integer("duration_ms"),
  },
  (table) => [
    index("idx_aaj_started_at").on(table.startedAt),
    index("idx_aaj_status_started").on(table.status, table.startedAt),
  ],
);

export type AnalyticsAggregationJob =
  typeof analyticsAggregationJobsTable.$inferSelect;

// ── analytics_admin_reports ───────────────────────────────────────────────────

export const analyticsAdminReportsTable = pgTable(
  "analytics_admin_reports",
  {
    id: serial("id").primaryKey(),
    reportType: text("report_type").notNull(),
    periodStart: date("period_start", { mode: "date" }).notNull(),
    periodEnd: date("period_end", { mode: "date" }).notNull(),

    generatedAt: timestamp("generated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    generatedByAdminId: integer("generated_by_admin_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),

    label: text("label"),

    kpiSnapshot: jsonb("kpi_snapshot").notNull(),
    comparisonKpi: jsonb("comparison_kpi"),
    insights: jsonb("insights"),

    notes: text("notes"),
    isFinal: boolean("is_final").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("analytics_admin_reports_period_type_unique").on(
      table.reportType,
      table.periodStart,
      table.periodEnd,
    ),
    index("idx_aar_period").on(table.periodStart, table.periodEnd),
  ],
);

export type AnalyticsAdminReport =
  typeof analyticsAdminReportsTable.$inferSelect;
