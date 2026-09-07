-- Migration 0021: Add sort_order to office_media for stable gallery ordering.
-- Additive only — no rows deleted, no columns dropped. Safe to re-run:
--   ADD COLUMN IF NOT EXISTS is idempotent;
--   the UPDATE is a no-op when sort_order is already populated;
--   CREATE INDEX IF NOT EXISTS is idempotent.

ALTER TABLE office_media
  ADD COLUMN IF NOT EXISTS sort_order INTEGER;

-- Initialise sort_order for existing decision_gallery rows using chronological
-- insertion order per office as the baseline. New gallery inserts will receive
-- (current max + 1) computed by the application layer at insert time.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY office_id
           ORDER BY created_at
         ) AS rn
    FROM office_media
   WHERE placement = 'decision_gallery'
     AND sort_order IS NULL
)
UPDATE office_media
   SET sort_order = ranked.rn
  FROM ranked
 WHERE office_media.id = ranked.id;

-- Partial index covering the common "get gallery ordered" query pattern.
CREATE INDEX IF NOT EXISTS idx_office_media_gallery_order
  ON office_media (office_id, sort_order)
  WHERE placement = 'decision_gallery';
