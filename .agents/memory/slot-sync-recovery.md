---
name: Slot-sync recovery pattern
description: How post-commit convertReservationToAllocation failures are detected, flagged, and repaired without manual intervention or silent inconsistency.
---

## The problem

`activatePaidCore()` uses two sequential DB operations:
1. `UPDATE office_subscriptions SET state='active_paid'` — committed in its own transaction
2. `convertReservationToAllocation()` — called post-commit in a separate transaction

If step 2 fails the office has `state=active_paid` + no allocated slot + `is_subscription_hidden=true`. Previously this was silently logged.

## The fix (migration 0036)

Added `slot_sync_needed_at TIMESTAMPTZ` to `office_subscriptions`.
- **NULL** = no issue
- **NOT NULL** = conversion failed post-commit; sweeper must retry

### On conversion failure in activatePaidCore
```sql
UPDATE office_subscriptions SET slot_sync_needed_at = NOW() WHERE office_id = $1
```
Done via `pool.query` (not Drizzle) so it works even if the Drizzle schema is stale.

### Recovery sweeper (slotSyncRecovery.ts)
`runSlotSyncSweep()` every 15 min — idempotent, safe to re-run at any frequency.

Recovery cases:
- `allocated` → clear flag + restore visibility (concurrent fix)
- `reserved` (not expired) → retry `convertReservationToAllocation(officeId, null)` → clear flag
- `not_required` → clear flag + restore visibility (uncapped market)
- `released`/expired → `needs_admin` — DO NOT auto-allocate (supply-cap violation risk)
- retry throws → `conversion_failed` — flag retained, will retry next sweep

### Supply-cap safety rule
**Never** auto-allocate when the reservation has expired. The 3-hour window may have allowed `processWaitlist()` to give the slot to another provider. Only a human admin (via `forceAllocateSlot`) can override after reviewing the situation.

### Platform Health (adminHealth.ts)
Section `slotSync`:
- `pendingCount > 0` → status = "critical"
- Counts: total pending + subset that need admin (reservation expired)
- Included in `overallStatus` via `worstStatus()`

### Files involved
- `lib/db/migrations/0036_slot_sync_needed.sql` — ALTER TABLE
- `lib/db/src/schema/subscriptions.ts` — `slotSyncNeededAt` column
- `artifacts/api-server/src/lib/slotSyncRecovery.ts` — recoverSlotSync + runSlotSyncSweep + scheduleSlotSyncSweep
- `artifacts/api-server/src/lib/subscriptionLifecycle.ts` — activatePaidCore catch block sets flag
- `artifacts/api-server/src/routes/adminHealth.ts` — slotSync health section
- `artifacts/api-server/src/index.ts` — scheduleSlotSyncSweep() registered at startup
- `artifacts/api-server/src/lib/subscriptionSweeper.ts` — ReminderRow + inline sub object updated

**Why:** `OfficeSubscription` now requires `slotSyncNeededAt: Date | null` — any inline object construction of this type must include the field.
