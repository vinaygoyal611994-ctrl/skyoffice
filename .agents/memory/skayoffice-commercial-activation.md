---
name: SkayOffice Commercial Activation
description: Plans, commercial state machine, campaign lifecycle, and notification flow added in migration 0029.
---

## Commercial State Machine

Three states live in `system_config` key `commercial_state`:
- `disabled` — no enforcement; sweeper skips the hideForNonPayment step entirely
- `scheduled` — activation date set, notifications may be in-flight; still no enforcement
- `active` — full lifecycle enforcement; sweeper hides on non-payment

**Critical sweeper guard:** `getCommercialState()` is called at the top of `runSubscriptionSweep()`. Step 3 (hideForNonPayment) is wrapped in `if (commercialState === "active")` — so hiding is completely skipped when disabled or scheduled.

**Activation requires explicit Admin confirmation:** `activateCampaign()` is the only path to `active`. The HTTP route also requires `{ confirmed: true }` in the request body as an extra guard. No scheduler or cron calls this function.

## Database Tables (migration 0029)

- `plans` — plan catalog (monthly_price in smallest unit: halalas/cents, 100 per SAR)
- `commercial_activation_campaigns` — one row per launch campaign (draft/scheduled/active/cancelled)
- `activation_notifications` — per-office notification tracking with UNIQUE(campaign_id, office_id) dedup

Seeded: `commercial_state = 'disabled'` + one default plan (Office Standard, 199 SAR/month).

## Key API Routes

All under `/api/admin/commercial/...`:
- `GET /state` — current commercial state
- `GET/POST /plans`, `GET/PUT /plans/:id` — plan CRUD
- `GET/POST /campaigns`, `GET/PUT /campaigns/:id` — campaign management
- `POST /campaigns/:id/notify` — send pre-activation bilingual emails (dedup-guarded)
- `POST /campaigns/:id/activate` — FINAL CONFIRM (requires `{ confirmed: true }`)
- `POST /campaigns/:id/cancel` — cancel; reverts commercial_state if no other active campaigns

## Plan price convention
Price stored as INTEGER in smallest currency unit (100 halalas = 1 SAR). Always divide by 100 for display. Never store as float.

## Frontend
`CommercialLaunchSection.tsx` added as "Commercial Launch" tab (Rocket icon) in IntelligenceHub alongside Subscriptions.

## Email
`sendCommercialActivationNotice()` added to `EmailProvider` interface + both providers. Bilingual HTML template via `buildCommercialActivationEmail()`.

## Test file
`src/lib/__tests__/commercialActivation.test.ts` — 27 tests covering all 8 behavioral requirements from the spec.
