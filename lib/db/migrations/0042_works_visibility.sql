ALTER TABLE "offices"
  ADD COLUMN IF NOT EXISTS "works_enabled" boolean NOT NULL DEFAULT false;

-- Preserve the intent of offices that already started using Works before the
-- explicit visibility control existed. No media rows or object paths change.
UPDATE "offices" AS o
SET "works_enabled" = true
WHERE EXISTS (
  SELECT 1
  FROM "office_media" AS m
  WHERE m."office_id" = o."id"
    AND m."placement" = 'works'
    AND m."status" <> 'rejected'
);