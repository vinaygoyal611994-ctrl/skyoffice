-- Migration 0030: Active Supply Slot + Returning Provider Waitlist
-- Separates Supply Slot lifecycle from subscription state and public visibility.
-- Creates market_slot_allocations and slot_audit_log tables.
-- Seeds allocations for all currently active, non-demo, non-hidden offices.

-- ── market_slot_allocations ───────────────────────────────────────────────────
-- One row per office. Tracks slot lifecycle independent of subscription.

CREATE TABLE IF NOT EXISTS market_slot_allocations (
  id             SERIAL PRIMARY KEY,
  office_id      INTEGER     NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  market_key     TEXT        NOT NULL, -- "SA|riyadh|marketing"
  slot_status    TEXT        NOT NULL
                   CHECK (slot_status IN ('allocated','waiting','released','not_required')),
  priority_tier  INTEGER     NOT NULL DEFAULT 3,
  -- 1 = returning (previously allocated in this market)
  -- 2 = existing eligible (approved/active, never held slot here)
  -- 3 = new provider
  allocated_at   TIMESTAMPTZ,        -- last time slot was allocated
  released_at    TIMESTAMPTZ,        -- last time slot was released
  release_reason TEXT,
  allocated_by   INTEGER REFERENCES users(id) ON DELETE SET NULL, -- NULL = system
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (office_id)  -- one slot record per office
);

CREATE INDEX IF NOT EXISTS idx_slot_alloc_market_key    ON market_slot_allocations(market_key);
CREATE INDEX IF NOT EXISTS idx_slot_alloc_slot_status   ON market_slot_allocations(slot_status);
CREATE INDEX IF NOT EXISTS idx_slot_alloc_mkt_status    ON market_slot_allocations(market_key, slot_status);
CREATE INDEX IF NOT EXISTS idx_slot_alloc_priority      ON market_slot_allocations(market_key, slot_status, priority_tier, allocated_at DESC NULLS LAST, created_at ASC);

-- ── slot_audit_log ────────────────────────────────────────────────────────────
-- Immutable, append-only record of every slot lifecycle event.

CREATE TABLE IF NOT EXISTS slot_audit_log (
  id                 SERIAL PRIMARY KEY,
  office_id          INTEGER     NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  market_key         TEXT        NOT NULL,
  action             TEXT        NOT NULL
                       CHECK (action IN (
                         'allocated',
                         'released',
                         'waitlist_entered',
                         'waitlist_exited',
                         'priority_assigned',
                         'admin_override',
                         'not_required'
                       )),
  slot_status_before TEXT,
  slot_status_after  TEXT,
  priority_tier      INTEGER,
  reason             TEXT        NOT NULL,
  performed_by       INTEGER REFERENCES users(id) ON DELETE SET NULL, -- NULL = system
  metadata           JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_slot_audit_office  ON slot_audit_log(office_id);
CREATE INDEX IF NOT EXISTS idx_slot_audit_market  ON slot_audit_log(market_key);
CREATE INDEX IF NOT EXISTS idx_slot_audit_action  ON slot_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_slot_audit_created ON slot_audit_log(created_at DESC);

-- ── Seed: existing active, visible offices → allocated ────────────────────────
-- These offices currently occupy marketplace slots.
-- priority_tier = 2 (existing provider, not new, not returning from hidden).

INSERT INTO market_slot_allocations (office_id, market_key, slot_status, priority_tier, allocated_at)
SELECT o.id, o.supply_gate_market_key, 'allocated', 2, NOW()
FROM offices o
WHERE o.supply_gate_market_key IS NOT NULL
  AND o.status IN ('approved', 'active')
  AND o.is_demo = false
  AND o.is_subscription_hidden = false
ON CONFLICT (office_id) DO NOTHING;

-- ── Seed: active-but-hidden offices → released ───────────────────────────────
-- These offices are hidden (e.g. from prior non-payment) and their slot
-- should be counted as released so the next waitlist provider can claim it.
-- priority_tier = 1 (returning — they were previously allocated).

INSERT INTO market_slot_allocations (
  office_id, market_key, slot_status, priority_tier,
  allocated_at, released_at, release_reason
)
SELECT
  o.id, o.supply_gate_market_key, 'released', 1,
  NOW() - interval '1 day',  -- placeholder allocated_at (before migration)
  NOW(),
  'pre-migration: office was hidden at migration time'
FROM offices o
WHERE o.supply_gate_market_key IS NOT NULL
  AND o.status IN ('approved', 'active')
  AND o.is_demo = false
  AND o.is_subscription_hidden = true
ON CONFLICT (office_id) DO NOTHING;
