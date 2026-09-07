---
name: SkayOffice bilingual search & logout blank-screen fixes
description: Root causes for a bilingual search gap and a logout blank-screen flash in the SkayOffice pilot app, and the constraints that shaped the fix.
---

## Bilingual search gap
Office search only matched `name` (English) and `city`, never `nameAr`. There is also no `cityAr`
column in the schema — real curated offices store city in English, some test/junk records store
city in Arabic — so a search in one language could miss matching records in the other.

**Why:** schema is frozen (no new columns allowed) and the DB has no Arabic city field to fall back on.

**How to apply:** any future search/filter feature must account for `nameAr` explicitly, and for
city cross-language matching use a static code-only synonym map (see `citySynonyms.ts` pattern) —
do not assume `ilike` on `city`/`name` alone covers Arabic queries, and do not add a `cityAr` column
without checking with the user first (schema-change constraint).

## Logout blank-screen flash
Logout success handlers used `window.location.href = '/'`, a full document reload — the browser
tears down and re-fetches/re-parses the whole SPA before anything paints, producing a visible blank
flash. This happened identically for all three roles (customer, office, admin) since they share one
logout button/handler pattern in the layout shell.

**Why:** hard navigation is unnecessary when the session cookie is already cleared server-side by the
logout endpoint; the only client-side work needed is dropping cached user-derived query data.

**How to apply:** prefer client-side route navigation (e.g. wouter's `setLocation`) plus clearing the
query cache over `window.location.href` for post-logout redirects in SPAs with react-query — avoids
the reload flash while still fully resetting cached auth/user state.

**Follow-up gotcha:** use `queryClient.removeQueries()`, not `invalidateQueries()`, on logout.
react-query keeps the last successful `data` around after a refetch errors, so invalidating alone
left the stale authenticated `user` object (and header) visible even though `/api/auth/me` was
already returning 401 server-side. `removeQueries()` clears `data` back to `undefined` immediately.
