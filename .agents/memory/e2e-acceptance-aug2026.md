---
name: E2E Acceptance Aug 2026
description: Full 16-scenario E2E acceptance test run results, defects found/fixed, and production status as of Aug 2026.
---

# E2E Production Acceptance — August 2026

## Auth shape in production
- Login/register responses include `sessionToken` field (not `token`)
- Autoscale bearer shim: use `Authorization: Bearer <sessionToken>` on all requests
- Unauthenticated → 401; wrong role → 403; these are verified working

## Route paths to remember
- Contact events: `POST /api/contact-events` (NOT `/api/contact` — returns 404)
- Supply slots: `/api/admin/supply-slots/...` (no double prefix since fix)
- Commercial: `/api/admin/commercial/...` (double-prefix bug fixed Aug 2026, needs redeploy)

## Supply cap body schema
- `PUT /api/admin/market-supply/controls/:id/cap` body: `{ supplyCap: number | null, reason: string, pause?: boolean }`
- Field is `supplyCap` (not `cap` or `adminCap`)
- `POST /api/admin/supply-slots/allocate/:officeId` requires `{ reason: string }`

## P1 defect fixed (not yet redeployed as of Aug 16)
- `commercialActivation.ts`: ALL routes had `/api/` hardcoded → double-prefix → 404
- Fix: `sed -i 's|"/api/admin/commercial/|"/admin/commercial/|g'` already applied
- Build: clean (0 TS errors)
- State before fix: accessible only at `/api/api/admin/commercial/...`
- After redeploy: accessible at `/api/admin/commercial/...`
- Commercial state is currently `disabled` (pre-launch, expected)

## Active office IDs in production
- Office: id=54, slug=`office-user-17`, name=" skayoffice " (isDemo=false, status=active)
- Freelancer: id=53, slug=`office-2`, name="استشارات قانونية" (status=active)

## Force-allocate vs cap enforcement
- `POST /api/admin/supply-slots/allocate/:officeId` is admin override — bypasses cap (expected)
- Cap enforcement only happens during `POST /api/admin/applications/:id/approve` (transactional FOR UPDATE)

## Background jobs health pattern
- After fresh deploy, analytics aggregation job shows "critical" until first job runs (~15min delay)
- Trigger manually: `POST /api/analytics/admin/aggregate` with `{"date":"YYYY-MM-DD"}`
- All jobs: subscription sweep, reservation sweep, slot sweep, backup — all working

## Production verified clean
- 0 five-xx errors in production (platform health: overallStatus: healthy)
- All 16 E2E scenarios passed or had expected behavior
- Analytics: profileViews=151, activeOffices=2, all aggregation jobs completed
