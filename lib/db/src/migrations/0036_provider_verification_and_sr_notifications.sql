-- Migration 0036: Provider email/phone verification + service-request notification outbox
--
-- Blocker 8: Provider email/phone verification gate
--   • Adds email_verified_at / phone_verified_at columns to users table (nullable,
--     backwards-compatible). Office accounts must verify their email before their
--     application can be submitted for admin review.
--   • Adds provider_verification_tokens table for time-limited OTP codes (hashed).
--
-- Blocker 9: Durable service-request lifecycle notifications
--   • service_request_notification_outbox — exactly-once delivery of SR lifecycle
--     emails. Rows are inserted atomically inside the status-change transaction so
--     the notification is guaranteed to be delivered even if the server crashes.
--   • Status enum: pending | sent | failed | skipped
--   • Notification types cover all observable SR lifecycle events for both parties.
--   • Retry with exponential backoff; permanently failed after 5 attempts.

-- ── Part 1: Verification columns on users ────────────────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS phone_verified_at  TIMESTAMPTZ;

-- ── Part 2: Provider verification tokens ─────────────────────────────────────
-- Each row is a one-time code (OTP) for verifying an email address or phone number.
-- The raw token is never stored — only its SHA-256 hash. A token is valid when:
--   used_at IS NULL AND expires_at > NOW()
-- Expired/used rows are periodically pruned by the cleanup worker.

CREATE TABLE IF NOT EXISTS provider_verification_tokens (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 'email' or 'phone' — which channel this token verifies
  channel      TEXT        NOT NULL CHECK (channel IN ('email', 'phone')),
  -- SHA-256 of the raw 6-digit OTP code; raw code is never stored
  token_hash   TEXT        NOT NULL,
  -- The contact address this token was sent to (email address or E.164 phone)
  contact      TEXT        NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One valid token per user per channel at a time: all previous unused tokens
-- for the same (user_id, channel) pair are invalidated before issuing a new one.
CREATE INDEX IF NOT EXISTS idx_prov_verif_tokens_user_channel
  ON provider_verification_tokens (user_id, channel);

-- ── Part 3: Service-request notification outbox ───────────────────────────────
-- One row per lifecycle event per party. Inserted atomically with the status change.
-- Exactly-once delivery via FOR UPDATE SKIP LOCKED in the outbox worker.

CREATE TABLE IF NOT EXISTS service_request_notification_outbox (
  id                  SERIAL PRIMARY KEY,

  -- Which service request this notification is about
  service_request_id  INTEGER     NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,

  -- Which user should receive the notification (customerId or officeUserId)
  recipient_user_id   INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Which role the recipient is playing in this notification
  recipient_role      TEXT        NOT NULL CHECK (recipient_role IN ('customer', 'office')),

  -- Lifecycle event that triggered this notification
  notification_type   TEXT        NOT NULL CHECK (notification_type IN (
    'sr_submitted',                    -- office: new request received
    'sr_offer_sent',                   -- customer: office sent an offer
    'sr_offer_accepted',               -- office: customer accepted the offer
    'sr_offer_rejected',               -- office: customer rejected the offer
    'sr_rejected',                     -- customer: office rejected the request
    'sr_completed_awaiting_confirm',   -- customer: office marked done, awaiting your confirmation
    'sr_confirmed_completed',          -- office: customer confirmed completion
    'sr_not_completed'                 -- office: customer flagged as not completed
  )),

  -- Delivery lifecycle
  status              TEXT        NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),

  -- Number of send attempts (0 = not yet tried)
  attempts            INTEGER     NOT NULL DEFAULT 0,

  -- Last error description (sanitised, ≤500 chars)
  last_error          TEXT,

  -- Earliest time the worker should attempt delivery
  next_attempt_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Populated when status transitions to 'sent' or 'skipped'
  sent_at             TIMESTAMPTZ
);

-- Worker scan index: fetch due notifications efficiently
CREATE INDEX IF NOT EXISTS idx_sr_notif_outbox_due
  ON service_request_notification_outbox (next_attempt_at, status, attempts)
  WHERE status IN ('pending', 'failed');

-- Recipient user lookup (admin queries, cascade awareness)
CREATE INDEX IF NOT EXISTS idx_sr_notif_outbox_recipient
  ON service_request_notification_outbox (recipient_user_id);

-- Service-request lookup (e.g. cancel all pending notifications for a deleted SR)
CREATE INDEX IF NOT EXISTS idx_sr_notif_outbox_sr_id
  ON service_request_notification_outbox (service_request_id);
