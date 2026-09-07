// The `offices.city` column only stores a single string per office (no
// `cityAr` column — schema is intentionally not being changed for this fix).
// Curated offices store their city in English ("Amman", "Riyadh", ...);
// some records store it in Arabic instead. Either way, without this map an
// Arabic-typed city name can never match an English-stored city value (and
// vice versa), which made search silently fail to narrow results for
// Arabic-language users. This is a static, code-only alias table — no
// database change — used to expand a typed search term into its known
// city-name equivalents before matching.
const CITY_SYNONYM_GROUPS: string[][] = [
  ["Amman", "عمان"],
  ["Dubai", "دبي"],
  ["Kuwait City", "مدينة الكويت", "الكويت"],
  ["Cairo", "القاهرة"],
  ["Abu Dhabi", "أبوظبي", "أبو ظبي"],
  ["Beirut", "بيروت"],
  ["Riyadh", "الرياض"],
  ["Doha", "الدوحة"],
  ["Muscat", "مسقط"],
  ["Mecca", "مكة", "Makkah"],
  ["Jeddah", "جدة"],
];

/**
 * Given a raw search term, returns any known city-name synonyms it matches
 * (in either direction, case-insensitive substring match), excluding the
 * original term itself. Returns an empty array if the term doesn't match
 * any known city.
 */
export function expandCitySynonyms(term: string): string[] {
  const normalized = term.trim().toLowerCase();
  if (!normalized) return [];

  const matches = new Set<string>();
  for (const group of CITY_SYNONYM_GROUPS) {
    const groupMatches = group.some((variant) => {
      const v = variant.toLowerCase();
      return v.includes(normalized) || normalized.includes(v);
    });
    if (groupMatches) {
      for (const variant of group) {
        if (variant.toLowerCase() !== normalized) matches.add(variant);
      }
    }
  }
  return Array.from(matches);
}
