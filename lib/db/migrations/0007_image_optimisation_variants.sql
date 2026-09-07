-- Add JSONB columns for server-generated WebP image variants (migration 0007).
-- All columns are nullable so existing rows are unaffected.
-- cover_variants / pending_quick_card_cover_variants store { original, thumbnail, medium }.
-- office_media.variants stores { original, thumbnail, display } for image rows; null for videos.
-- The `original` path is private and stripped from public API responses.
ALTER TABLE "offices"
  ADD COLUMN IF NOT EXISTS "cover_variants"                        JSONB,
  ADD COLUMN IF NOT EXISTS "pending_quick_card_cover_variants"     JSONB;

ALTER TABLE "office_media"
  ADD COLUMN IF NOT EXISTS "variants" JSONB;
