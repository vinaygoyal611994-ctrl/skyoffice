---
name: Payment Foundation
description: Architecture decisions and invariants for the SkayOffice payment system (migrations 0033 + 0034).
---

# Payment Foundation

## Core invariant — triple guard preventing paid activation without a valid slot

1. `validatePrePayment()` in `lib/paymentValidator.ts` — blocks checkout if no reserved/allocated slot
2. Webhook handler re-checks slot via `activatePaid()` internally before activating
3. `activatePaid()` in `subscriptionLifecycle.ts` throws if no valid slot (existing behavior)

**Why:** A provider must hold a market slot reservation to pay. If the slot expires during checkout, the payment lock mechanism (see below) prevents the reservation from being released. If the lock lapses before webhook delivery, `failed_no_slot` is set as a defensive anomaly state.

## Payment lock mechanism (migration 0034)

`market_slot_allocations.payment_locked_until TIMESTAMPTZ` is set to `NOW() + 30min` when a checkout session is created. The reservation sweeper skips any slot where `payment_locked_until > NOW()`, so the reservation cannot be released while an active checkout is in flight.

**Lock clearing:** Cleared when payment succeeds (in `convertReservationToAllocation`), fails (in `handlePaymentFailed` webhook handler), or gateway errors (in checkout error handler). All paths call `clearPaymentLock(officeId)` from `supplySlotManager.ts`.

**Hard expiry:** Lock is always a fixed timestamp — never indefinite. After 30 min, sweeper can release normally.

**SQL guard in sweeper:**
```sql
WHERE slot_status = 'reserved'
  AND reservation_expires_at < NOW()
  AND (payment_locked_until IS NULL OR payment_locked_until <= NOW())
```

## Retry semantics (same billing period)

Before INSERT, the checkout handler checks for an existing row by `idempotency_key`:
- `succeeded` → 409 `already_paid` (hard block; no retry allowed)
- `pending` → 409 `duplicate_pending` (concurrent session open)
- `failed` or `cancelled` → UPDATE the row back to pending (retry path, no INSERT)
- none → INSERT fresh row

**Why:** UNIQUE(idempotency_key) would block a second INSERT for retried failed/cancelled payments. UPDATE reuses the same row, so only one row per billing cycle ever exists per office.

## Webhook is the sole activation source

Frontend success redirect NEVER activates. It only triggers a status poll.

## Gateway abstraction

`paymentGateway.ts` defines `PaymentGateway` interface + `NormalisedWebhookEvent`. Business logic in `payments.ts` uses only neutral event types (`"checkout.completed"`, `"payment.failed"`, `"unknown"`). Zero Stripe SDK types in route handlers.

- `StripeGateway` is the current adapter; swapping gateways = replacing only `StripeGateway`, nothing else.
- `getPaymentGateway()` / `_setPaymentGateway()` for injection in tests.
- Tests mock `getPaymentGateway` (returns gateway object), NOT individual stripeClient functions.

## Route mounting order — raw body before express.json()

In `routes/index.ts`, the webhook raw-body middleware is registered at `POST /payments/webhook` BEFORE `router.use(paymentsRouter)`. In tests, send to `/payments/webhook` (no `/api` prefix) and mount raw-body the same way.

## Provider slot-status API

`GET /api/supply-slots/status` (office auth) is implemented in `routes/officeSlots.ts` and mounted in `routes/index.ts`. Returns: `slotStatus`, `reservationExpiresAt`, `minutesRemaining`, `marketKey`, `priorityTier`, `paymentLockedUntil`.

## idempotency_key format

`{officeId}:{planId}:{YYYY-MM}` — one row per office per billing month. UNIQUE constraint enforces this at DB level.

## SYSTEM_ADMIN_ID = 1

Webhook activations pass `adminId = 1` (seeded admin) to `activatePaid()`.

## Price constants (canonical, SAR)

Office: 20,000 halalas = 200 SAR/month  
Freelancer: 12,000 halalas = 120 SAR/month  
Source: `artifacts/api-server/src/lib/paymentPlans.ts` — `PLAN_PRICES` map.

## Key files

- Migration 0033: `lib/db/src/migrations/0033_payment_foundation.sql`
- Migration 0034: `lib/db/src/migrations/0034_payment_lock.sql` (adds `payment_locked_until`)
- Schema: `lib/db/src/schema/payments.ts`, `lib/db/src/schema/supplySlots.ts`
- Gateway interface: `artifacts/api-server/src/lib/paymentGateway.ts`
- Plans: `artifacts/api-server/src/lib/paymentPlans.ts`
- Validator: `artifacts/api-server/src/lib/paymentValidator.ts`
- supplySlotManager: exports `clearPaymentLock`, `convertReservationToAllocation` (clears lock), `expireReservation` (clears lock)
- Routes: `artifacts/api-server/src/routes/payments.ts`
- Provider slot status: `artifacts/api-server/src/routes/officeSlots.ts`
- Admin payment history: in `DetailDrawer` of `artifacts/skayoffice-pilot/src/pages/admin/sections/SubscriptionSection.tsx`

## Stripe configuration needed before payments work

- `STRIPE_SECRET_KEY` — Replit Secret (sk_test_...)
- `STRIPE_WEBHOOK_SECRET` — Replit Secret (whsec_...)
- Without them, `/api/payments/checkout` returns 503 immediately
