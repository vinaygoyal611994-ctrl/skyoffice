---
name: Freelancer gallery image selection
description: How freelancers select Quick Card Image and Decision Card Main Image from their gallery, after the personal-photo feature was removed.
---

## Rule
Freelancers use gallery images (`decision_gallery` placement) for both card surfaces. No separate personal-photo upload exists.

- **Quick Card Image** → `coverUrl` column, set immediately via `PATCH /offices/me/media/:mediaId/quick-card-image` (freelancer-only; bypasses pending-review because the image is already approved)
- **Decision Card Main Image** → `primaryMediaId` column, set via the existing `PATCH /offices/me/media/:mediaId/primary` endpoint

**Why:** The old circular-avatar personal photo feature was removed. Gallery images are already approved through the normal media review flow, so they can be set immediately without another admin review cycle.

**How to apply:** Any future freelancer image-display work should use `coverUrl` (Quick Card) and `primaryMediaId` (Decision Card hero) — not `logoUrl` or `freelancerImageStyle`.

## Serializer behavior (heroGalleryItemId)
`serializeOfficeProfile` returns `heroGalleryItemId: number | null`. When non-null, the gallery item with that ID is being used as the Decision Card hero (`approvedDecisionCardCover`). The public profile (`office-profile.tsx`) skips that item in the gallery carousel to avoid showing it twice.

- `heroGalleryItemId` is non-null only for freelancers with `primaryMediaId` set and no real `decision_card_cover` media row.
- `gallery` in the serializer always includes ALL approved gallery items (including the hero one), so the dashboard can manage them.

## Dead fields (backward compat only, no UI renders them)
- `logoUrl`: was the personal-photo URL; kept in DB/schema but not shown anywhere
- `freelancerImageStyle`: `personal_photo | brand_image` enum; kept in DB/schema; `freelancerImageStyle: _discardedFis` is stripped from pendingData in PATCH /offices/me locked branch to prevent accidental staging
