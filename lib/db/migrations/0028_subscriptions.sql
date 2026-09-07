-- ============================================================================
-- Migration 0028: Subscription Lifecycle & Growth Foundation
-- ============================================================================
--
-- Adds the minimum reliable subscription infrastructure needed before any
-- payment gateway integration.
--
-- Tables created:
--   system_config               — admin-configurable platform settings (trial duration, etc.)
--   office_subscriptions        — one active subscription row per office
--   subscription_history        — immutable audit trail of every state change
--   subscription_notifications  — dedup guard for expiry reminder emails
--
-- Column added:
--   offices.is_subscription_hidden — visibility overlay (never touches offices.status)
--
-- Safety guarantees:
--   • No existing office data is touched or deleted by this migration.
--   • offices.status workflow (draft/under_review/active/etc.) is unchanged.
--   • All historical data (transactions, reviews, QR links) is preserved.
--   • Non-payment NEVER deletes an office — it only sets is_subscription_hidden = true.
-- ============================================================================

-- ── system_config ─────────────────────────────────────────────────────────────
-- Stores admin-configurable platform settings as key→value pairs.
-- Values are stored as text; callers parse to int/bool as needed.
CREATE TABLE IF NOT EXISTS system_config (
  key         text PRIMARY KEY,
  value       text NOT NULL,
  description text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  integer REFERENCES users(id) ON DELETE SET NULL
);

-- Seed: trial duration (configurable, default 14 days)
INSERT INTO system_config (key, value, description)
VALUES
  ('trial_duration_days',           '14', 'Default trial period length in days; overridable per-office when starting a trial'),
  ('subscription_grace_period_days', '3', 'Days after subscription expires before the office is hidden from public discovery'),
  ('subscription_expiry_warning_days', '7', 'Days before expiry at which the subscription enters "expiring" state and first reminder fires')
ON CONFLICT (key) DO NOTHING;

-- ── office_subscriptions ──────────────────────────────────────────────────────
-- One row per office. Upserted on every lifecycle transition.
-- All history is in subscription_history — this row always reflects current state.
--
-- Lifecycle states:
--   free                    — registered & active on platform, no subscription started
--   trial                   — trial period active
--   active_paid             — paid subscription active  [future: set by payment webhook]
--   expiring                — within warning_days of expires_at; reminders fire here
--   expired                 — trial/paid expired; office still visible (grace period)
--   hidden_due_to_nonpayment — expired beyond grace period; hidden from public discovery
--   cancelled               — explicitly cancelled by admin or office owner
CREATE TABLE IF NOT EXISTS office_subscriptions (
  id                   serial PRIMARY KEY,
  office_id            integer NOT NULL UNIQUE REFERENCES offices(id) ON DELETE CASCADE,
  state                text    NOT NULL DEFAULT 'free'
                       CHECK (state IN (
                         'free', 'trial', 'active_paid', 'expiring',
                         'expired', 'hidden_due_to_nonpayment', 'cancelled'
                       )),

  -- Trial window (set when state = 'trial')
  trial_started_at     timestamptz,
  trial_ends_at        timestamptz,

  -- Paid access window (set when state = 'active_paid' or renewed)
  paid_through_date    timestamptz,

  -- Unified expiry: whichever of trial_ends_at / paid_through_date is active.
  -- Used by the sweeper to know when to fire reminders and transition states.
  expires_at           timestamptz,

  -- Cancellation
  cancelled_at         timestamptz,
  cancelled_by         integer REFERENCES users(id) ON DELETE SET NULL,
  cancel_reason        text,

  -- Hidden-due-to-non-payment
  hidden_at            timestamptz,

  -- Notification dedup: which reminder types have been sent for the current
  -- expires_at period.  Values: '7d', '3d', '1d', 'day'.
  -- Reset to '{}' whenever expires_at changes (new trial/renewal).
  notified_reminders   text[] NOT NULL DEFAULT '{}',

  -- Free-text admin note (optional)
  notes                text,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_office_subscriptions_state      ON office_subscriptions(state);
CREATE INDEX idx_office_subscriptions_expires_at ON office_subscriptions(expires_at)
  WHERE expires_at IS NOT NULL;
CREATE INDEX idx_office_subscriptions_office_id  ON office_subscriptions(office_id);

-- ── subscription_history ──────────────────────────────────────────────────────
-- Immutable audit log of every subscription state change.
-- Never updated; only INSERT'd.  Preserves full lifecycle history even after
-- the current subscription row is overwritten.
CREATE TABLE IF NOT EXISTS subscription_history (
  id              serial PRIMARY KEY,
  office_id       integer NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  subscription_id integer REFERENCES office_subscriptions(id) ON DELETE SET NULL,
  from_state      text,           -- NULL on first insertion (initial 'free' row)
  to_state        text NOT NULL,
  reason          text,           -- human-readable reason for the transition
  changed_by      integer REFERENCES users(id) ON DELETE SET NULL,  -- NULL = system/sweeper
  metadata        jsonb,          -- trial_ends_at, paid_through_date, etc. at time of change
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscription_history_office_id  ON subscription_history(office_id);
CREATE INDEX idx_subscription_history_created_at ON subscription_history(created_at DESC);
CREATE INDEX idx_subscription_history_to_state   ON subscription_history(to_state);

-- ── subscription_notifications ────────────────────────────────────────────────
-- Dedup guard: one row per (office_id, notification_type, period_expires_at).
-- Prevents duplicate reminders if the sweeper runs multiple times in the same day
-- or if expires_at is adjusted slightly.
CREATE TABLE IF NOT EXISTS subscription_notifications (
  id                 serial PRIMARY KEY,
  office_id          integer NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  -- 'expiry_7d' | 'expiry_3d' | 'expiry_1d' | 'expiry_day'
  notification_type  text NOT NULL,
  -- The expires_at that triggered this notification.
  -- Key part of the unique constraint — a new trial/renewal period gets new keys.
  period_expires_at  timestamptz NOT NULL,
  sent_at            timestamptz NOT NULL DEFAULT now(),
  metadata           jsonb,
  UNIQUE (office_id, notification_type, period_expires_at)
);

CREATE INDEX idx_subscription_notifications_office ON subscription_notifications(office_id);

-- ── offices: subscription visibility overlay ──────────────────────────────────
-- Single boolean: true when subscription policy requires hiding this office from
-- public discovery (after grace period expires post non-payment).
-- NULL is treated as false (backward-compatible default for all existing offices).
-- This column NEVER affects completed transactions, reviews, QR links, or
-- the office's existence — it is a read-filter only.
ALTER TABLE offices
  ADD COLUMN IF NOT EXISTS is_subscription_hidden boolean NOT NULL DEFAULT false;

-- Partial index: only rows with true need fast lookup (typically very few)
CREATE INDEX IF NOT EXISTS idx_offices_subscription_hidden
  ON offices(is_subscription_hidden)
  WHERE is_subscription_hidden = true;

-- Back-fill: all existing active offices get a 'free' subscription row so the
-- admin dashboard shows real counts immediately.
-- We insert only for offices that have no subscription row yet.
INSERT INTO office_subscriptions (office_id, state)
SELECT id, 'free'
FROM   offices
WHERE  status IN ('active', 'approved')
  AND  id NOT IN (SELECT office_id FROM office_subscriptions)
ON CONFLICT (office_id) DO NOTHING;
