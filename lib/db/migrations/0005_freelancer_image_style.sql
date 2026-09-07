-- Migration: add freelancer_image_style column for freelancer profile display preference.
-- Idempotent: safe to run multiple times.
--
-- Values:
--   personal_photo  — logoUrl displayed as a circular avatar (face-friendly crop)
--   brand_image     — logoUrl displayed as a rounded square / brand logo (default)
--   NULL            — treated as brand_image for backward compatibility
--
-- Only meaningful for provider_type = 'freelancer'; offices are blocked at
-- the API layer from setting this field.

ALTER TABLE offices
  ADD COLUMN IF NOT EXISTS freelancer_image_style TEXT
    CHECK (freelancer_image_style IN ('personal_photo', 'brand_image'));
