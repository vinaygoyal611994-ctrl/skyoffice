---
name: Slot Notification Outbox
description: Persistent outbox pattern for slot reservation notifications — architecture, atomicity guarantee, worker design, and test implications.
---

# Slot Notification Outbox

## The Pattern

When `createReservationRow()` (in `supplySlotManager.ts`) creates a reservation, it now also creates a `slot_notification_outbox` row **inside the same transaction** (using the same `client`). This is the atomicity guarantee: if the reservation INSERT rolls back, the outbox row rolls back too. If the server crashes after both INSERTs commit, the outbox row survives and the next worker run delivers the email.

## Key Files

- `lib/db/src/migrations/0032_slot_notification_outbox.sql` — table + CHECK constraint extension
- `artifacts/api-server/src/lib/slotNotificationOutbox.ts` — `enqueueNotification()`, `runOutboxWorker()`, `scheduleOutboxWorker()`, `getOutboxSummary()`
- `artifacts/api-server/src/routes/supplySlots.ts` — `GET /api/admin/supply-slots/notification-outbox`
- `artifacts/api-server/src/lib/healthTracker.ts` — `recordOutboxWorkerRun()`, outbox stats in `getHealthSnapshot()`

## createReservationRow now makes 4 client queries per reservation

Previously 2 (slot INSERT + reservation_created audit). Now 4:
1. INSERT/UPDATE market_slot_allocations (reservation)
2. INSERT slot_audit_log (reservation_created)
3. INSERT slot_notification_outbox (outbox entry — ON CONFLICT DO NOTHING)
4. INSERT slot_audit_log (notification_queued)

**Any test that stubs client queries through processWaitlist into createReservationRow needs 2 extra `{ rows: [] }` entries per reservation created.**

Affected tests fixed: supplySlots.test.ts (4 tests), slotReservations.test.ts (3 tests).

## Sweeper no longer sends email

`slotReservationSweeper.ts` no longer imports `emailProvider` or has `handleNextProvider`. It just expires + calls processWaitlist. `ReservationSweeperResult` no longer has `notificationsSent`. The sweeper test file was completely rewritten to reflect this.

## Worker Design

- Candidate SELECT (non-locking): `WHERE status IN ('pending','failed') AND attempts < 5 AND next_attempt_at <= NOW()`
- Per-row transaction with `FOR UPDATE SKIP LOCKED` — concurrent workers process different rows
- Staleness check: `WHERE office_id=$1 AND slot_status='reserved' AND reservation_expires_at > NOW()` — skip if stale
- Backoff: `2^attempts` minutes (2min, 4min, 8min, 16min, then permanently failed at attempt 5)
- Schedules every 2 minutes (first run 30s after startup)

## Audit actions added in migration 0032

CHECK constraint extended to include: `next_provider_selected`, `notification_queued`, `notification_sent`, `notification_failed`, `notification_skipped_stale`

## Test Pattern for Audit Param Assertions

The audit action is passed as a SQL **parameter** (`$3`), not embedded in the SQL string. When verifying audit actions in outbox tests, check `c[1]` (params array), not `c[0]` (SQL string):

```typescript
const auditCall = client.query.mock.calls.find(
  (c: unknown[]) =>
    String(c[0]).includes("slot_audit_log") &&
    Array.isArray(c[1]) &&
    (c[1] as unknown[]).includes("notification_skipped_stale"),
);
```

## Health Tracker

`recordOutboxWorkerRun({ sent, failed, skipped })` accumulates totals since last restart. `getHealthSnapshot()` includes `outbox: { totalSent, totalFailed, totalSkipped, lastWorkerRunAt, lastFailureAt, lastFailureSummary }`.

Admin endpoint health signal: `failed === 0` → healthy, `1-3` → warning, `>3` → critical.

**Why:** A failed count > 0 means providers were not notified and won't be retried automatically — needs manual investigation.
