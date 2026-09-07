import {
  boolean,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * plans — Subscription plan catalog.
 *
 * Price is stored in the smallest currency unit (e.g. halalas for SAR, cents for USD)
 * to avoid floating-point representation issues.
 *
 * country_code = NULL  → applies to all countries
 * provider_type = NULL → applies to all provider types (office, freelancer)
 */
export const plansTable = pgTable("plans", {
  id:              serial("id").primaryKey(),
  name:            text("name").notNull(),
  nameAr:          text("name_ar").notNull(),
  description:     text("description"),
  descriptionAr:   text("description_ar"),
  // Price in smallest currency unit (100 halalas = 1 SAR, 100 cents = 1 USD)
  monthlyPrice:    integer("monthly_price").notNull().default(0),
  currency:        text("currency").notNull().default("SAR"),
  billingInterval: text("billing_interval").notNull().default("monthly"),
  isActive:        boolean("is_active").notNull().default(true),
  // NULL = applies to all countries / provider types
  countryCode:     text("country_code"),
  providerType:    text("provider_type"),
  sortOrder:       integer("sort_order").notNull().default(0),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
});

export type Plan = typeof plansTable.$inferSelect;
export type PlanInsert = typeof plansTable.$inferInsert;
