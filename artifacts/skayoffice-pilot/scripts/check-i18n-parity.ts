/**
 * MED-05: Translation key parity check.
 *
 * Ensures every key in the `translations` map has non-empty text for BOTH
 * 'ar' and 'en'.  Run with:
 *   npx tsx scripts/check-i18n-parity.ts
 *
 * Add to CI or as a pre-commit hook:
 *   "check-i18n": "tsx scripts/check-i18n-parity.ts"
 */

import { translations } from '../src/lib/i18n';

let errors = 0;
const keys = Object.keys(translations) as (keyof typeof translations)[];

for (const key of keys) {
  const entry = translations[key];
  if (!entry.ar || entry.ar.trim() === '') {
    console.error(`[MISSING AR] ${key}`);
    errors++;
  }
  if (!entry.en || entry.en.trim() === '') {
    console.error(`[MISSING EN] ${key}`);
    errors++;
  }
}

if (errors > 0) {
  console.error(`\n❌ ${errors} translation gap(s) found across ${keys.length} keys.`);
  process.exit(1);
} else {
  console.log(`✅ All ${keys.length} translation keys have AR + EN text.`);
}
