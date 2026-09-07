-- 0039_provider_verification_attempt_guards.sql
-- Persist OTP failures so confirmation cannot be brute-forced or consumed twice.

ALTER TABLE provider_verification_tokens
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS uq_prov_verif_tokens_active_user_channel
  ON provider_verification_tokens (user_id, channel)
  WHERE used_at IS NULL;