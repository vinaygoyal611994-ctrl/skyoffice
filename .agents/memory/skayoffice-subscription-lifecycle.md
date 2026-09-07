---
name: SkayOffice Subscription Lifecycle
description: Design decisions and schema conventions for the subscription system built in migration 0028.
---

## Core Design Decisions

**Subscription state is SEPARATE from offices.status**
- `office_subscriptions` table holds state; `offices.status` workflow (draft/under_review/active/etc.) is never touched by subscription operations.
- Public listing filter: `is_subscription_hidden = false` (new column on offices) — toggled atomically with subscription state changes, never the status enum.

**State machine (valid transitions)**
```
free         → trial (admin), active_paid (admin)
trial        → expiring (sweeper, 7d before), expired (sweeper), active_paid, cancelled
active_paid  → expiring (sweeper), cancelled
expiring     → active_paid (renewed), expired, cancelled
expired      → hidden_due_to_nonpayment (sweeper, after grace), active_paid (reactivate), cancelled
hidden       → active_paid (reactivate), cancelled
cancelled    → active_paid (reactivate)
```

**Sweeper runs every 6h** — transitions expiring/expired/hidden states; sends dedup-guarded email reminders.

**Notification dedup**: `subscription_notifications` table with UNIQUE (office_id, notification_type, period_expires_at). Same expires_at = same period. New trial/renewal = new keys = new reminders fire.

**Trial duration is configurable** via `system_config` table (`trial_duration_days`, default 14). Grace period and warning window also configurable.

**Reactivation** (expired/hidden/cancelled → active_paid) atomically clears `is_subscription_hidden` via pool transaction.

**Growth metrics** are computed from `subscription_history` (no denormalized counters). Current snapshot from `office_subscriptions`.

## Tables (migration 0028)
- `system_config` — key/value admin settings, seeded with 3 subscription keys
- `office_subscriptions` — one row per office (UNIQUE office_id), upserted on transitions
- `subscription_history` — immutable INSERT-only audit trail
- `subscription_notifications` — dedup sentinel for expiry reminder emails

## Column: offices.is_subscription_hidden
- boolean NOT NULL DEFAULT false
- Only true when state = hidden_due_to_nonpayment
- Cleared on reactivation (activatePaid)
- Added to public `/offices` listing filter alongside status='active'

**Why:**
- Keeps offices.status clean for the existing approval workflow
- Hot public listing path avoids a JOIN to office_subscriptions
- One column is clearer than embedding subscription logic in the status enum

**How to apply:**
- Any feature that queries offices for public display must include `eq(officesTable.isSubscriptionHidden, false)` in conditions
- Any admin action that restores a hidden office must call `activatePaid()` — never manually set the flag

## Routes (subscriptions.ts router, mounted in routes/index.ts)
- GET/POST /api/admin/subscriptions + /:officeId + /:officeId/{trial,activate,expire,cancel,reactivate}
- POST /api/admin/subscriptions/sweep — trigger manual sweep
- GET/PUT /api/admin/system-config/subscription + /:key

## Email method
`emailProvider.sendSubscriptionExpiryReminder()` added to EmailProvider interface + both providers (ConsoleEmailProvider logs, ResendEmailProvider sends HTML email).

## Vitest hoisting rule (confirmed again)
Use `vi.hoisted(() => { ... })` to declare mock variables before `vi.mock` factories. Standard `const mockDb = vi.fn()` before `vi.mock` fails with "Cannot access before initialization" because `vi.mock` hoists to top of file.
