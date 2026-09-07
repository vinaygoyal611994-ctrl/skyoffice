-- Migration: 0025_market_supply_snapshots
-- Adds an append-only table that records the active provider count per
-- country × city × category at the time of each market recompute run.
--
-- Purpose: replace the "created_at < 60d" proxy in market supply trend
-- analysis with reliable point-in-time supply counts that survive provider
-- status changes (deactivation, reactivation) after the snapshot was taken.
--
-- Design choices:
--   - Append-only: never UPDATE or DELETE rows during normal operation.
--   - city_id and category_id are plain text matching analytics_daily_by_market
--     conventions (canonical lowercased keys, e.g. "riyadh", "legal").
--   - No FK to market_supply_control: snapshots exist independently and may
--     pre-date a control row, e.g. on first-run bootstrap.
--   - A partial cleanup (rows older than 365 days) can be added later without
--     schema changes; the index supports it efficiently.

CREATE TABLE IF NOT EXISTS market_supply_snapshots (
  id             serial       PRIMARY KEY,
  country_code   text         NOT NULL,
  city_id        text         NOT NULL,
  category_id    text         NOT NULL,
  active_count   integer      NOT NULL,
  snapshotted_at timestamptz  NOT NULL DEFAULT NOW()
);

-- Supports the DISTINCT ON lookup:
--   SELECT DISTINCT ON (country_code, city_id, category_id) ...
--   WHERE snapshotted_at <= NOW() - interval '30 days'
--   ORDER BY country_code, city_id, category_id, snapshotted_at DESC
CREATE INDEX IF NOT EXISTS idx_mss_market_time
  ON market_supply_snapshots (country_code, city_id, category_id, snapshotted_at DESC);
