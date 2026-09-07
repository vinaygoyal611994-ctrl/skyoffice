---
name: Audit Phase 1 Migration (July 2026)
description: Migration 0009_audit_phase1 — what it contains, how it was applied, and constraints added
---

## Migration 0009_audit_phase1

Applied to dev database July 24, 2026. Contains:

**New indexes:**
- `idx_offices_status_provider_type` on offices(status, provider_type)
- `idx_offices_city` on offices(city)
- `idx_offices_reviewed_by` on offices(reviewed_by)
- `idx_office_admin_notes_created_by` on office_admin_notes(created_by)
- `idx_contact_events_customer_user_id` on contact_events(customer_user_id)
- `idx_contact_events_office_id` on contact_events(office_id)
- `idx_video_call_requests_customer_user_id` on video_call_requests(customer_user_id)
- `idx_video_call_requests_office_id` on video_call_requests(office_id)
- `idx_favourites_office_id` on favourites(office_id)
- `idx_password_reset_tokens_user_id` on password_reset_tokens(user_id)

Note: idx_offices_user_id, idx_office_media_office_id, idx_office_services_office_id,
idx_office_verification_documents_office_id, idx_office_admin_notes_office_id were
already created in migration 0001 — they are declared in the Drizzle schema for
completeness but NOT re-created in 0009.

**New columns:**
- `users.updated_at` TIMESTAMPTZ NOT NULL DEFAULT NOW() (back-filled from created_at)
- `office_media.updated_at` TIMESTAMPTZ NOT NULL DEFAULT NOW() (back-filled from created_at)

**New FK constraints:**
- `office_admin_notes_created_by_fkey`: created_by → users(id) ON DELETE SET NULL
- `offices_reviewed_by_fkey`: reviewed_by → users(id) ON DELETE SET NULL

**Schema changes (Drizzle TypeScript):**
- `officeAdminNotesTable.createdBy`: was `.notNull()`, now nullable with FK. This makes `InsertOfficeAdminNote.createdBy` optional in TS — callers still pass a value, they just don't get a compile error if they don't.
- `officesTable.reviewedBy`: added `.references(() => usersTable.id, { onDelete: "set null" })`
- All table schemas now declare their indexes in the second argument for drizzle-kit completeness.
- `insertOfficeMediaSchema` now omits `updatedAt`.
- `insertUserSchema` now omits `updatedAt`.

**Serializer fix:**
- `officeSerializer.ts` `serializeAdminNote` parameter type changed from `createdBy: number` to `createdBy: number | null`

**Migration runner notes:**
- `ADD CONSTRAINT IF NOT EXISTS` is NOT valid PostgreSQL syntax — only `CREATE INDEX IF NOT EXISTS` works. Constraint additions must use plain `ADD CONSTRAINT name ...`.
- Migration 0008 (assistant table drops) was stamped but never applied to the dev DB, so it needed stamping before 0009 could run: `pnpm --filter scripts exec tsx src/stamp-migration.ts 0008_remove_assistant_tables`

**Production:**
- Run migration against production DB before deploying code changes.
- Production DB had an automated backup at backups/skayoffice-20260723_231113.sql.gz before these changes.
