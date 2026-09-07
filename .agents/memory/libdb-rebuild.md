---
name: lib/db rebuild after schema additions
description: How to rebuild the db lib's .d.ts files after adding new schema files, so the api-server's TypeScript project references see the new exports.
---

## Context
`artifacts/api-server/tsconfig.json` uses TypeScript project references:
```json
"references": [{ "path": "../../lib/db" }]
```
TypeScript resolves `@workspace/db` from `lib/db/dist/*.d.ts` (pre-built declarations),
**not** from source. Adding a new file to `lib/db/src/schema/` and re-exporting it from
`lib/db/src/schema/index.ts` is not enough — the dist files must be regenerated.

## Rebuild command
```bash
cd lib/db && npx tsc --build
```
`lib/db/package.json` has no `"build"` script, so `pnpm --filter @workspace/db run build`
prints "None of the selected packages has a build script". Use `npx tsc --build` directly.

**Why:** Project references are designed for incremental, cross-package builds. The api-server
can't see new exports until the db lib's declarations are updated.

**How to apply:** Any time a new file is added to `lib/db/src/schema/` (new table), run the
rebuild before running `tsc --noEmit` in the api-server or tests will fail with
"has no exported member" errors.

## Also needed
After rebuild, register the new migration file in `lib/db/migrations/meta/_journal.json`
(next index, same timestamp pattern) and apply it with the psql runbook from `lib/db/MIGRATIONS.md`.
