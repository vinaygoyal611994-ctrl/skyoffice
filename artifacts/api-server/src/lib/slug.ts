import { db, officesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Minimal structural type covering both the top-level `db` and any Drizzle
 * transaction object. Both expose the same `select` method at runtime; this
 * type lets callers pass either when performing uniqueness checks inside a
 * transaction (CRIT-01 fix).
 */
type SelectableDB = Pick<typeof db, "select">;

/**
 * Route segments and app-level paths that must never be used as an office slug.
 * A slug matching any of these would hijack a first-party route (e.g. /office/admin,
 * /office/dashboard, /office/discover) and break navigation.  (MED-13)
 */
const RESERVED_SLUGS = new Set([
  "admin",       "dashboard",   "api",          "auth",
  "login",       "logout",      "register",     "discover",
  "favourites",  "favorites",   "account",      "office",
  "offices",     "home",        "about",        "terms",
  "privacy",     "forgot-password", "reset-password",
  "ar",          "en",          "storage",      "assets",
  "static",      "public",      "media",        "support",
  "help",        "contact",     "blog",         "app",
  "www",         "portal",      "customer",
]);

/**
 * Converts an office's (English) name into a URL-safe base slug, e.g.
 * "Levant Bridge Translation" -> "levant-bridge-translation".
 * Not guaranteed unique on its own — see `generateUniqueOfficeSlug`.
 */
export function slugify(input: string): string {
  const base = input
    .normalize("NFKD")
    // Strip diacritics from transliterated Latin names; Arabic-only names
    // (no Latin base form) fall through to the numeric fallback below.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return base || "office";
}

/**
 * Generates a slug for an office that is guaranteed unique among existing
 * offices, appending "-2", "-3", etc. on collision. Call once at office
 * creation time — slugs are intentionally never regenerated on rename, so
 * a link/QR code already shared or printed keeps working indefinitely.
 *
 * `idHint`, when provided, is used as the slug base for names with no
 * Latin characters at all (e.g. Arabic-only office names), producing
 * "office-42" instead of every such office colliding down to
 * "office-2", "office-3", etc.
 *
 * `queryDb`, when provided, should be the active transaction object so the
 * uniqueness check participates in the same transaction as the INSERT.
 * Defaults to the module-level `db` for backward-compatible call-sites that
 * don't need transactional uniqueness.
 */
export async function generateUniqueOfficeSlug(
  name: string,
  idHint?: number,
  queryDb: SelectableDB = db,
): Promise<string> {
  const slugified = slugify(name);
  // Arabic-only (or otherwise non-Latin) names strip down to "office" (the
  // internal empty-string fallback in `slugify`), a bare number, or another
  // too-short/non-descriptive fragment. Prefer a stable "office-<id>" base
  // for those instead of a near-meaningless or colliding slug.
  const isWeak = slugified === "office" || !/[a-z]/.test(slugified) || slugified.length < 3;
  const base = isWeak && idHint !== undefined ? `office-${idHint}` : slugified;
  let candidate = base;
  let suffix = 2;

  // Small, bounded table in practice; a loop of individual existence checks
  // is simpler and safer here than a single query with wildcard matching.
  // MED-13: also skip reserved route segments so an office slug never
  // shadows a first-party path (e.g. /office/admin, /office/dashboard).
  while (true) {
    if (!RESERVED_SLUGS.has(candidate)) {
      const [existing] = await queryDb
        .select({ id: officesTable.id })
        .from(officesTable)
        .where(eq(officesTable.slug, candidate));
      if (!existing) return candidate;
    }
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
}
