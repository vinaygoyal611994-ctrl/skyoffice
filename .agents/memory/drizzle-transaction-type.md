---
name: Drizzle transaction type vs db type
description: The TypeScript type of tx inside db.transaction() differs from typeof db even though the runtime shapes are identical; use cast or Pick to bridge.
---

## Rule
`db.transaction(async (tx) => { ... })` gives `tx` the internal `NodePgTransaction<...>` type, which does NOT extend `typeof db` (i.e., `NodePgDatabase<typeof schema>`), even though both expose the same select/insert/update/delete methods at runtime.

**Bridging approaches (pick one):**
1. **Structural Pick** — type the helper parameter as `Pick<typeof db, "select">` (or add insert/update as needed). Both `db` and `tx` satisfy this at call sites without casts.
2. **`tx as any` cast** — quick and pragmatic for isolated helpers; used for `generateUniqueOfficeSlug(name, undefined, tx as any)`.

**Why:** Drizzle's type hierarchy uses an internal generic transaction type that isn't exported as a clean public alias. The runtime behavior is correct regardless.

**How to apply:** Any helper that needs to work both standalone (using module-level `db`) and inside a transaction should accept `Pick<typeof db, "select" | "insert" | ...>` rather than `typeof db`, and default to the module-level `db`. Call sites inside transactions pass `tx as any`.
