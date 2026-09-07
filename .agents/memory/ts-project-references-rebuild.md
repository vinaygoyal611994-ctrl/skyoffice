---
name: TypeScript project references require explicit rebuild
description: When lib source files change, dist/.d.ts files are stale until manually rebuilt — apps resolve types via dist/, not src/.
---

## Rule
After editing any file under `lib/db/src`, `lib/api-zod/src`, or `lib/api-client-react/src`, run:
```
npx tsc -p lib/<pkg>/tsconfig.json
```
for each changed lib before running `tsc --noEmit` on the apps.

**Why:** The app tsconfigs (`artifacts/*/tsconfig.json`) use TypeScript `references` pointing to the lib packages. With composite mode, TypeScript resolves the lib types through `dist/*.d.ts` declaration files, NOT through the `exports: "./src/index.ts"` field in package.json. Old dist files silently show pre-change types.

**How to apply:** Any time you hand-edit lib source and then run a TypeScript check on an app that depends on it, rebuild the lib first. The symptom of forgetting is "Module has no exported member X" or "Property Y does not exist on type Z" errors that look impossible given what you just wrote.
