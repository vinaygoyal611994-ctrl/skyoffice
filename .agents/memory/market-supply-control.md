---
name: Market Supply Control
description: Rules-based market classification system — schema, API routes, classifier engine, city normalization, country handling, and Supply Control UI tab.
---

# Market Supply Control

## Key decisions

**DB:** Raw SQL migration `0024_market_supply_control.sql` — unique on (country_code, city_id, category_id). Drizzle schema in `lib/db/src/schema/marketSupplyControl.ts`, exported from schema index.

**Classifier:** Pure TS function in `artifacts/api-server/src/lib/marketClassifier.ts`. Takes `MarketSignals`, returns `ClassificationResult`. No DB dependency — fully unit-testable. 53 tests in `src/lib/__tests__/marketClassifier.test.ts`.

**Country handling:** Launch markets are SA and UAE only. All provider/transaction queries use `AND o.country IN ('SA', 'AE')`. NO `COALESCE(country, 'JO')` or any other fallback. Offices with NULL or unrecognised country are excluded from all supply counts — never assigned to another country. Analytics demand side (analytics_daily_by_market) already stores a real country_code; no fixup needed there.

**City normalization:** `canonicalCityKey()` in `marketRecompute.ts` calls `classifyCityId()` from searchNormalizer on raw `LOWER(city)` SQL results. Arabic/English/transliteration variants all map to the same key. Falls back to raw lower for unknown cities. Covers KSA + UAE at launch.

**All provider/transaction map keys:** `"<country>|<canonicalCityId>|<categoryId>"` — country is included to prevent cross-country collisions. Prior-snapshot map keys use `"<country_code>|<city_id>|<category_id>"` (already canonical from DB, no normalization needed).

**Completed transaction timestamp:** `customer_confirmed_at` (NOT `created_at`). `customer_confirmed_at` is set atomically when the customer calls `PATCH /service-requests/:id/confirm-completion` which sets `status = 'completed'` and `customerConfirmedAt = new Date()` in the same update. `created_at` records when the request was submitted — weeks before completion. Query also guards `customer_confirmed_at IS NOT NULL`.

**Supply trend foundation (migration 0025):** `market_supply_snapshots` table — append-only, stores `(country_code, city_id, category_id, active_count, snapshotted_at)`. Written by `runMarketRecompute()` on every run. Q3 (prior supply) reads `DISTINCT ON (country_code, city_id, category_id) ... WHERE snapshotted_at <= NOW() - interval '30 days' ORDER BY ... snapshotted_at DESC` — the most recent snapshot ≥30 days old. Falls back to current count (neutral trend) until 30+ days of snapshots have accumulated.

**Recompute engine:** `artifacts/api-server/src/lib/marketRecompute.ts` — contains `fetchAllMarketSignals()`, `runMarketRecompute(triggeredBy, actor)`, `scheduleMarketRecompute()`. Admin route calls `runMarketRecompute('admin')`. Scheduler calls `runMarketRecompute('scheduled', null)`. Manual POST /api/admin/market-supply/controls/compute always available.

**Scheduler:** 6-hour interval, 90-min initial delay, production-only, skips if any row was computed within 5 hours. Registered in `index.ts` alongside analytics + backup schedulers. Never auto-approves.

**API routes** (all under `/api/admin/market-supply/`, admin-only):
- `GET /signals` — live compute, read-only
- `GET /controls` — persisted records
- `POST /controls/compute` → delegates to `runMarketRecompute('admin')`
- `POST /controls/:id/decision` — approve/reject/monitor

**Acceptance status mapping** (post-calibration):
```
need_more_supply  → recruit
balanced          → open
near_saturation   → limited
oversupplied      → closed
weak_demand       → monitor  (classifier) → limited if was open (route)
insufficient_data → monitor  (classifier) → limited if was open (route)
```
pending_recommendation stores recommendedAcceptance ("recruit"|"open"|"limited"|"closed"|"monitor"), NOT marketStatus. Route handles legacy marketStatus strings via LEGACY_STATUS_MAP fallback.

**Application Gate (migration 0026):**
- Gate runs in `POST /offices/me/submit` AFTER completeness check, BEFORE status update.
- Gate reads ONLY `acceptance_status` from `market_supply_control`. `pending_recommendation` and `market_status` have NO gate effect.
- "recruit"/"open"/"no_data" → allowed. "limited" → allowed + flagged. "closed" → 403 bilingual JSON (unless override set).
- 5 new nullable columns on `offices`: `supply_gate_status`, `supply_gate_market_key`, `supply_gate_override_by` (FK users.id), `supply_gate_override_at`, `supply_gate_override_reason`.
- Admin override route: `POST /api/admin/applications/:officeId/supply-gate-override` — body `{ reason: string (min 10) }`. Uses `ApproveAdminApplicationParams` for officeId. If office is in draft/changes_requested, moves to under_review AND sets override. Audited with `admin.supply_gate.override`.
- Gate lib: `artifacts/api-server/src/lib/marketGate.ts` — exports `resolveMarket`, `checkMarketGate`, `checkMarketGateForOffice`, `buildMarketClosedError`, `CANONICAL_CITY_COUNTRY`. `checkMarketGateForOffice` returns no_data when country unresolvable (never blocks on unknown).
- City→country inference: `CANONICAL_CITY_COUNTRY` map in marketGate.ts — 16 SA cities, 7 AE cities. Map key includes country: "SA|riyadh|marketing" — SA and AE never collide.
- 43 new tests in `src/lib/__tests__/marketGate.test.ts` — 534 total tests pass.
- Gate events audited: `supply_gate.allowed`, `supply_gate.limited`, `supply_gate.no_data`, `supply_gate.blocked`, `supply_gate.override_used`, `admin.supply_gate.override`.

**Safeguard:** The decision endpoint only writes to `market_supply_control`. Zero effect on offices, subscriptions, or visibility.

**`automatic` mode:** Enum value exists in the schema/DB but no API ever sets it in v1.

**Why:** Post-decision audit trail is in `signals_snapshot` (JSONB) + `admin_review_decision/note/reviewed_by/last_reviewed_at`.
