---
name: SkayOffice public offices API shape
description: The public listing endpoint uses a non-obvious response shape and requires a mandatory query param.
---

## Rule
`GET /api/offices` returns `{ items: OfficeSummary[], total: number, page: number, limit: number }` — the list key is `items`, not `offices`.

**Why:** The response was designed with pagination metadata at the top level. Code that reads `.offices` or `.data` will silently get `undefined` and show 0 results.

## Required query param
`providerType=office|freelancer` is **required**. Omitting it returns `400` with a Zod validation error. The frontend always sends this param when rendering the discovery page.

## Other useful params
- `?search=<text>` — full-text search on name/nameAr
- `?category=<enum>` — filter by category slug
- `?page=N&limit=N` — pagination

**How to apply:** In curl tests or client code, always include `providerType` and read `.items` from the response.
