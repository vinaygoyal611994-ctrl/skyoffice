---
name: pg Pool.connect() overload type
description: ReturnType<typeof pool.connect> resolves to void (last overload wins in TS); how to type dedicated advisory-lock clients without importing pg directly.
---

## The problem
`pool.connect()` in `@types/pg` has two overloads:
1. `connect(): Promise<PoolClient>`   ← the one we want
2. `connect(callback: (err, client, done) => void): void`  ← last overload

TypeScript's `ReturnType<typeof pool.connect>` picks the **last** overload → returns `void`.
So `Awaited<ReturnType<typeof pool.connect>>` = `void`, and declaring `lockClient` with that type causes cascade errors.

## The fix
Define a minimal local interface that describes only the methods we actually call, and cast the result:

```typescript
// In the file that needs it — avoids importing "pg" as a direct dep
interface DBLockClient {
  query<T = unknown>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
  release(destroy?: boolean): void;
}

let lockClient: DBLockClient | null = null;
// ...
lockClient = await pool.connect() as unknown as DBLockClient;
```

**Why:** `pg` is only a direct dependency of `@workspace/db`, not of `@workspace/api-server`.
`import type { PoolClient } from "pg"` fails in the api-server context.

**How to apply:** Anywhere a file in `artifacts/api-server` needs a typed reference to a checked-out pool connection (advisory locks, row-level locking, etc.).
