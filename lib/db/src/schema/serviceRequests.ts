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
import { officesTable } from "./offices";

export const serviceRequestStatusEnum = [
  "submitted",
  "offer_sent",
  "agreed",
  "awaiting_customer_confirmation",
  "completed",
  "rejected",
  "not_completed",
] as const;

export type ServiceRequestStatus = (typeof serviceRequestStatusEnum)[number];

export const serviceRequestsTable = pgTable(
  "service_requests",
  {
    id: serial("id").primaryKey(),
    // RESTRICT (not CASCADE): deleting a user who has service requests is
    // blocked to prevent silent historical-transaction data loss.
    customerId: integer("customer_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    officeId: integer("office_id")
      .notNull()
      .references(() => officesTable.id, { onDelete: "cascade" }),
    serviceName: text("service_name").notNull(),
    description: text("description").notNull(),
    // Price and duration are text to allow flexible formats ("500 SAR", "3–5 days", etc.)
    price: text("price"),
    executionDuration: text("execution_duration"),
    status: text("status", { enum: serviceRequestStatusEnum })
      .notNull()
      .default("submitted"),
    officeCompletedAt: timestamp("office_completed_at", { withTimezone: true }),
    customerConfirmedAt: timestamp("customer_confirmed_at", {
      withTimezone: true,
    }),
    // Set exactly once when the office sends their first offer response.
    // Never overwritten. NULL means the office has not yet responded.
    // Used to compute automatic response-speed metrics.
    firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("idx_service_requests_customer_id").on(table.customerId),
    index("idx_service_requests_office_id").on(table.officeId),
    index("idx_service_requests_status").on(table.status),
  ],
);

export type ServiceRequest = typeof serviceRequestsTable.$inferSelect;

export const serviceRequestReviewsTable = pgTable(
  "service_request_reviews",
  {
    id: serial("id").primaryKey(),
    // UNIQUE constraint enforces one review per completed request.
    requestId: integer("request_id")
      .notNull()
      .references(() => serviceRequestsTable.id, { onDelete: "cascade" }),
    // Redundant FK kept for efficient customer-scoped IDOR checks without
    // joining back through service_requests.
    // RESTRICT (not CASCADE): review history must survive user deletion.
    customerId: integer("customer_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    wasCompleted: text("was_completed", { enum: ["yes", "no"] }).notNull(),
    wouldRecommend: text("would_recommend", { enum: ["yes", "no"] }).notNull(),
    // Legacy 1–5 customer-chosen rating. Nullable since migration 0022:
    // new reviews omit this field (response speed is system-calculated from
    // first_response_at - created_at, not customer-reported).
    responseSpeed: integer("response_speed"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("service_request_reviews_request_id_idx").on(table.requestId),
    index("idx_service_request_reviews_customer_id").on(table.customerId),
  ],
);

export type ServiceRequestReview =
  typeof serviceRequestReviewsTable.$inferSelect;
