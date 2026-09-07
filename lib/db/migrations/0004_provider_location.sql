-- Migration: add provider latitude/longitude for proximity-based ranking.
-- Idempotent: safe to run multiple times.

-- Add latitude and longitude as nullable DOUBLE PRECISION columns.
-- Existing rows remain NULL until providers fill in their coordinates.
ALTER TABLE offices ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE offices ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

-- Partial B-tree index: only index rows that actually have coordinates.
-- Keeps the index small and avoids wasting pages on the many NULLs expected
-- at pilot stage. Future migration to PostGIS is non-breaking — just add a
-- GEOGRAPHY column and drop this index.
CREATE INDEX IF NOT EXISTS idx_offices_lat_lon
  ON offices(latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
