-- Migration 0020: Media placement & independent approval status
-- All changes are additive (ADD COLUMN IF NOT EXISTS). Safe to re-run.
--
-- Legacy fallback rules (document for operators applying to production):
--   quick_card_cover    -> offices.cover_url (approved) / offices.pending_quick_card_cover (pending)
--   decision_card_cover -> office_media WHERE placement='decision_card_cover' AND status='approved'
--                          FALLBACK: offices.hero_media_url (legacy, untouched)
--   decision_gallery    -> office_media WHERE placement='decision_gallery' AND status='approved'
--   shared_identity     -> offices.logo_url (no approval gate; applies immediately)
--
-- Existing office_media rows default to placement='decision_gallery', status='approved' -- no data loss.
-- Existing offices rows get the three new columns as NULL (no pending media until submitted).

ALTER TABLE office_media
  ADD COLUMN IF NOT EXISTS placement        TEXT NOT NULL DEFAULT 'decision_gallery',
  ADD COLUMN IF NOT EXISTS status           TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

ALTER TABLE offices
  ADD COLUMN IF NOT EXISTS pending_quick_card_cover        TEXT,
  ADD COLUMN IF NOT EXISTS pending_media_submitted_at      TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS pending_media_rejection_reason  TEXT;
