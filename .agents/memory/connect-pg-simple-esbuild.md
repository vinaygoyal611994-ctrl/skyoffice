---
name: connect-pg-simple breaks under esbuild bundling
description: connect-pg-simple's createTableIfMissing reads a table.sql file at runtime; esbuild bundling loses that file unless the package is externalized.
---

`connect-pg-simple` (Postgres-backed `express-session` store) reads a `table.sql` file from its own package directory at runtime to create/verify the session table (`createTableIfMissing: true`). When a Node backend is bundled with esbuild (e.g. the api-server's `build.mjs`), that relative file read breaks with `ENOENT: no such file or directory, open '.../dist/table.sql'` because esbuild inlines the JS but does not carry along the sibling `.sql` asset.

**Why:** esbuild bundling collapses the package into the output file graph; asset files referenced via `fs.readFile` relative paths outside of `import`/`require` are not tracked or copied.

**How to apply:** Add `"connect-pg-simple"` to the esbuild `external` array in the backend's build config (alongside other native/asset-dependent packages) so it's resolved from `node_modules` at runtime instead of bundled. Symptom to watch for: session login succeeds (200) but every subsequent authenticated request 401s, because the session table/rows were silently never persisted.
