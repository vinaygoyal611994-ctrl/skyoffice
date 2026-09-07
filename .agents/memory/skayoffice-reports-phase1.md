---
name: SkayOffice Office Reports Phase 1
description: Architecture decisions and test-input constraints for the office analytics report feature.
---

# Office Reports Phase 1

## Route & file structure
- Route handler: `artifacts/api-server/src/routes/analyticsOfficeReport.ts` (separate file, not appended to analytics.ts)
- Pure engine: `artifacts/api-server/src/lib/officeReportEngine.ts` — all recommendation/opportunity/change logic is side-effect-free
- Client hook: `lib/api-client-react/src/office-report.ts` — hand-written, not orval-generated
- Dashboard component: `artifacts/skayoffice-pilot/src/pages/dashboard/sections/Performance.tsx`
- Translations: added `reportTranslations` block at end of `artifacts/skayoffice-pilot/src/lib/i18n.ts`; must also add `keyof typeof reportTranslations` to `TranslationKey` union on line ~632

## Auth / ownership
- `requireRole("office")` middleware + resolve officeId via `db.select().from(officesTable).where(eq(officesTable.userId, req.session.user!.id))`; never accept officeId from client

## Recommendation priority test constraints
- Priority 2 fires when `profileViews < THRESHOLDS.INSUFFICIENT_DATA_PROFILE_VIEWS (5)` — even if impressions are high
- To unit-test priority 3 (low CTR), use `profileViews: 5, cardImpressions: 200` so priority 2 is skipped and CTR = 2.5% < 5%
- To unit-test priority 4 (low conversion), use `cardImpressions: 50, profileViews: 10` so CTR = 20% (priority 3 skipped) and contactActions: 0

**Why:** Priority 2 always fires first when profileViews < 5 regardless of other signals. Tests that set profileViews < 5 will never reach priority 3 or 4.

## Phone clicks
`phone_click` action type is NOT in `contactEventActionTypeEnum` so `phoneClicks` always returns 0; shown as `null` when `acceptsPhoneCalls=false`; implemented defensively for forward-compatibility

## Copy-link / phone raw queries
Both hit indexed columns in `analytics_events`/`contact_events` directly (not `analytics_daily_by_office`) since they weren't in the daily aggregate schema

## TranslationKey type extension pattern
When adding new translation namespaces via `Object.assign`, also add `keyof typeof <newConst>` to the `TranslationKey` union type in i18n.ts (line ~632); without it the t() function will reject those keys at compile time
