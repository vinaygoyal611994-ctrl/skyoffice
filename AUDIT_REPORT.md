# SkayOffice — Comprehensive Technical Audit Report

**Audit Date:** 19 July 2026  
**Audited By:** Replit Agent (read-only, no modifications made)  
**Scope:** Production codebase only — `artifacts/api-server`, `artifacts/skayoffice-pilot`, `lib/db`, `lib/api-zod`  
**Build/Version:** Current HEAD of the monorepo; no commit SHA is surfaced from within the environment  
**Confirmation:** No code, files, dependencies, database records, production data, configuration, or environment settings were modified during this audit.

---

## 1. Executive Summary

SkayOffice is a bilingual (Arabic/English) office-and-freelancer marketplace built on a TypeScript monorepo: an Express/Drizzle API server and a React/Vite frontend. The architecture is coherent for a pilot phase and follows several modern best practices — server-side role enforcement, Zod-validated API contracts, Helmet security headers, rate limiting, and structured audit logging for admin actions.

However, the codebase carries meaningful risks that must be acknowledged before public launch:

- **Zero automated tests.** The entire system — authentication, RBAC, registration, approval, activation, media handling — is verified only by manual smoke scripts. A regression in any critical workflow will not be caught automatically.
- **Registration has no database transaction.** A partial failure during office signup can create orphaned user records with no matching office, with no cleanup mechanism.
- **Significant i18n incompleteness.** Key admin and public-facing UI components contain hardcoded Arabic and English strings that bypass the translation layer, making the platform unreliable for its bilingual audience.
- **No subscription or payment schema exists.** The platform is not ready for paid plans. Activating a payment gateway today would require schema design, backend enforcement logic, and webhook infrastructure — none of which is in place.
- **The JavaScript bundle is not code-split.** All routes, dashboard sections, admin panels, Uppy uploader, Recharts, and Framer Motion ship to every visitor in a single bundle. This will produce poor First Contentful Paint for public (non-dashboard) visitors on mobile.
- **No server-side caching.** Every request — including heavy AI assistant threads and office list queries — hits the database cold.

The platform is **ready with conditions** for its current pilot phase, but is **not ready** for a public commercial launch without addressing the items flagged Critical and High below.

---

## 2. Scores

| Area | Score |
|---|---|
| Overall Code Quality | **62 / 100** |
| Maintainability | **58 / 100** |
| Production Stability | **65 / 100** |
| Security | **74 / 100** |
| Scalability Readiness | **40 / 100** |
| Test-Coverage Confidence | **8 / 100** |
| Payment-Integration Readiness | **12 / 100** |
| **Technical Debt Level** | **High** |

---

## 3. Finding Counts

| Severity | Count |
|---|---|
| Critical | 2 |
| High | 9 |
| Medium | 14 |
| Low | 8 |
| **Total** | **33** |

---

## 4. Individual Findings

### CRITICAL

---

#### CRIT-01 — Registration has no database transaction; orphaned users are created on partial failure

> **STATUS: CLOSED ✅** — Fixed in commit `64c9002` (2026-07-20). Production-validated and permanently closed in commit `b8d95f1` (2026-07-20). See `PRODUCTION_FINAL_VALIDATION.md §CRIT-01 Final Closure`.

- **Severity:** Critical  
- **Category:** F — Database & Data Integrity / G — Registration Workflows  
- **Affected:** `artifacts/api-server/src/routes/auth.ts` lines ~56–185 (registration handler)  
- **Explanation:** The office and freelancer registration flow inserts a row into `usersTable` first, then derives a slug and inserts into `officesTable`. Neither step is wrapped in `db.transaction(...)`. If the second insert fails (e.g., slug collision, DB constraint, network blip), the user record is committed but no office record exists. The orphaned user account cannot log in (no office record to resolve) and cannot re-register (email already taken).  
- **Evidence:** No `db.transaction` call found in `auth.ts`. Drizzle's `db.transaction` API is available but unused in this path.  
- **Business Impact:** Silent signup failures with no recovery path. Affected users cannot be helped without direct DB intervention.  
- **Technical Impact:** Orphaned users accumulate over time; admin cannot see or clean them through the admin panel.  
- **Security/Data Risk:** Low direct security risk, but creates permanent inconsistent state.  
- **Recommended Action:** Wrap the user insert, slug generation, and office insert in a single `db.transaction(async (tx) => { ... })` call. Roll back if any step fails.  
- **Must fix before launch:** Yes  
- **Effort:** Small  
- **Risk of change:** Low — additive wrapping with no schema change  
- **Dependencies:** None  

**Resolution (2026-07-20):**

| Commit | Change |
|--------|--------|
| `64c9002` | `db.transaction()` wraps entire registration flow (user INSERT + slug check + office INSERT + both audit-log entries). Customer registration also fully transactional. `auditLog.ts` extended with optional `tx` parameter so audit records join the surrounding transaction. 61 unit tests added. |
| `b8d95f1` | `isDuplicateKeyError()` extended to handle drizzle-orm@0.45.x `_DrizzleQueryError` wrapper — `23505` code lives on `.cause.code`, not top level; concurrent-race loser now returns 409 instead of 500. |

**Production validation (2026-07-20, commit `1d119cc`):**

| Test | Result |
|------|--------|
| Customer registration → 201, user + audit row created | ✅ PASS |
| Office registration → 201, user + office + 2 audit rows, all in one transaction | ✅ PASS |
| Duplicate email (sequential) → 409, 0 DB writes | ✅ PASS |
| Duplicate email (concurrent DB race) → one 201 + one 409, 0 orphans | ✅ PASS |
| 7 × validation failure → 400, 0 DB writes | ✅ PASS |
| DB state after all tests: no orphaned users, offices, or audit rows | ✅ PASS |  

---

#### CRIT-02 — Zero automated tests across the entire platform

- **Severity:** Critical  
- **Category:** P — Tests & QA  
- **Affected:** Entire codebase — no `*.test.ts`, `*.test.tsx`, `*.spec.ts` files found in `artifacts/api-server/` or `artifacts/skayoffice-pilot/`. One shell script (`smoke-test-provider-types.sh`) exists but is manual.  
- **Explanation:** No automated test suite exists. Authentication, session handling, RBAC enforcement, registration state machine, approval/rejection flows, media ownership checks, admin-only endpoints, and the AI assistant are all untested by code. Any refactor or dependency upgrade has zero regression safety.  
- **Evidence:** `find artifacts lib -name "*.test.*" -o -name "*.spec.*"` returns nothing.  
- **Business Impact:** Regressions in login, registration, or media upload go undetected until reported by users. Confidence in deployments is entirely based on developer memory.  
- **Technical Impact:** Prevents safe refactoring of the large route files. Blocks adding contributors without high breakage risk.  
- **Security/Data Risk:** A security regression (e.g., accidentally removing `requireRole("admin")`) would not be caught.  
- **Recommended Action:** Start with a critical-path API test suite covering: registration, login, logout, role enforcement (admin/office/guest), IDOR checks, and activation state machine. Use Vitest or Jest + Supertest. Target 60% API route coverage before launch; 80% within 30 days after.  
- **Must fix before launch:** Yes (at minimum: auth and RBAC tests)  
- **Effort:** Large  
- **Risk of change:** None — tests are additive  
- **Dependencies:** None  

---

### HIGH

---

#### HIGH-01 — Hardcoded Arabic and English UI strings bypass the i18n layer

- **Severity:** High  
- **Category:** J — Localization  
- **Affected:**  
  - `artifacts/skayoffice-pilot/src/components/OfficesTable.tsx` lines 46–78 (status labels, messages)  
  - `artifacts/skayoffice-pilot/src/components/ContactAnalytics.tsx` lines 80–215 (all chart labels)  
  - `artifacts/skayoffice-pilot/src/pages/office-profile.tsx` lines 548, 625 (WhatsApp template, language toggle)  
  - `artifacts/skayoffice-pilot/src/pages/admin/index.tsx` line 119  
  - `artifacts/skayoffice-pilot/src/components/CustomerManagement.tsx` (ternary-based `language === 'ar'` string switching)  
- **Explanation:** These files contain raw Arabic Unicode characters or English strings outside any `t()` call. Switching the language toggle will not translate these strings; they remain locked to whichever language is hardcoded.  
- **Evidence:** Arabic Unicode characters (U+0600–U+06FF) found in source files outside `src/lib/i18n.ts` and the locale data files. Pattern: `language === 'ar' ? '...' : '...'` used as a manual substitute for the translation function.  
- **Business Impact:** Bilingual users see mixed-language screens. Arabic-only users see English strings in the admin panel; English-only users see Arabic strings in the public office profile.  
- **Technical Impact:** Spreads translation logic across the codebase instead of centralising it, making future language additions very difficult.  
- **Recommended Action:** Audit every file using the Unicode grep pattern and replace all raw strings with `t('key')` calls. Add all missing keys to both `ar` and `en` translation objects.  
- **Must fix before launch:** Yes  
- **Effort:** Medium  
- **Risk:** Low  
- **Dependencies:** None  

---

#### HIGH-02 — JavaScript bundle is not code-split; single large bundle for all routes

- **Severity:** High  
- **Category:** N — Performance  
- **Affected:** `artifacts/skayoffice-pilot/src/App.tsx`, `vite.config.ts`  
- **Explanation:** The React app has no `React.lazy()` or dynamic `import()` in `App.tsx`. Every route — homepage, office profile, full dashboard, admin panel, Uppy upload UI, Recharts analytics, Framer Motion animations — is bundled into a single JS chunk delivered to every visitor including anonymous public users viewing an office profile.  
- **Evidence:** `App.tsx` imports all page components statically. No `React.lazy`, `Suspense`, or Vite `build.rollupOptions.output.manualChunks` configuration found.  
- **Business Impact:** Public visitors (the majority) pay the full bundle cost — including admin panel and dashboard code they will never use. On a 4G mobile connection, First Contentful Paint is significantly delayed, directly affecting SEO and bounce rate.  
- **Technical Impact:** As the product grows, the bundle will become progressively worse without active intervention.  
- **Recommended Action:** Wrap all route-level page components in `React.lazy()` with a `<Suspense>` boundary at the router level. This alone will split the bundle per route automatically via Vite.  
- **Must fix before launch:** Yes (for public-facing routes at minimum)  
- **Effort:** Small–Medium  
- **Risk:** Low  
- **Dependencies:** None  

---

#### HIGH-03 — No server-side or client-side caching; every request hits the database cold

- **Severity:** High  
- **Category:** N — Performance  
- **Affected:** `artifacts/api-server/src/routes/offices.ts`, `platform.ts`, `assistant.ts`; `artifacts/skayoffice-pilot` React Query configuration  
- **Explanation:** No `Cache-Control` response headers are set on any API endpoint. React Query `staleTime` and `gcTime` are not configured globally or per-query, meaning the defaults (staleTime=0) cause refetches on every component mount. Public office listings, platform statistics, and individual office profiles are fetched fresh on every page load.  
- **Evidence:** No `res.set('Cache-Control', ...)` in any route handler. No `QueryClient` configuration with `defaultOptions` in the frontend. No Redis or in-memory cache layer in the API.  
- **Business Impact:** Under moderate traffic, office listing and profile pages will saturate the DB connection pool. AI assistant thread loading is particularly slow cold.  
- **Technical Impact:** Latency grows linearly with user count. No headroom for traffic spikes.  
- **Recommended Action:** (1) Add `Cache-Control: public, max-age=60` on the office list endpoint and individual public office profiles. (2) Set React Query `staleTime: 60_000` globally for public-facing queries. (3) For platform statistics, add a short-lived server-side cache (simple in-memory `Map` with TTL is sufficient for pilot).  
- **Must fix before launch:** Yes (at least for public list/profile endpoints)  
- **Effort:** Small  
- **Risk:** Low  
- **Dependencies:** None  

---

#### HIGH-04 — No subscription or payment schema; payment integration readiness is near zero

- **Severity:** High  
- **Category:** Q — Payment & Subscription Readiness  
- **Affected:** `lib/db/src/schema/` (no subscriptions/plans/transactions tables); `artifacts/skayoffice-pilot/src/pages/dashboard/Subscription.tsx` (hardcoded "Pilot" UI)  
- **Explanation:** There is no `subscriptions`, `plans`, `payment_attempts`, or `transactions` table in the database schema. The `offices` table contains a single integer column `completed_transactions` which is a placeholder, not a real payment model. The `Subscription.tsx` dashboard page renders a hardcoded "Pilot" badge with no real data.  
- **Evidence:** `lib/db/src/schema/` contains no subscription-related table definitions. No Stripe, RevenueCat, or any payment provider referenced in source.  
- **Business Impact:** The platform cannot charge for services, cannot enforce paid-only features, and has no audit trail for financial transactions.  
- **Technical Impact:** Adding payments will require schema migration, backend enforcement logic (no frontend-only activation), webhook infrastructure, and plan-to-providerType validation — none of which is scaffolded.  
- **Security Risk:** Without backend enforcement, a future payment integration that only checks frontend state could be bypassed.  
- **Recommended Action:** Before integrating a gateway: (1) design the `plans` and `subscriptions` schema, (2) add a `subscription_status` column to `offices`, (3) add plan-type validation (office vs freelancer plans are separate), (4) build webhook verification endpoint, (5) ensure all premium features are gated by a server-side `subscription_status` check, not frontend state.  
- **Must fix before launch:** No (for current pilot). Yes before any paid feature is enabled.  
- **Effort:** Large  
- **Risk:** Medium  
- **Dependencies:** HIGH-01 (providerType separation must be solid before plans are tied to it)  

---

#### HIGH-05 — Large route files concentrate business logic inline with request/response handling

- **Severity:** High  
- **Category:** A — Codebase Structure / C — Architecture  
- **Affected:**  
  - `artifacts/api-server/src/routes/admin.ts` (1,348 lines)  
  - `artifacts/api-server/src/routes/offices.ts` (1,185 lines)  
  - `artifacts/api-server/src/routes/assistant.ts` (1,061 lines)  
  - `artifacts/skayoffice-pilot/src/pages/office-profile.tsx` (1,129 lines)  
- **Explanation:** These files handle HTTP parsing, input validation, business logic (status machine transitions, activation blockers, audit logging), database queries, and response serialization all inline. There is no service layer, no use-case layer, and no separate repository layer.  
- **Evidence:** `admin.ts` contains approval, rejection, activation, suspension, document verification, media takedown, audit logging, and platform statistics — all in the same file.  
- **Business Impact:** As the product grows, adding features to these files becomes increasingly risky. A bug fix in one area can silently break an adjacent area in the same file.  
- **Technical Impact:** Unit testing individual business rules is impossible without instantiating the full Express stack. Onboarding a new developer requires understanding the full file before making a targeted change.  
- **Recommended Action:** Incrementally extract business logic into service modules (e.g., `src/services/officeService.ts`, `src/services/activationService.ts`). Start with the activation and pending-changes flows, which are complex and most likely to grow. This is not urgent for pilot but should be done in the first 30 days post-launch.  
- **Must fix before launch:** No  
- **Effort:** Medium  
- **Risk:** Medium (refactoring without tests is risky — do CRIT-02 first)  
- **Dependencies:** CRIT-02 (tests needed before safe refactoring)  

---

#### HIGH-06 — Admin panel uses browser `confirm()` for destructive actions; fails on mobile/embedded

- **Severity:** High  
- **Category:** H — Admin Panel / L — Interactive Controls  
- **Affected:** `artifacts/skayoffice-pilot/src/components/OfficesTable.tsx`, `RegistrationRequests.tsx`  
- **Explanation:** High-risk admin actions (office deletion, video takedown) are confirmed via `window.confirm()`. This native dialog is suppressed in iOS WebView, embedded browsers, and some browser policies, meaning the confirmation may silently pass without the admin seeing it. It also provides no context (e.g., which office is being deleted).  
- **Evidence:** `confirm()` calls found in OfficesTable.tsx and RegistrationRequests.tsx for delete and takedown actions.  
- **Business Impact:** An admin on a mobile device or using an embedded browser could accidentally delete an office without any warning.  
- **Technical Impact:** Poor UX for admin operations; not internationalizable.  
- **Recommended Action:** Replace `confirm()` calls with the existing Radix UI `AlertDialog` component, already present in the UI library. Show the office name and action type in the dialog body.  
- **Must fix before launch:** Yes  
- **Effort:** Small  
- **Risk:** Very low  
- **Dependencies:** None  

---

#### HIGH-07 — Session cookie lifetime is 30 days with no rotation or sliding expiry

- **Severity:** High  
- **Category:** D — Authentication  
- **Affected:** `artifacts/api-server/src/app.ts` line ~238 (`maxAge: 30 * 24 * 60 * 60 * 1000`)  
- **Explanation:** Session cookies are valid for 30 calendar days from creation with no rotation. A stolen session cookie is valid for the full 30-day window. Additionally, there is no per-session device tracking or forced re-authentication for sensitive actions (e.g., password change, account deletion).  
- **Evidence:** `maxAge: 30 * 24 * 60 * 60 * 1000` in session config. No session rolling (`rolling: true`) or re-authentication check on sensitive mutations.  
- **Business Impact:** A compromised session gives an attacker full account access for up to 30 days.  
- **Technical Impact:** No mechanism to revoke a specific session without destroying all sessions (no per-session revocation via Redis).  
- **Recommended Action:** (1) Enable `rolling: true` on the session so the cookie extends only when the user is active. (2) Reduce `maxAge` to 7 days. (3) For admin sessions specifically, reduce to 8 hours. (4) For sensitive mutations (password change), require re-entry of the current password.  
- **Must fix before launch:** Yes (at minimum reduce admin session lifetime)  
- **Effort:** Small  
- **Risk:** Low  
- **Dependencies:** None  

---

#### HIGH-08 — Images are not optimized; no responsive srcset, no format negotiation

- **Severity:** High  
- **Category:** N — Performance / I — Media Handling  
- **Affected:** `artifacts/skayoffice-pilot/src/pages/office-profile.tsx` line ~200; `QuickOfficeCard.tsx`; all image-serving paths  
- **Explanation:** Office images are served directly from Google Cloud Storage at their original upload resolution and format (JPEG/PNG). There is no server-side resizing, no WebP conversion, no `srcset` attribute on `<img>` elements, and no CDN edge caching. A 4 MB original cover image is sent to a mobile device that only needs a 400px thumbnail.  
- **Evidence:** `<img src={coverUrl} ...>` in card components without `srcset` or `sizes`. GCS URLs served directly. Object storage fetch latency documented at 3.5–4s (per prior internal notes).  
- **Business Impact:** Office listing pages are slow on mobile. The 3.5–4s image load time per image in carousels creates a poor first impression.  
- **Technical Impact:** As the number of offices grows, image bandwidth costs scale with no optimization.  
- **Recommended Action:** (1) Add an image-proxy endpoint (`/api/img?url=...&w=400&fmt=webp`) using `sharp` to resize and re-encode on first request, caching the result to object storage. (2) Add `srcset` and `sizes` to all card and gallery `<img>` elements. (3) Ensure `loading="lazy"` is present on all below-fold images (partially done).  
- **Must fix before launch:** Partial — at minimum `loading="lazy"` on all images and `srcset` for card thumbnails  
- **Effort:** Medium  
- **Risk:** Low  
- **Dependencies:** None  

---

#### HIGH-09 — No database backup schedule is configured or documented

- **Severity:** High  
- **Category:** F — Database & Data Integrity  
- **Affected:** Infrastructure (no backup cron or script found in `artifacts/api-server/src/` or project root)  
- **Explanation:** No automated backup script, cron job, or Replit deployment hook for database dumps was found in the codebase. If the production PostgreSQL instance is lost or corrupted, all office registrations, approved documents, assistant conversations, and audit logs are unrecoverable.  
- **Evidence:** No `pg_dump`, backup cron, or backup-related configuration file found anywhere in the project.  
- **Business Impact:** A database failure without backups means total loss of all registered offices, user accounts, conversations, and media metadata.  
- **Data Risk:** Critical — complete, unrecoverable data loss scenario.  
- **Recommended Action:** Configure daily automated `pg_dump` exports to a separate storage bucket (not the same GCS bucket used for uploads). Verify restore procedure. Document RTO/RPO targets.  
- **Must fix before launch:** Yes  
- **Effort:** Small (using Replit's managed DB backup features or a simple cron script)  
- **Risk:** None — additive  
- **Dependencies:** None  

---

### MEDIUM

---

#### MED-01 — No API versioning in URL paths

- **Severity:** Medium  
- **Category:** C — Architecture  
- **Affected:** All routes under `artifacts/api-server/src/routes/`  
- **Explanation:** All API endpoints are under `/api/...` with no version prefix (e.g., `/api/v1/...`). When breaking API changes are needed, there is no mechanism to serve old and new versions simultaneously. The frontend and API are in the same monorepo today, but a future mobile app or third-party integration will be unable to pin to a stable API version.  
- **Recommended Action:** Introduce `/api/v1/` prefix during the next major route refactor. Not urgent for the current pilot where frontend and backend are co-deployed.  
- **Must fix before launch:** No  
- **Effort:** Medium  
- **Risk:** Medium if done carelessly (breaking change for all existing clients)  

---

#### MED-02 — Missing `db.transaction` in pending-changes approval merge

- **Severity:** Medium  
- **Category:** F — Database Integrity / G — Workflows  
- **Affected:** `artifacts/api-server/src/routes/admin.ts` ~line 605 (pending-changes approval handler)  
- **Explanation:** When an admin approves pending changes, the staged JSON is merged into the office record and the `pendingChanges` column is cleared. If the update succeeds but the clear fails (or vice versa), the office could show merged changes while the old pending record still exists, or the pending record is cleared without the changes being applied.  
- **Recommended Action:** Wrap the approve-changes handler in a `db.transaction`.  
- **Must fix before launch:** Yes  
- **Effort:** Small  
- **Risk:** Low  

---

#### MED-03 — TypeScript `as any` casting undermines type safety in critical paths

- **Severity:** Medium  
- **Category:** A — Codebase Quality / B — Build Health  
- **Affected:** `artifacts/api-server/src/routes/offices.ts`, `artifacts/skayoffice-pilot/src/pages/admin/index.tsx`, `artifacts/skayoffice-pilot/src/components/Media.tsx`  
- **Explanation:** Extensive use of `as any` casts in route handlers and form components suppresses TypeScript's ability to catch type mismatches at compile time. The API codegen (Orval/Zod) produces typed schemas, but casting to `any` bypasses those types at the callsite.  
- **Evidence:** Multiple `as any` occurrences found in audit across all three files.  
- **Recommended Action:** Replace `as any` with proper discriminated union types or `unknown` + runtime narrowing. Prioritise the admin and offices route handlers.  
- **Must fix before launch:** No (pilot risk is low; but should be remediated post-launch)  
- **Effort:** Medium  
- **Risk:** Low  

---

#### MED-04 — N+1 query risk in office list and profile serialization

- **Severity:** Medium  
- **Category:** F — Database / N — Performance  
- **Affected:** `artifacts/api-server/src/routes/offices.ts` line ~155 (list endpoint); `serializeOfficeProfile` helper  
- **Explanation:** The office list endpoint fetches office rows and counts separately. The profile serializer potentially executes multiple sub-queries per office record when called in a loop context. Under low traffic (pilot scale) this is not observable, but under 100+ concurrent requests it will saturate connection pool.  
- **Recommended Action:** Consolidate related data using Drizzle's `with` (nested relation) syntax or a single query with `leftJoin` + `jsonAgg`. Run `EXPLAIN ANALYZE` on the list and profile queries.  
- **Must fix before launch:** No (pilot scale is safe)  
- **Effort:** Medium  
- **Risk:** Medium  

---

#### MED-05 — Missing translation keys between Arabic and English locale objects

- **Severity:** Medium  
- **Category:** J — Localization  
- **Affected:** `artifacts/skayoffice-pilot/src/lib/i18n.ts`  
- **Explanation:** The translation system uses a single file with `{ ar, en }` per key. When a new feature adds a key to the English side and neglects the Arabic side (or vice versa), the untranslated language receives `undefined` which typically renders as an empty string or the raw key, breaking the UI silently.  
- **Evidence:** Past known gaps in `nameAr`/city synonym search coverage (per prior audit notes). No automated check validates key parity between `ar` and `en`.  
- **Recommended Action:** Add a build-time or test-time check that validates every translation key has both `ar` and `en` values defined and non-empty.  
- **Must fix before launch:** Yes  
- **Effort:** Small  
- **Risk:** None  

---

#### MED-06 — No rate limiting on file upload endpoints

- **Severity:** Medium  
- **Category:** M — Security / I — Media  
- **Affected:** `artifacts/api-server/src/routes/storage.ts` or equivalent upload URL generation route  
- **Explanation:** Rate limiting is applied to login (`loginIpLimiter`) and registration (`registerIpLimiter`), and to the AI assistant message endpoint. However, the upload URL generation endpoint (which grants signed write access to object storage) does not appear to have equivalent rate limiting. An authenticated user could generate thousands of upload URLs in a tight loop.  
- **Recommended Action:** Add an `uploadLimiter` (e.g., 20 signed URLs per user per hour) to the upload URL generation route.  
- **Must fix before launch:** Yes  
- **Effort:** Small  
- **Risk:** Low  

---

#### MED-07 — `browser.confirm()` cannot be localized and fails in WebView environments

- (Cross-reference HIGH-06 — same root cause, localization dimension)  
- **Severity:** Medium (localization dimension of HIGH-06)  
- **Category:** J — Localization / L — Interactive Controls  
- **Explanation:** `window.confirm()` always renders in the browser's UI language, not the app's language setting. An Arabic admin sees an English confirmation dialog.  
- **Recommended Action:** See HIGH-06 — replace with `AlertDialog`.  

---

#### MED-08 — Office deletion cascades to user account; no soft-delete or recovery mechanism

- **Severity:** Medium  
- **Category:** H — Admin Panel / F — Data Integrity  
- **Affected:** `artifacts/api-server/src/routes/admin.ts` line ~152–172  
- **Explanation:** Admin office deletion permanently deletes the office record and, via cascade, the associated user account. There is no soft-delete (`deletedAt` timestamp), no grace period, and no recovery path. A mistaken deletion destroys all associated data (conversations, documents, media metadata) permanently.  
- **Evidence:** `onDelete: cascade` on `offices.userId → users.id` FK. Admin deletion route calls `db.delete(officesTable)`.  
- **Recommended Action:** Add a `deletedAt` column and implement soft-delete. Permanently purge only after a 30-day hold. Or at minimum, require the admin to type the office name to confirm deletion (rather than just `confirm()`).  
- **Must fix before launch:** Partial — at minimum improve the confirmation UX  
- **Effort:** Medium (soft-delete), Small (improved confirmation)  
- **Risk:** Medium for soft-delete  

---

#### MED-09 — No Content Security Policy nonce for inline scripts; Vite dev injects inline `<script>`

- **Severity:** Medium  
- **Category:** M — Security  
- **Affected:** `artifacts/api-server/src/app.ts` (Helmet CSP config); Vite HMR in development  
- **Explanation:** Helmet is configured with a strict `default-src 'none'` CSP. Production Vite builds produce hashed assets that should work with this policy. However, if any third-party analytics or embed script is added in future without a nonce or hash, it will be silently blocked, which is a security-positive behavior but can cause confusion during integration.  
- **Evidence:** Helmet CSP confirmed present. No nonce middleware configured.  
- **Recommended Action:** Document the CSP policy. When integrating third-party scripts (analytics, chat widgets, payment iframes), use `nonce`-based allowlisting rather than weakening `script-src`.  
- **Must fix before launch:** No (current state is fine)  
- **Effort:** Small documentation task  
- **Risk:** None  

---

#### MED-10 — Orval-generated `api-zod/index.ts` is overwritten on every codegen run

- **Severity:** Medium  
- **Category:** O — Technical Debt / A — Maintainability  
- **Affected:** `lib/api-zod/src/index.ts`; `generated/` output  
- **Explanation:** Running the API schema codegen (Orval) re-adds a duplicate `generated/types` export to `api-zod/src/index.ts`, creating a TypeScript error. The file must be manually corrected after every run. This breaks the automated codegen workflow and introduces a manual error-prone step.  
- **Evidence:** Known issue from prior work — `api-zod/index.ts` re-adds duplicate export after codegen.  
- **Recommended Action:** Add a `postcodegen` npm script that rewrites `index.ts` to the canonical single-line barrel, or configure Orval's output to not overwrite the barrel file.  
- **Must fix before launch:** No  
- **Effort:** Small  
- **Risk:** None  

---

#### MED-11 — `dangerouslySetInnerHTML` usage in chart component

- **Severity:** Medium (Low direct risk, flag for policy)  
- **Category:** M — Security  
- **Affected:** `artifacts/skayoffice-pilot/src/components/chart.tsx`  
- **Explanation:** `dangerouslySetInnerHTML` is used to inject a static CSS theme string. The content is not user-controlled and does not represent a direct XSS risk today. However, its presence sets a precedent that could be dangerously extended.  
- **Recommended Action:** Replace with a `<style>` tag using the Vite CSS-in-JS patterns, or inject theme via CSS custom properties on a parent element. Remove `dangerouslySetInnerHTML` entirely to prevent future misuse.  
- **Must fix before launch:** No  
- **Effort:** Small  
- **Risk:** Low  

---

#### MED-12 — No automated orphaned-file cleanup for deleted or replaced uploads

- **Severity:** Medium  
- **Category:** I — Media Handling  
- **Affected:** `artifacts/api-server/src/routes/` (upload replacement paths); Object Storage  
- **Explanation:** When an office replaces their cover image or a document, the old object remains in storage with no cleanup. Over time, orphaned blobs accumulate, increasing storage costs with no corresponding data value. There is no background job or cleanup trigger.  
- **Recommended Action:** When a media object is replaced or deleted, schedule its old path for deletion either synchronously (if small) or via a deferred job queue.  
- **Must fix before launch:** No  
- **Effort:** Small–Medium  
- **Risk:** Low  

---

#### MED-13 — Public office slug is not checked for reserved route conflicts

- **Severity:** Medium  
- **Category:** K — Public Platform / F — Data Integrity  
- **Affected:** `artifacts/api-server/src/routes/auth.ts` (slug generation); `artifacts/skayoffice-pilot/src/App.tsx` (router)  
- **Explanation:** Office public URLs are `/office/:slug`. The slug is derived from the office name. If an office registers with a name that generates a slug matching a reserved UI route (e.g., `dashboard`, `admin`, `login`, `register`), the public URL would shadow the application route or produce a confusing 404.  
- **Recommended Action:** Add a reserved-slug blocklist validated during registration. At minimum: `['dashboard', 'admin', 'login', 'register', 'search', 'home', 'api']`.  
- **Must fix before launch:** Yes  
- **Effort:** Small  
- **Risk:** Low  

---

#### MED-14 — No IDOR check on admin document download; any admin can access any document

- **Severity:** Medium  
- **Category:** D — Authorization / I — Media  
- **Affected:** `artifacts/api-server/src/routes/admin.ts` (document review), `storage.ts` (object ACL)  
- **Explanation:** Admin document download is gated by `requireRole("admin")` which is correct. However, if there are multiple admin accounts in the future, there is no per-document ownership check — any admin can download any office's private documents. Today with a single admin account this is not a risk, but is a design gap.  
- **Recommended Action:** Document this as a known design decision. If multiple admin roles are introduced, add sub-role-based document access controls.  
- **Must fix before launch:** No (single admin in pilot)  
- **Effort:** Medium  
- **Risk:** Low  

---

### LOW

---

#### LOW-01 — No API versioning readiness for future mobile app

- **Severity:** Low  
- **Category:** C — Architecture / Q — Future Readiness  
- **Affected:** All routes  
- **Explanation:** A future native mobile app (iOS/Android) cannot pin to a stable API version. Adding `/v1/` prefix early is low-effort but must be done before a mobile app is in beta.  
- **Must fix before launch:** No  
- **Effort:** Small  

---

#### LOW-02 — `zod` and `@workspace/api-zod` are listed as dependencies in multiple `package.json` files

- **Severity:** Low  
- **Category:** O — Dependencies  
- **Affected:** Root `package.json`, `lib/api-zod/package.json`, `artifacts/api-server/package.json`  
- **Explanation:** `zod` and `@workspace/api-zod` appear in multiple workspace `package.json` files. pnpm deduplication handles this at install time, but version drift between workspace entries could cause subtle runtime type mismatches.  
- **Recommended Action:** Hoist `zod` to the root `package.json` as a workspace-level dependency and remove it from individual workspace files.  
- **Must fix before launch:** No  
- **Effort:** Small  

---

#### LOW-03 — No `replit.md` documentation file exists

- **Severity:** Low  
- **Category:** A — Maintainability / Onboarding  
- **Affected:** Project root  
- **Explanation:** There is no `replit.md` or equivalent project overview document describing the stack, environment setup, workflow names, seed credentials, or onboarding steps. A new developer joining the team has no written starting point.  
- **Recommended Action:** Create `replit.md` with: project overview, tech stack, environment variable list, how to run dev, how to seed data, how to run the admin, how to create a test office registration.  
- **Must fix before launch:** No  
- **Effort:** Small  

---

#### LOW-04 — Maps link uses office name as the query; address field is not used

- **Severity:** Low  
- **Category:** K — Public Platform  
- **Affected:** `artifacts/skayoffice-pilot/src/pages/office-profile.tsx`  
- **Explanation:** The "Open in Maps" link is constructed as `https://www.google.com/maps/search/?api=1&query=[officeName]`. If the office name is a common word, the map opens to an ambiguous location. The office address field exists in the schema but is not used in the Maps URL.  
- **Recommended Action:** Use the address field in the Maps query: `?query=[address],[city]` with the office name as a fallback.  
- **Must fix before launch:** No  
- **Effort:** Small  

---

#### LOW-05 — Audit log is stored in the same database with no export or alerting

- **Severity:** Low  
- **Category:** H — Admin / M — Security  
- **Affected:** `artifacts/api-server/src/routes/admin.ts` (`recordAuditLog`)  
- **Explanation:** Admin actions are audit-logged into the primary database. This is correct for pilot. However, if the database is corrupted or an insider deletes records, the audit log is also lost. There is no export to immutable storage, no alerting on sensitive events (e.g., admin account deletion).  
- **Recommended Action:** Post-launch, export audit logs periodically to append-only object storage. Add alerting for high-severity admin actions.  
- **Must fix before launch:** No  
- **Effort:** Small–Medium  

---

#### LOW-06 — SkayOffice copyright year is hardcoded; will become stale annually

- **Severity:** Low  
- **Category:** A — Maintainability  
- **Affected:** Footer component (referenced in task backlog)  
- **Explanation:** The copyright year in the footer is hardcoded and will require a manual update each January.  
- **Recommended Action:** Replace with `new Date().getFullYear()` in the footer component.  
- **Must fix before launch:** No  
- **Effort:** Trivial  

---

#### LOW-07 — `smoke-test-provider-types.sh` is the only QA artifact; it tests nothing automatically

- **Severity:** Low  
- **Category:** P — Tests  
- **Affected:** `smoke-test-provider-types.sh`  
- **Explanation:** This shell script is a manual checklist, not an automated test. It produces no machine-readable output and cannot be run in CI.  
- **Recommended Action:** Migrate to Vitest + Supertest API tests as part of CRIT-02.  
- **Must fix before launch:** No (subsumed by CRIT-02)  
- **Effort:** Small  

---

#### LOW-08 — No `Content-Security-Policy` header on static frontend assets served by Vite/Nginx

- **Severity:** Low  
- **Category:** M — Security  
- **Affected:** Frontend delivery (Vite dev server or production static serving)  
- **Explanation:** The API server has Helmet with CSP configured. However, when the Vite frontend is served from a separate process (as in the current Replit deployment), the HTML page itself may not carry the same CSP header unless the frontend server is also configured with it. This depends on the production serving setup.  
- **Recommended Action:** Confirm that the production frontend delivery mechanism (Replit reverse proxy or a separate static server) is forwarding or setting the CSP header on the HTML response.  
- **Must fix before launch:** Verify only  
- **Effort:** Small  

---

## 5. Top Launch-Blocking Issues (must be resolved before going live)

1. **CRIT-01** — Registration has no database transaction; orphaned users on partial failure  
2. **CRIT-02** — Zero automated tests (minimum: auth + RBAC + registration test suite)  
3. **HIGH-01** — Hardcoded Arabic/English strings on public and admin screens  
4. **HIGH-02** — No code splitting; entire dashboard ships to every public visitor  
5. **HIGH-03** — No caching; public endpoints hit the database cold on every request  
6. **HIGH-06** — `window.confirm()` for destructive admin actions fails silently in WebView  
7. **HIGH-07** — 30-day session lifetime with no rotation, especially for admin accounts  
8. **HIGH-09** — No database backup schedule  
9. **MED-02** — No transaction in pending-changes approval merge  
10. **MED-05** — Missing translation key parity validation  
11. **MED-06** — No rate limiting on upload URL generation  
12. **MED-13** — No reserved-slug blocklist during office registration  

---

## 6. Top Security Risks

| Risk | Finding | Status |
|---|---|---|
| Stolen session cookie valid 30 days (admin) | HIGH-07 | Must fix |
| Upload endpoint not rate-limited | MED-06 | Must fix |
| Destructive admin action confirmation fails in WebView | HIGH-06 | Must fix |
| Soft-delete absent; data permanently destroyed on admin error | MED-08 | Address post-launch |
| `dangerouslySetInnerHTML` precedent in chart.tsx | MED-11 | Low; monitor |
| Audit log in same DB (tamperable) | LOW-05 | Post-launch |
| CSP on frontend static assets unconfirmed | LOW-08 | Verify |

**Positive security findings (no action needed):**
- No hardcoded secrets in source code  
- Helmet CSP, HSTS, and security headers are configured  
- Drizzle ORM prevents SQL injection (all queries parameterised)  
- Rate limiting applied to login, register, assistant, and contact endpoints  
- Object ACL enforces ownership on private documents  
- Session roles enforced entirely server-side  
- Admin routes all protected by `requireRole("admin")`  
- Sensitive fields (passwords, tokens, cookies) explicitly redacted from logs  

---

## 7. Top Data Integrity Risks

1. **CRIT-01** — Orphaned user records from non-transactional registration  
2. **MED-02** — Pending-changes approval has no transaction  
3. **HIGH-09** — No database backups  
4. **MED-08** — Office deletion is permanent with no soft-delete  
5. **MED-12** — Orphaned media files accumulate indefinitely after replacement  
6. **MED-13** — Reserved slug names could corrupt routing  

---

## 8. Top Maintainability Risks

1. **HIGH-05** — Three route files over 1,000 lines with inlined business logic  
2. **CRIT-02** — No tests means refactoring is high-risk  
3. **HIGH-01** — i18n scattered as hardcoded strings across dozens of components  
4. **MED-03** — `as any` throughout type-sensitive paths  
5. **MED-10** — Codegen overwrites the barrel file requiring manual correction  
6. **LOW-03** — No onboarding documentation  

---

## 9. Top Scalability Risks

1. **HIGH-03** — No caching at any layer  
2. **HIGH-02** — Single monolithic JS bundle  
3. **HIGH-08** — Images not resized/optimised; original files served to all devices  
4. **MED-04** — N+1 query risk in office list endpoint  
5. **HIGH-05** — Monolithic route files will become change bottlenecks  
6. **HIGH-04** — No subscription schema; adding monetisation is a large-scale rework  

---

## 10. Areas Already Well Designed

- **Server-side role enforcement.** Roles (`office`, `admin`, `customer`) are stored and checked in the session, never trusted from the client. All admin routes are middleware-protected.
- **Zod-validated API contracts.** `@workspace/api-zod` provides a shared schema library. Request validation happens at the route boundary via Zod, preventing malformed data from reaching the DB.
- **Activation state machine.** The `getActivationBlockers` check runs at both initial activation and reactivation, ensuring an office cannot bypass requirements after suspension.
- **Pending-changes workflow.** Offices cannot immediately publish edits; changes are staged in a JSON column and require admin approval, protecting listing quality.
- **Audit logging.** Every significant admin action is logged via `recordAuditLog` with the actor, timestamp, and action type.
- **Rate limiting.** Auth and AI-assistant endpoints are rate-limited appropriately.
- **Security headers.** Helmet with strict CSP and HSTS is configured for production.
- **Bearer-token shim.** The `Authorization: Bearer` → signed cookie translation correctly handles Replit Autoscale's cookie stripping without compromising security.
- **providerType separation.** Office and freelancer accounts are structurally separated at registration and enforced throughout the API.
- **Structured logging.** Pino provides structured JSON logs with sensitive field redaction.

---

## 11. Items Safe to Clean Later (no urgency, low risk)

- LOW-02: Hoist `zod` to root workspace dependencies  
- LOW-03: Write `replit.md` onboarding document  
- LOW-04: Use address field in Maps link  
- LOW-06: Dynamic copyright year in footer  
- LOW-07: Replace shell smoke test with automated equivalent  
- MED-10: Fix Orval codegen barrel-file overwrite  
- MED-11: Remove `dangerouslySetInnerHTML` from chart.tsx  
- MED-12: Orphaned file cleanup job  
- HIGH-05: Service layer extraction from large route files (after tests exist)  

---

## 12. Items That Should Not Be Changed Immediately (risky without tests)

- **HIGH-05 (route file decomposition):** Extracting service layers from 1,000-line route files is the right long-term move, but must not be done until CRIT-02 (automated tests) is in place. Refactoring without tests is how logic bugs are silently introduced into the approval/activation state machine.
- **MED-08 (soft-delete):** Adding `deletedAt` requires a migration, changes to all delete queries, and a purge policy. Safe to do in the first 30 days post-launch, not in the pre-launch rush.
- **F — Database schema changes generally:** Any schema change to production must go through a migration tested in development first. No schema change should be applied directly to the production database via `drizzle-kit push`.

---

## 13. Recommended Remediation Plan

### Before Launch (blocking)

| Priority | Finding | Effort |
|---|---|---|
| 1 | CRIT-01: Wrap registration in `db.transaction` | Small |
| 2 | MED-02: Wrap pending-changes approval in `db.transaction` | Small |
| 3 | HIGH-07: Reduce admin session to 8h; enable `rolling: true` | Small |
| 4 | HIGH-06: Replace `confirm()` with AlertDialog in admin panel | Small |
| 5 | MED-06: Add rate limit to upload URL generation endpoint | Small |
| 6 | MED-13: Add reserved-slug blocklist in registration | Small |
| 7 | HIGH-09: Configure daily database backup | Small |
| 8 | MED-05: Add build-time translation key parity check | Small |
| 9 | HIGH-01: Audit and fix hardcoded strings in OfficesTable, ContactAnalytics, office-profile | Medium |
| 10 | HIGH-02: Add `React.lazy` + `Suspense` on all page-level routes | Small–Medium |
| 11 | HIGH-03: Add `Cache-Control` on public list/profile endpoints; set React Query `staleTime` | Small |
| 12 | CRIT-02 (partial): Auth, RBAC, and registration API tests | Large |

### Immediately After Launch (within 7 days)

- HIGH-08: Serve card thumbnails at appropriate size; add `srcset`  
- MED-03: Eliminate `as any` casts in route handlers  
- MED-04: Add `EXPLAIN ANALYZE` on list query; optimise if >50ms  
- LOW-08: Confirm CSP header is present on frontend HTML response in production  

### Within 30 Days

- MED-08: Implement soft-delete for offices with 30-day hold  
- HIGH-05: Extract service modules from `admin.ts` and `offices.ts` (after test coverage exists)  
- CRIT-02 (continued): Expand test suite to cover approval, media ownership, and localization  
- MED-12: Implement orphaned-file cleanup on upload replacement  

### Within 90 Days

- HIGH-04: Design and implement subscription/payment schema  
- MED-01: Add `/api/v1/` prefix  
- MED-09: Add nonce-based CSP for any third-party integrations  
- LOW-05: Export audit logs to append-only storage  
- HIGH-08: Implement server-side image resizing proxy  

### Long-Term Improvements

- Redis-backed session store for per-session revocation  
- Full service/repository layer extraction  
- CDN in front of static assets and media  
- Expand test coverage to 80% API route coverage  
- Database read replica for reporting and assistant queries  
- Payment gateway integration (Stripe or equivalent) with webhook verification  
- CI/CD pipeline with automated test gating on every merge  

---

## 14. Estimated Total Remediation Effort

| Phase | Effort |
|---|---|
| Before launch (critical fixes) | 6–10 days |
| First 30 days post-launch | 8–12 days |
| 30–90 days | 15–20 days |
| Long-term | 30–60 days ongoing |

---

## 15. Payment Integration Readiness Score: 12/100

The platform is not ready for payment integration. To reach readiness:
- Design `plans`, `subscriptions`, and `payment_attempts` tables  
- Add `subscription_status` column to offices  
- Enforce subscription checks server-side (never frontend-only)  
- Separate office and freelancer plan types at schema and enforcement level  
- Build a webhook endpoint with signature verification  
- Implement idempotent payment processing (unique transaction references)  
- Add manual admin activation override for edge cases  
- Test payment failure and refund paths before enabling any real billing  

---

## 16. Readiness Conclusion

### Verdict: **Ready with conditions (for pilot phase only)**

**Supporting explanation:**

The SkayOffice codebase is coherent, structurally sound, and appropriate for a controlled pilot with a limited number of known offices. The core workflows — registration, admin approval, activation, public profile display, and the AI assistant — are implemented correctly and include meaningful safeguards (state machine, audit logging, rate limiting, structured error handling).

The platform is **not ready for an unrestricted public launch** without first addressing:
1. The non-transactional registration (CRIT-01)
2. The absence of any automated tests (CRIT-02)
3. The broken i18n in key screens (HIGH-01)
4. The single-chunk JavaScript bundle (HIGH-02)
5. The complete absence of caching (HIGH-03)
6. The unsafe admin destructive-action confirmations (HIGH-06)
7. The 30-day admin session without rotation (HIGH-07)
8. The absence of database backups (HIGH-09)

Launching with these gaps creates meaningful risk of data loss (no backups, non-transactional registration), poor user experience (bundle performance, broken Arabic UI), and security exposure (long admin sessions, unconfirmed destructive actions).

If the pilot is strictly controlled (known offices, manually onboarded, no public registration), then the most urgent items are CRIT-01, HIGH-09, HIGH-07, and HIGH-06, which can collectively be resolved within 1–2 development days.

---

## 17. Confirmation

> No code, files, dependencies, database records, production data, configuration, or environment settings were modified during the preparation of this report. All findings are based on read-only inspection of the codebase. Secret values (SESSION_SECRET, AI_INTEGRATIONS_OPENAI_API_KEY, RESEND_API_KEY, SEED_ADMIN_PASSWORD, SEED_DEMO_PASSWORD) were confirmed present as environment references only — their actual values were not accessed, read, or recorded.
