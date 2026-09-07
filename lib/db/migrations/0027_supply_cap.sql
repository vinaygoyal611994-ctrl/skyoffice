-- Migration: 0027_supply_cap
-- Extends market_supply_control with admin-controlled supply caps and
-- cap intelligence recommendation fields.
-- Creates market_supply_cap_history for immutable cap decision audit trail.
--
-- Design principles:
--   - supply_cap is ONLY changed by explicit admin actions (set cap, approve
--     recommendation).  The scheduled intelligence recompute NEVER writes to it.
--   - recommended_supply_cap is advisory only; overwritten each recompute.
--   - cap_status is a denormalised convenience field, updated whenever supply
--     or cap changes so the admin list can sort/filter without re-computing.
--   - Slot consumers = status IN ('approved', 'active') AND is_demo = false.
--     under_review / draft / rejected / suspended do NOT consume slots.
--   - When supply > cap (admin reduced cap): cap_status = 'over_cap'.
--     No existing providers are removed; natural attrition restores balance.

-- ── Cap control columns ────────────────────────────────────────────────────────
ALTER TABLE market_supply_control
  ADD COLUMN IF NOT EXISTS supply_cap               integer,
  ADD COLUMN IF NOT EXISTS cap_status               text NOT NULL DEFAULT 'available',
  ADD COLUMN IF NOT EXISTS cap_source               text,
  ADD COLUMN IF NOT EXISTS cap_updated_at           timestamptz,
  ADD COLUMN IF NOT EXISTS cap_updated_by           integer REFERENCES users(id) ON DELETE SET NULL,
  -- Intelligence recommendation (advisory only; never auto-applied)
  ADD COLUMN IF NOT EXISTS recommended_supply_cap       integer,
  ADD COLUMN IF NOT EXISTS recommended_cap_change        integer,
  ADD COLUMN IF NOT EXISTS cap_recommendation_reason     text,
  ADD COLUMN IF NOT EXISTS cap_recommendation_confidence real,
  ADD COLUMN IF NOT EXISTS cap_recommendation_computed_at timestamptz;

-- Partial index: quickly find markets that have a cap set
CREATE INDEX IF NOT EXISTS idx_msc_supply_cap
  ON market_supply_control (supply_cap)
  WHERE supply_cap IS NOT NULL;

-- ── Supply cap history (immutable audit trail) ─────────────────────────────────
-- Append-only.  Every cap change writes a new row.
-- Decision context (recommended_cap, confidence) is snapshotted at decision time.
CREATE TABLE IF NOT EXISTS market_supply_cap_history (
  id                        serial       PRIMARY KEY,
  country_code              text         NOT NULL,
  city_id                   text         NOT NULL,
  category_id               text         NOT NULL,
  previous_cap              integer,
  new_cap                   integer      NOT NULL,
  action_type               text         NOT NULL,
  -- action_type values:
  --   set_initial                    — first cap ever set for this market
  --   admin_adjustment               — admin manually changed an existing cap
  --   approved_recommendation        — admin approved intelligence recommendation
  --   rejected_recommendation        — admin rejected recommendation (cap unchanged)
  --   removed                        — cap removed (market becomes uncapped)
  changed_by                integer      REFERENCES users(id) ON DELETE SET NULL,
  reason                    text,
  recommended_cap           integer,     -- recommendation at decision time (if any)
  recommendation_confidence real,
  current_active_supply     integer,     -- slot consumers at decision time
  created_at                timestamptz  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_msch_market
  ON market_supply_cap_history (country_code, city_id, category_id, created_at DESC);
