-- Add legal-consent tracking columns to users table.
-- All four columns are nullable so existing accounts are unaffected.
-- New registrations populate them at sign-up time with version "1.0".
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "terms_accepted_at"       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "privacy_accepted_at"     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "accepted_terms_version"  TEXT,
  ADD COLUMN IF NOT EXISTS "accepted_privacy_version" TEXT;
