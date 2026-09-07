/**
 * Manually stamp a migration as applied without executing it.
 *
 * Use this ONLY after manually reviewing and applying a migration that the
 * automated runner blocked (e.g. one containing DROP COLUMN that was
 * intentional and approved).
 *
 * Usage:
 *   DATABASE_URL=<url> tsx scripts/src/stamp-migration.ts <migration-tag>
 *
 * Example:
 *   DATABASE_URL=$DATABASE_URL tsx scripts/src/stamp-migration.ts 0001_add_new_column
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../lib/db/migrations");

async function main(): Promise<void> {
  const tag = process.argv[2];
  if (!tag) {
    console.error("Usage: tsx scripts/src/stamp-migration.ts <migration-tag>");
    console.error("Example: tsx scripts/src/stamp-migration.ts 0001_add_column");
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("ERROR: DATABASE_URL environment variable is required.");
    process.exit(1);
  }

  const sqlPath = path.join(MIGRATIONS_DIR, `${tag}.sql`);
  let sql: string;
  try {
    sql = await readFile(sqlPath, "utf-8");
  } catch {
    console.error(`ERROR: Migration file not found: ${sqlPath}`);
    process.exit(1);
  }

  const hash = createHash("sha256").update(sql).digest("hex");

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
        id       serial  PRIMARY KEY,
        hash     text    NOT NULL UNIQUE,
        tag      text    NOT NULL,
        created_at bigint NOT NULL
      )
    `);

    const result = await client.query(
      `INSERT INTO "__drizzle_migrations" (hash, tag, created_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (hash) DO NOTHING
       RETURNING id`,
      [hash, tag, Date.now()],
    );

    if (result.rowCount && result.rowCount > 0) {
      console.log(`✓ Stamped migration as applied: ${tag}`);
      console.log(`  Hash: ${hash}`);
    } else {
      console.log(`Migration already recorded: ${tag} (hash: ${hash})`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Stamp failed:", err.message);
  process.exit(1);
});
