---
name: SkayOffice bearer-auth gap in raw fetch() calls
description: After switching to bearer-token sessions (Autoscale strips Set-Cookie), any code that calls fetch() directly instead of the generated api-client hooks loses auth silently in production.
---

The bearer-token session fallback (see `autoscale-cookie-stripping.md`) only auto-attaches
`Authorization: Bearer <token>` for requests made through `@workspace/api-client-react`'s
generated hooks (wired via `setAuthTokenGetter` in `custom-fetch.ts`). Any hand-rolled
`fetch()` call in app code — e.g. the two-step object-storage upload flow
(`POST /storage/uploads/request-url` before the actual PUT) — does **not** go through that
path and had no Authorization header at all.

**Why:** in dev, a same-origin `fetch()` picks up the `connect.sid` cookie automatically, so
this class of bug is invisible there. In production, there is no cookie to pick up, so the
same call 401s — surfacing as an upload that silently hangs/fails right after the file is
picked, while everything that uses the generated hooks (e.g. the profile form) keeps working.
This is exactly the kind of regression the bearer-token fallback introduces if not swept
across *all* direct-fetch call sites, not just the generated client.

**How to apply:** whenever adding/reviewing a raw `fetch()` call in `skayoffice-pilot` (or
`use-upload.ts` in `object-storage-web`), attach the bearer token explicitly — use
`authFetch()` from `artifacts/skayoffice-pilot/src/lib/sessionToken.ts`, or the hook's
`getAuthToken` option — instead of assuming cookies will carry the session.
</content>
