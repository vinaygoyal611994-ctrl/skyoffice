---
name: SkayOffice public share URL was pointing at an unrelated external site
description: VITE_PUBLIC_APP_URL and VITE_PLATFORM_SHARE_URL were set to URLs that didn't actually serve this app — verify before trusting a "prod URL" env var.
---

Found (2026-07-15) two problems in the env vars that back `getAppBaseUrl()`/`getPlatformShareUrl()` in `artifacts/skayoffice-pilot/src/lib/publicUrl.ts`:

1. `VITE_PLATFORM_SHARE_URL` was set to a `*.sisko.replit.dev` development preview URL (with a `?nativeBrowserPresentationStyle=fullScreen` query string left over from testing). Anyone using the homepage "Share SkayOffice" button got a link that opened the Replit dev workspace / "Run this app" page instead of the live site.
2. `VITE_PUBLIC_APP_URL` was set to `https://skayoffice.com`, which resolves (200 OK, page title "SkayOffice") but is served by **Netlify**, not this Replit deployment — confirmed via `curl -I` (`server: Netlify` vs. `server: Google Frontend` for the real `getDeploymentInfo().primaryUrl`). It was an unrelated external site, not a verified custom domain on this deployment's `additionalUrls`. Every office QR code and share link built from it would have sent visitors to the wrong website.

**Why:** a plausible-looking custom domain in an env var is not proof it's actually wired to the current deployment. `additionalUrls` from `getDeploymentInfo()` is the source of truth for verified custom domains — an env var can drift from it silently (e.g. left over from a domain purchased for later, or copy-pasted from a different project).

**How to apply:** whenever a "production base URL" env var is suspected of being wrong, don't just curl it and check for 200 — also check response headers (`server:`, or any Replit-specific header) and confirm the returned page is actually this app's build (compare `<title>`, asset hashes, or a known route) before trusting it. Cross-check against `getDeploymentInfo().primaryUrl` / `additionalUrls`, which reflect what Replit itself considers this deployment's public URL(s).
