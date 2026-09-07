---
name: Slot Reservation Sweeper
description: Architecture and design decisions for the 3-hour reservation expiry sweeper.
---

## What was built

`artifacts/api-server/src/lib/slotReservationSweeper.ts` — `runReservationSweep()` and `scheduleReservationSweep()`.

Already registered in `index.ts` (line 404). Runs every 15 min with a 60s startup delay via `setInterval + setTimeout` (both `.unref()`).

## Pipeline

1. `pool.query` — SELECT expired reservations (`slot_status='reserved' AND reservation_expires_at < NOW()`)
2. `expireReservation(officeId)` per expired row — emits `reservation_expired` audit
3. `processWaitlist(marketKey)` per affected market (deduplicated via Set) — emits `reservation_created` audit
4. Per newly reserved/allocated office: fetch office info + slot info in one JOIN query, insert `next_provider_selected` into `slot_audit_log`, send `emailProvider.sendSlotReservationNotice`

## Audit events emitted

- `reservation_expired` → by `expireReservation()` in supplySlotManager
- `reservation_released` → by `releaseSlot()` in supplySlotManager (admin force-release)
- `reservation_created` → by `createReservationRow()` inside `processWaitlist`
- `next_provider_selected` → by the sweeper itself, after processWaitlist returns (context: sweeper-driven handoff)

## Notification deduplication — no DB column needed

`processWaitlist` only returns offices in `pwResult.reserved` when they transition from `waiting → reserved` in that call. An already-reserved office is skipped. So each office is notified exactly once per reservation window. No `reservation_notification_sent_at` column required.

**Why:** processWaitlist idempotency via ON CONFLICT handles it. Only risk is crash between reservation creation and notification (notification lost, not duplicated).

## Manual trigger

`POST /api/admin/supply-slots/sweep` (requireRole("admin")) — calls `runReservationSweep()` synchronously and returns full result + writes audit log.

## Result shape

`ReservationSweeperResult`: `{ ranAt, durationMs, expiredCount, marketKeys, reservedCount, allocatedCount, notificationsSent, errors }`

## Failure isolation

- expireReservation failure for one office → `errors++`, continue to next office
- processWaitlist failure for one market → `errors++`, continue to next market  
- Office info fetch failure → `warn`, skip notification, no `errors++`
- next_provider_selected audit failure → `warn`, continue to email, no `errors++`
- Email send failure → `warn`, `notificationsSent` NOT incremented, no `errors++`

## Email

Added `sendSlotReservationNotice` to EmailProvider interface + ConsoleEmailProvider + ResendEmailProvider + HTML template (`buildSlotReservationNoticeEmail`). No payment link per spec.

## Tests

`src/lib/__tests__/slotReservationSweeper.test.ts` — 22 scenarios, 736 total tests pass.
