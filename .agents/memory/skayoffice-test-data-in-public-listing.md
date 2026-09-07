---
name: SkayOffice test/e2e offices leaking into public listing
description: e2e/manual test office records (no isDemo flag) can end up status=active and visible on the public homepage.
---

The `offices.isDemo` flag only marks the curated showcase offices (ids 1-10). Offices created by registration e2e tests or manual QA (names like "مكتب الاختبار", "office-<random>", "Office H7Go") are not flagged demo, and if their status ever reaches `active` they show up live on the public discover/home page and category browsing — real clutter in a pilot, not just a cosmetic issue.

**Why:** the admin "delete demo data" affordance keys off `isDemo`, so junk test offices without that flag are invisible to that cleanup path and just sit in the live listing.

**How to apply:** when doing a pre-pilot/production-readiness pass, query `offices` for `status='active' AND is_demo=false` and manually eyeball names for obvious test patterns (Arabic "مكتب اختبار/تدقيق" placeholders, random-suffix names) — report them for the user to archive/delete rather than assuming `isDemo` alone identifies all non-production data.
