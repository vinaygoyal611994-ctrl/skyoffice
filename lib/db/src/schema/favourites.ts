import {
  index,
  integer,
  pgTable,
  serial,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { officesTable } from "./offices";

export const favouritesTable = pgTable(
  "favourites",
  {
    id: serial("id").primaryKey(),
    customerUserId: integer("customer_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    officeId: integer("office_id")
      .notNull()
      .references(() => officesTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // The unique constraint on (customer_user_id, office_id) already acts as a
    // composite index covering queries filtered by customer_user_id alone.
    // Add a separate index for office_id to support reverse lookups
    // (e.g. "how many customers have favourited this office").
    unique().on(table.customerUserId, table.officeId),
    index("idx_favourites_office_id").on(table.officeId),
  ],
);

export const insertFavouriteSchema = createInsertSchema(favouritesTable).omit(
  { id: true, createdAt: true },
);
export type InsertFavourite = z.infer<typeof insertFavouriteSchema>;
export type Favourite = typeof favouritesTable.$inferSelect;
