/**
 * Analytics configuration constants.
 *
 * All timestamps stored in UTC; this timezone is used for daily bucketing
 * in reports and the aggregation scheduler.
 *
 * Override via environment variables — never hard-code region-specific values
 * in application code.
 */

/** Timezone used for report display and daily bucket boundaries. */
export const ANALYTICS_REPORTING_TIMEZONE =
  process.env["ANALYTICS_REPORTING_TIMEZONE"] ?? "Asia/Riyadh";

/**
 * Number of days to retain raw analytics_events rows.
 * A future cleanup job will enforce this window.
 * Default: 24 months.
 */
export const ANALYTICS_RETENTION_MONTHS =
  parseInt(process.env["ANALYTICS_RETENTION_MONTHS"] ?? "24", 10);

/** Semantic version of the aggregation logic. Bump when output shape changes. */
export const AGGREGATION_VERSION = 1 as const;

/** Semantic version of bot detection rules applied to new events. */
export const BOT_DETECTION_VERSION = "1.0";

/** Semantic version of the search normalization + intent parser. */
export const PARSER_VERSION = "1.0.0";

/**
 * Minimum required sample size to show a metric reliably in the Intelligence
 * dashboard. Metric displays "Insufficient data (n=X)" when below threshold.
 */
export const ANALYTICS_MIN_SAMPLE_SIZE = 30;

/**
 * Maximum length of a stored search query (original and normalized).
 * Queries longer than this are truncated before storage.
 */
export const MAX_SEARCH_QUERY_LENGTH = 200;

/** Max length for a QR campaign ID. Must match pattern /^[a-z0-9-]{1,64}$/. */
export const MAX_QR_CAMPAIGN_ID_LENGTH = 64;

/** Cookie name for the anonymous visitor ID. */
export const VISITOR_COOKIE_NAME = "_skay_vid";

/** Visitor cookie max-age in seconds — 365 days. */
export const VISITOR_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/** Countries currently supported as primary markets. */
export const PRIMARY_MARKET_COUNTRY_CODES = ["SA", "AE"] as const;

/** Aggregation schedule: run daily at HH:MM UTC. */
export const AGGREGATION_CRON_HOUR_UTC = 1;   // 01:00 UTC = 04:00 AST
export const AGGREGATION_CRON_MINUTE_UTC = 30;

/** How many past days to backfill on startup if not yet aggregated. */
export const AGGREGATION_BACKFILL_DAYS = 7;

/** Interval in ms for the aggregation scheduler loop. */
export const AGGREGATION_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
