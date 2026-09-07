---
name: api-client-react dist rebuild requirement
description: lib/api-client-react uses composite:true — tsc project references resolve from dist/, not src/. Dist gets stale when api.schemas.ts or api.ts are edited manually.
---

## Rule
Any manual edit to `lib/api-client-react/src/generated/api.schemas.ts` or `api.ts` requires a rebuild:

```
cd lib/api-client-react && pnpm exec tsc --build
```

Without this, TypeScript in skayoffice-pilot sees the OLD dist/.d.ts types, hides real errors, and then surfaces a large batch of new errors next time tsc --build is run.

**Why:** The tsconfig at `artifacts/skayoffice-pilot/tsconfig.json` lists `lib/api-client-react` as a project reference. TypeScript project references resolve types from `outDir` (dist/) when `composite: true` is set — never from src/ directly.

**How to apply:** Run `cd lib/api-client-react && pnpm exec tsc --build` after every change to the generated schema files.

## Known manual additions to generated schema (Task #33 pending — full codegen broken)

Fields added manually that are not yet codegen-tracked:
- `OfficeMedia.variants?: OfficeMediaVariants | null` + `sortOrder?: number | null`
- `OfficeUpdate.latitude?: number | null`, `longitude?: number | null`
- `OfficeProfile.latitude?: number | null`, `longitude?: number | null`
- `OfficeSortType = 'nearest' | 'available' | 'newest'`
- `PaginatedOfficeList` (list offices paginated envelope replacing OfficeSummary[])
- `listOffices()` return type changed to `PaginatedOfficeList`
- `ListOfficesParams` gained: `sort`, `page`, `limit`, `lat`, `lon`
- `isSubscriptionHidden`, `slotStatus`, `reservationExpiresAt` (already tracked in previous session)

When Task #33 (codegen) is completed, the codegen output must include all of the above.
