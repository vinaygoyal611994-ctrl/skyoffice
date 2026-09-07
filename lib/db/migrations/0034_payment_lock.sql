-- 0034_payment_lock.sql
-- Adds payment_locked_until to market_slot_allocations.
--
-- PURPOSE:
--   When a Stripe Checkout session is created, the reservation is placed into
--   a short "payment-pending protection window" by setting payment_locked_until
--   to NOW() + 30 minutes. The reservation sweeper skips any slot where
--   payment_locked_until > NOW(), so a reservation that expires during an active
--   checkout cannot be released until the window closes.
--
--   Hard expiry: the lock is always a fixed timestamp; it never becomes indefinite.
--   If 30 minutes elapse without a confirmed payment, the sweeper releases the
--   reservation and advances the waitlist normally on its next run.
--
--   This makes "money received but no slot" structurally unreachable for
--   correctly-timed checkouts: any checkout that reaches Stripe is guaranteed at
--   least 30 minutes of protection window regardless of when reservation_expires_at
--   falls relative to the checkout creation time.
--
-- SWEEPER CHANGE (applied in code, not SQL):
--   The sweeper's query gains one additional predicate:
--     AND (payment_locked_until IS NULL OR payment_locked_until <= NOW())
--
-- CLEANUP:
--   payment_locked_until is cleared (set NULL) when:
--     1. Payment succeeds — slot transitions to 'allocated', column is cleared.
--     2. Payment fails — lock cleared so the sweeper can release the reservation.
--     3. Reservation is expired by the sweeper after lock lapses — cleared as part
--        of the expireReservation update.

ALTER TABLE market_slot_allocations
  ADD COLUMN IF NOT EXISTS payment_locked_until TIMESTAMPTZ;

-- Index for the sweeper's new predicate
CREATE INDEX IF NOT EXISTS idx_slot_alloc_payment_lock
  ON market_slot_allocations (payment_locked_until)
  WHERE payment_locked_until IS NOT NULL;
