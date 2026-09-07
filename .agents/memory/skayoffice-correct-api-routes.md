---
name: SkayOffice correct production API route paths
description: Verified route paths found during smoke-test triage — use these, not guesses
---

Discovered and confirmed live against https://skayoffice-pilot.replit.app on 2026-07-20.

## Office workflow
- Submit initial application: `POST /api/offices/me/submit` (NOT /submit-changes)
- Save profile change (draft → immediate field; active/locked → goes to pendingChanges): `PATCH /api/offices/me`
- Add document: `POST /api/offices/me/documents` body: `{objectPath, documentType}`
  - Valid documentType enum: `"identity"` | `"trade_license"` | `"professional_license"` | `"certificate"`
- List documents: `GET /api/offices/me/documents`
- Add service: `POST /api/offices/me/services`

## Admin workflow
- List all offices: `GET /api/admin/offices` (returns flat array)
- Get office + docs: `GET /api/admin/applications/:officeId`
- Approve initial application: `POST /api/admin/applications/:officeId/approve`
- Approve document: `POST /api/admin/applications/:officeId/documents/:documentId` body: `{status:"approved"}`
- Activate office (after docs approved): `POST /api/admin/applications/:officeId/activate`
- Delete office + linked user: `DELETE /api/admin/offices/:officeId`
- No customer/user delete route exists (returns 404)

## Upload
- Request signed URL: `POST /api/storage/uploads/request-url`
  - Body: `{name: string, size: number, contentType: string, category?: string}`
  - Valid categories: `cover`, `gallery_image`, `gallery_video`, `marketing_video`, `document`, `quick_card_cover`, `decision_card_cover`
  - NOT: `office_cover`, `office_document`, `media` (these return 400)
- Serve stored object: `GET /objects/uploads/:uuid` — NO `/api` prefix (served outside the /api router)

## AI assistant
- Create conversation: `POST /api/offices/:officeId/assistant/conversations` body: `{language: "en"|"ar"}` → returns 200 (NOT 201)
- Send message: `POST /api/assistant/conversations/:conversationId/messages`
- Office assistant settings: `GET|PATCH /api/offices/me/assistant/settings`
- Office conversations: `GET /api/offices/me/assistant/conversations`

## Favourites
- Add: `POST /api/favourites` body: `{officeId: number}` → 201 (NOT POST /favourites/:id)
- List: `GET /api/favourites` (requireRole customer)
- Remove: `DELETE /api/favourites/:officeId` → 204

## Auth
- Logout: `POST /api/auth/logout` → 204 No Content (NOT 200)
- Customer register: `POST /api/auth/register/customer` → 201 (NOT 200)
- Office register: `POST /api/auth/register/office` body MUST include: `whatsapp`, `termsAccepted: true`, `providerType: "office"|"freelancer"`

## Status codes
- Guard (authenticated but wrong role): returns 401, NOT 403, for most endpoints
- RTL `dir` attribute: set dynamically by React in Shell.tsx / SharePlatformSection.tsx — NOT in static HTML shell

**Why:** The first smoke test script used guessed paths and incorrect field names; every 404 in the
original 26-failure run traced back to these path errors. Use this file for any future test scripts.
