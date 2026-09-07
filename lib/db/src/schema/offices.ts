import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

// The 6 default "Languages Spoken by the Office" options (stable codes,
// never renamed — display labels live in the frontend i18n dictionary). A
// customer-entered custom name goes in `customLanguages` instead, never as
// a new code here.
export const defaultSpokenLanguageCodes = [
  "ar",
  "en",
  "ur",
  "hi",
  "tl",
  "fr",
] as const;

export const officeCategoryEnum = [
  "translation",
  "legal",
  "marketing",
  "development",
  "design",
  "real_estate",
  "company_formation",
  "business_consulting",
  "accounting",
  "social_media_management",
  "other",
] as const;

export const providerTypeEnum = ["office", "freelancer"] as const;
export type ProviderType = (typeof providerTypeEnum)[number];

// How a freelancer's profile image is displayed on public cards.
// NULL is treated as 'brand_image' for backward compatibility with
// existing freelancers who haven't chosen yet.
// Offices are not permitted to set this field (enforced at API layer).
export const freelancerImageStyleEnum = [
  "personal_photo",
  "brand_image",
] as const;
export type FreelancerImageStyle = (typeof freelancerImageStyleEnum)[number];

export const mediaTypeEnum = ["image", "video"] as const;

export const officeStatusEnum = [
  "draft",
  "under_review",
  "changes_requested",
  "approved",
  "active",
  "rejected",
  "suspended",
] as const;

export const verificationDocumentTypeEnum = [
  "identity",
  "trade_license",
  "professional_license",
  "certificate",
] as const;

export const verificationDocumentStatusEnum = [
  "pending",
  "approved",
  "rejected",
] as const;

export const officesTable = pgTable(
  "offices",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    // Stable, human-readable public identifier (e.g. "levant-bridge-translation").
    // Used for the office's canonical public URL and QR code so links/scans
    // never break if the numeric id changes or is renumbered. Generated once
    // at creation time from the English name; never regenerated on rename so
    // already-printed/shared/scanned links keep working.
    slug: text("slug").notNull().unique(),
    category: text("category", { enum: officeCategoryEnum }).notNull(),
    city: text("city").notNull(),
    shortDescription: text("short_description"),
    shortDescriptionAr: text("short_description_ar"),
    description: text("description"),
    descriptionAr: text("description_ar"),
    // Legacy contact field. No longer collected or required anywhere in the
    // app — `whatsapp` is now the single required contact number — but kept
    // (nullable) so pre-existing data is never dropped.
    phone: text("phone"),
    whatsapp: text("whatsapp"),
    // Whether the WhatsApp number above also accepts regular phone calls, so
    // the Decision Card can offer a "Call" action without a second number.
    acceptsPhoneCalls: boolean("accepts_phone_calls").notNull().default(false),
    // Languages spoken by the office staff. `spokenLanguages` holds stable
    // codes from `defaultSpokenLanguageCodes`; `customLanguages` holds
    // free-text "Other" entries the office typed in themselves (never
    // auto-translated). At least one entry across both is required before an
    // office can submit its application for review.
    spokenLanguages: text("spoken_languages")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    customLanguages: text("custom_languages")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // Timestamp the office ticked the "I agree to the Terms & Privacy Policy"
    // checkbox at registration. Required going forward; backfilled for
    // pre-existing offices (see migration) since they registered before this
    // checkbox existed.
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
    email: text("email").notNull(),
    website: text("website"),
    address: text("address"),
    country: text("country"),
    specialization: text("specialization"),
    googleMapsUrl: text("google_maps_url"),
    // Provider geographic coordinates — set optionally by the provider from
    // their dashboard. Used for proximity-based ranking when available.
    // Nullable: existing providers retain null until they add coordinates.
    // Not exposed in the public OfficeSummary — only the computed distance is.
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    status: text("status", { enum: officeStatusEnum })
      .notNull()
      .default("active"),
    rejectionReason: text("rejection_reason"),
    changeRequestReason: text("change_request_reason"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    // FK to users.id — nullable because offices start unreviewed.
    // ON DELETE SET NULL so admin account deletion doesn't lose the record.
    reviewedBy: integer("reviewed_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    logoUrl: text("logo_url"),
    coverUrl: text("cover_url"),
    heroMediaUrl: text("hero_media_url"),
    heroMediaType: text("hero_media_type", { enum: mediaTypeEnum }),
    // Optional single marketing video slot for the Digital Office/Decision
    // Card (distinct from heroMedia/gallery — office can only have one).
    // MP4 only, <=80MB, <=75s; duration is verified from the uploaded file
    // server-side and stored as whole seconds without understating it.
    marketingVideoUrl: text("marketing_video_url"),
    marketingVideoMimeType: text("marketing_video_mime_type"),
    marketingVideoSize: integer("marketing_video_size"),
    marketingVideoDuration: integer("marketing_video_duration"),
    marketingVideoUpdatedAt: timestamp("marketing_video_updated_at", {
      withTimezone: true,
    }),
    certifications: text("certifications").array(),
    certificationsAr: text("certifications_ar").array(),
    videoCallEnabled: boolean("video_call_enabled").notNull().default(true),
    // Optional customer-facing portfolio surface. Disabling it hides approved
    // Works publicly without deleting approved or pending media rows.
    worksEnabled: boolean("works_enabled").notNull().default(false),
    // Freelancer-only display preference for how logoUrl is rendered publicly.
    // NULL → brand_image (backward-compatible default).
    // Constrained by CHECK in the DB migration; also validated at API layer.
    freelancerImageStyle: text("freelancer_image_style", {
      enum: freelancerImageStyleEnum,
    }),
    isOnline: boolean("is_online").notNull().default(false),
    isVerified: boolean("is_verified").notNull().default(false),
    completedTransactions: integer("completed_transactions")
      .notNull()
      .default(0),
    clientsRecommendPercent: integer("clients_recommend_percent")
      .notNull()
      .default(0),
    isDemo: boolean("is_demo").notNull().default(false),
    // Mandatory provider-type discriminator. Set once at registration and
    // read-only thereafter (self-service type changes are out of scope for v1;
    // an admin route may be added later). All rows created before this column
    // was added automatically received DEFAULT 'office' via the migration.
    providerType: text("provider_type", { enum: providerTypeEnum })
      .notNull()
      .default("office"),
    // Primary media item shown first in the gallery/preview (item 11). Not a
    // hard FK — the referenced office_media row may be deleted independently
    // and application code clears this back to null when that happens.
    primaryMediaId: integer("primary_media_id"),
    // While an office is approved/active/suspended, direct edits to public
    // fields are locked (item 2). Edits are staged here as a JSON blob and
    // only merged into the live row once an admin approves the revision.
    // NOTE: coverUrl is no longer stored inside this blob — Quick Card cover
    // changes use the dedicated pending_quick_card_cover column instead.
    pendingChanges: text("pending_changes"),
    pendingChangesSubmittedAt: timestamp("pending_changes_submitted_at", {
      withTimezone: true,
    }),
    // ── Media placement pending state (migration 0020) ──────────────────────
    // Quick Card cover changes are tracked independently from the text-field
    // pendingChanges blob so admins can approve/reject each placement without
    // affecting the other. Gallery and Decision Card cover changes are tracked
    // per-row in office_media.status.
    pendingQuickCardCoverUrl: text("pending_quick_card_cover"),
    pendingMediaSubmittedAt: timestamp("pending_media_submitted_at", {
      withTimezone: true,
    }),
    pendingMediaRejectionReason: text("pending_media_rejection_reason"),
    // ── Image optimisation variants (migration 0025) ─────────────────────────
    // After server-side processing the raw upload is replaced by WebP variants.
    // coverVariants stores { original, thumbnail, medium } for the active cover.
    // pendingQuickCardCoverVariants stores the same for the staged pending cover.
    // The `original` path is private and stripped from public API responses.
    coverVariants: jsonb("cover_variants"),
    pendingQuickCardCoverVariants: jsonb("pending_quick_card_cover_variants"),

    // ── Supply Control gate (migration 0026) ─────────────────────────────────
    // Recorded at submit time.  NULL = not yet submitted, or submitted before
    // migration 0026 (pre-gate; treat as "allowed" for reporting purposes).
    //
    // supplyGateStatus    — outcome: 'allowed' | 'limited' | 'blocked' | 'no_data'
    // supplyGateMarketKey — compound key checked, e.g. "SA|riyadh|marketing"
    // supplyGateOverride* — set only when an admin explicitly overrides the gate
    //                       for this specific office without changing market-level
    //                       acceptance_status. Every override must be audited.
    supplyGateStatus:         text("supply_gate_status"),
    supplyGateMarketKey:      text("supply_gate_market_key"),
    supplyGateOverrideBy:     integer("supply_gate_override_by").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    supplyGateOverrideAt:     timestamp("supply_gate_override_at", { withTimezone: true }),
    supplyGateOverrideReason: text("supply_gate_override_reason"),

    // ── Subscription visibility overlay (migration 0028) ─────────────────────
    // TRUE when subscription has expired beyond the grace period and the office
    // should be hidden from public discovery.
    // This is a READ-FILTER ONLY — it never deletes the office, changes
    // offices.status, or affects transaction/review/audit history.
    // Cleared (→ false) automatically when a subscription is reactivated.
    isSubscriptionHidden: boolean("is_subscription_hidden").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // idx_offices_user_id — created in migration 0001; declared here for schema completeness.
    index("idx_offices_user_id").on(table.userId),
    // Composite index covering the most common public listing filter combination.
    index("idx_offices_status_provider_type").on(
      table.status,
      table.providerType,
    ),
    // City filter used on both the discover page and the admin office list.
    index("idx_offices_city").on(table.city),
    // Supports "reviewed by" admin lookups; partial since most rows are null.
    index("idx_offices_reviewed_by").on(table.reviewedBy),
  ],
);

export const insertOfficeSchema = createInsertSchema(officesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertOffice = z.infer<typeof insertOfficeSchema>;
export type Office = typeof officesTable.$inferSelect;

export const officeServicesTable = pgTable(
  "office_services",
  {
    id: serial("id").primaryKey(),
    officeId: integer("office_id")
      .notNull()
      .references(() => officesTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
  },
  (table) => [
    // idx_office_services_office_id — created in migration 0001; declared here for schema completeness.
    index("idx_office_services_office_id").on(table.officeId),
  ],
);

export const insertOfficeServiceSchema = createInsertSchema(
  officeServicesTable,
).omit({ id: true });
export type InsertOfficeService = z.infer<typeof insertOfficeServiceSchema>;
export type OfficeServiceRow = typeof officeServicesTable.$inferSelect;

// Media placement — which surface this item is displayed on.
// 'decision_gallery' is the backward-compatible default for all pre-existing rows.
export const mediaPlacementEnum = [
  "quick_card_cover",    // single cover image on QuickOfficeCard (stored in offices.coverUrl, not here)
  "decision_card_cover", // hero image/video at top of Decision Card
  "decision_gallery",    // gallery in Decision Card
  "works",               // optional 4:3 portfolio work image
  "shared_identity",     // logo / personal photo (stored in offices.logoUrl, not here)
] as const;
export type MediaPlacement = (typeof mediaPlacementEnum)[number];

// Per-item approval state for office_media rows.
export const mediaItemStatusEnum = ["approved", "pending_review", "rejected"] as const;
export type MediaItemStatus = (typeof mediaItemStatusEnum)[number];

export const officeMediaTable = pgTable(
  "office_media",
  {
    id: serial("id").primaryKey(),
    officeId: integer("office_id")
      .notNull()
      .references(() => officesTable.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    type: text("type", { enum: mediaTypeEnum }).notNull(),
    // Which surface this media item belongs to (migration 0020).
    // Existing rows default to 'decision_gallery' via SQL DEFAULT.
    placement: text("placement", { enum: mediaPlacementEnum })
      .notNull()
      .default("decision_gallery"),
    // Per-item approval state (migration 0020).
    // Existing rows default to 'approved' via SQL DEFAULT — no data loss.
    status: text("status", { enum: mediaItemStatusEnum })
      .notNull()
      .default("approved"),
    // Stored when an admin rejects this item, so the office owner can see why.
    rejectionReason: text("rejection_reason"),
    // Image optimisation variant paths (migration 0025).
    // Stores { original, thumbnail, display } for images; null for videos.
    // `original` is the raw upload path (private). `thumbnail` and `display`
    // are the server-generated WebP variants. Stripped of `original` before
    // being returned in public API responses.
    variants: jsonb("variants"),
    // Display order within independently ordered decision_gallery and works
    // placements (migration 0021 / 0041).
    // NULL for single-slot placements (decision_card_cover, quick_card_cover, etc.).
    // Assigned as (max + 1) at insert time; updated by the reorder endpoint.
    sortOrder: integer("sort_order"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Tracks when an admin last changed the approval status of this item.
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // idx_office_media_office_id — created in migration 0001; declared here for schema completeness.
    index("idx_office_media_office_id").on(table.officeId),
  ],
);

export const insertOfficeMediaSchema = createInsertSchema(
  officeMediaTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOfficeMedia = z.infer<typeof insertOfficeMediaSchema>;
export type OfficeMediaRow = typeof officeMediaTable.$inferSelect;

// Verification documents are private — never served through the public
// object path. Only the owning office and admins may fetch them (enforced
// in the storage route, see storage.ts).
export const officeVerificationDocumentsTable = pgTable(
  "office_verification_documents",
  {
    id: serial("id").primaryKey(),
    officeId: integer("office_id")
      .notNull()
      .references(() => officesTable.id, { onDelete: "cascade" }),
    documentType: text("document_type", {
      enum: verificationDocumentTypeEnum,
    }).notNull(),
    objectPath: text("object_path").notNull(),
    status: text("status", { enum: verificationDocumentStatusEnum })
      .notNull()
      .default("pending"),
    reviewNote: text("review_note"),
    reviewedBy: integer("reviewed_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Enforces one-to-one binding between a storage object and a document
    // record, so the ownership check in storage.ts (which looks up the
    // requester's access by matching objectPath) can never resolve to more
    // than one office.
    uniqueIndex("office_verification_documents_object_path_idx").on(
      table.objectPath,
    ),
    // idx_office_verification_documents_office_id — created in migration 0001; declared here for schema completeness.
    index("idx_office_verification_documents_office_id").on(table.officeId),
  ],
);

export const insertOfficeVerificationDocumentSchema = createInsertSchema(
  officeVerificationDocumentsTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOfficeVerificationDocument = z.infer<
  typeof insertOfficeVerificationDocumentSchema
>;
export type OfficeVerificationDocumentRow =
  typeof officeVerificationDocumentsTable.$inferSelect;

// Internal admin-only notes about an office (item 10). Never surfaced to the
// office or the public — only through the admin-scoped endpoints.
export const officeAdminNotesTable = pgTable(
  "office_admin_notes",
  {
    id: serial("id").primaryKey(),
    officeId: integer("office_id")
      .notNull()
      .references(() => officesTable.id, { onDelete: "cascade" }),
    note: text("note").notNull(),
    // Nullable FK to users.id — set to NULL when the admin account is deleted
    // so the note text is preserved for audit purposes (ON DELETE SET NULL).
    createdBy: integer("created_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // idx_office_admin_notes_office_id — created in migration 0001; declared here for schema completeness.
    index("idx_office_admin_notes_office_id").on(table.officeId),
    // Partial index: only non-null created_by values need to be indexed.
    index("idx_office_admin_notes_created_by").on(table.createdBy),
  ],
);

export const insertOfficeAdminNoteSchema = createInsertSchema(
  officeAdminNotesTable,
).omit({ id: true, createdAt: true });
export type InsertOfficeAdminNote = z.infer<
  typeof insertOfficeAdminNoteSchema
>;
export type OfficeAdminNoteRow = typeof officeAdminNotesTable.$inferSelect;
