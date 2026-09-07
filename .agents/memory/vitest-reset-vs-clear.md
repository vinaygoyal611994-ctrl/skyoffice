---
name: vitest resetAllMocks vs clearAllMocks
description: Critical difference between vi.clearAllMocks() and vi.resetAllMocks() for mockResolvedValueOnce queues.
---

## Rule

Always use `vi.resetAllMocks()` in global `beforeEach` hooks when tests use `mockResolvedValueOnce`.

**Why:** `vi.clearAllMocks()` clears call history (mock.calls, mock.results) but does NOT drain the `mockResolvedValueOnce` queue. When a function returns early (e.g. when `supply_cap = null`, the second DB query is never made), the unconsumed mock response stays in the queue and pollutes the next test.

`vi.resetAllMocks()` drains the queue AND clears history — this is the correct choice for test isolation.

## Pattern

```typescript
// At file top level (outside all describe blocks)
beforeEach(() => { vi.resetAllMocks(); });

// Do NOT add per-describe beforeEach hooks for clearAllMocks — the global one covers all
```

## How to apply

- Any test file that uses `mockResolvedValueOnce` (mocked pool queries, API calls, etc.)
- Do NOT use `vi.clearAllMocks()` when mocking async functions; it will cause flaky tests that fail depending on test order
