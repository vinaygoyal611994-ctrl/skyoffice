import {
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { officesTable } from "./offices";
import { plansTable } from "./plans";

// ── Campaign status ───────────────────────────────────────────────────────────

export const campaignStatusEnum = [
  "draft",      // created, not yet scheduled
  "scheduled",  // activation date set; notifications may be in-flight
  "active",     // activation confirmed; subscription lifecycle is enforced
  "cancelled",  // cancelled before activation
] as const;

export type CampaignStatus = (typeof campaignStatusEnum)[number];

// ── Notification status ───────────────────────────────────────────────────────

export const activationNotificationStatusEnum = [
  "queued",    // scheduled for delivery
  "sent",      // email delivered (API accepted)
  "failed",    // email delivery failed
] as const;

export type ActivationNotificationStatus =
  (typeof activationNotificationStatusEnum)[number];

// ── commercial_activation_campaigns ──────────────────────────────────────────

/**
 * One row per commercial launch campaign (typically one per market/phase).
 * Tracks the full lifecycle: draft → scheduled → active.
 *
 * A campaign can target a specific country/city/provider_type or be global.
 * NULL on any filter field means "all values".
 */
export const commercialActivationCampaignsTable = pgTable(
  "commercial_activation_campaigns",
  {
    id:                   serial("id").primaryKey(),
    status:               text("status", { enum: campaignStatusEnum })
                            .notNull()
                            .default("draft"),

    // Linked plan (what offices will be paying for)
    planId:               integer("plan_id")
                            .references(() => plansTable.id, { onDelete: "restrict" }),

    // Targeting (NULL = all)
    targetCountry:        text("target_country"),
    targetCity:           text("target_city"),
    targetProviderType:   text("target_provider_type"),

    // Scheduling
    scheduledAt:          timestamp("scheduled_at",  { withTimezone: true }),
    notificationLeadDays: integer("notification_lead_days").notNull().default(7),

    // Activation outcome (set when status → 'active')
    activatedAt:          timestamp("activated_at",  { withTimezone: true }),
    confirmedBy:          integer("confirmed_by")
                            .references(() => usersTable.id, { onDelete: "set null" }),

    // Running counts (updated during notify/activate operations)
    eligibleCount:        integer("eligible_count").notNull().default(0),
    notifiedCount:        integer("notified_count").notNull().default(0),
    failedCount:          integer("failed_count").notNull().default(0),
    excludedCount:        integer("excluded_count").notNull().default(0),
    activatedOffices:     integer("activated_offices").notNull().default(0),

    notes:                text("notes"),
    createdAt:            timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:            timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy:            integer("created_by")
                            .references(() => usersTable.id, { onDelete: "set null" }),
  },
  (table) => [
    index("idx_campaigns_status").on(table.status),
    index("idx_campaigns_scheduled_at").on(table.scheduledAt),
  ],
);

export type CommercialActivationCampaign =
  typeof commercialActivationCampaignsTable.$inferSelect;

// ── activation_notifications ──────────────────────────────────────────────────

/**
 * Per-office notification tracking for a commercial activation campaign.
 * UNIQUE (campaign_id, office_id) prevents duplicate emails for the same campaign.
 */
export const activationNotificationsTable = pgTable(
  "activation_notifications",
  {
    id:         serial("id").primaryKey(),
    campaignId: integer("campaign_id")
                  .notNull()
                  .references(() => commercialActivationCampaignsTable.id, { onDelete: "cascade" }),
    officeId:   integer("office_id")
                  .notNull()
                  .references(() => officesTable.id, { onDelete: "cascade" }),
    status:     text("status", { enum: activationNotificationStatusEnum })
                  .notNull()
                  .default("queued"),
    locale:     text("locale").notNull().default("ar"),
    sentAt:     timestamp("sent_at", { withTimezone: true }),
    failReason: text("fail_reason"),
    metadata:   jsonb("metadata"),
    createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_activation_notifications_campaign_office").on(
      table.campaignId, table.officeId,
    ),
    index("idx_activation_notifications_campaign").on(table.campaignId),
    index("idx_activation_notifications_office").on(table.officeId),
    index("idx_activation_notifications_status").on(table.status),
  ],
);

export type ActivationNotification =
  typeof activationNotificationsTable.$inferSelect;
