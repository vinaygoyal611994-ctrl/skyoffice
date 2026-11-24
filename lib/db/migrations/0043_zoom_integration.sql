CREATE TABLE "office_zoom_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"office_id" integer NOT NULL,
	"zoom_account_id" text,
	"zoom_user_id" text,
	"zoom_user_email" text,
	"encrypted_access_token" text,
	"encrypted_refresh_token" text,
	"token_expires_at" timestamp with time zone,
	"granted_scopes" text,
	"status" text DEFAULT 'not_connected' NOT NULL,
	"last_validated_at" timestamp with time zone,
	"last_refreshed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "office_zoom_connections_office_id_unique" UNIQUE("office_id")
);

CREATE TABLE "video_call_meeting_details" (
	"id" serial PRIMARY KEY NOT NULL,
	"video_call_request_id" integer NOT NULL,
	"office_id" integer NOT NULL,
	"provider_name" text DEFAULT 'zoom' NOT NULL,
	"external_meeting_id" text NOT NULL,
	"join_url" text NOT NULL,
	"host_start_url" text NOT NULL,
	"meeting_password" text,
	"provider_status" text DEFAULT 'active' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"duration_minutes" integer DEFAULT 25 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_call_meeting_details_video_call_request_id_unique" UNIQUE("video_call_request_id")
);

DO $$ BEGIN
 ALTER TABLE "office_zoom_connections" ADD CONSTRAINT "office_zoom_connections_office_id_offices_id_fk" FOREIGN KEY ("office_id") REFERENCES "public"."offices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "video_call_meeting_details" ADD CONSTRAINT "video_call_meeting_details_video_call_request_id_video_call_requests_id_fk" FOREIGN KEY ("video_call_request_id") REFERENCES "public"."video_call_requests"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "video_call_meeting_details" ADD CONSTRAINT "video_call_meeting_details_office_id_offices_id_fk" FOREIGN KEY ("office_id") REFERENCES "public"."offices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE INDEX "idx_office_zoom_connections_office_id" ON "office_zoom_connections" USING btree ("office_id");
CREATE INDEX "idx_vcmd_request_id" ON "video_call_meeting_details" USING btree ("video_call_request_id");
CREATE INDEX "idx_vcmd_office_id" ON "video_call_meeting_details" USING btree ("office_id");
