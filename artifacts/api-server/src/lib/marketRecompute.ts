/**
 * Market Decision Intelligence — Recompute Engine
 *
 * Exports:
 *   fetchAllMarketSignals()     — SQL aggregation + canonical city normalization
 *   runMarketRecompute()        — classify + upsert all markets + write supply snapshot
 *   scheduleMarketRecompute()   — production-only 6-hour scheduler
 *
 * Country handling
 * ─────────────────
 * Launch markets are Saudi Arabia (SA) and UAE (AE).
 * Offices with a missing or unrecognised country are excluded from all supply
 * counts.  They are never assigned to another country by default.
 * The analytics demand side (analytics_daily_by_market) already stores a real
 * country_code; no COALESCE fallback is needed or applied there.
 *
 * City normalization
 * ──────────────────
 * Provider/transaction queries return raw LOWER(city) from SQL, then
 * classifyCityId() maps Arabic/English spelling variants to the same stable
 * key that analytics_daily_by_market already uses.
 * Example: "الرياض", "Riyadh", "riyadh" → "riyadh"
 *          "أبوظبي", "Abu Dhabi", "abu dhabi" → "abu_dhabi"
 *
 * Completed transactions
 * ──────────────────────
 * Sourced from service_requests WHERE status = 'completed'.
 * Period bucketing uses customer_confirmed_at (the authoritative completion
 * timestamp — set atomically when the customer confirms completion via
 * PATCH /service-requests/:id/confirm-completion).
 * created_at is intentionally NOT used: it records when the request was
 * submitted, which can be weeks before completion.
 *
 * Supply trend foundation
 * ───────────────────────
 * market_supply_snapshots stores the active provider count per
 * country × city × category at the time of each recompute run.
 * The prior-period supply count is read from the most recent snapshot that is
 * at least 30 days old.  On bootstrap (no snapshots ≥ 30 days old yet) the
 * prior count falls back to the current count, producing a neutral trend
 * (supplyTrend = 0) — correct behaviour when history is unavailable.
 */

import { db, pool, marketSupplyControlTable, marketRecomputeRunsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  classifyMarket,
  computeCapRecommendation,
  type MarketSignals,
} from "./marketClassifier";
import { classifyCityId } from "./searchNormalizer";
import { recordAuditLog } from "./auditLog";
import { logger } from "./logger";
import type { SessionUser } from "./auth";

// Minimal interface for the dedicated advisory-lock connection.
// Avoids importing PoolClient from "pg" directly (it's a transitive dep only).
interface DBLockClient {
  query<T = unknown>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
  release(destroy?: boolean): void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** How often the scheduler re-evaluates all markets (6 hours). */
const MARKET_RECOMPUTE_INTERVAL_MS = 6 * 60 * 60 * 1_000;

/**
 * If any market_supply_control row was computed within this window, the
 * scheduled run is considered redundant and skips gracefully.
 */
const FRESHNESS_SKIP_HOURS = 5;

/**
 * PostgreSQL advisory lock key for the market-recompute mutex.
 * Sits well above the analytics-aggregator's date-based keys (~19000–20000)
 * and fits comfortably in a PostgreSQL int8.
 */
const MARKET_RECOMPUTE_LOCK_KEY = 1_000_000_001;

/**
 * Only offices in these country codes contribute to supply counts.
 * Offices with country = NULL or any other value are excluded.
 */
const VALID_COUNTRIES = ["'SA'", "'AE'"].join(", ");

// ── City normalization ────────────────────────────────────────────────────────

/**
 * Maps a raw free-text city value (already lowercased by SQL) to the canonical
 * stable city_id key used in analytics_daily_by_market.
 *
 * Falls back to the raw lowercased value for cities not in the alias map so
 * that unrecognised cities still produce a consistent (if unrecognised) key
 * rather than splitting the same city into multiple market rows.
 */
function canonicalCityKey(rawLower: string): string {
  return classifyCityId(rawLower.trim()) ?? rawLower.trim();
}

// ── Signal fetching ───────────────────────────────────────────────────────────

export type MarketSignalRow = {
  countryCode: string;
  cityId: string;
  categoryId: string;
  signals: MarketSignals;
  lastSignalDate: string | null;
};

/**
 * Fetches and assembles market signals for every city×category combination
 * that has analytics data in the last 60 days.
 *
 * Map keys in all provider/transaction lookup maps are:
 *   "<countryCode>|<canonicalCityId>|<categoryId>"
 *
 * This prevents city name collisions across countries and ensures that
 * unresolved-country offices are never silently merged into a valid market.
 */
export async function fetchAllMarketSignals(): Promise<MarketSignalRow[]> {
  const now    = new Date();
  const d30    = new Date(now); d30.setDate(d30.getDate() - 30);
  const d60    = new Date(now); d60.setDate(d60.getDate() - 60);
  const d30str = d30.toISOString().slice(0, 10);
  const d60str = d60.toISOString().slice(0, 10);

  // ── Query 1: analytics signals (demand side) ───────────────────────────────
  // Aggregates last-30d and prior-30d demand counters from analytics_daily_by_market.
  // Excludes __ALL__ rollup rows.
  // country_code here is reliable — analytics stores the actual country.
  const marketAggRes = await pool.query<{
    country_code:      string;
    city_id:           string;
    category_id:       string;
    searches_30d:      string;
    zero_result_30d:   string;
    profile_views_30d: string;
    whatsapp_30d:      string;
    map_30d:           string;
    days_of_data:      string;
    last_signal_date:  string | null;
    searches_prior:    string;
  }>(`
    SELECT
      country_code,
      city_id,
      category_id,
      SUM(CASE WHEN date >= $1::date THEN searches             ELSE 0 END) AS searches_30d,
      SUM(CASE WHEN date >= $1::date THEN zero_result_searches ELSE 0 END) AS zero_result_30d,
      SUM(CASE WHEN date >= $1::date THEN profile_views        ELSE 0 END) AS profile_views_30d,
      SUM(CASE WHEN date >= $1::date THEN whatsapp_clicks      ELSE 0 END) AS whatsapp_30d,
      SUM(CASE WHEN date >= $1::date THEN map_clicks           ELSE 0 END) AS map_30d,
      COUNT(CASE WHEN date >= $1::date THEN 1 END)                          AS days_of_data,
      MAX(CASE WHEN date >= $1::date THEN date::text END)                   AS last_signal_date,
      SUM(CASE WHEN date < $1::date AND date >= $2::date THEN searches ELSE 0 END) AS searches_prior
    FROM analytics_daily_by_market
    WHERE city_id    != '__ALL__'
      AND category_id != '__ALL__'
      AND date >= $2::date
    GROUP BY country_code, city_id, category_id
  `, [d30str, d60str]);

  if (marketAggRes.rows.length === 0) return [];

  // ── Query 2: current active providers (supply side) ────────────────────────
  // Filters to valid launch markets only — offices with country IS NULL or any
  // non-launch country are excluded and never assigned to another country.
  // Map key: "<country>|<canonicalCity>|<category>"
  const activeProvRes = await pool.query<{
    country:      string;
    city_lower:   string;
    category:     string;
    active_count: string;
  }>(`
    SELECT
      country,
      LOWER(city)  AS city_lower,
      category,
      COUNT(*)     AS active_count
    FROM offices
    WHERE status = 'active'
      AND is_demo = false
      AND country IN (${VALID_COUNTRIES})
    GROUP BY country, LOWER(city), category
  `);

  // ── Query 3: prior-period supply from snapshots ────────────────────────────
  // Returns the most recent snapshot that is at least 30 days old for each
  // country × city × category.  city_id and category_id in the snapshot table
  // are already canonical (written by this engine), so no normalization needed.
  //
  // Falls back to current count (neutral trend) when no prior snapshot exists
  // — correct bootstrap behaviour for a freshly deployed system.
  const priorSnapshotRes = await pool.query<{
    country_code: string;
    city_id:      string;
    category_id:  string;
    active_count: string;
  }>(`
    SELECT DISTINCT ON (country_code, city_id, category_id)
      country_code,
      city_id,
      category_id,
      active_count
    FROM market_supply_snapshots
    WHERE snapshotted_at <= NOW() - interval '30 days'
    ORDER BY country_code, city_id, category_id, snapshotted_at DESC
  `);

  // ── Query 4: providers with ≥1 contact in last 30 days ────────────────────
  // Filtered to valid launch markets; excludes demo offices.
  const activeProvWithContactsRes = await pool.query<{
    country:    string;
    city_lower: string;
    category:   string;
    cnt:        string;
  }>(`
    SELECT
      o.country,
      LOWER(o.city)        AS city_lower,
      o.category,
      COUNT(DISTINCT o.id) AS cnt
    FROM offices o
    JOIN contact_events ce ON ce.office_id = o.id
    WHERE o.status = 'active'
      AND o.is_demo = false
      AND o.country IN (${VALID_COUNTRIES})
      AND ce.created_at >= $1::date
    GROUP BY o.country, LOWER(o.city), o.category
  `, [d30str]);

  // ── Query 5: completed transactions (funnel depth) ────────────────────────
  // Source: service_requests WHERE status = 'completed'.
  //
  // Timestamp: customer_confirmed_at — the authoritative completion timestamp.
  //   Set atomically when the customer confirms via confirm-completion route.
  //   created_at records when the request was originally submitted (can be
  //   weeks before completion) and must NOT be used for period bucketing.
  //
  // Filters:
  //   - o.country IN (SA, AE): exclude providers with missing/invalid country.
  //   - o.is_demo = false: exclude QA/seed offices.
  //   - Does NOT filter o.status: historical completions from offices that later
  //     became inactive are still valid market-level signals.
  //   - customer_confirmed_at IS NOT NULL: defensive guard (should always be set
  //     when status = 'completed' based on confirm-completion route logic).
  const txnRes = await pool.query<{
    country:   string;
    city_lower: string;
    category:  string;
    txn_30d:   string;
    txn_prior: string;
  }>(`
    SELECT
      o.country,
      LOWER(o.city)                                                                                              AS city_lower,
      o.category,
      COUNT(CASE WHEN sr.customer_confirmed_at >= $1::date                                        THEN 1 END)   AS txn_30d,
      COUNT(CASE WHEN sr.customer_confirmed_at <  $1::date AND sr.customer_confirmed_at >= $2::date THEN 1 END) AS txn_prior
    FROM offices o
    JOIN service_requests sr ON sr.office_id = o.id
    WHERE sr.status = 'completed'
      AND sr.customer_confirmed_at IS NOT NULL
      AND sr.customer_confirmed_at >= $2::date
      AND o.is_demo = false
      AND o.country IN (${VALID_COUNTRIES})
    GROUP BY o.country, LOWER(o.city), o.category
  `, [d30str, d60str]);

  // ── Build lookup maps ──────────────────────────────────────────────────────
  //
  // All maps keyed by "<country>|<canonicalCityId>|<category>".
  // Including country prevents cross-country city name collisions and ensures
  // that excluded (null-country) offices are never merged into a valid market.

  const provMap     = new Map<string, number>();
  const priorMap    = new Map<string, number>(); // from snapshots
  const provCntMap  = new Map<string, number>();
  const txnMap      = new Map<string, { current: number; prior: number }>();

  for (const r of activeProvRes.rows) {
    const key = `${r.country}|${canonicalCityKey(r.city_lower)}|${r.category}`;
    provMap.set(key, (provMap.get(key) ?? 0) + parseInt(r.active_count, 10));
  }

  // Prior snapshot map: already uses canonical city_id — no normalization needed
  for (const r of priorSnapshotRes.rows) {
    const key = `${r.country_code}|${r.city_id}|${r.category_id}`;
    priorMap.set(key, parseInt(r.active_count, 10));
  }

  for (const r of activeProvWithContactsRes.rows) {
    const key = `${r.country}|${canonicalCityKey(r.city_lower)}|${r.category}`;
    provCntMap.set(key, (provCntMap.get(key) ?? 0) + parseInt(r.cnt, 10));
  }

  for (const r of txnRes.rows) {
    const key = `${r.country}|${canonicalCityKey(r.city_lower)}|${r.category}`;
    const existing = txnMap.get(key) ?? { current: 0, prior: 0 };
    txnMap.set(key, {
      current: existing.current + parseInt(r.txn_30d,   10),
      prior:   existing.prior   + parseInt(r.txn_prior, 10),
    });
  }

  // ── Assemble signal objects ────────────────────────────────────────────────

  return marketAggRes.rows.map((row) => {
    const key = `${row.country_code}|${row.city_id}|${row.category_id}`;

    const activeProv             = provMap.get(key)    ?? 0;
    // Prior supply: from snapshot if available; neutral fallback (same as current)
    // means supplyTrend = 0 until 30+ days of snapshots have accumulated.
    const activeProv60dAgo       = priorMap.get(key)   ?? activeProv;
    const activeProvWithContacts = provCntMap.get(key) ?? 0;
    const txn                    = txnMap.get(key);

    const signals: MarketSignals = {
      searches:             parseInt(row.searches_30d,    10),
      zeroResultSearches:   parseInt(row.zero_result_30d, 10),
      profileViews:         parseInt(row.profile_views_30d, 10),
      whatsappContacts:     parseInt(row.whatsapp_30d,    10),
      mapContacts:          parseInt(row.map_30d,         10),
      daysOfData:           parseInt(row.days_of_data,    10),
      activeProv,
      activeProv60dAgo,
      searchesPrior30d:     parseInt(row.searches_prior,  10),
      activeProvWithContacts,
      // customer_confirmed_at is the authoritative completion timestamp
      completedTransactions:         txn?.current ?? 0,
      completedTransactionsPrior30d: txn?.prior   ?? 0,
    };

    return {
      countryCode:    row.country_code,
      cityId:         row.city_id,
      categoryId:     row.category_id,
      signals,
      lastSignalDate: row.last_signal_date ?? null,
    };
  });
}

// ── Core recompute (classify + upsert + snapshot) ────────────────────────────

type Actor = SessionUser | null | undefined;

// ── Run tracking ──────────────────────────────────────────────────────────────

async function createRecomputeRun(triggeredBy: string): Promise<number> {
  const [run] = await db
    .insert(marketRecomputeRunsTable)
    .values({ triggeredBy, status: "running" })
    .returning({ id: marketRecomputeRunsTable.id });
  return run.id;
}

async function completeRecomputeRun(
  runId: number,
  startMs: number,
  marketsUpserted: number,
): Promise<void> {
  await db
    .update(marketRecomputeRunsTable)
    .set({
      status: "completed",
      completedAt: new Date(),
      durationMs: Date.now() - startMs,
      marketsUpserted,
    })
    .where(eq(marketRecomputeRunsTable.id, runId));
}

async function failRecomputeRun(
  runId: number,
  startMs: number,
  errorMessage: string,
): Promise<void> {
  await db
    .update(marketRecomputeRunsTable)
    .set({
      status: "failed",
      failedAt: new Date(),
      durationMs: Date.now() - startMs,
      errorMessage: errorMessage.slice(0, 500),
    })
    .where(eq(marketRecomputeRunsTable.id, runId));
}

async function skipRecomputeRun(runId: number, skipReason: string): Promise<void> {
  await db
    .update(marketRecomputeRunsTable)
    .set({ status: "skipped", skippedAt: new Date(), skipReason })
    .where(eq(marketRecomputeRunsTable.id, runId));
}

/**
 * Classifies all markets, upserts results into market_supply_control, and
 * writes a point-in-time supply snapshot to market_supply_snapshots.
 *
 * The snapshot enables reliable supply trend analysis in future recompute runs
 * by replacing the "created_at < 60d proxy" with an actual historical count.
 *
 * @param triggeredBy  "admin" (manual button) or "scheduled" (cron)
 * @param actor        The admin session user, or null for scheduled runs
 * @returns            Count of upserted rows and ISO timestamp
 */
export async function runMarketRecompute(
  triggeredBy: "admin" | "scheduled",
  actor?: Actor,
): Promise<{ upserted: number; computedAt: string; skipped?: boolean; skipReason?: string }> {
  const startMs = Date.now();

  // Single dedicated DB client for the advisory lock — ensures acquire and
  // release run on the SAME PostgreSQL session (advisory locks are session-scoped).
  let runId: number | null = null;
  let lockClient: DBLockClient | null = null;
  let lockAcquired = false;

  try {
    runId = await createRecomputeRun(triggeredBy);

    lockClient = await pool.connect();
    const lockResult = await lockClient.query<{ pg_try_advisory_lock: boolean }>(
      "SELECT pg_try_advisory_lock($1)",
      [MARKET_RECOMPUTE_LOCK_KEY],
    );
    lockAcquired = lockResult.rows[0]?.pg_try_advisory_lock === true;

    if (!lockAcquired) {
      logger.info(
        { triggeredBy },
        "[market-recompute] Advisory lock busy — another run is in progress, skipping",
      );
      lockClient.release();
      lockClient = null;
      await skipRecomputeRun(runId, "lock_busy").catch(() => {});
      return { upserted: 0, computedAt: new Date().toISOString(), skipped: true, skipReason: "lock_busy" };
    }

    const markets = await fetchAllMarketSignals();
    const now     = new Date();

    // Collect snapshot rows while processing markets (one INSERT per batch below)
    const snapshotRows: Array<{
      countryCode: string;
      cityId: string;
      categoryId: string;
      activeCount: number;
    }> = [];

    // ── Pre-fetch current supply caps for cap recommendation computation ──────
    // The recompute NEVER modifies supply_cap — only recommended_supply_cap.
    // We pre-fetch all caps to avoid per-market round trips inside the loop.
    const capFetchRes = await pool.query<{
      country_code: string;
      city_id:      string;
      category_id:  string;
      supply_cap:   number | null;
    }>(`SELECT country_code, city_id, category_id, supply_cap FROM market_supply_control`);

    const capMap = new Map<string, number | null>();
    for (const r of capFetchRes.rows) {
      capMap.set(`${r.country_code}|${r.city_id}|${r.category_id}`, r.supply_cap ?? null);
    }

    let upsertedCount = 0;

    for (const { countryCode, cityId, categoryId, signals } of markets) {
      const cls = classifyMarket(signals);

      // Cap recommendation (advisory only — NEVER auto-applied to supply_cap)
      const mKey      = `${countryCode}|${cityId}|${categoryId}`;
      const currentCap = capMap.get(mKey) ?? null;
      const capRec    = computeCapRecommendation(cls, currentCap, signals.activeProv);

      // Only store recommendation when a cap exists (no-cap markets get NULL fields)
      const recCap    = currentCap !== null ? capRec.recommendedCap   : null;
      const recChange = currentCap !== null ? capRec.capChange        : null;
      const recReason = currentCap !== null ? capRec.reason           : null;
      const recConf   = currentCap !== null ? capRec.confidence       : null;

      const snapshotObj = {
        ...signals,
        ...cls.derivedSignals,
      };

      await pool.query(`
        INSERT INTO market_supply_control
          (country_code, city_id, category_id,
           market_status, pending_recommendation, recommended_action,
           current_active_supply, confidence_score, recommendation_reason,
           last_computed_at, signals_snapshot,
           recommended_supply_cap, recommended_cap_change,
           cap_recommendation_reason, cap_recommendation_confidence,
           cap_recommendation_computed_at,
           updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb,
                $12, $13, $14, $15, $10, $10)
        ON CONFLICT (country_code, city_id, category_id) DO UPDATE SET
          market_status                  = EXCLUDED.market_status,
          pending_recommendation         = EXCLUDED.pending_recommendation,
          recommended_action             = EXCLUDED.recommended_action,
          current_active_supply          = EXCLUDED.current_active_supply,
          confidence_score               = EXCLUDED.confidence_score,
          recommendation_reason          = EXCLUDED.recommendation_reason,
          last_computed_at               = EXCLUDED.last_computed_at,
          signals_snapshot               = EXCLUDED.signals_snapshot,
          recommended_supply_cap         = EXCLUDED.recommended_supply_cap,
          recommended_cap_change         = EXCLUDED.recommended_cap_change,
          cap_recommendation_reason      = EXCLUDED.cap_recommendation_reason,
          cap_recommendation_confidence  = EXCLUDED.cap_recommendation_confidence,
          cap_recommendation_computed_at = EXCLUDED.cap_recommendation_computed_at,
          updated_at                     = EXCLUDED.updated_at
          -- NOTE: supply_cap, cap_source, cap_updated_at, cap_updated_by,
          -- cap_status are intentionally excluded from DO UPDATE.
          -- The recompute engine MUST NEVER overwrite admin-controlled cap settings.
      `, [
        countryCode,
        cityId,
        categoryId,
        cls.marketStatus,
        cls.recommendedAcceptance,
        cls.recommendedAction,
        signals.activeProv,
        cls.confidenceScore,
        cls.recommendationReason,
        now,
        JSON.stringify(snapshotObj),
        recCap,
        recChange,
        recReason,
        recConf,
      ]);

      snapshotRows.push({
        countryCode,
        cityId,
        categoryId,
        activeCount: signals.activeProv,
      });

      upsertedCount++;
    }

    // ── Write supply snapshot (one row per market per recompute) ──────────────
    // Batched as individual INSERTs in the loop below (markets count is small,
    // typically < 200 rows).  Append-only — no ON CONFLICT clause.
    if (snapshotRows.length > 0) {
      for (const snap of snapshotRows) {
        await pool.query(`
          INSERT INTO market_supply_snapshots
            (country_code, city_id, category_id, active_count, snapshotted_at)
          VALUES ($1, $2, $3, $4, $5)
        `, [snap.countryCode, snap.cityId, snap.categoryId, snap.activeCount, now]);
      }

      logger.debug(
        { snapshots: snapshotRows.length },
        "[market-recompute] Supply snapshots written",
      );
    }

    logger.info(
      { triggeredBy, markets: upsertedCount },
      "[market-recompute] Recompute complete",
    );

    await recordAuditLog({
      actor:      actor ?? null,
      action:     `admin.market_supply.compute.${triggeredBy}`,
      targetType: "system",
      targetId:   null as unknown as number,
      metadata:   { marketsProcessed: upsertedCount, triggeredBy },
    });

    await completeRecomputeRun(runId, startMs, upsertedCount).catch(() => {});

    return { upserted: upsertedCount, computedAt: now.toISOString() };

  } catch (err) {
    const errorMessage = (err as Error).message;
    logger.error({ err: errorMessage, triggeredBy }, "[market-recompute] Recompute failed");
    if (runId !== null) {
      await failRecomputeRun(runId, startMs, errorMessage).catch(() => {});
    }
    throw err;
  } finally {
    // Release the advisory lock on the SAME connection it was acquired on.
    // If unlock fails, destroy the connection — PostgreSQL auto-releases
    // session-level locks when a connection is closed.
    const clientToRelease = lockClient;
    lockClient = null;
    if (lockAcquired && clientToRelease) {
      try {
        await clientToRelease.query("SELECT pg_advisory_unlock($1)", [MARKET_RECOMPUTE_LOCK_KEY]);
        clientToRelease.release();
      } catch {
        clientToRelease.release(true); // destroy → session ends → lock auto-releases
      }
    } else if (clientToRelease) {
      clientToRelease.release();
    }
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

/**
 * Registers a production-only scheduled market recompute.
 *
 * Behaviour:
 *   - Runs every 6 hours (MARKET_RECOMPUTE_INTERVAL_MS)
 *   - Initial delay of 90 min before first check (1/4 of interval)
 *   - Skips gracefully if any row was computed within the last 5 hours
 *     (prevents double-runs if admin triggered a manual recompute recently)
 *   - Never auto-approves or applies recommendations — compute only
 *   - .unref() so it does not keep the process alive
 *   - No-op in development (logs a warning instead)
 *
 * Manual recompute via POST /api/admin/market-supply/controls/compute
 * remains available at all times regardless of scheduler state.
 */
export function scheduleMarketRecompute(): void {
  if (process.env.NODE_ENV !== "production") {
    logger.warn(
      "[market-recompute] Not production environment — scheduler NOT started. " +
      "Use POST /api/admin/market-supply/controls/compute for manual runs.",
    );
    return;
  }

  const initialDelay = MARKET_RECOMPUTE_INTERVAL_MS / 4; // 90 min

  logger.info(
    {
      initialDelayMs: initialDelay,
      intervalMs:     MARKET_RECOMPUTE_INTERVAL_MS,
      intervalHours:  MARKET_RECOMPUTE_INTERVAL_MS / 3_600_000,
    },
    "[market-recompute] Scheduler registered",
  );

  const check = async () => {
    try {
      // Skip if a recent compute already exists to avoid duplicate work
      const recent = await db.execute(sql`
        SELECT 1 FROM market_supply_control
        WHERE last_computed_at >= NOW() - (${FRESHNESS_SKIP_HOURS} || ' hours')::interval
        LIMIT 1
      `);

      if (recent.rows.length > 0) {
        logger.debug(
          { freshWithinHours: FRESHNESS_SKIP_HOURS },
          "[market-recompute] Recent compute found — skipping scheduled run",
        );
        return;
      }

      await runMarketRecompute("scheduled", null);
    } catch (err) {
      logger.warn(
        { err: (err as Error).message },
        "[market-recompute] Scheduled run failed — will retry next interval",
      );
    }
  };

  const initialTimer = setTimeout(() => {
    void check();
    const interval = setInterval(() => void check(), MARKET_RECOMPUTE_INTERVAL_MS);
    interval.unref();
  }, initialDelay);

  initialTimer.unref();
}
