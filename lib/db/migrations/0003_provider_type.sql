-- Migration 0003: Add provider_type to offices + social_media_management category
-- Safe to run once; idempotent via IF NOT EXISTS / IF EXISTS guards.
-- Existing records automatically get provider_type='office' via DEFAULT.

-- 1. Drop the old CHECK constraint on category (Drizzle generates it with a
--    deterministic name derived from the table/column; find it dynamically
--    so this survives any naming variation across environments).
DO $$
DECLARE
  con_name TEXT;
BEGIN
  -- Find the category value-check constraint, explicitly excluding the NOT NULL
  -- pseudo-constraints that PostgreSQL 16+ exposes in information_schema
  -- (those have check clauses of the form "column IS NOT NULL" and names like
  -- "2200_<oid>_<col>_not_null").  We only want the real IN (...)  CHECK.
  SELECT tc.constraint_name
    INTO con_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.check_constraints cc
      ON tc.constraint_name = cc.constraint_name
   WHERE tc.table_name     = 'offices'
     AND tc.table_schema   = 'public'
     AND tc.constraint_type = 'CHECK'
     AND cc.check_clause LIKE '%category%'
     AND cc.check_clause NOT LIKE '%IS NOT NULL%'
   LIMIT 1;
  IF con_name IS NOT NULL THEN
    BEGIN
      EXECUTE format('ALTER TABLE offices DROP CONSTRAINT %I', con_name);
    EXCEPTION WHEN OTHERS THEN
      -- Constraint may not exist or may have been dropped already; proceed.
      NULL;
    END;
  END IF;
END $$;

-- 2. Re-add category check constraint with social_media_management included.
ALTER TABLE offices
  ADD CONSTRAINT offices_category_check
  CHECK (category IN (
    'translation', 'legal', 'marketing', 'development', 'design',
    'real_estate', 'company_formation', 'business_consulting',
    'accounting', 'social_media_management', 'other'
  ));

-- 3. Add provider_type column. The DEFAULT 'office' makes every existing row
--    immediately valid without a separate UPDATE, satisfying NOT NULL from
--    the first moment. New registrations supply an explicit value; the CHECK
--    enforces exactly two allowed values.
ALTER TABLE offices
  ADD COLUMN IF NOT EXISTS provider_type TEXT NOT NULL DEFAULT 'office'
  CHECK (provider_type IN ('office', 'freelancer'));

-- 4. Index for the provider_type filter on the public listing route.
CREATE INDEX IF NOT EXISTS idx_offices_provider_type
  ON offices (provider_type);
