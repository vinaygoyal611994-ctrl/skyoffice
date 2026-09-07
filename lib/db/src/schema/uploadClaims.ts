/**
 * upload_claims — Short-lived presigned-URL reservations.
 *
 * When the storage route mints a presigned PUT URL it simultaneously inserts a
 * claim row binding the object path to the requesting user's office and the
 * declared upload category.  When the client later registers the uploaded file
 * (POST /offices/me/media, POST /offices/me/documents,
 * PUT /offices/me/marketing-video, PATCH /offices/me/quick-card-cover), the
 * API validates that:
 *   1. The claim exists for the exact objectPath.
 *   2. The claim belongs to the same office.
 *   3. The category matches the registration endpoint.
 *   4. The claim has not expired (TTL: 15 minutes).
 *
 * On validation success the claim row is deleted atomically with the
 * registration insert/update, preventing replay attacks.
 *
 * Claims are also pruned by the sweeper in the background; the primary
 * expiry enforcement happens at claim-validation time.
 */
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

export const uploadClaimsTable = pgTable(
  "upload_claims",
  {
    id: serial("id").primaryKey(),
    // The user who requested the presigned URL (auth check at issue time).
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    // The office that owns this upload (resolved at issue time from offices.user_id).
    officeId: integer("office_id").notNull(),
    // Normalised object path produced by normalizeObjectEntityPath().
    objectPath: text("object_path").notNull(),
    // The declared category from the request-url body (matches UPLOAD_LIMITS keys).
    category: text("category").notNull(),
    // Hard expiry — 15 minutes from issuance.  Claims older than this are invalid.
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // One row per object path — prevents issuing two claims for the same key.
    uniqueIndex("upload_claims_object_path_idx").on(table.objectPath),
    // Fast lookup by userId for the ownership check.
    index("idx_upload_claims_user_id").on(table.userId),
    // Sweeper / expiry query.
    index("idx_upload_claims_expires_at").on(table.expiresAt),
  ],
);

export type UploadClaimRow = typeof uploadClaimsTable.$inferSelect;
export type UploadClaimInsert = typeof uploadClaimsTable.$inferInsert;
