-- Migration 0023: Analytics Data Quality (Phase 1)
--
-- Fixes identified in the production analytics audit:
--   1. is_internal on users — marks seed/QA/admin accounts so they can be
--      excluded from business metrics without scattered email-pattern checks.
--   2. is_self_view on analytics_events — server-set flag when an office owner
--      views their own profile; excluded from discovery/reach metrics.
--   3. is_internal_actor on analytics_events — denormalised flag copied from
--      users.is_internal at write time; avoids joins in every aggregation query.
--   4. Business-events partial index — fast scans over the clean event set.
--   5. service_requests FK: CASCADE → RESTRICT — deleting a user who has
--      submitted requests is now blocked; prevents silent history corruption.
--   6. service_request_reviews FK: CASCADE → RESTRICT — same protection for
--      review history.
--
-- All changes are additive / constraint-tightening. No data is deleted.

-- ── 1. Internal-actor flag on users ──────────────────────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT false;

-- Mark all @skayoffice.demo accounts (seed / QA / admin).
-- New internal accounts must be updated here manually or via admin tooling.
UPDATE users
SET is_internal = true
WHERE email LIKE '%@skayoffice.demo';

-- ── 2. Quality flags on analytics_events ─────────────────────────────────────

ALTER TABLE analytics_events
  ADD COLUMN IF NOT EXISTS is_self_view BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE analytics_events
  ADD COLUMN IF NOT EXISTS is_internal_actor BOOLEAN NOT NULL DEFAULT false;

-- ── 3. Partial index covering only business-grade events ──────────────────────
-- Used by aggregation queries to avoid full-table scans over bots / self-views
-- / internal actors. All three conditions must be false for an event to count.

CREATE INDEX IF NOT EXISTS idx_ae_business_events
  ON analytics_events (event_name, occurred_at DESC)
  WHERE is_bot = false
    AND is_self_view = false
    AND is_internal_actor = false;

-- ── 4. Protect service-request history from user deletion ────────────────────
-- Change: ON DELETE CASCADE → ON DELETE RESTRICT
-- Rationale: Deleting a user who has service requests would silently remove
-- completed transaction history, corrupting trust metrics and platform totals.
-- RESTRICT forces explicit data-management decisions before user deletion.

ALTER TABLE service_requests
  DROP CONSTRAINT IF EXISTS service_requests_customer_id_fkey;

ALTER TABLE service_requests
  ADD CONSTRAINT service_requests_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE RESTRICT;

-- ── 5. Protect review history from user deletion ──────────────────────────────

ALTER TABLE service_request_reviews
  DROP CONSTRAINT IF EXISTS service_request_reviews_customer_id_fkey;

ALTER TABLE service_request_reviews
  ADD CONSTRAINT service_request_reviews_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE RESTRICT;
