-- Migration: 0001_production_readiness_indexes
-- Applied: 2026-07-16
-- Purpose: Add missing foreign-key indexes for production performance
--
-- All statements use CREATE INDEX IF NOT EXISTS — safe to re-run (idempotent).
-- No data is modified; no tables are dropped or recreated.
-- These indexes were applied directly via psql on 2026-07-16 as part of the
-- production-readiness audit. They are tracked here for documentation.
--
-- Impact:
--   offices.user_id            — hit on every session lookup (login, auth check)
--   office_media.office_id     — hit on every office profile load
--   office_services.office_id  — hit on every office profile + list
--   office_verification_documents.office_id — admin application review
--   office_admin_notes.office_id — admin application review
--   assistant_analytics_events.conversation_id — assistant analytics queries
--   audit_log.created_at       — admin activity log (ordered by time)
--   contact_events.created_at  — contact analytics date-range queries

BEGIN;

CREATE INDEX IF NOT EXISTS idx_offices_user_id
  ON offices (user_id);

CREATE INDEX IF NOT EXISTS idx_office_media_office_id
  ON office_media (office_id);

CREATE INDEX IF NOT EXISTS idx_office_services_office_id
  ON office_services (office_id);

CREATE INDEX IF NOT EXISTS idx_office_verification_documents_office_id
  ON office_verification_documents (office_id);

CREATE INDEX IF NOT EXISTS idx_office_admin_notes_office_id
  ON office_admin_notes (office_id);

CREATE INDEX IF NOT EXISTS idx_assistant_analytics_events_conversation_id
  ON assistant_analytics_events (conversation_id);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
  ON audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contact_events_created_at_only
  ON contact_events (created_at DESC);

COMMIT;
