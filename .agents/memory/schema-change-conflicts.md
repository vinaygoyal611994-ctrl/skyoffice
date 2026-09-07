---
name: Handling "don't change the DB structure" vs. new-field requests
description: What to do when a feature request needs a new stored field but the user has explicitly frozen the database schema.
---

Users sometimes freeze broad areas ("do not change database structure/auth/admin") while also asking for a feature that logically requires new persisted data (e.g. a per-record boolean toggle, or a localized/Arabic variant of an existing text field). The freeze usually means "don't touch the parts I didn't ask about," not "block this feature outright."

**Why:** Guessing wrong here is costly either way — silently adding schema changes violates explicit trust boundaries; silently skipping the feature (or worse, faking it client-side) fails the actual request. This has come up twice in the same project (a `videoCallEnabled` toggle, then Arabic `nameAr`/`shortDescriptionAr`/`certificationsAr` fields).

**How to apply:** When a request needs new data with no home in the existing schema, stop and use `AskQuestion` with two concrete options: (a) add a small additive, nullable/defaulted column scoped exactly to the new need, or (b) skip persisting it and do the best possible version without new storage. Let the user decide — don't assume either way. Once approved, apply the migration via direct `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` through the SQL execution tool rather than `drizzle-kit push`, since push can prompt to drop the unmanaged `session` table in this project (see connect-pg-simple-esbuild.md) and fail non-interactively.
