/**
 * LOAD TEST CLEANUP SCRIPT
 * ========================
 * Removes ALL records created by seed-load-test.ts and verifies the
 * database returns to exact pre-seeding baseline counts.
 *
 * Deletion strategy
 * -----------------
 * Deleting from the `users` table where email ends with @loadtest.invalid
 * is sufficient.  The schema uses ON DELETE CASCADE for every child table:
 *
 *   users  ──cascade──▶  offices  ──cascade──▶  office_services
 *                                  ──cascade──▶  office_media
 *                                  ──cascade──▶  office_verification_documents
 *                                  ──cascade──▶  office_admin_notes
 *
 * No other tables (favourites, contact_events, etc.) can reference load-test
 * offices because they are status = 'draft' — no public user can interact
 * with them.
 *
 * Expected post-cleanup baseline
 * --------------------------------
 *   offices:        28
 *   active offices: 12
 *   office_services: 37
 *   office_media:    22
 */

import { db, pool, usersTable, officesTable, officeServicesTable, officeMediaTable } from "@workspace/db";
import { like, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

/** Baseline counts captured before the seed run (from DB snapshot). */
const EXPECTED_BASELINE = {
  offices: 28,
  active_offices: 12,
  services: 37,
  media: 22,
} as const;

async function main() {
  logger.info("=== LOAD_TEST cleanup: starting ===");

  // ── 1. Count what we are about to delete ──────────────────────────────────
  const beforeResult = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM users
         WHERE email LIKE '%@loadtest.invalid')          AS load_test_users,
      (SELECT count(*)::int FROM offices
         WHERE name LIKE 'LOAD_TEST_%')                  AS load_test_offices,
      (SELECT count(*)::int FROM office_services
         WHERE name LIKE 'LOAD_TEST_%')                  AS load_test_services,
      (SELECT count(*)::int FROM offices
         WHERE name LIKE 'LOAD_TEST_%'
           AND status = 'active')                        AS load_test_active_offices
  `);

  const bc = beforeResult.rows[0] as {
    load_test_users: number;
    load_test_offices: number;
    load_test_services: number;
    load_test_active_offices: number;
  };

  logger.info({ toDelete: bc }, "Records identified for deletion");

  if (bc.load_test_users === 0 && bc.load_test_offices === 0) {
    logger.info("No load-test records found — nothing to clean up.");
    return;
  }

  if (bc.load_test_active_offices > 0) {
    logger.warn(
      { count: bc.load_test_active_offices },
      "WARNING: some load-test offices have status=active — they may be visible publicly. Deleting anyway.",
    );
  }

  // ── 2. Delete load-test users (cascades to offices → services/media/docs) ──
  logger.info("Deleting load-test users (cascade will remove offices and child rows)…");

  const deleted = await db
    .delete(usersTable)
    .where(like(usersTable.email, `%@loadtest.invalid`))
    .returning({ id: usersTable.id });

  logger.info({ deletedUsers: deleted.length }, "Users deleted (cascade completed)");

  // ── 3. Safety check: no LOAD_TEST_ orphans in offices ─────────────────────
  const orphanResult = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM offices
         WHERE name LIKE 'LOAD_TEST_%')              AS orphan_offices,
      (SELECT count(*)::int FROM office_services
         WHERE name LIKE 'LOAD_TEST_%')              AS orphan_services
  `);

  const oc = orphanResult.rows[0] as { orphan_offices: number; orphan_services: number };

  if (oc.orphan_offices > 0 || oc.orphan_services > 0) {
    logger.error(
      { orphans: oc },
      "ORPHAN RECORDS DETECTED — cascade delete may have failed. Manual intervention required.",
    );
    process.exitCode = 1;
    return;
  }

  logger.info("No orphan records found — cascade delete verified clean.");

  // ── 4. Verify return to exact baseline ────────────────────────────────────
  const finalResult = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM offices)              AS offices,
      (SELECT count(*)::int FROM offices
         WHERE status = 'active')                      AS active_offices,
      (SELECT count(*)::int FROM office_services)      AS services,
      (SELECT count(*)::int FROM office_media)         AS media
  `);

  const fc = finalResult.rows[0] as {
    offices: number;
    active_offices: number;
    services: number;
    media: number;
  };

  logger.info({ finalCounts: fc, expectedBaseline: EXPECTED_BASELINE }, "Post-cleanup counts");

  const mismatches: string[] = [];
  if (fc.offices !== EXPECTED_BASELINE.offices)
    mismatches.push(`offices: got ${fc.offices}, expected ${EXPECTED_BASELINE.offices}`);
  if (fc.active_offices !== EXPECTED_BASELINE.active_offices)
    mismatches.push(`active_offices: got ${fc.active_offices}, expected ${EXPECTED_BASELINE.active_offices}`);
  if (fc.services !== EXPECTED_BASELINE.services)
    mismatches.push(`services: got ${fc.services}, expected ${EXPECTED_BASELINE.services}`);
  if (fc.media !== EXPECTED_BASELINE.media)
    mismatches.push(`media: got ${fc.media}, expected ${EXPECTED_BASELINE.media}`);

  if (mismatches.length > 0) {
    logger.error(
      { mismatches },
      "BASELINE MISMATCH — database did not return to pre-seeding state. Investigate before proceeding.",
    );
    process.exitCode = 1;
    return;
  }

  logger.info(
    {
      deletedUsers: deleted.length,
      deletedOffices: bc.load_test_offices,
      deletedServices: bc.load_test_services,
      baselineVerified: true,
      finalCounts: fc,
    },
    "=== LOAD_TEST cleanup complete — database restored to exact baseline ===",
  );
}

main()
  .catch((err) => {
    logger.error({ err }, "LOAD_TEST cleanup failed");
    process.exitCode = 1;
  })
  .finally(() => pool.end());
