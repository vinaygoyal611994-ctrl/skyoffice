/**
 * Market Recompute Runs — Migration 0035
 *
 * One row per runMarketRecompute() invocation.
 * Records start, outcome, duration, and advisory-lock skip events so
 * Platform Health can surface last-success, failures, and skips without
 * scraping logs.
 */

import { index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const marketRecomputeRunsTable = pgTable(
  "market_recompute_runs",
  {
    id: serial("id").primaryKey(),

    /** 'scheduled' | 'admin' */
    triggeredBy: text("triggered_by").notNull(),

    /** 'running' | 'completed' | 'failed' | 'skipped' */
    status: text("status").notNull().default("running"),

    startedAt:   timestamp("started_at",   { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failedAt:    timestamp("failed_at",    { withTimezone: true }),
    skippedAt:   timestamp("skipped_at",   { withTimezone: true }),

    durationMs:      integer("duration_ms"),
    marketsUpserted: integer("markets_upserted"),

    /** Truncated to 500 chars at write time; no stack traces or credentials. */
    errorMessage: text("error_message"),

    /** 'lock_busy' — advisory lock was held by another instance. */
    skipReason: text("skip_reason"),
  },
  (table) => [
    index("market_recompute_runs_started_at_idx").on(table.startedAt),
    index("market_recompute_runs_status_idx").on(table.status, table.startedAt),
  ],
);

export type MarketRecomputeRun    = typeof marketRecomputeRunsTable.$inferSelect;
export type InsertMarketRecomputeRun = typeof marketRecomputeRunsTable.$inferInsert;
