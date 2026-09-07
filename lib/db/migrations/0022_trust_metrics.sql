-- Migration 0022: Trust metrics — first_response_at, nullable response_speed,
-- zero out legacy seeded completed_transactions / clients_recommend_percent
-- on non-demo offices.
--
-- Additive only for new columns. Re-runnable: ADD COLUMN IF NOT EXISTS,
-- DROP CONSTRAINT IF EXISTS, ADD CONSTRAINT are all idempotent.

-- 1. Add first_response_at to service_requests.
--    Set exactly once by the application when the office sends their first offer.
--    NULL means the office has not yet responded.
ALTER TABLE service_requests
  ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ;

--> statement-breakpoint

-- 2. Allow response_speed to be NULL in service_request_reviews.
--    Existing reviews keep their 1–5 value (no data loss).
--    New reviews omit this field — response speed is now derived automatically
--    from first_response_at - created_at.
ALTER TABLE service_request_reviews
  ALTER COLUMN response_speed DROP NOT NULL;

--> statement-breakpoint

-- 3. Replace the strict 1–5 CHECK with a NULL-permissive version.
ALTER TABLE service_request_reviews
  DROP CONSTRAINT IF EXISTS service_request_reviews_response_speed_check;

--> statement-breakpoint

ALTER TABLE service_request_reviews
  ADD CONSTRAINT service_request_reviews_response_speed_check
    CHECK (response_speed IS NULL OR response_speed BETWEEN 1 AND 5);

--> statement-breakpoint

-- 4. Zero out legacy seeded values on non-demo offices.
--    These columns are no longer returned by the public API.
--    Demo offices (is_demo = true) keep their display values for
--    admin / demonstration scenarios.
UPDATE offices
   SET completed_transactions    = 0,
       clients_recommend_percent = 0
 WHERE is_demo IS DISTINCT FROM true
   AND (completed_transactions > 0 OR clients_recommend_percent > 0);
