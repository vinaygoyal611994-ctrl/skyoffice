CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"password_hash" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"status_reason" text,
	"status_changed_at" timestamp with time zone,
	"status_changed_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "office_admin_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"office_id" integer NOT NULL,
	"note" text NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "office_media" (
	"id" serial PRIMARY KEY NOT NULL,
	"office_id" integer NOT NULL,
	"url" text NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "office_services" (
	"id" serial PRIMARY KEY NOT NULL,
	"office_id" integer NOT NULL,
	"name" text NOT NULL,
	"name_ar" text
);
--> statement-breakpoint
CREATE TABLE "office_verification_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"office_id" integer NOT NULL,
	"document_type" text NOT NULL,
	"object_path" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"review_note" text,
	"reviewed_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offices" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"slug" text NOT NULL,
	"category" text NOT NULL,
	"city" text NOT NULL,
	"short_description" text,
	"short_description_ar" text,
	"description" text,
	"description_ar" text,
	"phone" text,
	"whatsapp" text,
	"accepts_phone_calls" boolean DEFAULT false NOT NULL,
	"spoken_languages" text[] DEFAULT '{}'::text[] NOT NULL,
	"custom_languages" text[] DEFAULT '{}'::text[] NOT NULL,
	"terms_accepted_at" timestamp with time zone,
	"email" text NOT NULL,
	"website" text,
	"address" text,
	"country" text,
	"specialization" text,
	"google_maps_url" text,
	"status" text DEFAULT 'active' NOT NULL,
	"rejection_reason" text,
	"change_request_reason" text,
	"submitted_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" integer,
	"activated_at" timestamp with time zone,
	"logo_url" text,
	"cover_url" text,
	"hero_media_url" text,
	"hero_media_type" text,
	"marketing_video_url" text,
	"marketing_video_mime_type" text,
	"marketing_video_size" integer,
	"marketing_video_duration" integer,
	"marketing_video_updated_at" timestamp with time zone,
	"certifications" text[],
	"certifications_ar" text[],
	"video_call_enabled" boolean DEFAULT true NOT NULL,
	"is_online" boolean DEFAULT false NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"completed_transactions" integer DEFAULT 0 NOT NULL,
	"clients_recommend_percent" integer DEFAULT 0 NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"primary_media_id" integer,
	"pending_changes" text,
	"pending_changes_submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offices_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "favourites" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_user_id" integer NOT NULL,
	"office_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "favourites_customer_user_id_office_id_unique" UNIQUE("customer_user_id","office_id")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_id" integer,
	"actor_role" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" integer,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" json NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_user_id" integer NOT NULL,
	"office_id" integer NOT NULL,
	"action_type" text NOT NULL,
	"source_page" text,
	"language" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_call_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_user_id" integer NOT NULL,
	"office_id" integer NOT NULL,
	"preferred_date" text NOT NULL,
	"preferred_time" text NOT NULL,
	"timezone" text NOT NULL,
	"contact_number" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'new' NOT NULL,
	"responded_at" timestamp with time zone,
	"responded_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_analytics_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"office_id" integer NOT NULL,
	"conversation_id" integer,
	"event_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"office_id" integer NOT NULL,
	"customer_user_id" integer NOT NULL,
	"status" text DEFAULT 'waiting_for_office' NOT NULL,
	"language" text DEFAULT 'ar' NOT NULL,
	"delay_timer_expires_at" timestamp with time zone,
	"assistant_activated_at" timestamp with time zone,
	"human_takeover_at" timestamp with time zone,
	"last_message_at" timestamp with time zone,
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"sender_type" text NOT NULL,
	"sender_user_id" integer,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "office_assistant_knowledge" (
	"id" serial PRIMARY KEY NOT NULL,
	"office_id" integer NOT NULL,
	"introduction" text,
	"services" text,
	"service_descriptions" text,
	"working_hours_text" text,
	"city_service_area" text,
	"faq" text,
	"required_documents" text,
	"process_steps" text,
	"pricing_guidance" text,
	"contact_instructions" text,
	"never_answer" text,
	"fallback_message" text,
	"fallback_message_ar" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "office_assistant_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"office_id" integer NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"mode" text DEFAULT 'off' NOT NULL,
	"delay_minutes" integer DEFAULT 4 NOT NULL,
	"working_days" text[] DEFAULT '{"sun","mon","tue","wed","thu"}' NOT NULL,
	"open_time" text DEFAULT '09:00' NOT NULL,
	"close_time" text DEFAULT '17:00' NOT NULL,
	"timezone" text DEFAULT 'Asia/Amman' NOT NULL,
	"welcome_message" text,
	"welcome_message_ar" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "office_admin_notes" ADD CONSTRAINT "office_admin_notes_office_id_offices_id_fk" FOREIGN KEY ("office_id") REFERENCES "public"."offices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_media" ADD CONSTRAINT "office_media_office_id_offices_id_fk" FOREIGN KEY ("office_id") REFERENCES "public"."offices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_services" ADD CONSTRAINT "office_services_office_id_offices_id_fk" FOREIGN KEY ("office_id") REFERENCES "public"."offices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_verification_documents" ADD CONSTRAINT "office_verification_documents_office_id_offices_id_fk" FOREIGN KEY ("office_id") REFERENCES "public"."offices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offices" ADD CONSTRAINT "offices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favourites" ADD CONSTRAINT "favourites_customer_user_id_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favourites" ADD CONSTRAINT "favourites_office_id_offices_id_fk" FOREIGN KEY ("office_id") REFERENCES "public"."offices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_events" ADD CONSTRAINT "contact_events_customer_user_id_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_events" ADD CONSTRAINT "contact_events_office_id_offices_id_fk" FOREIGN KEY ("office_id") REFERENCES "public"."offices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_call_requests" ADD CONSTRAINT "video_call_requests_customer_user_id_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_call_requests" ADD CONSTRAINT "video_call_requests_office_id_offices_id_fk" FOREIGN KEY ("office_id") REFERENCES "public"."offices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_analytics_events" ADD CONSTRAINT "assistant_analytics_events_office_id_offices_id_fk" FOREIGN KEY ("office_id") REFERENCES "public"."offices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_analytics_events" ADD CONSTRAINT "assistant_analytics_events_conversation_id_assistant_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."assistant_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_office_id_offices_id_fk" FOREIGN KEY ("office_id") REFERENCES "public"."offices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_customer_user_id_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_conversation_id_assistant_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."assistant_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_assistant_knowledge" ADD CONSTRAINT "office_assistant_knowledge_office_id_offices_id_fk" FOREIGN KEY ("office_id") REFERENCES "public"."offices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_assistant_settings" ADD CONSTRAINT "office_assistant_settings_office_id_offices_id_fk" FOREIGN KEY ("office_id") REFERENCES "public"."offices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "office_verification_documents_object_path_idx" ON "office_verification_documents" USING btree ("object_path");--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "session" USING btree ("expire");--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_conversations_office_customer_idx" ON "assistant_conversations" USING btree ("office_id","customer_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "office_assistant_knowledge_office_id_idx" ON "office_assistant_knowledge" USING btree ("office_id");--> statement-breakpoint
CREATE UNIQUE INDEX "office_assistant_settings_office_id_idx" ON "office_assistant_settings" USING btree ("office_id");