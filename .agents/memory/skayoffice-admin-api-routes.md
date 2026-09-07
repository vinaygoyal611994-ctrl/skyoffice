---
name: SkayOffice admin API route paths
description: Correct URL patterns for admin operations — commonly mis-guessed as /admin/offices/:id/action when the actual base is /admin/applications/:id/action.
---

## Rule
Admin office-action routes use `/api/admin/applications/:officeId/` as the base, **not** `/api/admin/offices/:officeId/`.

**Why:** The office management endpoints (list, patch verification, delete) live under `/api/admin/offices/`, but approval-workflow actions (approve, reject, request-changes, pending-changes) live under `/api/admin/applications/` to reflect their application-review semantics.

## Correct routes

| Action | Route |
|--------|-------|
| List offices | `GET /api/admin/offices` |
| Patch verification | `PATCH /api/admin/offices/:officeId/verification` |
| Delete office | `DELETE /api/admin/offices/:officeId` |
| Approve application | `POST /api/admin/applications/:officeId/approve` |
| Reject application | `POST /api/admin/applications/:officeId/reject` + `{ reason }` |
| Request changes | `POST /api/admin/applications/:officeId/request-changes` + `{ reason }` |
| Approve pending changes | `POST /api/admin/applications/:officeId/pending-changes/approve` |
| Reject pending changes | `POST /api/admin/applications/:officeId/pending-changes/reject` + `{ reason }` |

**How to apply:** When writing curl tests or frontend admin calls, always use `applications` not `offices` for approval-workflow actions.
