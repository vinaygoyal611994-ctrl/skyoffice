-- Migration 0031: Slot Reservations + No-Pay-Without-Capacity
--
-- Changes:
--   1. Add 'reserved' to market_slot_allocations.slot_status CHECK constraint
--   2. Add reservation lifecycle columns to market_slot_allocations
--   3. Add new audit actions to slot_audit_log CHECK constraint
--   4. Add index for reservation expiry sweeper
--
-- Semantics:
--   reserved: a 3-hour exclusive hold granted to a waiting provider when
--             a slot becomes available. Counts against capacity (prevents
--             double-booking). Expires automatically if not converted to
--             'allocated' via a confirmed payment.

-- ── Step 1: Drop and re-add the slot_status CHECK constraint ─────────────────
-- PostgreSQL does not support ALTER TABLE ... ALTER CONSTRAINT; we must drop
-- and re-add. The constraint name follows the Postgres auto-generated pattern.

ALTER TABLE market_slot_allocations
  DROP CONSTRAINT IF EXISTS market_slot_allocations_slot_status_check;

ALTER TABLE market_slot_allocations
  ADD CONSTRAINT market_slot_allocations_slot_status_check
  CHECK (slot_status IN ('allocated', 'waiting', 'released', 'not_required', 'reserved'));

-- ── Step 2: Add reservation lifecycle columns ─────────────────────────────────
-- All nullable — only populated while slot_status = 'reserved'.

ALTER TABLE market_slot_allocations
  ADD COLUMN IF NOT EXISTS reservation_started_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reservation_expires_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reservation_released_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reservation_release_reason TEXT;

-- Index so the sweeper can find expired reservations in O(log n).
CREATE INDEX IF NOT EXISTS idx_slot_alloc_reservation_expiry
  ON market_slot_allocations (reservation_expires_at)
  WHERE slot_status = 'reserved';

-- ── Step 3: Drop and re-add the slot_audit_log action CHECK constraint ────────

ALTER TABLE slot_audit_log
  DROP CONSTRAINT IF EXISTS slot_audit_log_action_check;

ALTER TABLE slot_audit_log
  ADD CONSTRAINT slot_audit_log_action_check
  CHECK (action IN (
    'allocated',
    'released',
    'waitlist_entered',
    'waitlist_exited',
    'priority_assigned',
    'admin_override',
    'not_required',
    'reservation_created',
    'reservation_expired',
    'reservation_released',
    'reservation_converted'
  ));
