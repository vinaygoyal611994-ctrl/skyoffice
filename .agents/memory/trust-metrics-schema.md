---
name: SkayOffice trust metrics schema
description: How completed-count, recommendation %, and response speed are calculated and surfaced after migration 0022.
---

## Rules

- **Response speed** is system-calculated: `first_response_at - created_at` (in minutes). Set once, at the moment the office sends their first PATCH /offer. Never overwritten. Customers no longer submit a rating.
- **`response_speed` column in `service_request_reviews`** is now nullable (dropped from review insert schema). DB CHECK: `IS NULL OR BETWEEN 1 AND 5`. Existing non-null values are preserved.
- **`first_response_at`** is a nullable `timestamp with time zone` on `service_requests`. Added in migration 0022.
- **Completed count** uses LEFT JOIN so ALL completed requests are counted, even those without a review.
- **`recommendPct`** denominator is `reviewCount` (reviewers who answered), not `completedCount`.
- **Legacy columns** `completed_transactions` and `clientsRecommendPercent` on `offices` table are zeroed for non-demo offices in migration 0022, omitted from `serializeOfficeSummary`, and made optional in the generated Zod/TS types. Do not re-add them to serializers.
- **`/api/offices/{slug}/service-metrics`** returns: `{ completedCount, reviewCount, recommendPct, avgFirstResponseMinutes }` (4 keys, no PII). Two DB queries: (1) completedMetrics via LEFT JOIN + status=completed, (2) responseMetrics via AVG(EXTRACT EPOCH).
- **Self-dealing check**: POST /service-requests fetches `officesTable.userId` and rejects with 403 if it equals the session `customerId`.
- **Audit logging**: fire-and-forget `audit()` helper on every service-request lifecycle endpoint; never throws.

**Why:** Prevents fake metrics injection via customer-supplied ratings. All trust data flows from verified workflow timestamps.

**How to apply:** Any future review form changes must NOT re-introduce `responseSpeed` as a client-submitted field. Any future metrics endpoint must query `service_requests WHERE status='completed'`, not the offices table columns.
