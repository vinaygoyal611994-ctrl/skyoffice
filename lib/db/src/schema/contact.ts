import { index, integer, pgTable, serial, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { officesTable } from "./offices";

// Only whatsapp_click and video_call_request count as "verified commercial
// contact" — location_click/share_click are logged for visibility but never
// counted that way (see contact.ts routes and admin serializers).
export const contactEventActionTypeEnum = [
  "whatsapp_click",
  "video_call_request",
  "location_click",
  "share_click",
] as const;

export const contactEventsTable = pgTable(
  "contact_events",
  {
    id: serial("id").primaryKey(),
    customerUserId: integer("customer_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    officeId: integer("office_id")
      .notNull()
      .references(() => officesTable.id, { onDelete: "cascade" }),
    actionType: text("action_type", { enum: contactEventActionTypeEnum }).notNull(),
    sourcePage: text("source_page"),
    language: text("language"),
    // Phase 1 analytics: links this contact event to the search journey that
    // led to it. Client generates a UUID and stores it in sessionStorage as
    // "search_session_id"; it is passed through search → impressions →
    // card_click → profile_view → contact event. NULL for events recorded
    // before Phase 1 (expected and not an error).
    searchSessionId: uuid("search_session_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_contact_events_customer_user_id").on(table.customerUserId),
    index("idx_contact_events_office_id").on(table.officeId),
  ],
);

export const insertContactEventSchema = createInsertSchema(
  contactEventsTable,
).omit({ id: true, createdAt: true });
export type InsertContactEvent = z.infer<typeof insertContactEventSchema>;
export type ContactEvent = typeof contactEventsTable.$inferSelect;

export const videoCallRequestStatusEnum = [
  "new",
  "viewed",
  "accepted",
  "declined",
  "completed",
] as const;

export const videoCallRequestsTable = pgTable(
  "video_call_requests",
  {
    id: serial("id").primaryKey(),
    customerUserId: integer("customer_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    officeId: integer("office_id")
      .notNull()
      .references(() => officesTable.id, { onDelete: "cascade" }),
    preferredDate: text("preferred_date").notNull(),
    preferredTime: text("preferred_time").notNull(),
    timezone: text("timezone").notNull(),
    contactNumber: text("contact_number").notNull(),
    note: text("note"),
    status: text("status", { enum: videoCallRequestStatusEnum })
      .notNull()
      .default("new"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    respondedBy: integer("responded_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("idx_video_call_requests_customer_user_id").on(table.customerUserId),
    index("idx_video_call_requests_office_id").on(table.officeId),
  ],
);

export const insertVideoCallRequestSchema = createInsertSchema(
  videoCallRequestsTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVideoCallRequest = z.infer<
  typeof insertVideoCallRequestSchema
>;
export type VideoCallRequest = typeof videoCallRequestsTable.$inferSelect;
