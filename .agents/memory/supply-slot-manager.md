---
name: Supply Slot Manager
description: Active Supply Slot + Returning Provider Waitlist system — architecture, invariants, and integration points.
---

# Supply Slot Manager

## What it is
`artifacts/api-server/src/lib/supplySlotManager.ts` — the core library managing marketplace slot lifecycle independent of subscription state.

## Key invariant
Account, Subscription, Supply Slot, and Public Visibility are INDEPENDENT concerns:
- `active_paid + slot_status=waiting` → subscription active, office hidden (market full)
- `active_paid + slot_status=allocated` → subscription active, office visible
- Slot release never cancels a subscription; subscription renewal never bypasses slot cap

## Slot-consumer count (changed from offices table)
New canonical count: `SELECT COUNT(*) FROM market_slot_allocations WHERE market_key=$1 AND slot_status='allocated'`
Old (removed): `SELECT COUNT(*) FROM offices WHERE supply_gate_market_key=$1 AND status IN ('approved','active') AND is_demo=false`
Hidden offices have `slot_status='released'` and do NOT consume marketplace slots.

## Tables
- `market_slot_allocations` (one row per office) — tracks slot lifecycle
- `slot_audit_log` — immutable append-only event log
- Migration: `lib/db/src/migrations/0030_supply_slots.sql`
- Schema: `lib/db/src/schema/supplySlots.ts`

## Priority tiers (waitlist ordering)
1. Returning — had `allocated_at IS NOT NULL` (previously held a slot in this market)
2. Existing — `approved/active` with `supply_gate_market_key`, never held a slot
3. New — everyone else
Within tier: `allocated_at DESC NULLS LAST`, then `created_at ASC` (FIFO)

## Integration points
- `subscriptionLifecycle.ts:activatePaid()` — calls `allocateSlot()` AFTER subscription commit; does NOT unconditionally clear `is_subscription_hidden`
- `subscriptionLifecycle.ts:hideForNonPayment()` — calls `releaseSlot()` + `processWaitlist()` AFTER hide commit
- `marketGate.ts:checkCapForMarket()` — now uses `countAllocatedSlotsForMarket()`
- `admin.ts` approval route — uses `client.query` count from `market_slot_allocations` + calls `allocateNewApproval()` inside transaction
- `admin.ts` cap update route — triggers `processWaitlist()` when capacity increased
- `admin.ts` cap-decision route — triggers `processWaitlist()` on approved recommendation
- `routes/supplySlots.ts` — admin API routes mounted at `/api/admin/supply-slots/...`

## allocateSlot double-query bug (fixed)
The FOR UPDATE lock query result is used directly as supply_cap; `fetchCapForMarketKey` is NOT called separately after the lock. Tests must mock only ONE cap-related client.query (the FOR UPDATE), not two.

## Known gaps (proposed follow-ups)
- Rejection/suspension does NOT call `cancelSlot()` — orphaned waitlist entries possible
- `isSubscriptionHidden` and `slotStatus` in `serializeOfficeProfile` are `(office as any)` in frontend — needs codegen
- Dashboard waiting banner lacks queue position number
