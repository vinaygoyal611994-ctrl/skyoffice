-- 0033_payment_foundation.sql
-- Payment transaction ledger for SkayOffice subscription checkout.
--
-- Each row tracks one payment attempt end-to-end: from checkout session creation
-- through Stripe webhook confirmation (or failure).
--
-- Idempotency is enforced at three levels:
--   1. idempotency_key (UNIQUE): prevents duplicate checkout sessions per billing cycle
--   2. gateway_session_id (UNIQUE): prevents duplicate webhook processing per session
--   3. gateway_event_id (UNIQUE): prevents duplicate Stripe event delivery
--
-- status enum:
--   pending       — checkout session created; awaiting webhook
--   succeeded     — payment confirmed by Stripe webhook; subscription activated
--   failed        — Stripe reported payment failure
--   cancelled     — checkout session cancelled or gateway error before completion
--   failed_no_slot — payment succeeded at Stripe but slot had expired by webhook time

CREATE TABLE IF NOT EXISTS office_payment_transactions (
  id                         SERIAL PRIMARY KEY,
  office_id                  INTEGER NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  subscription_id            INTEGER REFERENCES office_subscriptions(id) ON DELETE SET NULL,
  plan_id                    INTEGER REFERENCES plans(id) ON DELETE SET NULL,
  -- reservation_id references market_slot_allocations.id; nullable (NULL for renewals
  -- in uncapped markets where no slot reservation is required)
  reservation_id             INTEGER REFERENCES market_slot_allocations(id) ON DELETE SET NULL,
  amount_halalas             INTEGER NOT NULL CHECK (amount_halalas > 0),
  currency                   TEXT NOT NULL DEFAULT 'SAR',
  gateway                    TEXT NOT NULL DEFAULT 'stripe',
  -- Stripe Checkout session ID (cs_test_... / cs_live_...)
  gateway_session_id         TEXT NOT NULL UNIQUE,
  -- Payment intent ID populated when webhook arrives
  gateway_payment_intent_id  TEXT UNIQUE,
  -- Stripe event ID — primary webhook idempotency key
  gateway_event_id           TEXT UNIQUE,
  -- Application-level idempotency: {officeId}:{planId}:{YYYY-MM}
  idempotency_key            TEXT NOT NULL UNIQUE,
  status                     TEXT NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','succeeded','failed','cancelled','failed_no_slot')),
  -- Set when status transitions to succeeded
  paid_at                    TIMESTAMPTZ,
  -- Set when status transitions to failed / failed_no_slot
  failed_at                  TIMESTAMPTZ,
  failure_reason             TEXT,
  -- Extensible metadata: renewal path flag, billing month, etc.
  metadata                   JSONB,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup by office for status page and admin history
CREATE INDEX IF NOT EXISTS idx_payment_txn_office_status
  ON office_payment_transactions (office_id, status);

-- Fast lookup by session ID (webhook processing path)
CREATE INDEX IF NOT EXISTS idx_payment_txn_session
  ON office_payment_transactions (gateway_session_id);

-- Fast lookup of stuck pending payments (health check)
CREATE INDEX IF NOT EXISTS idx_payment_txn_pending_created
  ON office_payment_transactions (created_at)
  WHERE status = 'pending';

-- Seed the Stripe webhook secret into system_config.
-- Starts empty; the admin must set it via the Replit Secrets panel (STRIPE_WEBHOOK_SECRET).
INSERT INTO system_config (key, value, description)
VALUES (
  'stripe_webhook_secret',
  '',
  'Stripe webhook signing secret (whsec_...). Set via STRIPE_WEBHOOK_SECRET environment variable — this row is a placeholder only.'
)
ON CONFLICT (key) DO NOTHING;
