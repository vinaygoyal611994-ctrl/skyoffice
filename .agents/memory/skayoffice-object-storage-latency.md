---
name: SkayOffice Pilot object-storage image latency
description: Why office cover/gallery images can render as a blank/gray box for the first few seconds on this project, and how it was mitigated.
---

Serving an uploaded image through the api-server's `/api/storage/objects/*` route (backed by `ObjectStorageService.downloadObject`) takes roughly 3.5-4 seconds per request in this environment, confirmed via workflow logs (`request completed ... responseTime: ~3800`, and even `request aborted` when a screenshot/tool times the page out before the fetch finishes). This is backend/network latency to the object storage backend, not an app bug — the same delay reproduces on freshly seeded images that are confirmed valid on disk.

**Why it matters:** a plain `<img src=.../>` with no loading state looks like a broken/blank/gradient box for several seconds after each fresh page load (no browser cache yet), which can look like a rendering bug during screenshot-based verification even though the request is healthy and eventually returns 200.

**How to apply:** don't chase this as a code bug — retrying the same screenshot rarely fixes it deterministically. Instead, give image-led cards/heroes an explicit loading state (e.g. skeleton/pulse background shown until the `<img>`'s `onLoad` fires, then fade in) so the slow first fetch reads as "loading" rather than "broken". Also avoid `loading="lazy"` on above-the-fold cover images — it defers the request start and compounds the delay.
