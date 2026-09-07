-- Migration 0010: Service Requests feature
--
-- Adds the two tables that power the customer→office service-request workflow:
--   service_requests     — lifecycle from submit through completion
--   service_request_reviews — one verified evaluation per completed request
--
-- All statements use IF NOT EXISTS / IF NOT EXISTS guards → idempotent.

-- ── service_requests ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS service_requests (
  id                       SERIAL PRIMARY KEY,
  customer_id              INTEGER NOT NULL
                             REFERENCES users(id) ON DELETE CASCADE,
  office_id                INTEGER NOT NULL
                             REFERENCES offices(id) ON DELETE CASCADE,
  service_name             TEXT NOT NULL,
  description              TEXT NOT NULL,
  price                    TEXT,
  execution_duration       TEXT,
  status                   TEXT NOT NULL DEFAULT 'submitted'
                             CHECK (status IN (
                               'submitted',
                               'offer_sent',
                               'agreed',
                               'awaiting_customer_confirmation',
                               'completed',
                               'rejected',
                               'not_completed'
                             )),
  office_completed_at      TIMESTAMPTZ,
  customer_confirmed_at    TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_service_requests_customer_id
  ON service_requests (customer_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_service_requests_office_id
  ON service_requests (office_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_service_requests_status
  ON service_requests (status);

-- ── service_request_reviews ──────────────────────────────────────────────────
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS service_request_reviews (
  id               SERIAL PRIMARY KEY,
  request_id       INTEGER NOT NULL UNIQUE
                     REFERENCES service_requests(id) ON DELETE CASCADE,
  customer_id      INTEGER NOT NULL
                     REFERENCES users(id) ON DELETE CASCADE,
  was_completed    TEXT NOT NULL CHECK (was_completed    IN ('yes', 'no')),
  would_recommend  TEXT NOT NULL CHECK (would_recommend  IN ('yes', 'no')),
  response_speed   INTEGER NOT NULL CHECK (response_speed BETWEEN 1 AND 5),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_service_request_reviews_customer_id
  ON service_request_reviews (customer_id);
