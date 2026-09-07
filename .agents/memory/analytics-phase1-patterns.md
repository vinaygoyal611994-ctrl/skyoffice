---
name: SkayOffice Analytics Phase 1 — implementation patterns
description: Key gotchas and conventions from the Phase 1 analytics build; needed for Phase 2+ work and for anyone touching these files.
---

## Analytics client function signatures (skayoffice-pilot/src/lib/analytics.ts)

- `trackSearch({ query, resultsCount, inputMethod?, cityId?, categoryId? })` — resets searchSessionId
- `trackCardClick({ officeId, position?, searchSessionId? })` — object arg, NOT positional
- `trackVideoStart(officeId: number)` — single number
- `trackVideoComplete(officeId: number)` — single number
- `trackGalleryInteraction(officeId: number)` — single number
- `trackCopyLink(officeId: number)` — single number
- `useImpressionTracker(officeId: number, position: number)` — returns callback ref `(el: HTMLElement | null) => void`, NOT RefObject; wrap card in `<div ref={callbackRef}>`, not `as React.RefObject<...>`

**Why:** Functions were written with minimal surface area; the object-vs-positional inconsistency is intentional (search/click need more options; video/gallery don't).

## ...commonContext() spread order in analytics.ts event objects

`...commonContext()` MUST come BEFORE explicit fields in event objects:
```typescript
sendEvents([{
  ...commonContext(),  // ← first
  eventName: "...",
  searchSessionId,    // ← this overrides commonContext's searchSessionId
}]);
```

**Why:** JS object spread: later keys win. commonContext() includes `searchSessionId` (from getSearchSessionId()), so placing spread last silently overwrites the explicitly computed searchSessionId (e.g. the freshly-reset one for search_performed). This caused TS2783 "specified more than once" errors.

## TypeScript project references require rebuild after ANY source change in lib/db or lib/api-zod

Any edit to `lib/db/src/schema/*.ts` or `lib/api-zod/src/generated/api.ts` requires rebuilding the package for consuming packages to see the new types:
```bash
npx tsc --build lib/db/tsconfig.json     # after schema changes
npx tsc --build lib/api-zod/tsconfig.json # after api-zod changes
```

**Why:** api-server and skayoffice-pilot resolve @workspace/db and @workspace/api-zod through TypeScript project references → dist/.d.ts files. The source files are authoritative, but the compiled declarations in dist/ are what TypeScript actually reads. Without rebuilding, new exports/columns are invisible to consuming packages.

## Analytics aggregation backfill runs on every startup

`backfillMissedDates()` is called unconditionally (not just production) in api-server/src/index.ts. It's idempotent — if a date was already aggregated, the advisory lock prevents double-processing. Confirmed working: processes ~7 days in <1s on startup.

## Intelligence.tsx admin dashboard uses local t() stub

The Market Intelligence dashboard (admin/sections/Intelligence.tsx) uses a local:
```typescript
const t = (_key: string, fallback?: string): string => fallback ?? _key;
```
instead of the global `useI18n()` hook. This avoids needing to add dozens of translation keys to i18n.ts for an admin-only English page.

**How to apply:** Always use the local stub pattern for admin-only components; use `useI18n()` only for user-facing UI that needs AR/EN toggle.

## Analytics event deduplication

`analyticsEventsTable.eventId` is a UUID unique index used for idempotent inserts. The server uses `onConflictDoNothing({ target: analyticsEventsTable.eventId })`. Client always generates a fresh UUID per event with `crypto.randomUUID()`.
