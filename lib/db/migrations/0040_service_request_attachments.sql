-- Private, request-scoped service-request attachments and single-use upload reservations.

CREATE TABLE IF NOT EXISTS service_request_attachment_reservations (
  id                SERIAL PRIMARY KEY,
  request_id        INTEGER NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  uploader_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  uploader_role     TEXT NOT NULL CHECK (uploader_role IN ('customer', 'office')),
  object_path       TEXT NOT NULL,
  file_name         TEXT NOT NULL,
  content_type      TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'application/pdf')),
  file_size         INTEGER NOT NULL CHECK (file_size > 0 AND file_size <= 10485760),
  expires_at        TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS sr_attachment_reservations_object_path_idx
  ON service_request_attachment_reservations (object_path);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sr_attachment_reservations_request_id
  ON service_request_attachment_reservations (request_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sr_attachment_reservations_uploader_id
  ON service_request_attachment_reservations (uploader_user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sr_attachment_reservations_expires_at
  ON service_request_attachment_reservations (expires_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS service_request_attachments (
  id                SERIAL PRIMARY KEY,
  request_id        INTEGER NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  uploader_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  uploader_role     TEXT NOT NULL CHECK (uploader_role IN ('customer', 'office')),
  object_path       TEXT NOT NULL,
  file_name         TEXT NOT NULL,
  content_type      TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'application/pdf')),
  file_size         INTEGER NOT NULL CHECK (file_size > 0 AND file_size <= 10485760),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS sr_attachments_object_path_idx
  ON service_request_attachments (object_path);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sr_attachments_request_id
  ON service_request_attachments (request_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sr_attachments_uploader_id
  ON service_request_attachments (uploader_user_id);