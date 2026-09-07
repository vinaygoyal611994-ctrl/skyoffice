-- 0036_slot_sync_needed.sql
--
-- Adds slot_sync_needed_at to office_subscriptions.
--
-- Problem this solves:
--   activatePaidCore() commits the subscription to active_paid in one DB
--   transaction, then calls convertReservationToAllocation() in a separate
--   step.  If the second step fails the office is left with:
--     • subscription.state = active_paid  (payment confirmed)
--     • market_slot_allocations.slot_status = reserved  (not converted)
--     • offices.is_subscription_hidden = true  (still hidden from public)
--
-- Solution:
--   When conversion fails, this column is set to NOW().  The slot-sync
--   recovery sweeper (runSlotSyncSweep) runs every 15 minutes, finds
--   rows where this is NOT NULL, and retries conversion.  On success it
--   clears the flag.  If the reservation has since expired it surfaces
--   the office in Platform Health as "needs admin".
--
-- NULL   = no issue.
-- NOT NULL = slot conversion pending recovery — sweeper will retry.

ALTER TABLE office_subscriptions
  ADD COLUMN IF NOT EXISTS slot_sync_needed_at TIMESTAMPTZ;

COMMENT ON COLUMN office_subscriptions.slot_sync_needed_at IS
  'Set when subscription commits to active_paid but convertReservationToAllocation '
  'fails in the post-commit step.  NULL = no issue.  NOT NULL = recovery sweeper '
  'must retry slot allocation.  Cleared by slotSyncSweeper on successful recovery.';
