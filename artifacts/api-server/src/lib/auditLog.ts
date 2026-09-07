import { db, auditLogTable } from "@workspace/db";
import type { SessionUser } from "./auth";

/**
 * Minimal structural type accepted by the optional `tx` parameter below.
 * Matches both the top-level `db` object and any Drizzle transaction object —
 * both expose an `insert` method at runtime with an identical signature.
 * (See the MEMORY note on Drizzle transaction vs db types for why `tx as any`
 * is used at call-sites rather than a stricter cast.)
 */
type InsertableDB = Pick<typeof db, "insert">;

/**
 * Writes a single audit-log entry.
 *
 * Pass `tx` when calling inside a Drizzle transaction so the write participates
 * in the same atomic unit as the surrounding business-logic inserts/updates.
 * If the transaction rolls back, the audit record rolls back with it.
 *
 * When `tx` is omitted the module-level `db` is used (backward-compatible with
 * all existing call-sites outside a transaction).
 */
export async function recordAuditLog(
  entry: {
    actor?: SessionUser | null;
    action: string;
    targetType?: string;
    targetId?: number;
    metadata?: Record<string, unknown>;
  },
  tx?: InsertableDB,
): Promise<void> {
  const conn = tx ?? db;
  await conn.insert(auditLogTable).values({
    actorId: entry.actor?.id ?? null,
    actorRole: entry.actor?.role ?? null,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
  });
}
