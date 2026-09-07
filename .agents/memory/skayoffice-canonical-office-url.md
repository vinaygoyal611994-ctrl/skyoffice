---
name: SkayOffice canonical office public URL (slug + language)
description: How the office QR/share/copy-link URL is built and why — stable slug, VITE_-prefixed prod base URL, route-collision handling.
---

Office public links (QR code, copy-link, native share, WhatsApp share) all resolve to
one canonical URL: `${VITE_PUBLIC_APP_URL}/{ar|en}/office/{slug}`, built by
`getOfficePublicUrl()` in `artifacts/skayoffice-pilot/src/lib/publicUrl.ts`.

- `slug` is a stable column on `officesTable`, generated once at office creation from the
  English name and never changed on rename — printed/shared/scanned links must keep working
  even if the office renames itself or its internal numeric `id` changes.
- The public `GET /offices/:officeId` endpoint accepts either the numeric id (legacy links,
  still supported) or the slug in the same path parameter, detected via a numeric regex.
- `VITE_PUBLIC_APP_URL` is a Vite-exposed (client-side) env var holding the real production
  origin (`https://skayoffice.com`). It must be prefixed `VITE_` or the frontend build can't
  see it — Vite only exposes `VITE_`-prefixed vars to client code. Missing this prefix is a
  common way this kind of "prod base URL" var silently doesn't work.
- **Why:** without it, a client-rendered QR/share URL would fall back to whatever origin is
  currently serving the page — a temporary `*.replit.dev` preview domain in dev, which is
  exactly the bug this fixes. The dev fallback (`window.location.origin`) is intentional and
  should never be "improved away" — it's what keeps QR codes testable in preview.
- **Route collision gotcha:** the app already had a literal route `/office/dashboard`
  (singular, office-portal). Adding the slug route `/office/:slug` required declaring it
  *after* `/office/dashboard` in wouter's `<Switch>` (first-match-wins, not most-specific) or
  visiting `/office/dashboard` would get swallowed as slug="dashboard". Same care needed for
  any regex used elsewhere (e.g. the office-modal-overlay background-location logic) matching
  `/office/...` — must explicitly exclude `/office/dashboard` there too.
