-- Migration 0009: Audit Phase 1 — indexes, additive columns, FK constraints
-- Applied as part of the July 2026 architecture and code quality audit.
--
-- All statements are ADDITIVE:
--   - No tables dropped or truncated
--   - No columns dropped
--   - IF NOT EXISTS guards make every statement idempotent
--
-- Sections:
--   A. Missing indexes on FK columns and common filter columns
--   B. Add updated_at to users (tracks password/status/role changes)
--   C. Add updated_at to office_media (tracks admin approval status changes)
--   D. office_admin_notes.created_by — drop NOT NULL, add FK with SET NULL
--   E. offices.reviewed_by — add FK with SET NULL

-- ── A. Indexes ───────────────────────────────────────────────────────────────
-- Note: idx_offices_user_id, idx_office_media_office_id,
-- idx_office_services_office_id, idx_office_verification_documents_office_id,
-- and idx_office_admin_notes_office_id were already created in migration 0001.
-- They are declared in the Drizzle schema for completeness but not re-created here.

CREATE INDEX IF NOT EXISTS idx_offices_status_provider_type
  ON offices (status, provider_type);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_offices_city
  ON offices (city);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_offices_reviewed_by
  ON offices (reviewed_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_office_admin_notes_created_by
  ON office_admin_notes (created_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_contact_events_customer_user_id
  ON contact_events (customer_user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_contact_events_office_id
  ON contact_events (office_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_video_call_requests_customer_user_id
  ON video_call_requests (customer_user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_video_call_requests_office_id
  ON video_call_requests (office_id);
--> statement-breakpoint
-- favourites: the unique constraint on (customer_user_id, office_id) already
-- covers queries filtering by customer_user_id alone. Add office_id index for
-- reverse lookups.
CREATE INDEX IF NOT EXISTS idx_favourites_office_id
  ON favourites (office_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id
  ON password_reset_tokens (user_id);

-- ── B. Add updated_at to users ───────────────────────────────────────────────
--> statement-breakpoint
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
--> statement-breakpoint
-- Back-fill existing rows: use created_at as the initial updated_at value.
UPDATE users SET updated_at = created_at WHERE updated_at IS NULL;
--> statement-breakpoint
ALTER TABLE users
  ALTER COLUMN updated_at SET NOT NULL;
--> statement-breakpoint
ALTER TABLE users
  ALTER COLUMN updated_at SET DEFAULT NOW();

-- ── C. Add updated_at to office_media ───────────────────────────────────────
--> statement-breakpoint
ALTER TABLE office_media
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
--> statement-breakpoint
UPDATE office_media SET updated_at = created_at WHERE updated_at IS NULL;
--> statement-breakpoint
ALTER TABLE office_media
  ALTER COLUMN updated_at SET NOT NULL;
--> statement-breakpoint
ALTER TABLE office_media
  ALTER COLUMN updated_at SET DEFAULT NOW();

-- ── D. office_admin_notes.created_by: drop NOT NULL, add FK ─────────────────
-- Notes are kept even when the admin account is deleted; created_by becomes
-- NULL in that case (audit trail preserved, no orphaned integer reference).
--> statement-breakpoint
ALTER TABLE office_admin_notes
  ALTER COLUMN created_by DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE office_admin_notes
  ADD CONSTRAINT office_admin_notes_created_by_fkey
  FOREIGN KEY (created_by)
  REFERENCES users(id)
  ON DELETE SET NULL;

-- ── E. offices.reviewed_by: add FK ──────────────────────────────────────────
-- Column is already nullable; just add the referential constraint.
--> statement-breakpoint
ALTER TABLE offices
  ADD CONSTRAINT offices_reviewed_by_fkey
  FOREIGN KEY (reviewed_by)
  REFERENCES users(id)
  ON DELETE SET NULL;
