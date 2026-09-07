/**
 * SkayOffice Proximity Ranking Service
 *
 * Single module that owns all public-listing sort logic. Routes call
 * `buildRankOrderBy()` and never re-implement ranking themselves.
 *
 * Future reputation signals (verified rating, response speed, complaint rate,
 * repeat customers) can be added here as additional ORDER BY expressions
 * without touching any route file.
 *
 * Profile completeness scoring
 * ─────────────────────────────
 * Computed from columns on the offices row (no subquery needed).
 * Services count is excluded from the SQL expression to avoid a JOIN in the
 * ORDER BY — this is a known limitation at pilot scale.
 *
 * Field              Weight
 * ─────              ──────
 * logo_url           2
 * cover_url          2
 * description        2
 * city (non-empty)   1
 * whatsapp           1
 * spoken_languages   1
 * hero_media_url     1
 * is_verified        2
 * ─────────────────────
 * Max score         12
 *
 * Fairness notes
 * ──────────────
 * • `id ASC` as final tie-breaker — earlier-registered providers break ties
 *   deterministically but are NOT permanently dominant (proximity and
 *   availability come first).
 * • completedTransactions and clientsRecommendPercent intentionally excluded
 *   (data not verified at pilot stage).
 * • isDemo providers sort last within any bucket.
 * • No paid boost, no artificial signals.
 */

import { officesTable } from "@workspace/db";
import { asc, desc, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

export type SortType = "nearest" | "available" | "newest";

// ─── Completeness score ─────────────────────────────────────────────────────

function completenessExpr(): SQL<number> {
  return sql<number>`(
    CASE WHEN ${officesTable.logoUrl}     IS NOT NULL THEN 2 ELSE 0 END +
    CASE WHEN ${officesTable.coverUrl}    IS NOT NULL THEN 2 ELSE 0 END +
    CASE WHEN ${officesTable.description} IS NOT NULL
          AND length(${officesTable.description}) > 0  THEN 2 ELSE 0 END +
    CASE WHEN ${officesTable.city}        IS NOT NULL
          AND length(${officesTable.city}) > 0          THEN 1 ELSE 0 END +
    CASE WHEN ${officesTable.whatsapp}    IS NOT NULL THEN 1 ELSE 0 END +
    CASE WHEN array_length(${officesTable.spokenLanguages}, 1) > 0
                                                         THEN 1 ELSE 0 END +
    CASE WHEN ${officesTable.heroMediaUrl} IS NOT NULL THEN 1 ELSE 0 END +
    CASE WHEN ${officesTable.isVerified}  = true        THEN 2 ELSE 0 END
  )`;
}

// ─── Haversine distance ─────────────────────────────────────────────────────

/**
 * SQL expression for great-circle distance in km using the Haversine formula.
 * Providers without coordinates receive a sentinel value (999999 km) so they
 * sort after all providers that do have coordinates.
 *
 * Accuracy: <0.5% error for distances up to 5 000 km — sufficient for any
 * pilot geography. Future migration to PostGIS ST_Distance is non-breaking.
 */
function haversineExpr(lat: number, lon: number): SQL<number> {
  return sql<number>`(
    CASE
      WHEN ${officesTable.latitude}  IS NULL
        OR ${officesTable.longitude} IS NULL THEN 999999.0
      ELSE 2.0 * 6371.0 * asin(sqrt(
        power(sin(radians((${officesTable.latitude} - ${lat}::float8) / 2.0)), 2) +
        cos(radians(${lat}::float8)) * cos(radians(${officesTable.latitude})) *
        power(sin(radians((${officesTable.longitude} - ${lon}::float8) / 2.0)), 2)
      ))
    END
  )`;
}

// ─── Haversine (JavaScript) ──────────────────────────────────────────────────

/**
 * Compute great-circle distance in km between two coordinate pairs.
 * Used after fetching results to populate the `distance` field in the API
 * response (avoids extracting computed columns from Drizzle).
 */
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ─── ORDER BY builder ────────────────────────────────────────────────────────

/**
 * Build the SQL ORDER BY clauses for the public office listing.
 *
 * CASE A — sort=nearest + customer coords + provider coords:
 *   Haversine distance ASC → completeness DESC → demo last → id ASC
 *
 * CASE B — sort=nearest + city known (no coords):
 *   City match first → online DESC → completeness DESC → demo last → id ASC
 *
 * CASE C — sort=nearest + no location:
 *   online DESC → completeness DESC → demo last → id ASC
 *
 * sort=available:
 *   online DESC → completeness DESC → demo last → id ASC
 *
 * sort=newest:
 *   created_at DESC → id DESC
 */
export function buildRankOrderBy(params: {
  sort: SortType;
  lat?: number;
  lon?: number;
  city?: string;
}): SQL[] {
  const { sort, lat, lon, city } = params;
  const completeness = completenessExpr();
  const demoLast = sql<number>`CASE WHEN ${officesTable.isDemo} = true THEN 1 ELSE 0 END`;

  if (sort === "nearest" && lat !== undefined && lon !== undefined) {
    // Case A: both customer and (potentially) provider coordinates available
    return [
      asc(haversineExpr(lat, lon)),
      desc(completeness),
      asc(demoLast),
      asc(officesTable.id),
    ];
  }

  if (sort === "nearest" && city && city.trim() !== "") {
    // Case B: city known — rank same-city providers first
    const cityMatch = sql<number>`CASE WHEN LOWER(${officesTable.city}) = LOWER(${city.trim()}::text) THEN 0 ELSE 1 END`;
    return [
      asc(cityMatch),
      desc(officesTable.isOnline),
      desc(completeness),
      asc(demoLast),
      asc(officesTable.id),
    ];
  }

  if (sort === "nearest" || sort === "available") {
    // Case C / available: no location, or explicit availability sort
    return [
      desc(officesTable.isOnline),
      desc(completeness),
      asc(demoLast),
      asc(officesTable.id),
    ];
  }

  if (sort === "newest") {
    return [desc(officesTable.createdAt), desc(officesTable.id)];
  }

  // Unreachable with Zod validation, but safe default
  return [asc(officesTable.id)];
}
