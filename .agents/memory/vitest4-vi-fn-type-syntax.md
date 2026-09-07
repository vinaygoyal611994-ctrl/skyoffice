---
name: Vitest 4 vi.fn type argument syntax
description: vi.fn generic signature changed in Vitest 4 — old two-tuple form no longer compiles.
---

## Rule
In Vitest 4, `vi.fn<Args, Return>()` (two type arguments) is invalid. Use function-signature form instead.

**Old (Vitest 3, now broken):**
```typescript
vi.fn<[], Promise<number | null>>()
vi.fn<[number], Promise<string | null>>()
```

**New (Vitest 4, correct):**
```typescript
vi.fn<() => Promise<number | null>>()
vi.fn<(officeId: number) => Promise<string | null>>()
```

**Why:** Vitest 4 changed `fn<TArgs extends any[], TReturn>()` to `fn<T extends (...args: any) => any>()`.

**How to apply:** When tsc reports `Expected 0-1 type arguments, but got 2` on a `vi.fn<...>()` call, rewrite to the single function-type form.
