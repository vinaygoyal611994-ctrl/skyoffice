-- 0037_upload_claims.sql
-- Binds every presigned office upload to one short-lived, single-use claim.

CREATE TABLE IF NOT EXISTS upload_claims (
  id          SERIAL       PRIMARY KEY,
  user_id     INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  office_id   INTEGER      NOT NULL,
  object_path TEXT         NOT NULL,
  category    TEXT         NOT NULL,
  expires_at  TIMESTAMPTZ  NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS upload_claims_object_path_idx
  ON upload_claims (object_path);
CREATE INDEX IF NOT EXISTS idx_upload_claims_user_id
  ON upload_claims (user_id);
CREATE INDEX IF NOT EXISTS idx_upload_claims_expires_at
  ON upload_claims (expires_at);