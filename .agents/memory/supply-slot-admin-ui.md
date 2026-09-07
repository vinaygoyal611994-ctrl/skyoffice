---
name: Supply Slot Admin UI
description: Architecture of the SlotReservationPanel — where it lives, how it gets data, what it renders, and gotchas.
---

# Supply Slot Admin UI

## Location

`SlotReservationPanel` is a standalone component in:
`artifacts/skayoffice-pilot/src/pages/admin/sections/SlotReservationPanel.tsx`

It is rendered at the END of the `DrillDown` component in `SupplyControlSection.tsx`, OUTSIDE the `{ctrl && (...)}` block. This means it always shows (even for markets without a persisted supply-control record).

## Data Sources (4 parallel fetches in loadSlotData)

The `DrillDown.loadSlotData` callback was updated to remove its `if (!ctrl) return` guard and now fetches all 4 endpoints in parallel:
1. `GET /api/admin/supply-slots/market/:key` → slotSummary
2. `GET /api/admin/supply-slots/reserved/:key` → reservations (active 3h windows only)
3. `GET /api/admin/supply-slots/waitlist/:key` → waitlist (ordered by backend priority)
4. `GET /api/admin/supply-slots/notification-outbox/:key` → outbox (last 12h rows)

## New API Endpoints Added

- `GET /api/admin/supply-slots/notification-outbox/:key` — per-market outbox rows (last 12h, max 100)
- `getOutboxForMarket(marketKey)` in `slotNotificationOutbox.ts`

## New Fields Added to Existing Endpoints

Both `getReservedSlotsForMarket` and `getWaitlistForMarket` now include `provider_type` from the `offices` table → exposed as `providerType: string` on both `ReservationEntry` and `WaitlistEntry` interfaces in `supplySlotManager.ts`.

## Panel Sections

1. **Market Summary Grid** — 4 color-coded stat cards (Allocated/Reserved/Available/Waiting), acceptance status, cap info
2. **Active Reservations** — live countdown from `reservationExpiresAt` (ticks every second via `useNow()` hook), tier badge, provider type badge, notification status badge, per-office history button
3. **Waitlist** — ordered list matching backend `priority_tier ASC, allocated_at DESC NULLS LAST, created_at ASC`; position #, tier/type badges, entered-at, last allocation date for returning
4. **Failed Notification Alert** — red banner if any outbox entry has `status='failed'`
5. **Admin Actions** (collapsible) — "Run Reservation Sweep" button (POST /sweep) + "Exceptional Override" (clearly labeled, collapsed, red-bordered)
6. **Per-office Audit History** — fetched on demand from `GET /api/admin/supply-slots/audit/:officeId`, filtered to current market key, max 20 recent relevant events

## Notification Status per Reservation

Outbox entries are matched to reservations by `officeId` (taking the entry with the highest `id` per officeId). Since an office can only have one active reservation at a time, this gives the right outbox row.

## Live Countdown

`useNow(1000)` hook provides a `nowMs` that updates every second. Countdown format:
- > 1h: "Xh Ym" — emerald
- 30-60m: "Xm Ys" — amber
- < 30m: "Xm Ys" — red bold
- Expired: "Expired" — red bold
The backend `minutesRemaining` is NOT used for countdown display (it goes stale). Only `reservationExpiresAt` is used.

## Old Slot Panel

The old "Active Slots" panel (basic stats + simple waitlist toggle) was removed from inside the DrillDown `{ctrl && (...)}` block and replaced by `<SlotReservationPanel>`. No duplicate rendering.

**Why:** The old panel didn't distinguish allocated vs reserved, had no countdown, no notification status, no history, no admin actions.
