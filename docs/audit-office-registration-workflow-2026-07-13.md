# Audit Report — Office Registration / Verification / Approval / Activation Workflow

**Date:** 2026-07-13
**Scope:** SkayOffice Pilot (`artifacts/skayoffice-pilot` + `artifacts/api-server`) — the full office lifecycle: registration → onboarding → media → documents → submission → admin review → changes requested → approval/activation → public visibility → suspension.
**Method:** Direct API testing (curl, with real request/response pairs) against the running dev server, combined with two independent browser-automation audits (one covering the office/public side, one covering the admin console). Server logs were inspected to corroborate findings.
**Constraint honored: this was a read-only audit. No code, schema, or data-fixing changes were made at any point. Every issue below is exactly as found; nothing was patched.**

Severity scale: **Critical** (breaks core flow or a security boundary) · **High** (real functional gap with a clear user-facing consequence) · **Medium** (works but is inconsistent/incomplete) · **Low** (polish/UX nit).

---

## 1. Registration

| # | Finding | Severity | Evidence |
|---|---|---|---|
| 1.1 | Required-field, category-enum, and password length (≥6) validation is enforced correctly server-side (400 with a clear Zod error) and mirrored client-side in the registration form. | ✅ Pass | curl: missing `category` → 400; password `"abc12"` → 400 |
| 1.2 | **Email format is never validated**, client or server. `email: "not-an-email"` is accepted and a full account/office is created. | **Medium** | curl: `POST /auth/register/office {"email":"not-an-email", ...}` → `201 Created`. Root cause: `OfficeRegisterInput`/`CustomerRegisterInput` in `lib/api-spec/openapi.yaml` declare `email: {type: string}` with no `format: email` (and note: adding `format: email` here is unsafe as-is — see memory note on Zod v3/v4 codegen mismatch — so this needs a manual regex/refinement, not just a format annotation). |
| 1.3 | **Duplicate phone numbers are allowed.** Only email uniqueness is enforced; two offices were successfully registered with the identical phone number `+966511111114`. | **Medium** | curl: second registration with a reused phone + new email → `201 Created`, no 409. `artifacts/api-server/src/routes/auth.ts` only checks the email column. |
| 1.4 | Duplicate email correctly returns `409 Email already registered`. | ✅ Pass | curl confirmed |
| 1.5 | New offices always start in `status: "draft"`. | ✅ Pass | curl confirmed |

## 2. Onboarding / Profile Editing

| # | Finding | Severity | Evidence |
|---|---|---|---|
| 2.1 | Draft-field editing and saving works via `PATCH /offices/me` for all profile fields tested (Arabic name, descriptions, specialization, address, Google Maps URL, WhatsApp). | ✅ Pass | curl round-trip confirmed persistence |
| 2.2 | **`PATCH /offices/me` has no status-based field locking at all.** An office can change *any* field — including `category` — while `under_review`, `approved`, or even `active`, with no server-side rejection. Verified end-to-end: changed `category` from `legal` to `marketing` on an application that was mid-review, and the change was accepted and persisted silently. | **High** | curl: `PATCH /offices/me {"category":"marketing"}` while `status:"under_review"` → `200 OK`, field changed. `artifacts/api-server/src/routes/offices.ts` `PATCH /offices/me` handler has no status guard. This also matches the UI: `dashboard.tsx` never disables inputs or the Save button based on `office.status` — only the "Send for Review" button is conditionally shown. |
| 2.3 | **During live browser testing, a persistent full-page semi-transparent overlay appeared over the entire dashboard after interacting with the media upload controls, blocking further clicks** (Save button, tab switching) until the page was reloaded. Reproduced across multiple screenshots. | **High** | Testing subagent screenshots (dashboard fully dimmed with skeleton blocks faintly visible underneath, no click-through). Likely cause: the `ObjectUploader` (Uppy) dialog backdrop not tearing down cleanly, compounded by slow object-storage thumbnail fetches (~4–5.8s per image, confirmed in API server logs) that keep the dashboard's own loading state active concurrently. |
| 2.4 | Hard-refreshing while on the public office-profile route for a non-active office (`/offices/:id` with `status` other than `active`) leaves the page **stuck in an infinite loading skeleton** instead of showing a "not found" message. | **Medium** | Server correctly returns `404 Office not found` (confirmed in API logs: `GET /api/offices/21` → `404`), but `office-profile.tsx` has no explicit 404/error branch — `isLoading || !office` just renders skeleton forever (confirmed by both code reading and the browser test, which never resolved past skeleton at that route). |

## 3. Media (logo / cover / gallery / video)

| # | Finding | Severity | Evidence |
|---|---|---|---|
| 3.1 | Adding gallery media via `POST /offices/me/media` works and correctly validates `type` against the `image`/`video` enum (invalid value → 400). | ✅ Pass | curl confirmed |
| 3.2 | **No file-type or file-size validation is configured on the uploader** — `ObjectUploader` in `dashboard.tsx` is used with no `allowedFileTypes`/`maxFileSize` props, and the API's `POST /storage/uploads/request-url` accepts whatever `contentType`/`size` the client reports with no server-side allow-list enforcement observed. | **Medium** | Frontend code read (no props passed) + browser test: staged an invalid `.txt` alongside a valid `.png` with no rejection message shown. |
| 3.3 | **No "primary/main image" selection exists** among gallery images — separate from the single dedicated Logo and Cover upload slots, there is no control to promote a gallery image to a hero/primary position. | **Low–Medium** (functional gap, not a bug) | Confirmed by both code read (no such control in `dashboard.tsx`) and live browser test. |
| 3.4 | Live "preview card" (Quick Office Card) reflects text-field edits (name, city, short description) immediately, but only reflects new media **after** the corresponding mutation completes and the query is invalidated/refetched — not instantly on file selection. | **Low** | Code read (`dashboard.tsx`) confirms preview is driven by the saved `officePreview` state, not local file-picker state. |
| 3.5 | During live testing the media/upload interaction triggered the stuck-overlay issue in 2.3, which also blocked verifying gallery-image deletion and the "does the preview update" check end-to-end in the browser. This should be re-tested once 2.3 is understood/fixed. | **High** (blocks verification) | Testing subagent report |

## 4. Documents (identity / trade license / professional license / certificate)

| # | Finding | Severity | Evidence |
|---|---|---|---|
| 4.1 | Document upload, listing, and deletion (`POST` / `GET` / `DELETE /offices/me/documents`) work correctly, and `documentType` is validated against a strict enum (`identity`, `trade_license`, `professional_license`, `certificate`); invalid types are rejected with 400. | ✅ Pass | curl confirmed |
| 4.2 | Document access control is correctly enforced at the storage layer: unauthenticated → 401, a different office → 403, owner/admin → passes the ownership check (404 only because the test object path doesn't exist in real object storage, not a permission failure). | ✅ Pass | curl matrix: unauth 401, office2→office1's doc 403, owner/admin → 404 "Object not found" (expected, since these docs were seeded with synthetic paths never actually uploaded to object storage — **not** a security bug). |
| 4.3 | Document replacement (delete rejected doc + re-upload) works and the new document correctly resets to `pending` for re-review. | ✅ Pass | curl confirmed |
| 4.4 | **In the admin document-review UI, clicking a document opens the raw API JSON response in a new browser tab instead of rendering an inline image/PDF viewer.** This is a real UX gap independent of the "object not found" result (which is a test-data artifact, not a bug — see 4.2). | **Medium** | Testing subagent screenshot: new tab shows raw `{"error":"Object not found"}` JSON rather than any preview chrome; the admin detail dialog has no in-place document preview panel. |
| 4.5 | **Per-document rejection in the admin UI does not prompt for or display a review note/reason**, even though the API supports a `reviewNote` field (confirmed via `POST /admin/applications/:id/documents/:docId {"status":"rejected","reviewNote":"..."}"`, which the API accepts and persists). The document-level reject button in `admin.tsx` appears to fire with no reason field, unlike the application-level reject/request-changes actions which do collect a `reason`. | **Medium** | curl confirms the API supports/persists `reviewNote`; testing subagent confirms clicking "reject" on a document produced no reason prompt and no reason was visible afterward in the dialog. |
| 4.6 | Live browser testing of the identity/trade-license upload step in the office dashboard could not be completed because the stuck-overlay issue (2.3) blocked reaching the Documents tab reliably in one run. | **High** (blocks verification) | Testing subagent report |

## 5. Submission

| # | Finding | Severity | Evidence |
|---|---|---|---|
| 5.1 | `POST /offices/me/submit` correctly validates completeness and returns a precise, human-readable list of missing items (e.g. `"Application incomplete, missing: whatsapp, logoUrl, identity document, trade license document"`). | ✅ Pass | curl confirmed |
| 5.2 | Submission is correctly restricted to `draft`/`changes_requested` origin statuses and transitions directly to `under_review` (by design — there is no separate `submitted` state). | ✅ Pass | curl confirmed |
| 5.3 | **In the live browser test, submitting an incomplete application did not surface any visible validation message** — the button entered a "sending..." state and the API returned 400 (confirmed in server logs), but no toast/inline error rendered, leaving the user with silent failure and no path to fixing it. | **High** | Testing subagent: "Clicking إرسال للمراجعة... no alert/toast/inline error text appeared"; corroborated by API log showing `POST /offices/me/submit → 400` immediately at that timestamp. |
| 5.4 | Once submitted (`under_review`), the office can still edit and re-save every field including category — see 2.2. The requested audit check "is the application locked for editing after submission" therefore fails: **it is not locked at all.** | **High** | See 2.2 |

## 6. Admin Review

| # | Finding | Severity | Evidence |
|---|---|---|---|
| 6.1 | Admin applications queue lists all offices with status filters for every state (`مسودة`, `قيد المراجعة`, `مطلوب تعديلات`, `تمت الموافقة`, `نشط`, `مرفوض`, `معلّق`) and submission dates. | ✅ Pass | curl + screenshot `khg67q` |
| 6.2 | Application detail view shows full profile fields and the documents list with per-document status badges; admin can approve/reject individual documents in place without a page reload. | ✅ Pass | curl + screenshot `0g4cy8` |
| 6.3 | See 4.4/4.5 for document-preview and rejection-reason UX gaps. | **Medium** | — |
| 6.4 | **No "internal admin notes" field exists anywhere** — separate from the applicant-facing rejection/change-request reason — for admins to leave notes only visible to other admins. | **Medium** (functional gap) | Confirmed independently by code read (`admin.tsx` only has a `reason` input tied to reject/request-changes) and by the live browser audit. |
| 6.5 | All admin state-transition endpoints (`approve`, `reject`, `request-changes`, `activate`, `suspend`, per-document review) are correctly logged to the audit log with actor, action, and timestamp. | ✅ Pass | curl + `GET /admin/audit-log` returned matching entries for every action performed during this audit; screenshot `822pta` shows them rendered in the admin UI. |
| 6.6 | Admin console is desktop-oriented; at 390px width the applications table becomes visually dense but remained usable in testing (no blocking overflow). | **Low** | Testing subagent, screenshot `zq8fgj` |

## 7. Changes Requested

| # | Finding | Severity | Evidence |
|---|---|---|---|
| 7.1 | `request-changes` correctly requires `under_review` origin and a reason; the office sees the reason via `GET /offices/me` (`changeRequestReason`). | ✅ Pass | curl confirmed |
| 7.2 | Office can replace a rejected document and resubmit from `changes_requested`; resubmission correctly clears both `rejectionReason` and `changeRequestReason` and moves back to `under_review`. | ✅ Pass | curl confirmed |
| 7.3 | The live browser test could not exercise "request changes" end-to-end because, by the time that test ran, no application remained in `under_review` in the seed/test data (all had already been moved to other states by the preceding API-level tests in this same audit — a **test-sequencing artifact, not a product bug**). This step should be spot-checked once independently if a clean end-to-end confirmation is required. | N/A (audit limitation) | Testing subagent report |

## 8. Approval / Activation

| # | Finding | Severity | Evidence |
|---|---|---|---|
| 8.1 | `approve` correctly requires `under_review` origin. | ✅ Pass | curl confirmed |
| 8.2 | `activate` correctly enforces every blocker and returns the *exact* set of unmet conditions in one response, verified individually: `application_not_approved`, `identity_document_not_approved`, `trade_license_not_approved`, `invalid_whatsapp` all triggered and cleared correctly as each was fixed. | ✅ Pass | curl matrix in `getActivationBlockers` (see `officeSerializer.ts`) — confirmed for status, both required document types, and WhatsApp validity. |
| 8.3 | **Activation blockers do not check for a main/logo image being distinctly "meaningful" beyond presence** — a placeholder/garbage `logoUrl` string would satisfy the check (it only tests for non-empty). This is a minor gap, consistent with the general lack of file-content validation noted in 3.2. | **Low** | Code read of `getActivationBlockers` |
| 8.4 | Once `active`, the office correctly appears in `/offices`, `/offices/:id`, and category filters. | ✅ Pass | curl confirmed |

## 9. Public Visibility Rules

| # | Finding | Severity | Evidence |
|---|---|---|---|
| 9.1 | `draft`, `under_review`, `changes_requested`, `rejected`, and `suspended` offices are **all correctly excluded** from `/offices` (list + category filter + search) and return `404` from `/offices/:id`. Verified for every one of these five states individually with dedicated test offices. | ✅ Pass | curl confirmed for all five states |
| 9.2 | Only `active` offices are counted/shown in `/categories` `officeCount` and `/platform/summary`. | ✅ Pass | curl confirmed |
| 9.3 | A search for a draft office's exact name on the public homepage correctly returns the "no results" empty state rather than leaking it. | ✅ Pass | Testing subagent confirmed via browser search |

## 10. Suspension

| # | Finding | Severity | Evidence |
|---|---|---|---|
| 10.1 | `suspend` correctly requires `active` origin, transitions to `suspended`, and the office is immediately removed from all public surfaces while its private data (profile, documents, approvals) remains intact for admin viewing. | ✅ Pass | curl confirmed |
| 10.2 | **There is no way to reactivate a suspended office — at either the API or UI level.** The only path back toward `active` is `POST .../activate`, but `getActivationBlockers` requires `status === "approved"`, and there is no admin action that moves a `suspended` office back to `approved`. Attempting `activate` on a suspended office correctly (but unhelpfully) fails with `application_not_approved`, and no "Unsuspend"/"Reactivate" button exists anywhere in the admin console. | **Critical** | curl: `POST /admin/applications/17/activate` from `status:"suspended"` → `400 {"error":"Activation blocked: application_not_approved"}`. Code read of `artifacts/api-server/src/routes/admin.ts` confirms only `approve/reject/request-changes/activate/suspend` exist — no reactivate/unsuspend route. Testing subagent independently confirmed no such control exists in `admin.tsx`. |

## 11. Permission Isolation

| # | Finding | Severity | Evidence |
|---|---|---|---|
| 11.1 | Role gating is correct everywhere tested: customer → office-only route (403), office → admin-only route (403), customer → admin-only route (403), unauthenticated → any protected route (401). | ✅ Pass | curl matrix confirmed |
| 11.2 | Cross-office data isolation is correct: office2 cannot edit or delete office1's profile/documents; attempts to delete another office's document by guessing its ID return `404` (no existence leak), and office1's data is verified unchanged afterward. | ✅ Pass | curl confirmed |
| 11.3 | Office cannot invoke admin-only actions on its own application (e.g. approving its own document) — correctly `403`. | ✅ Pass | curl confirmed |
| 11.4 | Unauthenticated and non-admin browser navigation to `/admin` is correctly blocked/redirected (to the customer login gate or the public homepage, depending on auth state), with no admin UI leaking. | ✅ Pass | Testing subagent, screenshots `jcsael`, `1nya6z` |

## 12. Regression

| # | Finding | Severity | Evidence |
|---|---|---|---|
| 12.1 | Homepage, category browsing, and search all function correctly and only ever show `active` offices; existing demo/seed offices render with logo, name, Share, QR, WhatsApp, and (where enabled) video-call actions. | ✅ Pass | Testing subagent, screenshot `8wbfoi` |
| 12.2 | An active demo office's public profile ("Decision Card") loads correctly in Arabic/RTL with working action buttons. | ✅ Pass | Testing subagent, screenshot `2djx2b` |
| 12.3 | Video-call and Share/QR buttons are rendered purely from the office object's own fields (`videoCallEnabled`, etc.) with no additional status gating beyond the office already being public/active. This is expected/by-design pending the separate, already-tracked "let customers actually request a video call" feature — not a bug in the current audit scope. | ℹ️ Note | Frontend code read |
| 12.4 | Favoriting could not be exercised in this pass (testing subagent did not have a quick customer session set up in that context) — should be spot-checked separately if needed. | N/A (audit limitation) | Testing subagent report |
| 12.5 | Admin audit log correctly reflects a long, real mixed history of actions (register, submit, document review, approve, reject, request-changes, activate, suspend) with no gaps observed. | ✅ Pass | curl + screenshot `822pta` |

## 13. Responsive / RTL

| # | Finding | Severity | Evidence |
|---|---|---|---|
| 13.1 | The app is Arabic-first with a working `dir="rtl"` toggle (`lib/i18n.ts`) and consistent RTL rendering observed on the homepage, dashboard, and office-profile page in both automated screenshots and code review. | ✅ Pass | Code read + screenshots |
| 13.2 | Public-facing pages (homepage, office profile) reflowed cleanly at 360×800, 390×844, and 430×932 with no clipping or overflow observed. | ✅ Pass | Testing subagent screenshots `m3de5k`, `3qmk32`, `6v5xuj` |
| 13.3 | The admin console is visibly dense at 390px (tight table columns) but remained usable with no blocking breakage — best characterized as "not optimized for mobile" rather than broken. | **Low** | Testing subagent, screenshot `zq8fgj` |

## 14. Final Summary

**No fixes, schema changes, or data corrections were made during this audit.** Every finding above reflects the exact current behavior of the merged implementation, reproduced live via direct API calls and two independent browser sessions on 2026-07-13. Test data created during this audit (offices `audit_office1/2/3`, a customer, and associated documents/media) remains in the dev database exactly as the workflow produced it — nothing was cleaned up or rolled back, per the "no fixes/changes" constraint; let me know if you'd like it purged before further work begins.

**Counts:** 1 Critical · 7 High · 8 Medium · 4 Low, plus 4 items that couldn't be fully exercised end-to-end due to test-sequencing/environment limits (flagged "N/A — audit limitation" above, not counted as findings).

### By severity

**Critical**
- 10.2 — No way to reactivate a suspended office (no unsuspend endpoint or control anywhere).

**High**
- 2.2 / 5.4 — Submitted/under-review/active applications are not locked for editing at all (any field, including category, can be changed post-submission).
- 2.3 / 3.5 / 4.6 — A full-page overlay gets stuck over the dashboard after interacting with media upload, blocking Save, tab-switching, and further testing.
- 5.3 — Submitting an incomplete application fails silently in the UI (no visible error, despite the API returning a clear 400).

**Medium**
- 1.2 — No email format validation on registration.
- 1.3 — No duplicate-phone check on registration.
- 2.4 — Non-active office public profile route hangs in an infinite loading skeleton instead of a "not found" state.
- 3.2 — No file-type/size validation on any upload.
- 4.4 — Admin document viewer opens raw JSON in a new tab instead of an inline preview.
- 4.5 — Document-level rejection has no reason/notes input in the admin UI (API supports it; UI doesn't use it).
- 6.4 — No internal-admin-only notes field, separate from applicant-facing reasons.

**Low**
- 3.3 — No "select primary image" control among gallery media.
- 3.4 — Live preview card doesn't reflect new media until after save/refetch.
- 8.3 — Activation's "has logo" check only verifies presence, not validity.
- 13.3 — Admin console is dense/not mobile-optimized (usable, not broken).

### What worked well
Registration validation (aside from email/phone), draft→submit gating with precise missing-field messaging, the entire admin approve/reject/request-changes/activate/suspend state machine and its exact blocker messages, document/media access control (401/403/404 correctly enforced by ownership and role), public visibility filtering across every non-active status, audit logging, and RTL/responsive rendering on public-facing pages all held up under direct testing with no exceptions found.

### Files most relevant to the findings above
- `artifacts/api-server/src/routes/auth.ts` — registration validation/duplicate checks (1.2, 1.3)
- `artifacts/api-server/src/routes/offices.ts` — `PATCH /offices/me` field-locking gap (2.2), submission (5.1–5.4)
- `artifacts/api-server/src/routes/admin.ts` — admin state machine, missing reactivate/unsuspend action (10.2), document review notes (4.5)
- `artifacts/api-server/src/lib/officeSerializer.ts` — `getActivationBlockers` (8.2, 8.3)
- `lib/api-spec/openapi.yaml` — `OfficeRegisterInput`/`CustomerRegisterInput` schemas (1.2)
- `artifacts/skayoffice-pilot/src/pages/dashboard.tsx` — no status-based field locking (2.2), upload overlay issue (2.3), no primary-media selector (3.3), preview refresh timing (3.4), silent submit failure (5.3)
- `artifacts/skayoffice-pilot/src/pages/office-profile.tsx` — no 404/error state, indefinite skeleton (2.4)
- `artifacts/skayoffice-pilot/src/pages/admin.tsx` — no internal notes field (6.4), document viewer/rejection UX (4.4, 4.5), no reactivate control (10.2)

This report is ready for your review before any remediation work begins.
