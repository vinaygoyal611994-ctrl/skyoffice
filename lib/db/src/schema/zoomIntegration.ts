import { index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { officesTable } from "./offices";
import { videoCallRequestsTable } from "./contact";

export const zoomConnectionStatusEnum = [
  "not_connected",
  "connected",
  "token_refreshing",
  "reauth_required",
  "disconnected",
  "error",
] as const;

// One row per office — stores OAuth tokens and connection state.
// Tokens are AES-256-GCM encrypted before storage; never stored in plaintext.
export const officeZoomConnectionsTable = pgTable(
  "office_zoom_connections",
  {
    id: serial("id").primaryKey(),
    officeId: integer("office_id")
      .notNull()
      .unique()
      .references(() => officesTable.id, { onDelete: "cascade" }),
    zoomAccountId: text("zoom_account_id"),
    zoomUserId: text("zoom_user_id"),
    zoomUserEmail: text("zoom_user_email"),
    encryptedAccessToken: text("encrypted_access_token"),
    encryptedRefreshToken: text("encrypted_refresh_token"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    grantedScopes: text("granted_scopes"),
    status: text("status", { enum: zoomConnectionStatusEnum })
      .notNull()
      .default("not_connected"),
    lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
    lastRefreshedAt: timestamp("last_refreshed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("idx_office_zoom_connections_office_id").on(table.officeId),
  ],
);

export const insertOfficeZoomConnectionSchema = createInsertSchema(
  officeZoomConnectionsTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOfficeZoomConnection = z.infer<typeof insertOfficeZoomConnectionSchema>;
export type OfficeZoomConnection = typeof officeZoomConnectionsTable.$inferSelect;

// Zoom meeting details for a confirmed video call request.
// Provider-agnostic: providerName lets a future integration swap Zoom without
// touching booking records.
export const videoCallMeetingDetailsTable = pgTable(
  "video_call_meeting_details",
  {
    id: serial("id").primaryKey(),
    videoCallRequestId: integer("video_call_request_id")
      .notNull()
      .unique()
      .references(() => videoCallRequestsTable.id, { onDelete: "cascade" }),
    officeId: integer("office_id")
      .notNull()
      .references(() => officesTable.id, { onDelete: "cascade" }),
    providerName: text("provider_name").notNull().default("zoom"),
    externalMeetingId: text("external_meeting_id").notNull(),
    joinUrl: text("join_url").notNull(),
    hostStartUrl: text("host_start_url").notNull(),
    meetingPassword: text("meeting_password"),
    providerStatus: text("provider_status").notNull().default("active"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    durationMinutes: integer("duration_minutes").notNull().default(25),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("idx_vcmd_request_id").on(table.videoCallRequestId),
    index("idx_vcmd_office_id").on(table.officeId),
  ],
);

export const insertVideoCallMeetingDetailsSchema = createInsertSchema(
  videoCallMeetingDetailsTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVideoCallMeetingDetails = z.infer<typeof insertVideoCallMeetingDetailsSchema>;
export type VideoCallMeetingDetails = typeof videoCallMeetingDetailsTable.$inferSelect;
