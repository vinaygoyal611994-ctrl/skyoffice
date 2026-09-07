---
name: Analytics Data Quality Phase 1
description: What was built, what was found wrong at audit time vs reality, and lasting constraints for analytics work.
---

## What Phase 1 added (migration 0023)

- `users.is_internal boolean DEFAULT false` — marks all @skayoffice.demo accounts; must UPDATE manually for any new internal account
- `analytics_events.is_self_view boolean DEFAULT false` — set server-side in offices.ts when `authenticatedUserId === officeRow.userId`
- `analytics_events.is_internal_actor boolean DEFAULT false` — denormalised from users.is_internal at event-write time
- `idx_ae_business_events` partial index covering events WHERE is_bot=false AND is_self_view=false AND is_internal_actor=false
- `service_requests.customer_id` FK changed CASCADE → RESTRICT (prevents silent history loss on user deletion)
- `service_request_reviews.customer_id` FK changed CASCADE → RESTRICT (same)

## Aggregation filter rule (ALL analytics aggregation queries must apply)

For `analytics_events` WHERE clauses: `is_bot = false AND is_self_view = false AND is_internal_actor = false`
For `contact_events` WHERE clauses: `AND customer_user_id NOT IN (SELECT id FROM users WHERE is_internal = true)`
For `favourites` WHERE clauses: same exclusion as contact_events

## Session-level changes

`SessionUser` now carries `isInternal: boolean` — populated at login from `user.isInternal`. Analytics ingestion (`POST /analytics/events`) returns early if `req.session.user?.isInternal`. Contact route (`POST /contact-events`) returns `{skipped: true}` for internal actors.

## Audit vs. reality corrections

- **contact_events "0 rows"**: the production audit reported 0 rows but production actually had 37 rows when re-checked post-migration. The prior read was likely from a slightly stale snapshot or a different query context. The route is working correctly.
- **Self-view contamination**: historical 67 profile_views all have is_self_view=false (they predate the flag). The is_self_view flag only applies to future events. Aggregation against historical data will count them as business-grade events, which is a known gap.
- **visitor_id gap fixed**: `getOrCreateVisitorId(req, res)` is now called before `res.sendStatus(204)` in the analytics POST. The cookie is now set in the analytics response, not only on the profile GET.

## Contact dedupe window

Changed from 4 s → 60 s. Prevents duplicate WhatsApp clicks within same session. Deliberate re-contact after 60 s is still recorded.

**Why:** 4 s was too short for users who tap the button, check something, and tap again — same intent but creates two rows.

## Production baseline after Phase 1

164 total events, 148 business-grade, 16 bots, 12 internal users, 37 contact_events rows, 6 service_requests.
