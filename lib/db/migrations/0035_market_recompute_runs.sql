-- 0035_market_recompute_runs.sql
-- Adds market_recompute_runs table for tracking market recompute job history.
--
-- PURPOSE:
--   Every runMarketRecompute() invocation (scheduled or manual) records a row
--   here.  Enables Platform Health to surface last-run, last-success,
--   consecutive-failures, and advisory-lock-skip events without scraping logs.
--
-- STATUS LIFECYCLE:
--   running   → completed  (normal success)
--   running   → failed     (exception thrown)
--   running   → skipped    (advisory lock already held by another instance)
--
-- SKIP REASON:
--   lock_busy — another instance held the advisory lock at acquire time.
--   (The scheduler's staleness-skip is a pre-flight guard; it never creates a run row.)

CREATE TABLE IF NOT EXISTS market_recompute_runs (
  id               SERIAL      PRIMARY KEY,
  triggered_by     TEXT        NOT NULL,          -- 'scheduled' | 'admin'
  status           TEXT        NOT NULL DEFAULT 'running',
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ,
  failed_at        TIMESTAMPTZ,
  skipped_at       TIMESTAMPTZ,
  duration_ms      INTEGER,
  markets_upserted INTEGER,
  -- Truncated at write time (500 chars); never contains stack traces or credentials.
  error_message    TEXT,
  skip_reason      TEXT,                          -- 'lock_busy'

  CONSTRAINT market_recompute_runs_status_check
    CHECK (status IN ('running', 'completed', 'failed', 'skipped')),

  CONSTRAINT market_recompute_runs_trigger_check
    CHECK (triggered_by IN ('scheduled', 'admin'))
);

CREATE INDEX IF NOT EXISTS market_recompute_runs_started_at_idx
  ON market_recompute_runs (started_at DESC);

CREATE INDEX IF NOT EXISTS market_recompute_runs_status_idx
  ON market_recompute_runs (status, started_at DESC);
