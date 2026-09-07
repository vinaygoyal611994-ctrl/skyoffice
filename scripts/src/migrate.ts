/**
 * Safe production migration runner for SkayOffice.
 *
 * Replaces `drizzle-kit push` (which can silently DROP tables) with an
 * explicit, reviewed, one-way migration flow:
 *
 *  1. Reads the ordered migration list from lib/db/migrations/meta/_journal.json
 *  2. First run on an existing database (tracking table empty): stamps all
 *     migrations as already-applied WITHOUT executing them — the database was
 *     set up via drizzle-kit push before versioned migrations existed, so its
 *     schema already matches the baseline.
 *  3. Subsequent runs: for each pending migration, checks for destructive DDL
 *     (DROP TABLE, TRUNCATE, DROP COLUMN, DROP SCHEMA). If any found, exits
 *     non-zero with a clear error before touching the database. Safe migrations
 *     are applied and stamped atomically within a transaction.
 *
 * Usage:
 *   DATABASE_URL=<connection-string> tsx scripts/src/migrate.ts
 *
 * To generate a new migration after schema changes:
 *   pnpm --filter @workspace/db run generate
 *   # Review the generated SQL in lib/db/migrations/
 *   # Commit the SQL file before deploying
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../lib/db/migrations");
const JOURNAL_PATH = path.join(MIGRATIONS_DIR, "meta/_journal.json");

// ---------------------------------------------------------------------------
// Destructive DDL patterns — any migration SQL matching one of these causes
// the runner to abort before touching the database. An admin must review and
// manually apply the migration (and then stamp it) if intentionally needed.
// ---------------------------------------------------------------------------
const DESTRUCTIVE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bDROP\s+TABLE\b/i, label: "DROP TABLE" },
  { pattern: /\bDROP\s+SCHEMA\b/i, label: "DROP SCHEMA" },
  { pattern: /\bTRUNCATE\b/i, label: "TRUNCATE" },
  {
    pattern: /\bALTER\s+TABLE\b[^;]*\bDROP\s+COLUMN\b/i,
    label: "ALTER TABLE … DROP COLUMN",
  },
];

type JournalEntry = { idx: number; tag: string; when: number };
type Journal = { entries: JournalEntry[] };

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("ERROR: DATABASE_URL environment variable is required.");
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    // -----------------------------------------------------------------------
    // 1. Ensure the migration-tracking table exists.
    //    This is safe to call on every run — IF NOT EXISTS makes it idempotent.
    // -----------------------------------------------------------------------
    await client.query(`
      CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
        id       serial  PRIMARY KEY,
        hash     text    NOT NULL UNIQUE,
        tag      text    NOT NULL,
        created_at bigint NOT NULL
      )
    `);

    // -----------------------------------------------------------------------
    // 2. Read the ordered migration list from the journal.
    // -----------------------------------------------------------------------
    let journal: Journal;
    try {
      journal = JSON.parse(await readFile(JOURNAL_PATH, "utf-8"));
    } catch {
      console.error(
        `ERROR: Could not read migration journal at ${JOURNAL_PATH}.`,
      );
      console.error(
        "Run `pnpm --filter @workspace/db run generate` to create migrations first.",
      );
      process.exit(1);
    }

    // -----------------------------------------------------------------------
    // 3. Identify which migrations have already been applied.
    // -----------------------------------------------------------------------
    const { rows } = await client.query<{ hash: string; tag: string }>(
      'SELECT hash, tag FROM "__drizzle_migrations" ORDER BY id',
    );
    const appliedHashes = new Set(rows.map((r) => r.hash));

    // -----------------------------------------------------------------------
    // 4. First-ever run on this database (tracking table was just created and
    //    is empty): stamp ALL migrations as applied WITHOUT running them.
    //    The database was previously set up via drizzle-kit push, so the
    //    schema already matches the baseline migration file exactly — re-
    //    running CREATE TABLE statements would fail with "relation already
    //    exists". Stamping records that this history has been processed.
    // -----------------------------------------------------------------------
    if (appliedHashes.size === 0) {
      console.log(
        "First migration run detected. Stamping all existing migrations as applied (schema was previously set up via push)...",
      );
      for (const entry of journal.entries) {
        const sqlPath = path.join(MIGRATIONS_DIR, `${entry.tag}.sql`);
        const sql = await readFile(sqlPath, "utf-8");
        const hash = hashContent(sql);
        await client.query(
          `INSERT INTO "__drizzle_migrations" (hash, tag, created_at)
           VALUES ($1, $2, $3)
           ON CONFLICT (hash) DO NOTHING`,
          [hash, entry.tag, Date.now()],
        );
        console.log(`  Stamped: ${entry.tag}`);
      }
      console.log(
        "All baseline migrations stamped. Future schema changes will be applied as new migration files.",
      );
      return;
    }

    // -----------------------------------------------------------------------
    // 5. Subsequent runs: find pending migrations, safety-check then apply.
    // -----------------------------------------------------------------------
    let appliedCount = 0;

    for (const entry of journal.entries) {
      const sqlPath = path.join(MIGRATIONS_DIR, `${entry.tag}.sql`);
      const sql = await readFile(sqlPath, "utf-8");
      const hash = hashContent(sql);

      if (appliedHashes.has(hash)) continue; // already applied

      console.log(`\nPending migration: ${entry.tag}`);

      // Safety check — abort if destructive DDL found
      for (const { pattern, label } of DESTRUCTIVE_PATTERNS) {
        if (pattern.test(sql)) {
          console.error(
            `\n⛔ SAFETY CHECK FAILED — Migration "${entry.tag}" contains "${label}".`,
          );
          console.error(
            "This migration could destroy production data. It will NOT be applied automatically.",
          );
          console.error(
            "Review the SQL carefully, then apply it manually and record it:",
          );
          console.error(
            `  psql $DATABASE_URL -f lib/db/migrations/${entry.tag}.sql`,
          );
          console.error(
            `  pnpm --filter scripts run stamp -- "${entry.tag}"`,
          );
          process.exit(1);
        }
      }

      // Apply in a transaction so the stamp and the DDL are atomic
      await client.query("BEGIN");
      try {
        const statements = sql
          .split("--> statement-breakpoint")
          .map((s) => s.trim())
          .filter(Boolean);
        for (const statement of statements) {
          await client.query(statement);
        }
        await client.query(
          `INSERT INTO "__drizzle_migrations" (hash, tag, created_at) VALUES ($1, $2, $3)`,
          [hash, entry.tag, Date.now()],
        );
        await client.query("COMMIT");
        console.log(`  ✓ Applied: ${entry.tag}`);
        appliedCount++;
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`  ✗ Failed to apply "${entry.tag}":`, (err as Error).message);
        process.exit(1);
      }
    }

    if (appliedCount === 0) {
      console.log("Database schema is up to date — no migrations to apply.");
    } else {
      console.log(`\n${appliedCount} migration(s) applied successfully.`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Migration runner failed:", err.message);
  process.exit(1);
});
