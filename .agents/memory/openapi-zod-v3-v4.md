---
name: OpenAPI format keywords break zod codegen
description: Using format: email or format: uri in an openapi.yaml causes orval to emit zod v4-only methods in a repo pinned to zod v3.
---

Using `format: email` or `format: uri` on a string schema in `openapi.yaml` causes orval's zod codegen to emit `zod.email()` / `zod.url()`. Those are zod v4-only chained methods. If the workspace's zod catalog is still v3.x, this produces `tsc --build` failures like `Property 'email' does not exist on type ... zod` in the generated `lib/api-zod` package.

**Why:** orval's zod target maps certain `format` values directly to the newest zod API shape, independent of what zod version is actually installed in the workspace.

**How to apply:** Before adding `format: email` / `format: uri` to any string schema in this kind of project, check the workspace's pinned zod version (see `pnpm-workspace.yaml` catalog). If it's v3, use plain `type: string` (optionally with a `pattern` or a description) instead of the `format` keyword, then re-run codegen and confirm `pnpm --filter @workspace/api-server run typecheck` (or the equivalent) passes.

For the Orval 8.x line, `8.21.0` is the security-patched version that remains compatible with this Zod 3 setup. Later `8.27.0` codegen emits `zod.int()`, which is unavailable in Zod 3 and causes widespread generated-schema type errors.

**Why:** Upgrading from vulnerable Orval `8.20.0` with a caret range resolved to `8.27.0`; security findings cleared, but regenerated schemas failed with hundreds of `Property 'int' does not exist` errors.

**How to apply:** Keep Orval pinned exactly to `8.21.0` while the workspace remains on Zod 3. Verify upgrades by running Orval codegen and the library typecheck before accepting generated output.
