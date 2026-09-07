---
name: SkayOffice public bilingual data fields
description: How office name/description/services/city are localized on the public site, and the fallback + gap-logging pattern used.
---

- Bilingual office data follows the existing `field`/`fieldAr` column convention (matches `name`/`nameAr`, `shortDescription`/`shortDescriptionAr`). Added `offices.description_ar` and `office_services.name_ar` this way. `serviceTags`/`services` in the API are `{name, nameAr}` objects, not bare strings.
- `offices.city` deliberately has **no** `cityAr` column (a prior, intentional decision — see `citySynonyms.ts` on the server for the search-side reason). Display-side localization instead uses a static `citiesMap`/`localizedCity()` helper in the frontend `i18n.ts`, mirroring `categoriesMap`. Lookup must be case-insensitive — real office `city` values are free text and casing varies (e.g. "BURAIDAH" vs "Buraidah").
- **Why:** avoids per-office Arabic city entry for a field whose values cluster into a small, known set of Gulf/Levant cities; a city outside the curated map just shows as-is in both languages (same spirit as the English-fallback pattern below), which is an accepted, non-silent gap rather than a bug.
- Client-side fallback pattern (`pickLocalized` in `i18n.ts`): in Arabic mode, use the `*Ar` field only if non-empty, else fall back to the English value (never a raw key/blank). This is a *deliberate, documented* fallback, not a "mixed content" bug — apply it consistently to any new bilingual field.
- Missing-Arabic-content is flagged for admin review by reusing the existing audit log (`recordAuditLog`, action `bilingual_content_gap`) inside `serializeOfficeProfile`, deduped in-memory per office per process lifetime — no new schema/endpoint needed for this pilot's scale.
- The office detail "Decision Card" can render as a full-screen modal overlay (`variant: 'modal'` in `office-profile.tsx`) that covers the site header entirely, including its language toggle. It needed its own small in-card toggle (next to the close button) — any future full-screen overlay in this app should check whether it similarly orphans a global control it depends on.
