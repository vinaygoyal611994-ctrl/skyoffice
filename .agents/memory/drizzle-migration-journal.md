---
name: Drizzle migration journal completeness
description: lib/db/migrations/meta/_journal.json must list every .sql file or drizzle-kit migrate skips them on fresh environments.
---

## Rule
`lib/db/migrations/meta/_journal.json` must have an entry for every `.sql` file in `lib/db/migrations/`. Migrations applied via raw SQL (bypassing drizzle-kit) do NOT auto-appear in the journal.

**Why:** `drizzle-kit migrate` reads `_journal.json` to determine which SQL files to apply in order. Any SQL file not listed in the journal is silently skipped. The dev DB already has the schema, but a fresh blank DB (new deployment environment) would be missing those tables.

**Current state (as of August 2026):** Journal has 20 entries (0000–0011, 0021–0028). Files 0024–0028 were manually added to the journal after being applied via raw SQL.

**How to apply:**
- After adding any new migration SQL file, also add its entry to `_journal.json` (increment `idx`, set `when` to current epoch ms, set `tag` to filename without `.sql`).
- The `__drizzle_migrations` DB table only records drizzle-kit-applied migrations. It being incomplete does NOT mean the DB is broken — the schema may still be fully applied via raw SQL.
- To verify coverage: `python3 -c "import json,os; j=json.load(open('lib/db/migrations/meta/_journal.json')); [print('MISSING',e['tag']) for e in j['entries'] if not os.path.exists(f'lib/db/migrations/{e[\"tag\"]}.sql')]"`
