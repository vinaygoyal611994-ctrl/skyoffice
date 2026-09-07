# SkayOffice — Database Migration Runbook

**Version:** 1.0
**Applies to:** Production schema changes
**Owner:** Engineering
**Review:** Before every production deployment that includes schema changes

> **Critical rule:** Never run `drizzle-kit push` against production.
> Never write or run custom DDL scripts against production directly.
> The Replit Publish flow (see Section 2) is the only supported path for
> applying schema changes to the production database.

---

## 1. How Schema Migrations Work in This Codebase

This project uses [Drizzle ORM](https://orm.drizzle.team/) with a
**migration-file-based** workflow. The canonical flow is:

```
Edit lib/db/src/schema/*.ts
  ↓
pnpm --filter @workspace/db run generate
  (creates a new SQL file in lib/db/src/migrations/)
  ↓
Review the generated SQL
  ↓
Commit the SQL file to git
  ↓
Replit Publish applies it to production
```

**The `scripts/src/migrate.ts` runner** (invoked via `pnpm --filter @workspace/scripts run migrate`) is a development/CI tool only. It:
- Applies pending migrations to the **development** database
- Detects destructive DDL (DROP TABLE, DROP COLUMN, TRUNCATE) and refuses
  to run them automatically
- Stamps already-applied migrations on first run

The runner is NOT used in the production deployment pipeline. Replit Publish handles that.

---

## 2. Applying Schema Changes to Production (Replit Publish)

Replit's Publish flow is the only supported way to apply schema changes to
production. When you click **Publish** in the Replit workspace:

1. Replit diffs the development schema against the production schema.
2. If there are renames, Replit shows a UI to resolve them (rename vs
   drop+create). **Review this carefully before confirming.**
3. Replit applies the diff to production automatically.

**You do not need to do anything extra** — just ensure your schema changes
are committed and the development database is up to date before publishing.

### Pre-publish checklist

- [ ] `lib/db/src/migrations/` contains the new migration SQL file
- [ ] The migration SQL file has been reviewed (especially for `ALTER TABLE`,
      `ADD COLUMN`, `CREATE INDEX`)
- [ ] Development database is up to date (`pnpm --filter @workspace/scripts run migrate`)
- [ ] TypeScript compiles cleanly (`pnpm run typecheck`)
- [ ] The new migration does NOT contain `DROP TABLE`, `DROP COLUMN`,
      `DROP SCHEMA`, or `TRUNCATE` — if it does, see Section 4

---

## 3. Generating a New Migration

After editing `lib/db/src/schema/*.ts`:

```bash
# Generate the migration SQL file
pnpm --filter @workspace/db run generate

# Review the generated SQL
cat lib/db/src/migrations/<new-file>.sql

# Apply to development database
pnpm --filter @workspace/scripts run migrate

# Typecheck to confirm no regressions
pnpm run typecheck
```

Generated migration files live in `lib/db/src/migrations/` and are named
with an incrementing four-digit prefix (e.g. `0035_add_contact_intent.sql`).

---

## 4. Destructive Migrations (DROP TABLE, DROP COLUMN, TRUNCATE)

The migration runner (`scripts/src/migrate.ts`) detects and **blocks** any
migration containing:
- `DROP TABLE`
- `DROP SCHEMA`
- `TRUNCATE`
- `ALTER TABLE … DROP COLUMN`

If you have an intentional destructive migration (e.g. removing an obsolete
column after a safe deployment), follow this process:

1. **Do not auto-run it.** The runner will exit 1 with an explanation.
2. Review the SQL carefully. Confirm the column/table is truly no longer used.
3. Back up production before proceeding (Section 5 of the Backup & DR doc).
4. Apply it manually via the Replit Publish flow (rename-resolution dialog
   lets you confirm drop vs rename).
5. If needed for development, apply it locally:
   ```bash
   psql "$DATABASE_URL" -f lib/db/src/migrations/<migration>.sql
   pnpm --filter @workspace/scripts run stamp -- "<migration-tag>"
   ```
6. Never commit destructive migrations without a corresponding code change
   that removes all references to the dropped column/table first.

---

## 5. Stamping a Migration (Already Applied Manually)

If you have already applied a migration manually (e.g. via the Replit Publish
rename dialog) and the runner does not know about it:

```bash
# Mark the migration as applied without re-running it
pnpm --filter @workspace/scripts run stamp -- "<migration-tag>"
# Example:
pnpm --filter @workspace/scripts run stamp -- "0035_add_contact_intent"
```

The stamp script (`scripts/src/stamp-migration.ts`) writes the migration
hash to `__drizzle_migrations` without executing the SQL.

---

## 6. Storage/Schema Parity Guard

Before a production deployment, verify that the development schema and
storage credentials are in sync with production by running the parity
check scripts:

```bash
# 1. Verify storage configuration and bucket isolation
pnpm --filter @workspace/scripts run verify-storage

# 2. (Every 90 days or after a major deployment) Run isolated restore verification
#    See docs/backup-and-disaster-recovery.md Section 5.1a for full instructions.
```

These scripts exit 0 on success, 1 on any failure. Never deploy if either
script reports a failure.

---

## 7. Quick Reference

| Task | Command |
|---|---|
| Generate migration after schema edit | `pnpm --filter @workspace/db run generate` |
| Apply pending migrations (dev DB) | `pnpm --filter @workspace/scripts run migrate` |
| Stamp a migration (already applied) | `pnpm --filter @workspace/scripts run stamp -- "<tag>"` |
| Verify storage credentials + buckets | `pnpm --filter @workspace/scripts run verify-storage` |
| Isolated restore verification | `pnpm --filter @workspace/scripts run verify-restore` |
| Apply to production | Use Replit Publish (never run DDL scripts directly) |
| Typecheck after changes | `pnpm run typecheck` |

---

## 8. What NOT to Do

- ❌ Run `drizzle-kit push` against production
- ❌ Run `scripts/src/migrate.ts` against `DATABASE_URL` pointing to production
- ❌ Write a custom `ALTER TABLE` / `CREATE TABLE` script and run it directly on production
- ❌ Set `DATABASE_URL` to the production connection string in your local environment
- ❌ Auto-apply migrations in a deploy/build hook (Replit Publish handles this)
- ❌ Run `verify-restore` with `RESTORE_VERIFY_DATABASE_URL` equal to `DATABASE_URL`
