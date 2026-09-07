-- Works uses the existing TEXT placement column.  This intentionally makes no
-- data changes: all historical rows remain decision_gallery.
-- Supports placement-local ordered reads/reordering without indexing other media.
CREATE INDEX IF NOT EXISTS "idx_office_media_works_order"
  ON "office_media" ("office_id", "sort_order", "id")
  WHERE "placement" = 'works' AND "status" <> 'rejected';