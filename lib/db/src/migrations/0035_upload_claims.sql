-- 0035_upload_claims.sql
-- Adds the upload_claims table for presigned-URL security binding.
--
-- PURPOSE:
--   When the API mints a presigned S3 PUT URL it simultaneously creates a
--   short-lived "claim" row that binds the generated object path to the
--   requesting user, their office, and the declared upload category.
--
--   Before registering an uploaded file into office_media,
--   office_verification_documents, or as a marketing-video / quick-card-cover,
--   the API validates and consumes the claim:
--     1. The claim's object_path matches the submitted objectPath.
--     2. The claim's office_id matches the requesting user's office.
--     3. The claim's category is compatible with the registration endpoint.
--     4. expires_at > NOW() (claim has not expired).
--
--   On success the claim row is deleted, preventing replay attacks.
--   Background sweeper prunes stale expired rows periodically.
--
-- TTL: 15 minutes (expiresAt = NOW() + INTERVAL '15 minutes' at issuance).

CREATE TABLE IF NOT EXISTS upload_claims (
  id          SERIAL       PRIMARY KEY,
  user_id     INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  office_id   INTEGER      NOT NULL,
  object_path TEXT         NOT NULL,
  category    TEXT         NOT NULL,
  expires_at  TIMESTAMPTZ  NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- One row per object path — prevents two claims for the same upload.
CREATE UNIQUE INDEX IF NOT EXISTS upload_claims_object_path_idx
  ON upload_claims (object_path);

-- Fast ownership lookup.
CREATE INDEX IF NOT EXISTS idx_upload_claims_user_id
  ON upload_claims (user_id);

-- Sweeper / expiry query.
CREATE INDEX IF NOT EXISTS idx_upload_claims_expires_at
  ON upload_claims (expires_at);
