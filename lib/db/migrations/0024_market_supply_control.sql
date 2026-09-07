-- Migration 0024: Market Supply Control
--
-- Creates the market_supply_control table used by the Market Decision
-- Intelligence feature.  One row per (country_code, city_id, category_id).
-- The acceptance_mode, acceptance_status and pending_recommendation columns
-- drive admin-controlled supply decisions.  No existing table or column is
-- modified; this migration is fully additive.

CREATE TABLE IF NOT EXISTS market_supply_control (
  id                      SERIAL PRIMARY KEY,

  -- Market key (uniqueness enforced below)
  country_code            TEXT        NOT NULL,
  city_id                 TEXT        NOT NULL,
  category_id             TEXT        NOT NULL,

  -- Admin-controlled mode (automatic is reserved but never set in v1)
  acceptance_mode         TEXT        NOT NULL DEFAULT 'manual'
    CHECK (acceptance_mode IN ('manual', 'assisted')),

  -- Market-level classification from the signal engine
  market_status           TEXT,

  -- Admin-approved acceptance decision
  acceptance_status       TEXT        NOT NULL DEFAULT 'open'
    CHECK (acceptance_status IN ('recruit', 'open', 'limited', 'closed')),

  -- Latest pending recommendation from compute (awaiting admin decision)
  pending_recommendation  TEXT,
  recommended_action      TEXT,
  target_supply           INTEGER,
  current_active_supply   INTEGER,
  confidence_score        REAL,
  recommendation_reason   TEXT,

  -- When the last compute ran
  last_computed_at        TIMESTAMPTZ,

  -- Full signal snapshot stored as JSONB for auditability
  signals_snapshot        JSONB,

  -- Last admin review
  last_reviewed_at        TIMESTAMPTZ,
  admin_review_decision   TEXT
    CHECK (admin_review_decision IN ('approved', 'rejected', 'monitoring', NULL)),
  admin_reviewed_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  admin_review_note       TEXT,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS market_supply_control_market_unique
  ON market_supply_control (country_code, city_id, category_id);

CREATE INDEX IF NOT EXISTS idx_msc_city_id
  ON market_supply_control (city_id);

CREATE INDEX IF NOT EXISTS idx_msc_market_status
  ON market_supply_control (market_status);
