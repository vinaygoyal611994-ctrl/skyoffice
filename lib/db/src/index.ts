import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// ---------------------------------------------------------------------------
// Connection pool configuration
//
// max: 10 — safe limit for Replit Autoscale. PostgreSQL on this host allows
//   112 max_connections. With max=10 per API instance, up to 11 concurrent
//   instances can run before connections are exhausted, leaving headroom for
//   migrations, psql sessions, and monitoring tools.
//   Increase to 15–20 only if you add a PgBouncer connection pooler.
//
// idleTimeoutMillis: 30 000 — release idle connections after 30 s to avoid
//   holding slots during low-traffic periods.
//
// connectionTimeoutMillis: 5 000 — fail fast if the DB is unreachable rather
//   than queuing requests indefinitely; the caller gets a 500 instead of a
//   hung response.
// ---------------------------------------------------------------------------
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  // keepAlive prevents the Replit PostgreSQL server from silently closing idle
  // connections while the Autoscale instance is between requests. Without this,
  // the first DB query after a quiet period hits a dead connection, the pool
  // spends the full connectionTimeoutMillis creating a replacement, and that
  // first request returns 500. TCP keepalive probes detect the dead connection
  // before it is handed to a query.
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
});

// Log pool-level errors so they surface in Pino logs rather than crashing
// the process with an unhandled 'error' event (pg emits these for idle
// client disconnects).
pool.on("error", (err: Error) => {
  console.error("[db-pool] Unexpected PostgreSQL pool error:", err.message);
});

export const db = drizzle(pool, { schema });

export * from "./schema";
