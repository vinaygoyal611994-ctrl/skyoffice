---
name: SkayOffice activation & upload reliability fixes
description: Structured-error pattern for activation blockers, storage-readability verification, and Uppy retry-safety used in the SkayOffice Pilot app.
---

**Structured blocker errors:** activation/reactivation failures return `{ error, blockers: string[] }` (new `ActivationBlockedError` openapi schema), mirroring the existing `{error, missingFields}` submit-validation convention. `AdminApplicationDetail.activationBlockers` lets the admin UI disable Activate/Reactivate proactively instead of only failing after click.

**Why:** the prior single joined-string error gave admins no actionable detail, and nothing prevented clicking Activate when it was guaranteed to fail.

**Storage-readability verification:** a shared `verifyObjectReadable(objectPath)` helper (in `objectStorage.ts`) retries a GCS existence check up to 3x with short backoff before concluding a file is unreadable — `ObjectNotFoundError` short-circuits immediately since retrying can't change a genuine 404. Used by both the activation-blocker check and by the office/media/document association routes (`PATCH /offices/me`, `POST /offices/me/media`, `POST /offices/me/documents`), which now reject with `{error, code: 'file_not_readable'}` before persisting a URL that might be broken.

**Why:** the GCS existence check is a live network call via the Replit sidecar and can fail transiently, independent of whether the file truly exists — this was the confirmed root cause of intermittent activation 400s.

**Uppy upload-reliability pattern:** in the shared `ObjectUploader` (`lib/object-storage-web`), `onComplete` may return a Promise; the Dashboard modal stays open (with the trigger button disabled) until it settles, and only closes if there were no per-file failures — this stops the UI from reading "success" before the association API call actually confirms it. `uppy.clear()` runs after a successful batch so reopening the modal can't re-fire `complete` for an already-processed file (duplicate-record risk). Bilingual (AR/EN) restriction-violation strings are set via Uppy's `locale.strings` option directly on the Uppy instance, since this app's admin/dashboard pages predate the `useI18n()` system and have no language toggle.

**How to apply:** reuse this pattern (structured blockers + `verifyObjectReadable` + awaited `onComplete` + `uppy.clear()`) for any future upload-adjacent feature in this app rather than re-deriving it.
