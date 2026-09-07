import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: "./src/schema/index.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // All generated migration SQL files land here. Never delete or reorder
  // these — Drizzle applies them in filename order and tracks applied ones
  // in the __drizzle_migrations table.
  out: "./migrations",
});
