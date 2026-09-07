---
name: SkayOffice upload category enum split
description: The upload category allow-list lives in two places that must stay in sync; verifyObjectReadable must not run on freshly-uploaded media objects.
---

# SkayOffice upload category enum split

## The rule
Upload categories must be declared in **both**:
1. `artifacts/api-server/src/routes/storage.ts` — `UPLOAD_LIMITS` map (runtime enforcement)
2. `lib/api-spec/openapi.yaml` — `UploadUrlRequest.category` enum (~line 3399)
3. `lib/api-zod/src/generated/api.ts` — `RequestUploadUrlBody.category` zod enum (~line 2320) and the matching `RequestUploadUrlResponse.metadata.category` enum (~line 2339)

If a category is in `UPLOAD_LIMITS` but not in the schema enum, the request fails at Zod validation with HTTP 400 "Missing or invalid required fields" — a silent breakage visible only at upload time.

**Why:** `quick_card_cover` and `decision_card_cover` were added to `UPLOAD_LIMITS` but not to the OpenAPI spec or generated Zod schema. Every upload using those categories was rejected.

**How to apply:** When adding a new upload category, update all three locations in one PR. Task #83 tracks making this a single source of truth.

---

## verifyObjectReadable must not run on media uploads

`verifyObjectReadable()` in `objectStorage.ts` retries up to 10 times × 500 ms = 5 s. GCS object propagation after a signed-URL PUT takes 3.5–4 s. Calling it immediately after `onComplete` consistently returned false.

**Affected endpoints (check was removed):**
- `POST /offices/me/media` — gallery images and DC covers
- `PATCH /offices/me/quick-card-cover` (unlocked/draft branch)
- `PUT /offices/me/marketing-video`

**Still uses the check (correct):**
- `POST /offices/me/documents` (~line 945) — admins review the file immediately; the 5 s retry window handles timing.

**Why it's safe to skip:** The object path is server-generated (signed-URL endpoint), and Uppy's `onComplete` fires only after HTTP 200 from the GCS PUT, confirming the file exists.

**How to apply:** Never add `verifyObjectReadable` to media upload endpoints. Only use it where an admin will immediately inspect the file (documents).
