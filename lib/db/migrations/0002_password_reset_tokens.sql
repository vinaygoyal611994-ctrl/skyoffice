-- Migration: 0002_password_reset_tokens
-- Applied: 2026-07-16
-- Purpose: Add password_reset_tokens table for secure password recovery
--
-- Security design:
--   - Only a SHA-256 hash of the raw token is stored — the raw token is never
--     persisted anywhere and is only ever sent to the user's registered email.
--   - requested_ip_hash stores a one-way hash of the requester's IP for audit
--     purposes only; no raw IP is stored.
--   - used_at records when the token was consumed; NULL = still valid.
--   - A CASCADE DELETE on user_id ensures tokens are removed when a user is
--     deleted, preventing orphaned sensitive rows.
--
-- Safe to re-run: all statements use IF NOT EXISTS.

BEGIN;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash        TEXT NOT NULL,
  expires_at        TIMESTAMPTZ NOT NULL,
  used_at           TIMESTAMPTZ,
  requested_ip_hash TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup by user_id (invalidating previous tokens on new request)
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id
  ON password_reset_tokens (user_id);

-- Fast lookup by token_hash (token verification on reset)
CREATE UNIQUE INDEX IF NOT EXISTS idx_password_reset_tokens_token_hash
  ON password_reset_tokens (token_hash);

-- Fast cleanup of expired tokens
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at
  ON password_reset_tokens (expires_at);

COMMIT;
