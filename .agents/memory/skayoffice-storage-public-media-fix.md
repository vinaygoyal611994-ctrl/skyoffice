---
name: SkayOffice storage public-media fix
description: How the private-object storage route was hardened to serve approved public media without auth while keeping documents private.
---

## The problem
`GET /api/storage/objects/*path` was gated `if (!req.session.user) return 401`. Session cookies
never reach the browser on the Autoscale deployment (Set-Cookie stripped), and browser `<img>` /
`<video>` tags cannot send `Authorization` headers, so ALL media — covers, gallery, video — was
invisible to every visitor including the page owner in their dashboard.

## The fix
`artifacts/api-server/src/routes/storage.ts` — `isApprovedPublicMedia(objectPath)` function runs
a single UNION ALL query before the auth gate. If the path matches any approved public record, the
file is served immediately. Otherwise the old Gate 1 (session) → Gate 2 (doc ownership) chain runs
unchanged.

## What counts as approved public media
- `offices.cover_url`
- `offices.cover_variants` (medium / original / thumbnail)
- `offices.marketing_video_url`
- `office_media.url WHERE status = 'approved'`
- `office_media.variants WHERE status = 'approved'` (display / original / thumbnail)

## What stays private (unchanged)
- `office_verification_documents.object_path` — Gate 2 ownership check untouched
- `office_media` WHERE `status != 'approved'`
- `offices.pending_quick_card_cover` and its variants
- Anything not in the above lists

## Critical implementation detail — ::text cast
`jsonb_build_object('key', $N)` fails at runtime with
`could not determine data type of parameter $N` because `jsonb_build_object` uses variadic
`anyelement` and PostgreSQL can't infer the type. Fix: write `${objectPath}::text` in the drizzle
`sql` template — the `::text` is static SQL, renders as `$N::text`, which PostgreSQL accepts.

**Why:** `sql` tag interpolation places the value as a bound parameter; any static text in the
template (including `::text`) is appended verbatim to the SQL string, not to the parameter value.

## Verified
- curl: 9 approved public paths → 200 without auth ✅
- curl: verification docs, pending/rejected media, random paths → 401 ✅
- Playwright: Decision Card cover loaded (complete=true, naturalWidth=1024) with no session ✅
- TypeScript: 0 errors ✅
- Test suite: 444/444 pass ✅
