---
name: SkayOffice production hardening — July 2026
description: Reference list of all audit findings fixed in the July 2026 remediation pass; use to avoid re-doing or conflicting with these changes.
---

## Changes applied (July 2026)

### Critical
- **CRIT-01**: CLOSED ✅ (2026-07-20). `db.transaction()` wraps full registration flow (both customer and office paths); `auditLog.ts` accepts optional `tx` so audit rows join the transaction. `isDuplicateKeyError()` checks both `err.code` and `err.cause.code` to handle drizzle-orm@0.45.x `_DrizzleQueryError` wrapper. Production-validated: concurrent race → one 201, one 409, zero orphans. 61 unit tests.
- **CRIT-02**: Vitest 4 + Supertest added to api-server; 20 unit tests cover slugify, hashPassword/verifyPassword, isValidEmail/isValidPhone.

### High
- **HIGH-01**: `AdminMediaRejectButton` (RegistrationRequests.tsx) now uses `useI18n()` — strings render in Arabic or English.
- **HIGH-02**: All 12 page modules in App.tsx converted to `React.lazy()`; wrapped in `<Suspense>`.
- **HIGH-03**: `QueryClient` defaults: staleTime=30s, gcTime=5min, retry=1. Public API routes now emit `Cache-Control: public, max-age=60/120`.
- **HIGH-06**: All 4 `window.confirm()` calls replaced with `AlertDialog` components (OfficesTable.tsx × 3, RegistrationRequests.tsx × 1).
- **HIGH-07**: Session `maxAge` 30d → 7d; `rolling: true` added.
- **HIGH-08**: `QuickOfficeCard` cover image now has `loading="lazy" decoding="async"`.
- **HIGH-09**: `scripts/backup-db.sh` — portable pg_dump script with 30-file rotation.

### Medium
- **MED-02**: Pending-changes approval in `admin.ts` wrapped in `db.transaction()`.
- **MED-05**: `artifacts/skayoffice-pilot/scripts/check-i18n-parity.ts` — translation parity checker.
- **MED-06**: `uploadUrlLimiter` (20 req/min/IP) added to `rateLimiter.ts`; applied to `POST /storage/uploads/request-url`.
- **MED-11**: `chart.tsx` ChartStyle — replaced `dangerouslySetInnerHTML` with `useRef` + `useLayoutEffect` textContent approach.
- **MED-13**: `RESERVED_SLUGS` set (30+ entries) added to `slug.ts`; `generateUniqueOfficeSlug` skips reserved candidates.

### Deferred (explicit)
HIGH-04 (payments), HIGH-05 (route decomposition), MED-01 (API versioning), MED-03 (as any cleanup), MED-07 (image pipeline), MED-08 (soft-delete), MED-09 (CSP nonce), MED-12 (orphaned files), MED-14 (admin IDOR).

### Slug.ts API change
`generateUniqueOfficeSlug(name, idHint?, queryDb?)` — third arg defaults to module-level `db`; pass `tx as any` inside transactions.
