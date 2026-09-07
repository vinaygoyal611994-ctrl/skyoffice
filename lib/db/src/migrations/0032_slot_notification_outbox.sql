-- Migration 0032: Slot Notification Outbox
--
-- Guarantees that every provider who receives a 3-hour slot reservation is
-- notified exactly once, even if the server crashes between reservation creation
-- and email delivery.
--
-- Design:
--   • slot_notification_outbox — one row per reservation notification attempt.
--   • Created atomically inside the same transaction as the reservation INSERT
--     (inside createReservationRow in supplySlotManager.ts).
--   • Unique constraint on reservation_id prevents duplicate outbox entries
--     for the same reservation.
--   • An outbox worker polls every 2 minutes, checks reservation validity,
--     sends the email, and updates the row status.
--   • Retry with exponential backoff; permanently fails after 5 attempts.
--   • Stale reservations (expired/converted/released) are skipped without sending.

-- ── Step 1: Notification outbox table ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS slot_notification_outbox (
  id                SERIAL PRIMARY KEY,
  office_id         INTEGER     NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  market_key        TEXT        NOT NULL,
  -- Idempotency key: "officeId:reservationStartedAt" — unique per reservation window.
  -- ON CONFLICT DO NOTHING on this column prevents duplicate notifications.
  reservation_id    TEXT        NOT NULL,
  notification_type TEXT        NOT NULL DEFAULT 'slot_reserved',
  status            TEXT        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  -- Number of send attempts (both successful and failed).
  attempts          INTEGER     NOT NULL DEFAULT 0,
  -- Sanitised error description ≤500 chars. Never contains stack traces, tokens, or credentials.
  last_error        TEXT,
  -- When the worker should next attempt delivery.
  next_attempt_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at           TIMESTAMPTZ,

  UNIQUE (reservation_id)   -- prevents duplicate outbox row for one reservation
);

-- Worker index: fetch due notifications in one efficient scan.
CREATE INDEX IF NOT EXISTS idx_slot_notif_outbox_due
  ON slot_notification_outbox (next_attempt_at, status, attempts)
  WHERE status IN ('pending', 'failed');

-- Office lookup (cascading deletes, admin queries).
CREATE INDEX IF NOT EXISTS idx_slot_notif_outbox_office
  ON slot_notification_outbox (office_id);

-- ── Step 2: Update slot_audit_log CHECK constraint ────────────────────────────
-- Add notification lifecycle events and the next_provider_selected sweeper event.

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
    'reservation_converted',
    'next_provider_selected',
    'notification_queued',
    'notification_sent',
    'notification_failed',
    'notification_skipped_stale'
  ));
