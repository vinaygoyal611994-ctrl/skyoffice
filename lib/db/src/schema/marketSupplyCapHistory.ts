/**
 * Market Supply Cap History — Migration 0027
 *
 * Immutable audit trail for every supply cap change.
 * Every row represents one admin decision (set, adjust, approve, reject, remove).
 * Rows are never updated or deleted.
 */

import {
  index,
  integer,
  pgTable,
  real,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const marketSupplyCapHistoryTable = pgTable(
  "market_supply_cap_history",
  {
    id: serial("id").primaryKey(),

    // Market key
    countryCode: text("country_code").notNull(),
    cityId:      text("city_id").notNull(),
    categoryId:  text("category_id").notNull(),

    // Change details
    previousCap: integer("previous_cap"),     // NULL on first set
    /** NULL means "cap removed" (market returned to uncapped). */
    newCap:      integer("new_cap"),

    /**
     * action_type values:
     *   set_initial               — first cap ever set for this market
     *   admin_adjustment          — admin manually changed an existing cap
     *   approved_recommendation   — admin approved intelligence recommendation
     *   rejected_recommendation   — admin rejected recommendation (cap unchanged)
     *   removed                   — cap removed (market becomes uncapped)
     */
    actionType: text("action_type").notNull(),

    changedBy: integer("changed_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    reason: text("reason"),

    // Snapshot of intelligence recommendation at decision time (if any)
    recommendedCap:            integer("recommended_cap"),
    recommendationConfidence:  real("recommendation_confidence"),

    // Supply context at decision time
    currentActiveSupply: integer("current_active_supply"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_msch_market").on(
      table.countryCode,
      table.cityId,
      table.categoryId,
      table.createdAt,
    ),
    index("idx_msch_changed_by").on(table.changedBy),
  ],
);

export type MarketSupplyCapHistoryRow =
  typeof marketSupplyCapHistoryTable.$inferSelect;
export type InsertMarketSupplyCapHistory =
  typeof marketSupplyCapHistoryTable.$inferInsert;
