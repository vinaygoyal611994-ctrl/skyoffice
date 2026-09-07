-- 0038_provider_verification_and_sr_notifications.sql
-- Basic provider verification plus durable service-request notification outbox.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS provider_verification_tokens (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel      TEXT        NOT NULL CHECK (channel IN ('email', 'phone')),
  token_hash   TEXT        NOT NULL,
  contact      TEXT        NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prov_verif_tokens_user_channel
  ON provider_verification_tokens (user_id, channel);

CREATE TABLE IF NOT EXISTS service_request_notification_outbox (
  id                  SERIAL PRIMARY KEY,
  service_request_id  INTEGER     NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  recipient_user_id   INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_role      TEXT        NOT NULL CHECK (recipient_role IN ('customer', 'office')),
  notification_type   TEXT        NOT NULL CHECK (notification_type IN (
    'sr_submitted',
    'sr_offer_sent',
    'sr_offer_accepted',
    'sr_offer_rejected',
    'sr_rejected',
    'sr_completed_awaiting_confirm',
    'sr_confirmed_completed',
    'sr_not_completed'
  )),
  status              TEXT        NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  attempts            INTEGER     NOT NULL DEFAULT 0,
  last_error          TEXT,
  next_attempt_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sr_notif_outbox_due
  ON service_request_notification_outbox (next_attempt_at, status, attempts)
  WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS idx_sr_notif_outbox_recipient
  ON service_request_notification_outbox (recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_sr_notif_outbox_sr_id
  ON service_request_notification_outbox (service_request_id);