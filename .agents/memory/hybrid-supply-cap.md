---
name: Hybrid Supply Cap
description: Design decisions and invariants for the admin-controlled per-market supply cap system built on top of Supply Control.
---

## Architecture

Supply cap is a hard ceiling per **Country + Canonical City + Category** market, stored in `market_supply_control.supply_cap`.

## Invariants

**Why:** Admins need to control market density without any automatic changes they didn't approve.

1. `supply_cap` is ONLY written by:
   - `PUT /api/admin/market-supply/controls/:id/cap` (admin sets cap)
   - `POST /api/admin/market-supply/controls/:id/cap-decision` (admin approves intelligence recommendation)
   - Nothing else. `runMarketRecompute` writes to `recommended_supply_cap`, never `supply_cap`.

2. Slot consumers = `status IN ('approved', 'active') AND is_demo = false`. `under_review`, `draft`, `rejected`, `suspended` do NOT consume a slot.

3. Pre-migration offices with `supply_gate_market_key = NULL` are NOT counted against the cap (grandfathered — "do not affect existing providers").

4. Cap enforcement happens at TWO points:
   - **Submit** (`checkFullGate` in offices.ts): soft check, returns 403 if at/over cap
   - **Approval** (admin.ts approve route): transactional `SELECT … FOR UPDATE` on `market_supply_control` → recount → reject with 409 if count >= cap

## Gate precedence (top wins)

1. Unresolvable market → `no_data` → allowed
2. `acceptance_status = 'closed'` + no admin override → `blocked` (market_closed)
3. cap set AND consumers ≥ cap → `blocked` (cap_full) — admin override does NOT bypass this
4. `limited` + below cap → `limited`
5. open/recruit + remaining ≤ near-cap threshold → `near_cap` (allowed, flagged)
6. Everything else → `allowed`

## Cap status thresholds

- `over_cap`: supply > cap (cap was lowered; no providers removed — only new admissions blocked)
- `full`: supply == cap
- `near_cap`: remaining ≤ max(2, ceil(cap × 0.20))
- `available`: remaining > near-cap threshold

## Recommendation formula (computeCapRecommendation — pure function)

- No cap set → capChange=0 (advisory: "set a cap first")
- `oversupplied` / `near_saturation` / `weak_demand` / `insufficient_data` → hold (capChange=0)
- `balanced` + rising demand (trend > 25% and conf ≥ 70%) → +1
- `need_more_supply` → +1..+5 scaled by demandPerProvider ratio, capped by confidence band
- Hard max: +5 per cycle regardless of signals
- Low confidence (<50%) → max +1

## Files

- `lib/db/migrations/0027_supply_cap.sql` — 10 cap columns on market_supply_control + market_supply_cap_history table
- `lib/db/src/schema/marketSupplyCapHistory.ts` — Drizzle schema (newCap nullable for cap-removal events)
- `lib/db/src/schema/marketSupplyControl.ts` — extended with cap columns
- `artifacts/api-server/src/lib/marketGate.ts` — `computeCapStatus`, `checkCapForMarket`, `checkFullGate`, `buildCapFullError`
- `artifacts/api-server/src/lib/marketClassifier.ts` — `computeCapRecommendation` (pure)
- `artifacts/api-server/src/lib/marketRecompute.ts` — writes recommended_supply_cap only
- `artifacts/api-server/src/routes/admin.ts` — approve route (transactional FOR UPDATE), 3 new cap routes (PUT cap, POST cap-decision, GET cap-history)
- `artifacts/api-server/src/routes/offices.ts` — submit route uses checkFullGate (replaces checkMarketGateForOffice)
- `artifacts/api-server/src/lib/__tests__/supplyCap.test.ts` — 54 tests covering all spec scenarios

## new_cap nullable

The `market_supply_cap_history.new_cap` column is nullable (`ALTER COLUMN new_cap DROP NOT NULL`) so cap-removal events can store `new_cap = NULL` (meaning "uncapped").
