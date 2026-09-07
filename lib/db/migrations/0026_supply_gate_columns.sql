-- Migration: 0026_supply_gate_columns
-- Adds Supply Control gate columns to the offices table.
--
-- These columns record the outcome of the market gate check at submit time,
-- and any admin override that explicitly allows a specific provider to apply
-- despite a closed market status.
--
-- Design:
--   supply_gate_status     — outcome recorded when the application was submitted.
--                            NULL = office has never been submitted, or submitted
--                            before this migration (pre-gate applications).
--   supply_gate_market_key — the exact market key checked, e.g. "SA|riyadh|marketing".
--                            NULL when status is null or 'no_data'.
--   supply_gate_override_* — populated only when an admin explicitly overrides
--                            the gate for this specific office.  Does not change
--                            the market-level acceptance_status.
--
-- Safeguards enforced at API layer (not DB CHECK) because the enum lives in
-- application code and adding/removing values should not require a migration:
--   supply_gate_status IN ('allowed', 'limited', 'blocked', 'no_data')

ALTER TABLE offices
  ADD COLUMN IF NOT EXISTS supply_gate_status        text,
  ADD COLUMN IF NOT EXISTS supply_gate_market_key    text,
  ADD COLUMN IF NOT EXISTS supply_gate_override_by   integer REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS supply_gate_override_at   timestamptz,
  ADD COLUMN IF NOT EXISTS supply_gate_override_reason text;

-- Index for admin queries: "show me all limited-market applications"
CREATE INDEX IF NOT EXISTS idx_offices_supply_gate_status
  ON offices (supply_gate_status)
  WHERE supply_gate_status IS NOT NULL;
