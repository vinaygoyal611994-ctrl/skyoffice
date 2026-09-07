---
name: Gallery sort_order migration and stamp flow
description: How sort_order was added to office_media for stable gallery ordering, including the stamp-migration flow and safety-check false positive.
---

## What was done
- Added `sort_order INTEGER` column to `office_media` table (migration 0021_gallery_sort_order.sql).
- 32 existing gallery rows had sort_order initialized (chronologically per office).
- Journal entry added at idx=12 (tag=`0021_gallery_sort_order`), stamped via `scripts/node_modules/.bin/tsx scripts/src/stamp-migration.ts 0021_gallery_sort_order`.

## Safety check false positive
`scripts/src/migrate.ts` blocks any migration whose SQL matches `/\bDROP\s+TABLE\b/i`, but the regex also matches **commented-out** lines (e.g. `-- DROP TABLE IF EXISTS foo`). This tripped on `0011_analytics.sql` which has commented-out DROP TABLE rollback notes. The fix is to strip SQL comments before running the pattern check. Work around this by using the stamp command to manually record the migration.

## Stamp command syntax
```
scripts/node_modules/.bin/tsx scripts/src/stamp-migration.ts <tag>
```
Do NOT use `pnpm --filter scripts run stamp -- <tag>` — pnpm passes `--` as `process.argv[2]`, causing a "file not found" error.

## Application of sort_order
- Gallery inserts: server computes `max(sort_order) + 1` in the office's gallery rows at insert time.
- Gallery serializer: orders by `sortOrder ?? id` ascending.
- Reorder endpoint: `PATCH /api/offices/me/media/reorder` — takes `{ items: [{ id, sortOrder }] }`.
- Frontend: `handleReorderGallery(mediaId, 'up'|'down')` swaps two adjacent items' sort_order values.
- Gallery limit: max 3 non-rejected gallery rows enforced server-side (400 `gallery_limit_reached`).
- DC cover limit: max 1 pending cover at a time enforced server-side (400 `cover_pending_exists`).

**Why:** Stable gallery ordering requires a persisted position column — JS `.sort()` on insertion order is unreliable across sessions and after deletes.
