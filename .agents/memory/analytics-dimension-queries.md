---
name: Analytics dimension functions use db.execute
description: The five analytics aggregation dimension functions all use db.execute(sql`...`), not db.select or pool.query. Critical for test mocking.
---

## What each dimension uses

All five dimension aggregators (`aggregateGlobal`, `aggregateByOffice`, `aggregateByMarket`,
`aggregateBySource`, `aggregateBySearch`) use:

```typescript
db.execute(sql`SELECT ... FROM analytics_events WHERE ...`)
```

They do NOT call:
- `db.select()` — not used for analytics reads
- `pool.query()` — not used for dimension queries

## For testing (triggering failures)

To make all dimensions fail in unit tests:
```typescript
mockDb.execute.mockImplementation(() => { throw new Error("db error"); });
```

This causes each dimension's top-level `await Promise.all([db.execute(...), ...])` to throw,
the per-dimension catch block captures the error into `dimensionErrors[]`, and when
`dimensionErrors.length > 0` the job is marked `failed`.

The `createJob` insert uses `db.insert(analyticsAggregationJobsTable).values(...).returning(...)` —
this is unaffected by mocking `db.execute`.

**Why:** Important to know which DB call to mock when testing error/failure paths; mocking the
wrong method leaves dimensions appearing to succeed.
