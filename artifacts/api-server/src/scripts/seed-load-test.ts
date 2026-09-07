/**
 * LOAD TEST SEED SCRIPT
 * =====================
 * Creates 500 synthetic office records for load / performance testing.
 *
 * ISOLATION GUARANTEE
 * -------------------
 * All 500 offices are inserted with status = 'draft'.  Every public-facing
 * API endpoint (GET /api/offices, GET /offices/:slug, /api/categories,
 * /api/platform, /api/favourites, /api/assistants) filters on
 * status = 'active', so draft offices are *structurally invisible* to all
 * public users without any query changes.
 *
 * IDENTIFICATION
 * --------------
 * Every generated record carries the LOAD_TEST_ name prefix and uses the
 * @loadtest.invalid email domain (.invalid is RFC-2606-reserved; mail can
 * never be delivered to this domain).  This makes bulk cleanup unambiguous.
 *
 * EXTERNAL SERVICES
 * -----------------
 * - No object-storage uploads (no media rows created).
 * - No AI assistant configuration (no office_assistant_settings rows).
 * - No email / WhatsApp / notification hooks fire on plain DB inserts.
 * - bcrypt hash computed once and reused across all 500 rows.
 *
 * IDEMPOTENCY
 * -----------
 * The script checks for existing load-test rows before starting.  If any
 * exist it exits cleanly so a partial prior run cannot corrupt the data.
 * Run cleanup-load-test.ts first, then re-run this script if needed.
 *
 * CLEANUP
 * -------
 * Run:  pnpm --filter @workspace/api-server seed:load-test:cleanup
 * That script deletes all LOAD_TEST_ records and verifies the DB returns
 * to the exact pre-seeding baseline.
 */

import {
  db,
  pool,
  usersTable,
  officesTable,
  officeServicesTable,
} from "@workspace/db";
import { like, sql, inArray } from "drizzle-orm";
import { hashPassword } from "../lib/auth";
import { logger } from "../lib/logger";

// ─── Constants ───────────────────────────────────────────────────────────────

const TOTAL = 500;
const USER_BATCH = 100;   // rows per INSERT for users  (~700 pg params / batch)
const OFFICE_BATCH = 50;  // rows per INSERT for offices (~1 200 pg params / batch)
const SVC_BATCH = 200;    // rows per INSERT for services (~600 pg params / batch)

/** RFC-2606 §2 — the .invalid TLD is permanently reserved and unresolvable. */
const LOAD_TEST_DOMAIN = "loadtest.invalid";

/** Never used for real auth; exists only to satisfy the NOT NULL constraint. */
const DUMMY_PASSWORD = "LoadTest_NotUsedForAuth_Synthetic2026!";

const CATEGORIES = [
  "translation", "legal", "marketing", "development", "design",
  "real_estate", "company_formation", "business_consulting",
  "accounting", "social_media_management", "other",
] as const;

const CITIES = [
  "Riyadh", "Jeddah", "Dubai", "Abu Dhabi", "Kuwait City",
  "Doha", "Manama", "Muscat", "Amman", "Cairo", "Beirut",
];

/** Two services per office — named so they are obviously synthetic. */
const SERVICE_TEMPLATES = [
  { name: "LOAD_TEST_Service_Primary",   nameAr: "خدمة اختبار التحميل الرئيسية" },
  { name: "LOAD_TEST_Service_Secondary", nameAr: "خدمة اختبار التحميل الثانوية" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Zero-pad n to 4 digits so slugs/names sort stably. */
function pad(n: number): string {
  return String(n).padStart(4, "0");
}

function loadTestEmail(n: number): string {
  return `load_test_${pad(n)}@${LOAD_TEST_DOMAIN}`;
}

function loadTestSlug(n: number): string {
  return `load-test-${pad(n)}`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  logger.info("=== LOAD_TEST seed: starting ===");

  // ── Pre-flight: abort if load-test rows already exist ──────────────────────
  const [existingRow] = await db
    .select({ cnt: sql<string>`count(*)` })
    .from(usersTable)
    .where(like(usersTable.email, `%@${LOAD_TEST_DOMAIN}`));

  const alreadyPresent = Number(existingRow.cnt);
  if (alreadyPresent > 0) {
    logger.error(
      { alreadyPresent },
      "Load-test rows already exist — run cleanup-load-test.ts first, then retry.",
    );
    process.exitCode = 1;
    return;
  }

  // ── Record baseline counts ─────────────────────────────────────────────────
  const baselineResult = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM offices)              AS offices,
      (SELECT count(*)::int FROM offices
         WHERE status = 'active')                      AS active_offices,
      (SELECT count(*)::int FROM office_services)      AS services,
      (SELECT count(*)::int FROM office_media)         AS media
  `);
  const baseline = baselineResult.rows[0];
  logger.info({ baseline }, "Baseline counts before seeding");

  // ── Hash password once; reuse for all 500 ─────────────────────────────────
  logger.info("Computing bcrypt hash (once)…");
  const passwordHash = await hashPassword(DUMMY_PASSWORD);
  logger.info("Hash ready — beginning bulk inserts");

  // ── Insert users in batches ────────────────────────────────────────────────
  let totalUsersInserted = 0;

  for (let start = 1; start <= TOTAL; start += USER_BATCH) {
    const end = Math.min(start + USER_BATCH - 1, TOTAL);
    const rows = [];
    for (let i = start; i <= end; i++) {
      rows.push({
        role: "office" as const,
        name: `LOAD_TEST_User_${pad(i)}`,
        email: loadTestEmail(i),
        phone: null as string | null,
        passwordHash,
        status: "active" as const,   // user account active; office row is draft
      });
    }
    const inserted = await db
      .insert(usersTable)
      .values(rows)
      .returning({ id: usersTable.id });
    totalUsersInserted += inserted.length;
  }
  logger.info({ totalUsersInserted }, "Users inserted");

  // ── Fetch all load-test user IDs ───────────────────────────────────────────
  // Build the full email list and resolve in one query.
  const allEmails = Array.from({ length: TOTAL }, (_, i) => loadTestEmail(i + 1));
  const allUsers = await db
    .select({ id: usersTable.id, email: usersTable.email })
    .from(usersTable)
    .where(inArray(usersTable.email, allEmails));

  const emailToUserId = new Map(allUsers.map((u) => [u.email, u.id]));

  if (emailToUserId.size !== TOTAL) {
    logger.error(
      { expected: TOTAL, found: emailToUserId.size },
      "User count mismatch after insert — aborting",
    );
    process.exitCode = 1;
    return;
  }

  // ── Insert offices in batches ──────────────────────────────────────────────
  let totalOfficesInserted = 0;
  const insertedOfficeIds: number[] = [];

  for (let start = 1; start <= TOTAL; start += OFFICE_BATCH) {
    const end = Math.min(start + OFFICE_BATCH - 1, TOTAL);
    const rows = [];

    for (let i = start; i <= end; i++) {
      const userId = emailToUserId.get(loadTestEmail(i));
      if (!userId) throw new Error(`Missing userId for load_test_${pad(i)}`);

      rows.push({
        userId,
        name: `LOAD_TEST_Office_${pad(i)}`,
        nameAr: `مكتب اختبار التحميل ${pad(i)}`,
        slug: loadTestSlug(i),
        category: CATEGORIES[(i - 1) % CATEGORIES.length],
        city: CITIES[(i - 1) % CITIES.length],
        email: loadTestEmail(i),
        whatsapp: null as string | null,
        shortDescription: `Synthetic load-test office #${i}. Not visible publicly. Safe to delete.`,
        shortDescriptionAr: `مكتب اختبار تحميل اصطناعي #${i}. غير مرئي للعامة. آمن للحذف.`,
        // ── Isolation: draft status means this office is invisible on every
        //    public endpoint (all filter on status = 'active'). ──────────────
        status: "draft" as const,
        isDemo: false,
        isVerified: false,
        isOnline: false,
        completedTransactions: 0,
        clientsRecommendPercent: 0,
        providerType: "office" as const,
        spokenLanguages: ["ar", "en"] as string[],
      });
    }

    const inserted = await db
      .insert(officesTable)
      .values(rows)
      .returning({ id: officesTable.id });

    totalOfficesInserted += inserted.length;
    insertedOfficeIds.push(...inserted.map((r) => r.id));
    logger.info({ batch: `${start}–${end}`, count: inserted.length }, "Office batch inserted");
  }

  // ── Insert services in batches ─────────────────────────────────────────────
  const allServiceRows = insertedOfficeIds.flatMap((officeId) =>
    SERVICE_TEMPLATES.map((svc) => ({ officeId, ...svc })),
  );

  let totalServicesInserted = 0;
  for (let start = 0; start < allServiceRows.length; start += SVC_BATCH) {
    const batch = allServiceRows.slice(start, start + SVC_BATCH);
    const inserted = await db
      .insert(officeServicesTable)
      .values(batch)
      .returning({ id: officeServicesTable.id });
    totalServicesInserted += inserted.length;
  }

  // ── Post-seed verification ─────────────────────────────────────────────────
  const afterResult = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM offices
         WHERE name LIKE 'LOAD_TEST_%')              AS load_test_offices,
      (SELECT count(*)::int FROM offices
         WHERE name LIKE 'LOAD_TEST_%'
           AND status = 'active')                    AS load_test_active,
      (SELECT count(*)::int FROM office_services
         WHERE name LIKE 'LOAD_TEST_%')              AS load_test_services,
      (SELECT count(*)::int FROM offices
         WHERE status = 'active'
           AND name NOT LIKE 'LOAD_TEST_%')          AS real_active_offices
  `);
  const afterCounts = afterResult.rows[0] as Record<string, unknown>;

  logger.info({ afterCounts }, "Post-seed verification counts");

  if (Number(afterCounts.load_test_active) !== 0) {
    logger.error("CRITICAL: load-test offices are visible as active — abort and investigate.");
    process.exitCode = 1;
    return;
  }

  logger.info(
    {
      usersInserted: totalUsersInserted,
      officesInserted: totalOfficesInserted,
      servicesInserted: totalServicesInserted,
      publiclyVisibleLoadTestOffices: 0,
      afterCounts,
    },
    "=== LOAD_TEST seed complete — 0 load-test offices are publicly visible ===",
  );
  logger.info("Run `pnpm --filter @workspace/api-server seed:load-test:cleanup` to remove all records.");
}

main()
  .catch((err) => {
    logger.error({ err }, "LOAD_TEST seed failed");
    process.exitCode = 1;
  })
  .finally(() => pool.end());
