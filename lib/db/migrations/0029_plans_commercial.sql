-- Migration 0029: Plans and Commercial Activation
-- Adds: plans, commercial_activation_campaigns, activation_notifications tables.
-- Seeds: commercial_state = 'disabled' in system_config, one default plan.

-- ── plans ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS plans (
  id               SERIAL PRIMARY KEY,
  name             TEXT        NOT NULL,
  name_ar          TEXT        NOT NULL,
  description      TEXT,
  description_ar   TEXT,
  -- Price in smallest currency unit (100 halalas = 1 SAR, 100 cents = 1 USD)
  monthly_price    INTEGER     NOT NULL DEFAULT 0,
  currency         TEXT        NOT NULL DEFAULT 'SAR',
  billing_interval TEXT        NOT NULL DEFAULT 'monthly',
  is_active        BOOLEAN     NOT NULL DEFAULT TRUE,
  -- NULL = applies to all countries / provider types
  country_code     TEXT,
  provider_type    TEXT,
  sort_order       INTEGER     NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_plans_is_active   ON plans(is_active);
CREATE INDEX IF NOT EXISTS idx_plans_country_code ON plans(country_code);

-- ── commercial_activation_campaigns ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS commercial_activation_campaigns (
  id                    SERIAL PRIMARY KEY,
  status                TEXT        NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','scheduled','active','cancelled')),
  plan_id               INTEGER REFERENCES plans(id) ON DELETE RESTRICT,
  -- Targeting (NULL = all)
  target_country        TEXT,
  target_city           TEXT,
  target_provider_type  TEXT,
  -- Scheduling
  scheduled_at          TIMESTAMPTZ,
  notification_lead_days INTEGER    NOT NULL DEFAULT 7,
  -- Activation outcome
  activated_at          TIMESTAMPTZ,
  confirmed_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- Running counts
  eligible_count        INTEGER     NOT NULL DEFAULT 0,
  notified_count        INTEGER     NOT NULL DEFAULT 0,
  failed_count          INTEGER     NOT NULL DEFAULT 0,
  excluded_count        INTEGER     NOT NULL DEFAULT 0,
  activated_offices     INTEGER     NOT NULL DEFAULT 0,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_campaigns_status       ON commercial_activation_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_scheduled_at ON commercial_activation_campaigns(scheduled_at);

-- ── activation_notifications ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS activation_notifications (
  id           SERIAL PRIMARY KEY,
  campaign_id  INTEGER     NOT NULL REFERENCES commercial_activation_campaigns(id) ON DELETE CASCADE,
  office_id    INTEGER     NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  status       TEXT        NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued','sent','failed')),
  locale       TEXT        NOT NULL DEFAULT 'ar',
  sent_at      TIMESTAMPTZ,
  fail_reason  TEXT,
  metadata     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, office_id)
);

CREATE INDEX IF NOT EXISTS idx_activation_notif_campaign ON activation_notifications(campaign_id);
CREATE INDEX IF NOT EXISTS idx_activation_notif_office   ON activation_notifications(office_id);
CREATE INDEX IF NOT EXISTS idx_activation_notif_status   ON activation_notifications(status);

-- ── system_config: seed commercial_state ─────────────────────────────────────

INSERT INTO system_config (key, value, description)
VALUES (
  'commercial_state',
  'disabled',
  'Global commercial activation state: disabled | scheduled | active'
)
ON CONFLICT (key) DO NOTHING;

-- ── Seed plans ────────────────────────────────────────────────────────────────
-- Office Plan: 200 SAR = 20000 halalas, provider_type = 'office'
-- Freelancer Plan: 120 SAR = 12000 halalas, provider_type = 'freelancer'

INSERT INTO plans (name, name_ar, description, description_ar, monthly_price, currency, billing_interval, provider_type, is_active, sort_order)
VALUES (
  'Office Plan',
  'خطة المكتب',
  'Monthly subscription for registered offices',
  'اشتراك شهري للمكاتب المسجلة',
  20000,  -- 200 SAR in halalas
  'SAR',
  'monthly',
  'office',
  TRUE,
  1
)
ON CONFLICT DO NOTHING;

INSERT INTO plans (name, name_ar, description, description_ar, monthly_price, currency, billing_interval, provider_type, is_active, sort_order)
VALUES (
  'Freelancer Plan',
  'خطة المستقل',
  'Monthly subscription for freelancers',
  'اشتراك شهري للمستقلين',
  12000,  -- 120 SAR in halalas
  'SAR',
  'monthly',
  'freelancer',
  TRUE,
  2
)
ON CONFLICT DO NOTHING;
