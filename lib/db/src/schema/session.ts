import { pgTable, varchar, json, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Declares the `session` table so drizzle-kit push recognizes it as an
 * existing, intentionally-managed table and does not propose dropping it.
 *
 * This table's actual lifecycle (creation, reads, writes, expiry) is owned
 * entirely by `connect-pg-simple` (see artifacts/api-server/src/app.ts),
 * not by application code. Do not query or migrate it via Drizzle.
 */
export const sessionTable = pgTable(
  "session",
  {
    sid: varchar("sid").primaryKey().notNull(),
    sess: json("sess").notNull(),
    expire: timestamp("expire", { mode: "date" }).notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);
