/**
 * Market Supply Control schema — Migration 0024
 *
 * One row per (countryCode × cityId × categoryId).
 * Tracks admin-controlled acceptance decisions and the last computed
 * signal snapshot from the Market Decision Intelligence engine.
 */

import {
  index,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const marketSupplyControlTable = pgTable(
  "market_supply_control",
  {
    id: serial("id").primaryKey(),

    // Market key
    countryCode: text("country_code").notNull(),
    cityId:      text("city_id").notNull(),
    categoryId:  text("category_id").notNull(),

    // 'manual' | 'assisted'  ('automatic' reserved, never set in v1)
    acceptanceMode: text("acceptance_mode").notNull().default("manual"),

    // Latest computed classification
    marketStatus: text("market_status"),

    // Admin-approved acceptance state
    acceptanceStatus: text("acceptance_status").notNull().default("open"),

    // Latest pending recommendation (awaiting admin decision)
    pendingRecommendation: text("pending_recommendation"),
    recommendedAction:     text("recommended_action"),
    targetSupply:          integer("target_supply"),
    currentActiveSupply:   integer("current_active_supply"),
    confidenceScore:       real("confidence_score"),
    recommendationReason:  text("recommendation_reason"),

    // When the last compute ran
    lastComputedAt: timestamp("last_computed_at", { withTimezone: true }),

    // Full signal snapshot (for audit)
    signalsSnapshot: jsonb("signals_snapshot"),

    // Admin review
    lastReviewedAt:      timestamp("last_reviewed_at",      { withTimezone: true }),
    adminReviewDecision: text("admin_review_decision"),
    adminReviewedBy:     integer("admin_reviewed_by").references(() => usersTable.id, { onDelete: "set null" }),
    adminReviewNote:     text("admin_review_note"),

    // ── Supply Cap (migration 0027) ──────────────────────────────────────────
    // supply_cap is ONLY changed by explicit admin action.
    // The scheduled intelligence recompute NEVER writes to this column.
    // NULL = uncapped (market admits providers without limit until admin sets one).
    supplyCap:  integer("supply_cap"),
    /**
     * Denormalised cap status — updated whenever supply or cap changes.
     *   available  — below cap (or uncapped)
     *   near_cap   — within the near-cap threshold (≤20% of cap remaining)
     *   full       — supply equals cap; no new admission
     *   over_cap   — supply exceeds cap (cap was lowered; no providers removed)
     *   paused     — manually paused by admin (intake suspended regardless of count)
     */
    capStatus:     text("cap_status").notNull().default("available"),
    /**
     * How the current cap was last set.
     *   manual_initial                 — admin set the first cap
     *   admin_adjustment               — admin manually changed an existing cap
     *   approved_intelligence_recommendation — admin approved an AI recommendation
     */
    capSource:     text("cap_source"),
    capUpdatedAt:  timestamp("cap_updated_at", { withTimezone: true }),
    capUpdatedBy:  integer("cap_updated_by").references(() => usersTable.id, { onDelete: "set null" }),

    // ── Intelligence cap recommendation (advisory only) ──────────────────────
    // Overwritten each recompute.  Never auto-applied.
    // Admin must explicitly approve before supply_cap changes.
    recommendedSupplyCap:           integer("recommended_supply_cap"),
    recommendedCapChange:           integer("recommended_cap_change"),
    capRecommendationReason:        text("cap_recommendation_reason"),
    capRecommendationConfidence:    real("cap_recommendation_confidence"),
    capRecommendationComputedAt:    timestamp("cap_recommendation_computed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("market_supply_control_market_unique").on(
      table.countryCode,
      table.cityId,
      table.categoryId,
    ),
    index("idx_msc_city_id").on(table.cityId),
    index("idx_msc_market_status").on(table.marketStatus),
  ],
);

export type MarketSupplyControlRow =
  typeof marketSupplyControlTable.$inferSelect;
export type InsertMarketSupplyControl =
  typeof marketSupplyControlTable.$inferInsert;
