-- =============================================================================
-- Demo-account password rotation — v2 — production
-- Generated: 2026-07-24T04:08:37Z
--
-- Scope (exact IN-list, no wildcards):
--   customer@skayoffice.demo, office1–office6@skayoffice.demo   → 7 rows
--
-- Explicitly excluded:
--   admin@skayoffice.demo          (admin password managed separately)
--   office7–office10@skayoffice.demo  (outside requested scope)
--   All real / QA users            (zero rows collide with the IN-list; confirmed pre-flight)
--
-- Password source: SEED_DEMO_PASSWORD environment secret (shared, intentional — see note below)
-- Hash algorithm : bcrypt $2b$ rounds=12, length 60
--
-- NOTE — Shared demo password:
--   A single password from the SEED_DEMO_PASSWORD environment secret is used
--   for all 7 accounts. This is intentional: demo accounts must be loginable
--   with a known, consistent credential for QA and product demonstrations.
--   This password is NOT used for admin@skayoffice.demo or any real user.
--
-- Safety guarantees:
--   1. Pre-flight guard   — aborts if the IN-list does not match exactly 7 rows.
--   2. Row-count guard    — GET DIAGNOSTICS ROW_COUNT inside the same DO block;
--                          rolls back if the UPDATE touched anything other than 7 rows.
--   3. Admin integrity    — snapshots admin's hash+updated_at BEFORE the UPDATE;
--                          verifies byte-for-byte identity AFTER; aborts if any drift.
--   4. No hash in output  — the final SELECT returns email/role/status/updated_at only.
-- =============================================================================

BEGIN;

-- ── 1. Snapshot admin row before the UPDATE ───────────────────────────────────
CREATE TEMP TABLE _admin_snap AS
  SELECT id, password_hash, updated_at
  FROM   users
  WHERE  email = 'admin@skayoffice.demo';

-- Abort early if the admin row is somehow missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _admin_snap) THEN
    RAISE EXCEPTION 'Admin snapshot is empty — admin row is missing. Aborting.';
  END IF;
END $$;

-- ── 2. Pre-flight scope guard + UPDATE + exact row-count guard ────────────────
DO $$
DECLARE
  scope_n   INT;
  updated_n INT;
BEGIN
  -- 2a. Pre-flight: the IN-list must match exactly 7 existing rows.
  SELECT COUNT(*) INTO scope_n
  FROM   users
  WHERE  email IN (
    'customer@skayoffice.demo',
    'office1@skayoffice.demo', 'office2@skayoffice.demo',
    'office3@skayoffice.demo', 'office4@skayoffice.demo',
    'office5@skayoffice.demo', 'office6@skayoffice.demo'
  );

  IF scope_n <> 7 THEN
    RAISE EXCEPTION
      'Scope guard: expected 7 target rows, found %. Aborting — no rows changed.',
      scope_n;
  END IF;

  -- 2b. Apply rotation.
  UPDATE users
  SET    password_hash = '$2b$12$raFWrSIGfyMESaUXYGCcdOQOW7brw37f.0xc6WhMeqpR1Ls8ZgQwO',
         updated_at    = NOW()
  WHERE  email IN (
    'customer@skayoffice.demo',
    'office1@skayoffice.demo', 'office2@skayoffice.demo',
    'office3@skayoffice.demo', 'office4@skayoffice.demo',
    'office5@skayoffice.demo', 'office6@skayoffice.demo'
  );

  -- 2c. Exact row-count guard via GET DIAGNOSTICS (no time-based heuristic).
  GET DIAGNOSTICS updated_n = ROW_COUNT;

  IF updated_n <> 7 THEN
    RAISE EXCEPTION
      'Row-count guard: expected 7 rows updated, got %. Rolling back.',
      updated_n;
  END IF;
END $$;

-- ── 3. Admin integrity guard — snapshot vs live row must be identical ─────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM   _admin_snap   s
    JOIN   users         u ON u.email = 'admin@skayoffice.demo'
    WHERE  u.password_hash IS DISTINCT FROM s.password_hash
        OR u.updated_at    IS DISTINCT FROM s.updated_at
  ) THEN
    RAISE EXCEPTION
      'Admin integrity guard: admin@skayoffice.demo was modified by this transaction. Rolling back.';
  END IF;
END $$;

-- ── 4. Result summary — no hash values printed ────────────────────────────────
SELECT
  email,
  role,
  CASE
    WHEN email = 'admin@skayoffice.demo' THEN 'NOT TOUCHED'
    ELSE 'ROTATED'
  END  AS status,
  updated_at
FROM   users
WHERE  email IN (
  'customer@skayoffice.demo',
  'office1@skayoffice.demo', 'office2@skayoffice.demo',
  'office3@skayoffice.demo', 'office4@skayoffice.demo',
  'office5@skayoffice.demo', 'office6@skayoffice.demo',
  'admin@skayoffice.demo'
)
ORDER BY email;

COMMIT;
