import app from "./app";
import { logger } from "./lib/logger";
import { cleanupExpiredTokens } from "./lib/passwordReset";
import { scheduleBackups } from "./lib/backup";
import { scheduleAnalyticsAggregation, backfillMissedDates } from "./lib/analyticsAggregator";
import { scheduleMarketRecompute } from "./lib/marketRecompute";
import { scheduleSubscriptionSweep } from "./lib/subscriptionSweeper";
import { scheduleReservationSweep } from "./lib/slotReservationSweeper";
import { scheduleOutboxWorker } from "./lib/slotNotificationOutbox";
import { scheduleSlotSyncSweep } from "./lib/slotSyncRecovery";
import { scheduleSrOutboxWorker } from "./lib/serviceRequestNotificationOutbox";
import { pool, db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword, verifyPassword } from "./lib/auth";
import { missingStorageEnvVars } from "./lib/storageConfig";

const rawPort = process.env["PORT"];


if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// ---------------------------------------------------------------------------
// Production env warnings — emitted at startup so problems are visible
// in the deployment logs before any user hits a broken flow.
// ---------------------------------------------------------------------------
if (process.env.NODE_ENV === "production") {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
    logger.warn(
      "[startup] RESEND_API_KEY and RESEND_FROM_EMAIL are required in production. " +
      "Password recovery, provider verification, and service-request " +
      "notifications will remain disabled until an email provider is configured.",
    );
  }
  if (
    !process.env.TWILIO_ACCOUNT_SID ||
    !process.env.TWILIO_AUTH_TOKEN ||
    (!process.env.TWILIO_FROM_PHONE_NUMBER &&
      !process.env.TWILIO_FROM_PHONE &&
      !process.env.TWILIO_MESSAGING_SERVICE_SID)
  ) {
    logger.warn(
      "[startup] Twilio SMS verification is not configured. Set " +
        "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and either " +
        "TWILIO_FROM_PHONE_NUMBER (legacy TWILIO_FROM_PHONE is also supported) " +
        "or TWILIO_MESSAGING_SERVICE_SID. " +
        "Phone verification requests will fail closed until configured.",
    );
  }
  if (!process.env.FRONTEND_URL) {
    throw new Error(
      "[startup] FRONTEND_URL is required in production for password reset " +
        "links and payment redirects. Set it to the canonical frontend origin " +
        "before deploying.",
    );
  }
  // S3-compatible object storage is mandatory in production — media uploads,
  // document serving, and DB backups all depend on it. Fail fast with a
  // clear error instead of letting the first upload/serve request 500.
  {
    const missing = missingStorageEnvVars();
    if (missing.length > 0) {
      throw new Error(
        `[startup] Missing required storage env vars in production: ` +
        `${missing.join(", ")}. Configure the S3-compatible storage ` +
        `credentials and bucket names before deploying.`,
      );
    }
  }
} else {
  const missingDev = missingStorageEnvVars();
  if (missingDev.length > 0) {
    logger.warn(
      `[startup] Storage env vars not set (${missingDev.join(", ")}) — ` +
      "object storage features (uploads, media serving, backups) will fail " +
      "until they are configured.",
    );
  }
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // ---------------------------------------------------------------------------
  // Eager DB connection warm-up.
  //
  // On Autoscale, the pg pool is lazy — it creates connections on first use.
  // Without this, the very first user requests after a cold start hit a fresh
  // SSL handshake to the production PostgreSQL server, and the 5 s
  // connectionTimeoutMillis causes those requests to fail with a 500.
  //
  // By warming up immediately after the server starts listening, the pool has
  // at least one healthy, SSL-negotiated connection ready before any real
  // traffic arrives. The .catch() prevents the error from crashing the process
  // on environments where the DB is briefly unavailable at startup.
  // ---------------------------------------------------------------------------
  pool.query("SELECT 1").then(() => {
    logger.info("[startup] DB connection warm-up succeeded");
  }).catch((warmupErr: Error) => {
    logger.warn({ err: warmupErr.message }, "[startup] DB connection warm-up failed — first requests may hit a cold connection");
  });

  // ---------------------------------------------------------------------------
  // Admin password sync — keeps the admin account's stored bcrypt hash in sync
  // with SEED_ADMIN_PASSWORD on every startup.
  //
  // Why this is needed: the admin account is seeded once when the environment is
  // first set up. If SEED_ADMIN_PASSWORD is later rotated (or if the environment
  // was provisioned with a temporary value), the stored hash becomes stale and
  // every admin login returns 401. This routine detects the drift and corrects
  // it idempotently: it only writes a new hash when bcrypt.compare reports a
  // mismatch, so a matching hash causes zero DB writes.
  //
  // Runs whenever SEED_ADMIN_PASSWORD is present in the environment. Safe to
  // repeat on every startup — bcrypt compare on a hit is fast (~100 ms) and the
  // UPDATE is a no-op when hashes already match.
  // ---------------------------------------------------------------------------
  if (process.env.SEED_ADMIN_PASSWORD) {
    (async () => {
      try {
        const [admin] = await db
          .select({ id: usersTable.id, passwordHash: usersTable.passwordHash })
          .from(usersTable)
          .where(eq(usersTable.email, "admin@skayoffice.demo"))
          .limit(1);

        if (!admin) {
          logger.warn("[startup] admin password sync: admin@skayoffice.demo not found — skipping");
          return;
        }

        const matches = await verifyPassword(
          process.env.SEED_ADMIN_PASSWORD!,
          admin.passwordHash,
        );

        if (matches) {
          logger.info("[startup] admin password sync: stored hash matches SEED_ADMIN_PASSWORD — no update needed");
        } else {
          const newHash = await hashPassword(process.env.SEED_ADMIN_PASSWORD!);
          await db
            .update(usersTable)
            .set({ passwordHash: newHash })
            .where(eq(usersTable.id, admin.id));
          logger.info("[startup] admin password sync: hash updated to match current SEED_ADMIN_PASSWORD");
        }
      } catch (err) {
        logger.warn({ err }, "[startup] admin password sync failed — admin login may not work until next restart");
      }
    })();
  }

  // ---------------------------------------------------------------------------
  // Analytics Phase 1: Seed service_taxonomy reference data if empty.
  //
  // The Replit Publish flow syncs the database schema (DDL) but does not
  // replay INSERT statements from migration files. This idempotent seed runs
  // on every startup and is safe to repeat: ON CONFLICT DO NOTHING means it
  // only writes rows that are genuinely missing.
  // ---------------------------------------------------------------------------
  pool.query(`
    INSERT INTO service_taxonomy (service_key, category_key, name_en, name_ar, sort_order) VALUES
      ('translation_legal',        'translation', 'Legal Translation',         'ترجمة قانونية',          10),
      ('translation_medical',      'translation', 'Medical Translation',       'ترجمة طبية',              20),
      ('translation_technical',    'translation', 'Technical Translation',     'ترجمة تقنية',             30),
      ('translation_financial',    'translation', 'Financial Translation',     'ترجمة مالية',             40),
      ('translation_certified',    'translation', 'Certified Translation',     'ترجمة رسمية معتمدة',       50),
      ('translation_simultaneous', 'translation', 'Simultaneous Interpreting', 'ترجمة فورية',             60),
      ('translation_subtitles',    'translation', 'Subtitles & Transcription', 'ترجمة وتفريغ مرئي',       70),
      ('legal_labor_cases',        'legal', 'Labor Cases',                    'قضايا عمالية',             10),
      ('legal_commercial_cases',   'legal', 'Commercial Cases',               'قضايا تجارية',              20),
      ('legal_contracts',          'legal', 'Contracts & Agreements',         'صياغة العقود',              30),
      ('legal_company_formation',  'legal', 'Company Formation',              'تأسيس الشركات',             40),
      ('legal_debt_collection',    'legal', 'Debt Collection',                'تحصيل الديون',              50),
      ('legal_enforcement',        'legal', 'Enforcement Orders',             'أوامر التنفيذ',              60),
      ('legal_family_law',         'legal', 'Family Law',                     'قضايا الأحوال الشخصية',    70),
      ('legal_consultation',       'legal', 'Legal Consultation',             'استشارات قانونية',          80),
      ('legal_real_estate_cases',  'legal', 'Real Estate Cases',              'قضايا عقارية',              90),
      ('marketing_brand_identity', 'marketing', 'Brand Identity',             'هوية بصرية',                10),
      ('marketing_campaigns',      'marketing', 'Ad Campaigns',               'حملات إعلانية',              20),
      ('marketing_seo',            'marketing', 'SEO & SEM',                  'تحسين محركات البحث',        30),
      ('marketing_content',        'marketing', 'Content Creation',           'إنتاج المحتوى',              40),
      ('marketing_photography',    'marketing', 'Product Photography',        'تصوير المنتجات',             50),
      ('marketing_video_prod',     'marketing', 'Video Production',           'إنتاج الفيديو',              60),
      ('marketing_influencer',     'marketing', 'Influencer Marketing',       'تسويق المؤثرين',            70),
      ('dev_web_app',      'development', 'Web Application',                  'تطبيق ويب',                 10),
      ('dev_mobile_app',   'development', 'Mobile App',                       'تطبيق جوال',                20),
      ('dev_ecommerce',    'development', 'E-commerce Store',                 'متجر إلكتروني',              30),
      ('dev_api',          'development', 'API & Backend',                    'واجهة برمجية وخادم',        40),
      ('dev_erp_crm',      'development', 'ERP / CRM Systems',                'أنظمة ERP وCRM',             50),
      ('dev_ai_ml',        'development', 'AI / ML Solutions',                'حلول الذكاء الاصطناعي',     60),
      ('design_logo',          'design', 'Logo Design',                       'تصميم شعار',                10),
      ('design_ui_ux',         'design', 'UI / UX Design',                    'تصميم واجهات',               20),
      ('design_print',         'design', 'Print & Packaging',                 'طباعة وتغليف',               30),
      ('design_motion',        'design', 'Motion Graphics',                   'موشن جرافيك',               40),
      ('design_3d',            'design', '3D Visualization',                  'نمذجة ثلاثية الأبعاد',      50),
      ('design_social_media',  'design', 'Social Media Design',               'تصاميم سوشيال ميديا',       60),
      ('re_buy',       'real_estate', 'Property Purchase',                    'شراء عقارات',                10),
      ('re_rent',      'real_estate', 'Property Rental',                      'إيجار عقارات',               20),
      ('re_sell',      'real_estate', 'Property Sale',                        'بيع عقارات',                 30),
      ('re_valuation', 'real_estate', 'Property Valuation',                   'تقييم عقاري',                40),
      ('re_mgmt',      'real_estate', 'Property Management',                  'إدارة عقارات',               50),
      ('re_invest',    'real_estate', 'Real Estate Investment',               'استثمار عقاري',              60),
      ('cf_llc',         'company_formation', 'LLC Formation',                'تأسيس شركة ذات مسؤولية محدودة', 10),
      ('cf_branch',      'company_formation', 'Branch Office',                'تأسيس فرع',                  20),
      ('cf_holding',     'company_formation', 'Holding Company',              'شركة قابضة',                 30),
      ('cf_freelance',   'company_formation', 'Freelance License',            'رخصة مستقل',                 40),
      ('cf_trade_name',  'company_formation', 'Trade Name Registration',      'تسجيل اسم تجاري',            50),
      ('cf_amendments',  'company_formation', 'Amendments & Renewals',        'تعديلات وتجديدات تجارية',    60),
      ('bc_strategy',    'business_consulting', 'Business Strategy',          'الاستراتيجية التجارية',      10),
      ('bc_feasibility', 'business_consulting', 'Feasibility Studies',        'دراسات الجدوى',              20),
      ('bc_operations',  'business_consulting', 'Operations Consulting',      'استشارات تشغيلية',           30),
      ('bc_hr',          'business_consulting', 'HR Consulting',              'استشارات موارد بشرية',       40),
      ('bc_financial',   'business_consulting', 'Financial Advisory',         'الاستشارات المالية',         50),
      ('acc_bookkeeping', 'accounting', 'Bookkeeping',                        'مسك الدفاتر',                10),
      ('acc_audit',       'accounting', 'Auditing',                           'تدقيق حسابات',               20),
      ('acc_tax',         'accounting', 'Tax Filing & VAT',                   'ضريبة القيمة المضافة وإقرارات ضريبية', 30),
      ('acc_payroll',     'accounting', 'Payroll Management',                 'إدارة الرواتب',               40),
      ('acc_financial',   'accounting', 'Financial Statements',               'القوائم المالية',             50),
      ('acc_zakat',       'accounting', 'Zakat Calculation',                  'حساب الزكاة',                60),
      ('smm_management',  'social_media_management', 'Account Management',    'إدارة الحسابات',             10),
      ('smm_content',     'social_media_management', 'Content Strategy',      'استراتيجية المحتوى',         20),
      ('smm_reels',       'social_media_management', 'Reels & TikTok',        'ريلز وتيك توك',              30),
      ('smm_paid_ads',    'social_media_management', 'Paid Advertising',      'الإعلانات الممولة',          40),
      ('smm_community',   'social_media_management', 'Community Management',  'إدارة المجتمع',              50),
      ('other_general', 'other', 'General Services',                          'خدمات عامة',                 10)
    ON CONFLICT (service_key) DO NOTHING
  `).then((result) => {
    const rowCount = result.rowCount ?? 0;
    if (rowCount > 0) {
      logger.info({ rowCount }, "[startup] service_taxonomy seeded successfully");
    } else {
      logger.info("[startup] service_taxonomy already seeded — no-op");
    }
  }).catch((err: Error) => {
    logger.warn({ err: err.message }, "[startup] service_taxonomy seed failed — analytics market intelligence may show incomplete category data");
  });

  // ---------------------------------------------------------------------------
  // CLEANUP-02: One-time production cleanup — QA test freelancer account.
  //
  // Gated by CLEANUP_TOKEN_2 env var. Deletes the QA test freelancer account
  // (offices id = 48, slug = skayoffice-qa-test-freelancer) and all data
  // directly associated with it:
  //   • analytics_events for office_id = 48
  //   • office_media rows for office_id = 48
  //   • favourites rows for office_id = 48
  //   • analytics_daily_by_office rows for office_id = 48
  //   • The freelancer office record itself
  //   • Today's aggregated KPI rows if the hourly job already ran
  //
  // Idempotent: all DELETEs are no-ops once the rows no longer exist.
  // After cleanup is confirmed, remove CLEANUP_TOKEN_2 from env vars to
  // prevent this block from re-executing on future startups.
  // ---------------------------------------------------------------------------
  if (process.env.CLEANUP_TOKEN_2) {
    (async () => {
      try {
        const r1 = await pool.query(
          `DELETE FROM analytics_events WHERE office_id = 48`
        );
        const eventsDeleted = r1.rowCount ?? 0;

        const r2 = await pool.query(
          `DELETE FROM office_media WHERE office_id = 48`
        );
        const mediaDeleted = r2.rowCount ?? 0;

        const r3 = await pool.query(
          `DELETE FROM favourites WHERE office_id = 48`
        );
        const favouritesDeleted = r3.rowCount ?? 0;

        await pool.query(
          `DELETE FROM analytics_daily_by_office WHERE office_id = 48`
        );

        const r5 = await pool.query(
          `DELETE FROM offices WHERE id = 48`
        );
        const officeDeleted = r5.rowCount ?? 0;

        // If today's aggregation already ran, clear today's KPI rows so
        // the next hourly tick recomputes them without the deleted events.
        const aggCheck = await pool.query(`
          SELECT count(*)::int AS ran
          FROM analytics_aggregation_jobs
          WHERE date_start = CURRENT_DATE AND status = 'completed'`);
        const aggRan: boolean = (aggCheck.rows[0] as {ran: number}).ran > 0;
        let aggRowsCleared = 0;
        if (aggRan) {
          for (const tbl of [
            'analytics_daily_global',
            'analytics_daily_by_office',
            'analytics_daily_by_market',
            'analytics_daily_by_search',
            'analytics_daily_by_source',
          ]) {
            const rd = await pool.query(
              `DELETE FROM ${tbl} WHERE date = CURRENT_DATE`
            );
            aggRowsCleared += rd.rowCount ?? 0;
          }
          const rj = await pool.query(
            `DELETE FROM analytics_aggregation_jobs WHERE date_start = CURRENT_DATE`
          );
          aggRowsCleared += rj.rowCount ?? 0;
        }

        logger.info(
          { eventsDeleted, mediaDeleted, favouritesDeleted, officeDeleted, aggRan, aggRowsCleared },
          "[startup] CLEANUP-02: QA freelancer account cleanup completed"
        );
      } catch (err: unknown) {
        logger.error({ err }, "[startup] CLEANUP-02: cleanup failed — manual cleanup may be required");
      }
    })();
  }

  // ---------------------------------------------------------------------------
  // HIGH-07: One-time migration — invalidate legacy admin sessions.
  //
  // Sessions created before the HIGH-07 hardening commit lack `loginAt` and
  // `lastSeenAt` fields. The enforceAdminSessionLimits middleware intentionally
  // passes those sessions through (to avoid silently breaking existing logins),
  // which means they bypass the new 8-hour absolute limit and 30-minute idle
  // timeout. Deleting them on startup forces every admin to re-authenticate
  // under the new regime.
  //
  // This query is idempotent: after the first run every new admin session is
  // written with `loginAt`, so subsequent startups delete zero rows and the
  // log message confirms the no-op.
  // ---------------------------------------------------------------------------
  pool.query(
    `DELETE FROM session
     WHERE sess -> 'user' ->> 'role' = 'admin'
       AND sess -> 'loginAt' IS NULL`
  ).then((result) => {
    const count = result.rowCount ?? 0;
    if (count > 0) {
      logger.info(
        { sessionsRemoved: count },
        "[startup] HIGH-07: invalidated legacy admin sessions without loginAt — all admins must re-authenticate",
      );
    } else {
      logger.info("[startup] HIGH-07: no legacy admin sessions found — migration already applied");
    }
  }).catch((err: Error) => {
    logger.warn({ err: err.message }, "[startup] HIGH-07: legacy admin session cleanup failed — manual invalidation may be required");
  });

  // ---------------------------------------------------------------------------
  // DQ-01: One-time DML migration — flag existing demo/internal accounts.
  //
  // The Phase-1 analytics data-quality work added users.is_internal (default
  // false). Accounts whose email ends in @skayoffice.demo are seed/QA/admin
  // accounts and must be excluded from aggregated analytics.
  //
  // This block runs on every startup and is safe to repeat:
  //   • UPDATE only touches rows where is_internal is still false, so after
  //     the first run it affects 0 rows (confirmed by the rowCount log).
  //   • The verification SELECT then asserts the expected total is 12.
  //   • No other user data is touched.
  // ---------------------------------------------------------------------------
  (async () => {
    try {
      const updateResult = await pool.query(
        `UPDATE users
            SET is_internal = true
          WHERE email LIKE '%@skayoffice.demo'
            AND is_internal = false`
      );
      const flagged = updateResult.rowCount ?? 0;

      const verifyResult = await pool.query(
        `SELECT COUNT(*)::int AS total
           FROM users
          WHERE email LIKE '%@skayoffice.demo'
            AND is_internal = true`
      );
      const total: number = (verifyResult.rows[0] as { total: number }).total;

      if (flagged > 0) {
        logger.info(
          { flagged, total },
          "[startup] DQ-01: demo accounts flagged as internal"
        );
      } else {
        logger.info(
          { total },
          "[startup] DQ-01: demo accounts already flagged — no-op"
        );
      }

      if (total !== 12) {
        logger.warn(
          { total, expected: 12 },
          "[startup] DQ-01: unexpected internal account count — expected 12"
        );
      }
    } catch (err: unknown) {
      logger.warn({ err }, "[startup] DQ-01: demo account flagging failed — analytics may include internal traffic");
    }
  })();

  // ---------------------------------------------------------------------------
  // HIGH-09: Automated secondary database backup to object storage.
  //
  // Primary backup tier is Neon PITR (always active, managed by Replit/Neon,
  // 7-day retention on Core / 28-day on Pro/Teams).
  //
  // This secondary tier runs a daily pg_dump → gzip → GCS upload so that
  // backups also exist independently of the Neon service (e.g. if there is a
  // billing or platform-level issue affecting the database itself).
  //
  // Only registered in production so that development server runs do not
  // interleave dev-environment dumps with the production backup history.
  // See DISASTER_RECOVERY.md for restore procedures covering both tiers.
  // ---------------------------------------------------------------------------
  if (process.env.NODE_ENV === "production") {
    scheduleBackups();
    scheduleAnalyticsAggregation();
    scheduleMarketRecompute();
  }

  // Subscription sweeper runs in all environments (dev + prod).
  // Transitions expiring/expired state and sends reminder emails.
  scheduleSubscriptionSweep();

  // Reservation sweeper — expires 3-hour slot reservations and passes
  // the opportunity to the next eligible provider via processWaitlist().
  scheduleReservationSweep();
  scheduleOutboxWorker();

  // SR notification outbox worker — emails office/customer on lifecycle events.
  scheduleSrOutboxWorker();

  // Slot-sync recovery sweeper — retries convertReservationToAllocation for any
  // office where payment committed but slot conversion failed post-commit.
  scheduleSlotSyncSweep();

  // ---------------------------------------------------------------------------
  // Phase 1 analytics: backfill any missed aggregations from the last
  // AGGREGATION_BACKFILL_DAYS days. Runs on every startup (idempotent).
  // Errors are caught and logged — never fail startup over analytics.
  // ---------------------------------------------------------------------------
  backfillMissedDates().catch((err: Error) => {
    logger.warn(
      { err: err.message },
      "[startup] Analytics backfill failed — non-critical, will retry next scheduled run",
    );
  });

  // ---------------------------------------------------------------------------
  // SEED-OFFICE-USER17: One-time production seed — create draft office for
  // the real pilot user (id = 17, sdsh2017@gmail.com) whose office record
  // was deleted during QA cleanup.
  //
  // Gated by SEED_OFFICE_USER17 env var. The INSERT uses WHERE NOT EXISTS so
  // it is fully idempotent: if the user already has any office the statement
  // is a no-op and the block logs a skip. Status is explicitly 'draft' so the
  // office is invisible to the public listing and requires no admin approval.
  //
  // After this has been confirmed to have run (check deployment logs for
  // "SEED-OFFICE-USER17: draft office created"), remove SEED_OFFICE_USER17
  // from env vars to prevent the block from evaluating on future startups.
  // ---------------------------------------------------------------------------
  if (process.env.SEED_OFFICE_USER17) {
    (async () => {
      try {
        const result = await pool.query(`
          INSERT INTO offices (
            user_id, name, name_ar, category, city, email,
            slug, status, is_online, is_verified, is_demo,
            provider_type, spoken_languages, custom_languages,
            accepts_phone_calls, video_call_enabled
          )
          SELECT
            17, 'Draft Office', NULL, 'other', 'Riyadh',
            'sdsh2017@gmail.com', 'office-user-17', 'draft',
            false, false, false, 'office', '{}', '{}', false, true
          WHERE NOT EXISTS (
            SELECT 1 FROM offices WHERE user_id = 17
          )
          RETURNING id, status, slug
        `);

        if ((result.rowCount ?? 0) > 0) {
          const row = result.rows[0] as { id: number; status: string; slug: string };
          logger.info(
            { officeId: row.id, status: row.status, slug: row.slug },
            "[startup] SEED-OFFICE-USER17: draft office created for user 17 (sdsh2017@gmail.com)"
          );
        } else {
          logger.info(
            "[startup] SEED-OFFICE-USER17: user 17 already has an office — no-op"
          );
        }
      } catch (err: unknown) {
        logger.error(
          { err },
          "[startup] SEED-OFFICE-USER17: seed failed — office record was NOT created"
        );
      }
    })();
  }

  // ---------------------------------------------------------------------------
  // Periodic cleanup of expired/consumed password-reset tokens.
  // Runs every 6 hours; .unref() so it doesn't keep the process alive
  // if the server is shutting down.
  // ---------------------------------------------------------------------------
  setInterval(async () => {
    try {
      await cleanupExpiredTokens();
    } catch (err) {
      logger.error({ err }, "Error during password reset token cleanup");
    }
  }, 6 * 60 * 60 * 1000).unref();
});
