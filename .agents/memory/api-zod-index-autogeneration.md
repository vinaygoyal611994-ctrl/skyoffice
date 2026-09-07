---
name: orval zod codegen overwrites api-zod's index.ts
description: Running orval codegen for the zod target regenerates lib/api-zod/src/index.ts and re-adds a duplicate "./generated/types" export, breaking tsc --build.
---

`lib/api-spec/orval.config.ts`'s `zod` target has `schemas: { path: "generated/types", type: "typescript" }` alongside the main `generated/api` output. Whenever `orval` is re-run (e.g. via `pnpm run codegen` in `lib/api-spec`), it regenerates `lib/api-zod/src/index.ts` as a barrel that exports **both** `./generated/api` and `./generated/types`. Since `generated/api` already re-exports the same schema symbols, this produces `TS2308: has already exported a member` errors across the workspace build.

**Why:** orval's default index-file generation always re-exports every configured output path (main target + separate `schemas.path`) for that client target, regardless of whether the two overlap.

**How to apply:** After any `orval` codegen run that touches the `zod` target, check `lib/api-zod/src/index.ts` and, if it contains more than the single line `export * from "./generated/api";`, rewrite it back to just that line before running `tsc --build` again. Do this as a standing final step of any workflow that edits `lib/api-spec/openapi.yaml`.
