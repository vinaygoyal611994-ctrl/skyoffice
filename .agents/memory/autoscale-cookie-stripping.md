---
name: Autoscale strips app Set-Cookie headers
description: Why session cookies (e.g. connect.sid) never reach the browser on Replit Autoscale deployments, and the bearer-token workaround used in SkayOffice.
---

On this project's Autoscale deployment (`skayoffice-pilot`, `https://skayoffice-pilot.replit.app`), the app's own `Set-Cookie` header (e.g. `connect.sid` from `express-session`) never reaches the browser. Only Google's own `GAESA` affinity cookie survives — confirmed by counting `Set-Cookie` headers in the raw response (exactly one, and it's `GAESA`). `app.set('trust proxy', ...)` was not the cause; there was no proxy-trust config issue in the app code. This reproduced consistently across all three user roles (admin/office/customer) and did not happen on the `*.replit.dev` dev domain — only on the published Autoscale URL.

**Why:** appears to be a platform-level behavior of the Autoscale/Google Frontend layer stripping or replacing the app's own `Set-Cookie` header before it reaches the client. Not fixable via cookie flags (`secure`, `sameSite`, `httpOnly`, etc.) — verified those aren't the cause since the header never arrives at all, not just gets rejected client-side. Switching deployment type (Autoscale → Reserved VM) would likely resolve it, but is often off-limits per user constraints.

**How to apply:** if a user reports login/session state not persisting only on the published `*.replit.app` URL (works fine on `*.replit.dev`), suspect this first. Reproduce with curl against production: check the login response's raw headers for how many `Set-Cookie` lines exist and whether the app's own session cookie name is among them.

**Workaround pattern used (no deployment-type change, no schema change, no session-store change):**
- Server keeps using its existing `express-session` + store as-is.
- On login/register, after `req.session.save()` resolves, include the raw `req.sessionID` in the JSON response body (e.g. as `sessionToken`), alongside the normal user payload.
- Add middleware (before the `session(...)` middleware) that reads an `Authorization: Bearer <token>` header, and — using the `cookie-signature` package with the same secret configured for `express-session` — re-signs it into the exact `s:<sid>.<hmac>` format `express-session` expects, injecting it into the request as if it were a `connect.sid` cookie. This lets all existing `req.session` logic work unchanged.
- Client stores the token (e.g. `localStorage`) after login and resends it as `Authorization: Bearer <token>` on every request; clears it on logout.
- This is purely additive — real cookie-based sessions (e.g. in dev, where `Set-Cookie` isn't stripped) keep working unaffected, since the shim middleware only activates when an `Authorization: Bearer` header is present.
- In this codebase, `@workspace/api-client-react`'s `setAuthTokenGetter`/`setBaseUrl` (in `custom-fetch.ts`) already existed for mobile/Expo use and was repurposed for the web app to attach the header automatically.
