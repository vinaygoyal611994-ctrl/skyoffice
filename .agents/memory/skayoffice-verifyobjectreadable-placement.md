---
name: SkayOffice verifyObjectReadable placement
description: verifyObjectReadable must be skipped for locked-status offices in PATCH /offices/me, or cover/logo uploads are systematically rejected.
---

# Rule

`verifyObjectReadable` must only run for offices whose edits go **directly live** (draft / changes-requested statuses). For locked offices (active / approved / suspended), skip the check — pending changes sit in `pendingChanges` until an admin approves them, giving GCS plenty of time to propagate.

**Why:** GCS object propagation after a presigned PUT takes ~3.5–4 s. The Uppy `onComplete` callback fires within milliseconds of the upload finishing. `verifyObjectReadable` uses `getObjectEntityFile`, which throws `ObjectNotFoundError` for an object that uploaded but hasn't propagated yet. `ObjectNotFoundError` is the short-circuit branch — it returns `false` immediately with zero retries. So `PATCH { coverUrl }` always returns 400 `file_not_readable` for locked offices, and `coverUrl` is never staged in `pendingChanges`.

**How to apply:** In `artifacts/api-server/src/routes/offices.ts`, determine `isLocked` right after the `under_review` guard (before the locked-branch). Run `verifyObjectReadable` only inside `if (!isLocked) { … }`. The locked branch below it can then use `isLocked` directly instead of re-evaluating the status.

**Companion bug:** `pendingChanges` must be merged (not replaced) on every PATCH — use `{ ...existingPending, ...pendingData }` so a cover upload followed by a text save doesn't discard the first change.
