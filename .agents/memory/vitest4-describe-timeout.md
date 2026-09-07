---
name: Vitest 4 describe-timeout syntax change
description: Passing a timeout as a third argument to describe() was removed in Vitest 4; the correct API is a per-test second argument to it().
---

## Rule
In Vitest 4, the `describe(name, fn, { timeout })` overload is gone. Pass timeout as the second argument to each `it()` call instead:

```ts
// ❌ Vitest 3 — removed in v4
describe('suite', () => { ... }, { timeout: 30_000 });

// ✅ Vitest 4
describe('suite', () => {
  it('slow test', async () => { ... }, 30_000);
});
```

**Why:** The API was deprecated in v3 and removed in v4 to avoid confusion between suite-level and test-level timeouts.

**How to apply:** Any time you write tests for the api-server (or any workspace package using Vitest), use the per-`it` timeout form. This applies to the bcrypt tests which genuinely need ~30 s.
