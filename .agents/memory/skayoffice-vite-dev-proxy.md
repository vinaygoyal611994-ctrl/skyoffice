---
name: SkayOffice Vite dev proxy + CORS port
description: The Vite dev server needs a /api proxy with changeOrigin so Playwright/testing subagents work without the Replit reverse proxy; the CORS allowlist must include the actual dev port.
---

# Rule

When Playwright (or any browser) accesses the app at `localhost:25700` directly (bypassing the Replit reverse proxy), two things must hold:

1. **Vite proxy**: `vite.config.ts` → `server.proxy` must include `{ '/api': { target: 'http://localhost:8080', changeOrigin: true } }`. Without `changeOrigin`, the browser's `Origin: http://localhost:25700` is forwarded to the API server, which rejects it. Without the proxy entry at all, `/api/…` calls hit the Vite SPA fallback and return HTML.

2. **CORS allowlist**: `artifacts/api-server/src/app.ts` → `buildAllowedOrigins()` must add `http://localhost:25700` and `http://127.0.0.1:25700` in the `NODE_ENV !== "production"` block. The old entry `localhost:5173` is the stale Vite default port; the actual dev port is 25700 (assigned via `PORT` env var by the artifact config).

**Why:** The Replit reverse proxy normally handles routing: `/skayoffice-pilot/*` → port 25700 and `/api/*` → port 8080, all under one hostname, so CORS never triggers. Testing subagents use localhost URLs and bypass that proxy, exposing both gaps.

**How to apply:** Add the proxy entry and the two `localhost:25700` origins whenever either gap surfaces. This is dev-only — production uses the built static bundle served by `server.mjs`, not the Vite dev server.

**Routing note:** When using `localhost:25700` directly (not through the Replit proxy), the app is at `/` (not `/skayoffice-pilot/`). The base path prefix is only present in the Replit-proxied URL.
