/**
 * One-time migration: adds image-optimisation variant columns.
 * Run with: pnpm --filter @workspace/api-server tsx src/scripts/migrate-image-variants.ts
 */
import { pool } from "@workspace/db";

async function run() {
  const client = await pool.connect();
  try {
    await client.query(`
      ALTER TABLE offices
        ADD COLUMN IF NOT EXISTS cover_variants jsonb,
        ADD COLUMN IF NOT EXISTS pending_quick_card_cover_variants jsonb;
      ALTER TABLE office_media
        ADD COLUMN IF NOT EXISTS variants jsonb;
    `);
    console.log("Migration applied: cover_variants, pending_quick_card_cover_variants, office_media.variants");
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => { console.error(err); process.exit(1); });
