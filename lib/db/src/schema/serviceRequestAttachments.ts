import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { serviceRequestsTable } from "./serviceRequests";

export const serviceRequestAttachmentUploaderRoleEnum = [
  "customer",
  "office",
] as const;

export type ServiceRequestAttachmentUploaderRole =
  (typeof serviceRequestAttachmentUploaderRoleEnum)[number];

const attachmentContentTypes = ["image/jpeg", "image/png", "application/pdf"] as const;

export const serviceRequestAttachmentReservationsTable = pgTable(
  "service_request_attachment_reservations",
  {
    id: serial("id").primaryKey(),
    requestId: integer("request_id")
      .notNull()
      .references(() => serviceRequestsTable.id, { onDelete: "cascade" }),
    uploaderUserId: integer("uploader_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    uploaderRole: text("uploader_role", {
      enum: serviceRequestAttachmentUploaderRoleEnum,
    }).notNull(),
    objectPath: text("object_path").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type", { enum: attachmentContentTypes }).notNull(),
    fileSize: integer("file_size").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("sr_attachment_reservations_object_path_idx").on(table.objectPath),
    index("idx_sr_attachment_reservations_request_id").on(table.requestId),
    index("idx_sr_attachment_reservations_uploader_id").on(table.uploaderUserId),
    index("idx_sr_attachment_reservations_expires_at").on(table.expiresAt),
  ],
);

export const serviceRequestAttachmentsTable = pgTable(
  "service_request_attachments",
  {
    id: serial("id").primaryKey(),
    requestId: integer("request_id")
      .notNull()
      .references(() => serviceRequestsTable.id, { onDelete: "cascade" }),
    uploaderUserId: integer("uploader_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    uploaderRole: text("uploader_role", {
      enum: serviceRequestAttachmentUploaderRoleEnum,
    }).notNull(),
    objectPath: text("object_path").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type", { enum: attachmentContentTypes }).notNull(),
    fileSize: integer("file_size").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("sr_attachments_object_path_idx").on(table.objectPath),
    index("idx_sr_attachments_request_id").on(table.requestId),
    index("idx_sr_attachments_uploader_id").on(table.uploaderUserId),
  ],
);

export type ServiceRequestAttachmentReservation =
  typeof serviceRequestAttachmentReservationsTable.$inferSelect;
export type ServiceRequestAttachment =
  typeof serviceRequestAttachmentsTable.$inferSelect;