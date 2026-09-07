-- Migration 0011: Analytics Foundation — Phase 1
--
-- Creates the SkayOffice Market Intelligence analytics layer.
-- All statements are ADDITIVE — no existing tables are modified except for
-- one nullable column addition to contact_events (additive, non-breaking).
--
-- Tables created:
--   service_taxonomy          — global stable service taxonomy (bilingual)
--   analytics_events          — raw immutable event store
--   analytics_daily_global    — global daily aggregates
--   analytics_daily_by_office — per-office daily aggregates
--   analytics_daily_by_market — per-market (country/city/category) daily aggregates
--   analytics_daily_by_source — per-source/campaign daily aggregates
--   analytics_daily_by_search — per-search-query daily aggregates
--   analytics_aggregation_jobs — aggregation job log (advisory-lock backed)
--   analytics_admin_reports   — frozen monthly/manual KPI snapshots
--
-- Additive column on existing table:
--   contact_events.search_session_id UUID NULL (for search-journey attribution)
--
-- ROLLBACK INSTRUCTIONS (in order, no data loss to existing tables):
--   DROP TABLE IF EXISTS analytics_admin_reports;
--   DROP TABLE IF EXISTS analytics_aggregation_jobs;
--   DROP TABLE IF EXISTS analytics_daily_by_search;
--   DROP TABLE IF EXISTS analytics_daily_by_source;
--   DROP TABLE IF EXISTS analytics_daily_by_market;
--   DROP TABLE IF EXISTS analytics_daily_by_office;
--   DROP TABLE IF EXISTS analytics_daily_global;
--   DROP TABLE IF EXISTS analytics_events;
--   DROP TABLE IF EXISTS service_taxonomy;
--   ALTER TABLE contact_events DROP COLUMN IF EXISTS search_session_id;
--
-- Partitioning readiness: analytics_events should be range-partitioned by
-- occurred_at (monthly) once monthly event volume exceeds ~200K rows.
-- Migration path: create new partitioned parent, INSERT SELECT, rename tables.
-- No application code changes required (same table name and schema).
--
-- UTC storage: all timestamps stored in UTC. Reporting timezone is
-- configurable at query time via application settings, not hard-coded here.

-- ── service_taxonomy ─────────────────────────────────────────────────────────
-- Global stable taxonomy of services within each office category.
-- The `service_key` is the permanent stable identifier — never rename it.
-- Display labels (name_en, name_ar) may be updated without breaking analytics.
-- Synonyms and country-specific terminology are added via a future
-- service_taxonomy_synonyms table referencing this one.

CREATE TABLE IF NOT EXISTS service_taxonomy (
  id          SERIAL      PRIMARY KEY,
  service_key TEXT        NOT NULL,   -- stable snake_case ID e.g. 'legal_labor_cases'
  category_key TEXT       NOT NULL,   -- must match officeCategoryEnum values
  name_en     TEXT        NOT NULL,
  name_ar     TEXT        NOT NULL,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  sort_order  SMALLINT    NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT service_taxonomy_service_key_unique UNIQUE (service_key)
);

CREATE INDEX IF NOT EXISTS idx_service_taxonomy_category_key
  ON service_taxonomy (category_key) WHERE is_active = TRUE;

-- Seed: Translation services
INSERT INTO service_taxonomy (service_key, category_key, name_en, name_ar, sort_order) VALUES
  ('translation_legal',        'translation', 'Legal Translation',         'ترجمة قانونية',          10),
  ('translation_medical',      'translation', 'Medical Translation',       'ترجمة طبية',              20),
  ('translation_technical',    'translation', 'Technical Translation',     'ترجمة تقنية',             30),
  ('translation_financial',    'translation', 'Financial Translation',     'ترجمة مالية',             40),
  ('translation_certified',    'translation', 'Certified Translation',     'ترجمة رسمية معتمدة',       50),
  ('translation_simultaneous', 'translation', 'Simultaneous Interpreting', 'ترجمة فورية',             60),
  ('translation_subtitles',    'translation', 'Subtitles & Transcription', 'ترجمة وتفريغ مرئي',       70)
ON CONFLICT (service_key) DO NOTHING;

-- Seed: Legal services
INSERT INTO service_taxonomy (service_key, category_key, name_en, name_ar, sort_order) VALUES
  ('legal_labor_cases',       'legal', 'Labor Cases',            'قضايا عمالية',          10),
  ('legal_commercial_cases',  'legal', 'Commercial Cases',       'قضايا تجارية',           20),
  ('legal_contracts',         'legal', 'Contracts & Agreements', 'صياغة العقود',           30),
  ('legal_company_formation', 'legal', 'Company Formation',      'تأسيس الشركات',          40),
  ('legal_debt_collection',   'legal', 'Debt Collection',        'تحصيل الديون',           50),
  ('legal_enforcement',       'legal', 'Enforcement Orders',     'أوامر التنفيذ',           60),
  ('legal_family_law',        'legal', 'Family Law',             'قضايا الأحوال الشخصية', 70),
  ('legal_consultation',      'legal', 'Legal Consultation',     'استشارات قانونية',       80),
  ('legal_real_estate_cases', 'legal', 'Real Estate Cases',      'قضايا عقارية',           90)
ON CONFLICT (service_key) DO NOTHING;

-- Seed: Marketing services
INSERT INTO service_taxonomy (service_key, category_key, name_en, name_ar, sort_order) VALUES
  ('marketing_brand_identity', 'marketing', 'Brand Identity',       'هوية بصرية',             10),
  ('marketing_campaigns',      'marketing', 'Ad Campaigns',         'حملات إعلانية',           20),
  ('marketing_seo',            'marketing', 'SEO & SEM',            'تحسين محركات البحث',      30),
  ('marketing_content',        'marketing', 'Content Creation',     'إنتاج المحتوى',           40),
  ('marketing_photography',    'marketing', 'Product Photography',  'تصوير المنتجات',          50),
  ('marketing_video_prod',     'marketing', 'Video Production',     'إنتاج الفيديو',           60),
  ('marketing_influencer',     'marketing', 'Influencer Marketing', 'تسويق المؤثرين',         70)
ON CONFLICT (service_key) DO NOTHING;

-- Seed: Development services
INSERT INTO service_taxonomy (service_key, category_key, name_en, name_ar, sort_order) VALUES
  ('dev_web_app',     'development', 'Web Application',    'تطبيق ويب',            10),
  ('dev_mobile_app',  'development', 'Mobile App',         'تطبيق جوال',           20),
  ('dev_ecommerce',   'development', 'E-commerce Store',   'متجر إلكتروني',         30),
  ('dev_api',         'development', 'API & Backend',      'واجهة برمجية وخادم',   40),
  ('dev_erp_crm',     'development', 'ERP / CRM Systems',  'أنظمة ERP وCRM',        50),
  ('dev_ai_ml',       'development', 'AI / ML Solutions',  'حلول الذكاء الاصطناعي', 60)
ON CONFLICT (service_key) DO NOTHING;

-- Seed: Design services
INSERT INTO service_taxonomy (service_key, category_key, name_en, name_ar, sort_order) VALUES
  ('design_logo',          'design', 'Logo Design',         'تصميم شعار',         10),
  ('design_ui_ux',         'design', 'UI / UX Design',      'تصميم واجهات',       20),
  ('design_print',         'design', 'Print & Packaging',   'طباعة وتغليف',       30),
  ('design_motion',        'design', 'Motion Graphics',     'موشن جرافيك',        40),
  ('design_3d',            'design', '3D Visualization',    'نمذجة ثلاثية الأبعاد', 50),
  ('design_social_media',  'design', 'Social Media Design', 'تصاميم سوشيال ميديا', 60)
ON CONFLICT (service_key) DO NOTHING;

-- Seed: Real estate services
INSERT INTO service_taxonomy (service_key, category_key, name_en, name_ar, sort_order) VALUES
  ('re_buy',      'real_estate', 'Property Purchase',    'شراء عقارات',    10),
  ('re_rent',     'real_estate', 'Property Rental',      'إيجار عقارات',   20),
  ('re_sell',     'real_estate', 'Property Sale',        'بيع عقارات',     30),
  ('re_valuation','real_estate', 'Property Valuation',   'تقييم عقاري',    40),
  ('re_mgmt',     'real_estate', 'Property Management',  'إدارة عقارات',   50),
  ('re_invest',   'real_estate', 'Real Estate Investment','استثمار عقاري', 60)
ON CONFLICT (service_key) DO NOTHING;

-- Seed: Company formation services
INSERT INTO service_taxonomy (service_key, category_key, name_en, name_ar, sort_order) VALUES
  ('cf_llc',         'company_formation', 'LLC Formation',          'تأسيس شركة ذات مسؤولية محدودة', 10),
  ('cf_branch',      'company_formation', 'Branch Office',           'تأسيس فرع',                     20),
  ('cf_holding',     'company_formation', 'Holding Company',         'شركة قابضة',                    30),
  ('cf_freelance',   'company_formation', 'Freelance License',       'رخصة مستقل',                    40),
  ('cf_trade_name',  'company_formation', 'Trade Name Registration', 'تسجيل اسم تجاري',               50),
  ('cf_amendments',  'company_formation', 'Amendments & Renewals',   'تعديلات وتجديدات تجارية',       60)
ON CONFLICT (service_key) DO NOTHING;

-- Seed: Business consulting
INSERT INTO service_taxonomy (service_key, category_key, name_en, name_ar, sort_order) VALUES
  ('bc_strategy',    'business_consulting', 'Business Strategy',        'الاستراتيجية التجارية',   10),
  ('bc_feasibility', 'business_consulting', 'Feasibility Studies',      'دراسات الجدوى',           20),
  ('bc_operations',  'business_consulting', 'Operations Consulting',    'استشارات تشغيلية',        30),
  ('bc_hr',          'business_consulting', 'HR Consulting',            'استشارات موارد بشرية',    40),
  ('bc_financial',   'business_consulting', 'Financial Advisory',       'الاستشارات المالية',      50)
ON CONFLICT (service_key) DO NOTHING;

-- Seed: Accounting
INSERT INTO service_taxonomy (service_key, category_key, name_en, name_ar, sort_order) VALUES
  ('acc_bookkeeping', 'accounting', 'Bookkeeping',         'مسك الدفاتر',        10),
  ('acc_audit',       'accounting', 'Auditing',            'تدقيق حسابات',       20),
  ('acc_tax',         'accounting', 'Tax Filing & VAT',    'ضريبة القيمة المضافة وإقرارات ضريبية', 30),
  ('acc_payroll',     'accounting', 'Payroll Management',  'إدارة الرواتب',      40),
  ('acc_financial',   'accounting', 'Financial Statements','القوائم المالية',    50),
  ('acc_zakat',       'accounting', 'Zakat Calculation',   'حساب الزكاة',        60)
ON CONFLICT (service_key) DO NOTHING;

-- Seed: Social media management
INSERT INTO service_taxonomy (service_key, category_key, name_en, name_ar, sort_order) VALUES
  ('smm_management',  'social_media_management', 'Account Management',    'إدارة الحسابات',         10),
  ('smm_content',     'social_media_management', 'Content Strategy',      'استراتيجية المحتوى',     20),
  ('smm_reels',       'social_media_management', 'Reels & TikTok',        'ريلز وتيك توك',          30),
  ('smm_paid_ads',    'social_media_management', 'Paid Advertising',      'الإعلانات الممولة',      40),
  ('smm_community',   'social_media_management', 'Community Management',  'إدارة المجتمع',          50)
ON CONFLICT (service_key) DO NOTHING;

-- Seed: Other
INSERT INTO service_taxonomy (service_key, category_key, name_en, name_ar, sort_order) VALUES
  ('other_general', 'other', 'General Services', 'خدمات عامة', 10)
ON CONFLICT (service_key) DO NOTHING;

-- ── contact_events: add search_session_id (additive, nullable) ────────────────
-- Allows linking a contact action back to the search journey that led to it.
-- NULL for all rows created before Phase 1 analytics (expected, not an error).
ALTER TABLE contact_events
  ADD COLUMN IF NOT EXISTS search_session_id UUID;

CREATE INDEX IF NOT EXISTS idx_contact_events_search_session_id
  ON contact_events (search_session_id)
  WHERE search_session_id IS NOT NULL;

-- ── analytics_events ──────────────────────────────────────────────────────────
-- Immutable raw event log. Records are never updated after insertion except
-- through documented cleanup/correction processes. See analyticsWriter.ts for
-- per-event deduplication rules.
--
-- Retention: 24 months rolling (configured in ANALYTICS_RETENTION_MONTHS env
-- var; cleanup job deferred to a future phase when volume warrants it).
--
-- Privacy: no raw IP addresses. visitor_id is a server-generated anonymous UUID
-- cookie. authenticated_user_id FK uses ON DELETE SET NULL so account deletion
-- preserves event counts while severing personal linkage.

CREATE TABLE IF NOT EXISTS analytics_events (
  -- ── Identity ──────────────────────────────────────────────────────────────
  id              BIGSERIAL   PRIMARY KEY,
  event_id        UUID        NOT NULL DEFAULT gen_random_uuid(),
  event_name      TEXT        NOT NULL,
  event_version   SMALLINT    NOT NULL DEFAULT 1,

  -- ── Time ──────────────────────────────────────────────────────────────────
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- ── Journey identity ──────────────────────────────────────────────────────
  visitor_id          UUID,
  session_id          UUID,
  search_session_id   UUID,          -- stable per search journey; passed through impressions/clicks/profile_view
  authenticated_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,

  -- ── Market dimensions (stable IDs, not translated labels) ─────────────────
  office_id           INTEGER REFERENCES offices(id) ON DELETE SET NULL,
  country_code        TEXT,          -- ISO 3166-1 alpha-2 e.g. 'SA', 'AE', 'KW'
  region_id           TEXT,          -- stable region key e.g. 'sa_riyadh', 'ae_dubai'
  city_id             TEXT,          -- normalized city key e.g. 'riyadh', 'dubai'
  category_id         TEXT,          -- stable enum from officeCategoryEnum or null
  service_id          TEXT,          -- known service_key from service_taxonomy or null
  detected_service_id TEXT,          -- service inferred from query/context (may differ from office's service)

  -- ── Attribution ───────────────────────────────────────────────────────────
  source              TEXT,          -- event-level source (validated enum, see CHECK below)
  session_source      TEXT,          -- source at start of session (preserved across events in session)
  entry_point         TEXT,          -- home | profile | search | external | direct_url
  referrer_domain     TEXT,          -- domain only, path/query stripped
  qr_campaign_id      TEXT,          -- stable QR campaign identifier (validated: a-z0-9-)
  utm_source          TEXT,
  utm_medium          TEXT,
  utm_campaign        TEXT,
  utm_content         TEXT,
  utm_term            TEXT,

  -- ── Search fields (null for non-search events) ────────────────────────────
  search_query_original   TEXT,      -- raw as typed/spoken; trimmed; NEVER updated after insert
  search_query_normalized TEXT,      -- normalized; may be updated by reprocessing job (version tracked via parser_version)
  detected_language       TEXT,      -- ISO 639-1 detected from query text ('ar', 'en', 'mixed')
  input_method            TEXT,      -- 'typed' | 'voice'
  search_intent           TEXT,      -- controlled taxonomy: find_office | find_nearest | find_highest_rated | find_specific_service | compare_offices | general_question | unknown
  intent_confidence       REAL,      -- 0.0–1.0; null when not computed
  service_detection_confidence REAL, -- 0.0–1.0; null when not computed
  parser_version          TEXT,      -- semantic version of the normalization/detection logic e.g. '1.0.0'
  search_results_count    INTEGER,   -- null on non-search events; 0 = zero results
  result_position         INTEGER,   -- position of clicked/viewed result (1-based)
  selected_office_id      INTEGER REFERENCES offices(id) ON DELETE SET NULL,
  zero_result_reason      TEXT,      -- e.g. 'no_offices_in_city', 'no_category_match', 'spelling_error_suspected'

  -- ── UX context ────────────────────────────────────────────────────────────
  interface_language  TEXT,          -- 'ar' | 'en'
  device_category     TEXT,          -- 'desktop' | 'mobile' | 'tablet' | 'unknown'
  os_family           TEXT,
  browser_family      TEXT,

  -- ── Data quality and bot filtering ────────────────────────────────────────
  is_bot              BOOLEAN     NOT NULL DEFAULT FALSE,
  bot_detection_version TEXT,        -- version of bot detection rules applied e.g. '1.0'
  exclusion_reason    TEXT,          -- null = not excluded; values: 'bot_ua', 'preview_bot', 'uptime_monitor', 'headless_browser', 'automation', 'admin_session', 'health_check', 'duplicate', 'test_traffic'

  -- ── Secondary metadata (non-dimension optional context) ───────────────────
  metadata            JSONB,

  -- ── Constraints ───────────────────────────────────────────────────────────
  CONSTRAINT analytics_events_event_id_unique UNIQUE (event_id),

  CONSTRAINT analytics_events_input_method_check
    CHECK (input_method IS NULL OR input_method IN ('typed', 'voice')),

  CONSTRAINT analytics_events_interface_language_check
    CHECK (interface_language IS NULL OR interface_language IN ('ar', 'en')),

  CONSTRAINT analytics_events_device_category_check
    CHECK (device_category IS NULL OR device_category IN ('desktop', 'mobile', 'tablet', 'unknown')),

  CONSTRAINT analytics_events_source_check
    CHECK (source IS NULL OR source IN (
      'direct', 'internal_search', 'qr', 'social', 'referral',
      'paid_campaign', 'organic_search', 'whatsapp_share', 'unknown'
    )),

  CONSTRAINT analytics_events_search_intent_check
    CHECK (search_intent IS NULL OR search_intent IN (
      'find_office', 'find_nearest', 'find_highest_rated',
      'find_specific_service', 'compare_offices', 'general_question', 'unknown'
    )),

  CONSTRAINT analytics_events_intent_confidence_check
    CHECK (intent_confidence IS NULL OR (intent_confidence >= 0.0 AND intent_confidence <= 1.0)),

  CONSTRAINT analytics_events_service_confidence_check
    CHECK (service_detection_confidence IS NULL OR (service_detection_confidence >= 0.0 AND service_detection_confidence <= 1.0)),

  CONSTRAINT analytics_events_results_count_check
    CHECK (search_results_count IS NULL OR search_results_count >= 0),

  CONSTRAINT analytics_events_result_position_check
    CHECK (result_position IS NULL OR result_position >= 1)
);

-- Indexes ordered by estimated query frequency
CREATE INDEX IF NOT EXISTS idx_ae_occurred_at
  ON analytics_events (occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_ae_event_name_occurred_at
  ON analytics_events (event_name, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_ae_office_id_occurred_at
  ON analytics_events (office_id, occurred_at DESC)
  WHERE office_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ae_visitor_id_occurred_at
  ON analytics_events (visitor_id, occurred_at DESC)
  WHERE visitor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ae_search_query_normalized
  ON analytics_events (search_query_normalized, occurred_at DESC)
  WHERE search_query_normalized IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ae_city_id_occurred_at
  ON analytics_events (city_id, occurred_at DESC)
  WHERE city_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ae_country_city_category
  ON analytics_events (country_code, city_id, category_id, occurred_at DESC)
  WHERE country_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ae_category_occurred_at
  ON analytics_events (category_id, occurred_at DESC)
  WHERE category_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ae_source_occurred_at
  ON analytics_events (source, occurred_at DESC)
  WHERE source IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ae_qr_campaign
  ON analytics_events (qr_campaign_id, occurred_at DESC)
  WHERE qr_campaign_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ae_search_session_id
  ON analytics_events (search_session_id, occurred_at DESC)
  WHERE search_session_id IS NOT NULL;

-- Partial index: non-bot events only (used by almost all metric queries)
CREATE INDEX IF NOT EXISTS idx_ae_non_bot_event_occurred_at
  ON analytics_events (event_name, occurred_at DESC)
  WHERE is_bot = FALSE;

-- ── analytics_daily_global ────────────────────────────────────────────────────
-- Global pre-aggregated daily totals. One row per UTC calendar day.
-- Idempotent: INSERT ... ON CONFLICT (date) DO UPDATE SET ...
-- Aggregation reads from analytics_events + contact_events + favourites +
-- audit_log + service_request_reviews. See analyticsAggregator.ts.

CREATE TABLE IF NOT EXISTS analytics_daily_global (
  id                        SERIAL      PRIMARY KEY,
  date                      DATE        NOT NULL,

  -- From analytics_events (non-bot)
  searches                  INTEGER     NOT NULL DEFAULT 0,
  zero_result_searches      INTEGER     NOT NULL DEFAULT 0,
  profile_views             INTEGER     NOT NULL DEFAULT 0,
  card_clicks               INTEGER     NOT NULL DEFAULT 0,
  card_impressions          INTEGER     NOT NULL DEFAULT 0,
  unique_visitors_approx    INTEGER     NOT NULL DEFAULT 0,
  video_starts              INTEGER     NOT NULL DEFAULT 0,
  video_completions         INTEGER     NOT NULL DEFAULT 0,
  copy_link_clicks          INTEGER     NOT NULL DEFAULT 0,
  gallery_interactions      INTEGER     NOT NULL DEFAULT 0,
  qr_visits                 INTEGER     NOT NULL DEFAULT 0,
  registration_starts       INTEGER     NOT NULL DEFAULT 0,
  voice_searches            INTEGER     NOT NULL DEFAULT 0,
  typed_searches            INTEGER     NOT NULL DEFAULT 0,

  -- From contact_events
  whatsapp_clicks           INTEGER     NOT NULL DEFAULT 0,
  map_clicks                INTEGER     NOT NULL DEFAULT 0,
  share_clicks              INTEGER     NOT NULL DEFAULT 0,
  video_call_requests       INTEGER     NOT NULL DEFAULT 0,

  -- From favourites table
  favourites_added          INTEGER     NOT NULL DEFAULT 0,
  favourites_removed        INTEGER     NOT NULL DEFAULT 0,

  -- From audit_log
  registrations_completed   INTEGER     NOT NULL DEFAULT 0,
  profiles_submitted        INTEGER     NOT NULL DEFAULT 0,
  profiles_approved         INTEGER     NOT NULL DEFAULT 0,
  profiles_rejected         INTEGER     NOT NULL DEFAULT 0,
  offices_activated         INTEGER     NOT NULL DEFAULT 0,
  offices_suspended         INTEGER     NOT NULL DEFAULT 0,

  -- From service_request_reviews
  reviews_submitted         INTEGER     NOT NULL DEFAULT 0,

  -- Point-in-time snapshots (at aggregation time)
  active_offices_snapshot   INTEGER,
  approved_offices_snapshot INTEGER,

  -- Aggregation metadata
  last_aggregated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  aggregation_version       SMALLINT    NOT NULL DEFAULT 1,

  CONSTRAINT analytics_daily_global_date_unique UNIQUE (date)
);

CREATE INDEX IF NOT EXISTS idx_adg_date
  ON analytics_daily_global (date DESC);

-- ── analytics_daily_by_office ─────────────────────────────────────────────────
-- Per-office daily aggregates. One row per (date, office_id).
-- office_id is NOT a FK (ON DELETE SET NULL equivalent: preserved as integer
-- even after office deletion so historical counts survive).

CREATE TABLE IF NOT EXISTS analytics_daily_by_office (
  id                        SERIAL      PRIMARY KEY,
  date                      DATE        NOT NULL,
  office_id                 INTEGER     NOT NULL,  -- preserved even after office deletion

  -- Snapshot of office metadata at aggregation time (not updated retroactively)
  office_country_code       TEXT,
  office_city_id            TEXT,
  office_category_id        TEXT,
  office_status_snapshot    TEXT,

  -- Metrics
  profile_views             INTEGER     NOT NULL DEFAULT 0,
  card_clicks               INTEGER     NOT NULL DEFAULT 0,
  card_impressions          INTEGER     NOT NULL DEFAULT 0,
  unique_visitors_approx    INTEGER     NOT NULL DEFAULT 0,
  video_starts              INTEGER     NOT NULL DEFAULT 0,
  video_completions         INTEGER     NOT NULL DEFAULT 0,
  qr_visits                 INTEGER     NOT NULL DEFAULT 0,
  whatsapp_clicks           INTEGER     NOT NULL DEFAULT 0,
  map_clicks                INTEGER     NOT NULL DEFAULT 0,
  share_clicks              INTEGER     NOT NULL DEFAULT 0,
  video_call_requests       INTEGER     NOT NULL DEFAULT 0,
  favourites_added          INTEGER     NOT NULL DEFAULT 0,
  favourites_removed        INTEGER     NOT NULL DEFAULT 0,

  last_aggregated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  aggregation_version       SMALLINT    NOT NULL DEFAULT 1,

  CONSTRAINT analytics_daily_by_office_unique UNIQUE (date, office_id)
);

CREATE INDEX IF NOT EXISTS idx_adbo_date
  ON analytics_daily_by_office (date DESC);

CREATE INDEX IF NOT EXISTS idx_adbo_office_id_date
  ON analytics_daily_by_office (office_id, date DESC);

-- ── analytics_daily_by_market ─────────────────────────────────────────────────
-- Per-market daily aggregates. One row per (date, country_code, city_id, category_id).
-- Supports city/category opportunity analysis and GCC expansion.
-- NULL city_id or category_id = "all cities" / "all categories" for that row.

CREATE TABLE IF NOT EXISTS analytics_daily_by_market (
  id                        SERIAL      PRIMARY KEY,
  date                      DATE        NOT NULL,
  country_code              TEXT        NOT NULL DEFAULT '__ALL__',
  city_id                   TEXT        NOT NULL DEFAULT '__ALL__',
  category_id               TEXT        NOT NULL DEFAULT '__ALL__',

  -- Demand signals
  searches                  INTEGER     NOT NULL DEFAULT 0,
  zero_result_searches      INTEGER     NOT NULL DEFAULT 0,
  profile_views             INTEGER     NOT NULL DEFAULT 0,
  card_clicks               INTEGER     NOT NULL DEFAULT 0,
  unique_visitors_approx    INTEGER     NOT NULL DEFAULT 0,
  whatsapp_clicks           INTEGER     NOT NULL DEFAULT 0,
  map_clicks                INTEGER     NOT NULL DEFAULT 0,
  qr_visits                 INTEGER     NOT NULL DEFAULT 0,
  voice_searches            INTEGER     NOT NULL DEFAULT 0,

  -- Supply snapshot
  active_offices_snapshot   INTEGER,

  last_aggregated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  aggregation_version       SMALLINT    NOT NULL DEFAULT 1,

  CONSTRAINT analytics_daily_by_market_unique UNIQUE (date, country_code, city_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_adbm_date
  ON analytics_daily_by_market (date DESC);

CREATE INDEX IF NOT EXISTS idx_adbm_country_city
  ON analytics_daily_by_market (country_code, city_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_adbm_category
  ON analytics_daily_by_market (category_id, date DESC)
  WHERE category_id != '__ALL__';

-- ── analytics_daily_by_source ─────────────────────────────────────────────────
-- Per-source and campaign daily aggregates.

CREATE TABLE IF NOT EXISTS analytics_daily_by_source (
  id                        SERIAL      PRIMARY KEY,
  date                      DATE        NOT NULL,
  source                    TEXT        NOT NULL DEFAULT 'unknown',
  utm_campaign              TEXT        NOT NULL DEFAULT '__NONE__',
  qr_campaign_id            TEXT        NOT NULL DEFAULT '__NONE__',

  -- Metrics
  sessions                  INTEGER     NOT NULL DEFAULT 0,
  profile_views             INTEGER     NOT NULL DEFAULT 0,
  unique_visitors_approx    INTEGER     NOT NULL DEFAULT 0,
  whatsapp_clicks           INTEGER     NOT NULL DEFAULT 0,
  qr_visits                 INTEGER     NOT NULL DEFAULT 0,

  last_aggregated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  aggregation_version       SMALLINT    NOT NULL DEFAULT 1,

  CONSTRAINT analytics_daily_by_source_unique UNIQUE (date, source, utm_campaign, qr_campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_adbs_date_source
  ON analytics_daily_by_source (date DESC, source);

-- ── analytics_daily_by_search ─────────────────────────────────────────────────
-- Per-normalized-search-query daily aggregates.
-- Records top search queries with their context for the search intelligence panel.
-- Rows are only created for queries with >= 1 non-bot search in the day.

CREATE TABLE IF NOT EXISTS analytics_daily_by_search (
  id                          SERIAL      PRIMARY KEY,
  date                        DATE        NOT NULL,
  search_query_normalized     TEXT        NOT NULL,
  country_code                TEXT        NOT NULL DEFAULT '__ALL__',
  city_id                     TEXT        NOT NULL DEFAULT '__ALL__',

  -- Metrics
  search_count                INTEGER     NOT NULL DEFAULT 0,
  zero_result_count           INTEGER     NOT NULL DEFAULT 0,
  click_count                 INTEGER     NOT NULL DEFAULT 0,   -- card_clicks within same search_session
  voice_count                 INTEGER     NOT NULL DEFAULT 0,
  typed_count                 INTEGER     NOT NULL DEFAULT 0,

  -- Detected context at aggregation time (majority value for the day)
  dominant_category_id        TEXT,
  dominant_service_id         TEXT,
  dominant_interface_language TEXT,

  last_aggregated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  aggregation_version         SMALLINT    NOT NULL DEFAULT 1,

  CONSTRAINT analytics_daily_by_search_unique
    UNIQUE (date, search_query_normalized, country_code, city_id)
);

CREATE INDEX IF NOT EXISTS idx_adbs_search_date
  ON analytics_daily_by_search (date DESC, search_count DESC);

CREATE INDEX IF NOT EXISTS idx_adbs_query
  ON analytics_daily_by_search (search_query_normalized, date DESC);

-- ── analytics_aggregation_jobs ────────────────────────────────────────────────
-- Tracks every aggregation job run for observability and lock management.
-- Uses PostgreSQL advisory locks to prevent concurrent aggregation of the same
-- date range. The advisory lock key is derived from the date being aggregated.

CREATE TABLE IF NOT EXISTS analytics_aggregation_jobs (
  id                    SERIAL      PRIMARY KEY,
  date_start            DATE        NOT NULL,
  date_end              DATE        NOT NULL,
  trigger               TEXT        NOT NULL,  -- 'scheduled' | 'manual' | 'backfill' | 'startup'
  status                TEXT        NOT NULL DEFAULT 'running', -- 'running' | 'completed' | 'failed' | 'skipped'
  aggregation_version   SMALLINT    NOT NULL,
  started_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at          TIMESTAMPTZ,
  failed_at             TIMESTAMPTZ,
  rows_processed        INTEGER,
  error_message         TEXT,
  duration_ms           INTEGER,

  CONSTRAINT analytics_aggregation_jobs_status_check
    CHECK (status IN ('running', 'completed', 'failed', 'skipped')),

  CONSTRAINT analytics_aggregation_jobs_trigger_check
    CHECK (trigger IN ('scheduled', 'manual', 'backfill', 'startup'))
);

CREATE INDEX IF NOT EXISTS idx_aaj_started_at
  ON analytics_aggregation_jobs (started_at DESC);

CREATE INDEX IF NOT EXISTS idx_aaj_status_started
  ON analytics_aggregation_jobs (status, started_at DESC);

-- ── analytics_admin_reports ───────────────────────────────────────────────────
-- Frozen KPI snapshots for historical monthly and manual reports.
-- kpi_snapshot and comparison_kpi are JSONB: structured objects matching the
-- AdminAnalyticsReport type defined in analyticsReportTypes.ts.
-- These are NEVER updated after generation (is_final = TRUE).
-- A new report supersedes the old one for the same period.

CREATE TABLE IF NOT EXISTS analytics_admin_reports (
  id                        SERIAL      PRIMARY KEY,
  report_type               TEXT        NOT NULL,   -- 'monthly' | 'manual'
  period_start              DATE        NOT NULL,
  period_end                DATE        NOT NULL,

  generated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generated_by_admin_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,

  label                     TEXT,                   -- e.g. "July 2026"

  -- Frozen snapshots — immutable after is_final = TRUE
  kpi_snapshot              JSONB       NOT NULL,
  comparison_kpi            JSONB,                  -- previous equivalent period
  insights                  JSONB,                  -- array of insight objects

  notes                     TEXT,
  is_final                  BOOLEAN     NOT NULL DEFAULT FALSE,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT analytics_admin_reports_type_check
    CHECK (report_type IN ('monthly', 'manual')),

  -- Prevent duplicate final reports for the same period+type
  -- (allows regenerating a non-final/partial report)
  CONSTRAINT analytics_admin_reports_period_type_unique
    UNIQUE (report_type, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_aar_period
  ON analytics_admin_reports (period_start DESC, period_end DESC);
