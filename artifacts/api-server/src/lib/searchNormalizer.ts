/**
 * Search query normalization for SkayOffice analytics.
 *
 * Applies normalization to raw search queries before storage in
 * analytics_events.search_query_normalized. The original is always
 * preserved in search_query_original (trimmed only, never masked).
 *
 * Normalization pipeline (in order):
 *   1. Trim leading/trailing whitespace
 *   2. Collapse internal whitespace runs to single spaces
 *   3. Arabic-specific normalization:
 *      a. Remove tatweel (kashida) — ـ
 *      b. Remove diacritics (tashkeel) — harakat + shadda + etc.
 *      c. Hamza / alef normalization: أإآٱ → ا
 *      d. Ya / alef-maqsura normalization: ى → ي
 *      e. Ta marbuta normalization: ة → ه
 *   4. Latin normalization: lowercase
 *   5. PII masking: phone numbers, emails, URLs, long numeric strings
 *      → "[MASKED_CONTACT]"
 *   6. Truncation to MAX_SEARCH_QUERY_LENGTH (applied to both original
 *      and normalized before storage by the caller)
 *
 * This file also exports:
 *   - detectQueryLanguage(raw): 'ar' | 'en' | 'mixed' | null
 *   - classifyCityId(query): stable city key or null
 *   - classifyCategoryId(query): stable category key or null
 */

import { MAX_SEARCH_QUERY_LENGTH } from "./analyticsConfig";

// ── PII masking patterns ──────────────────────────────────────────────────────

/** Replace pattern with this sentinel to signal masked PII. */
const MASKED_SENTINEL = "[MASKED_CONTACT]";

const PII_PATTERNS: RegExp[] = [
  // Saudi / UAE / international mobile phone numbers
  /(?:^|\s)[\+]?[\d\s\-\(\)]{9,15}(?:\s|$)/g,
  // Email addresses
  /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
  // URLs
  /https?:\/\/[^\s]+/g,
  // Standalone long numeric sequences (7+ digits) that are likely IDs/phones
  /(?<!\w)\d{7,}(?!\w)/g,
];

function maskPii(text: string): string {
  let result = text;
  for (const pattern of PII_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    result = result.replace(pattern, ` ${MASKED_SENTINEL} `);
  }
  // Collapse any double spaces introduced by masking
  return result.replace(/\s{2,}/g, " ").trim();
}

// ── Arabic normalization ──────────────────────────────────────────────────────

/** Arabic diacritics (tashkeel) Unicode range */
const ARABIC_DIACRITICS_RE = /[\u064B-\u065F\u0670]/g;

/** Tatweel (kashida) */
const ARABIC_TATWEEL_RE = /\u0640/g;

/** Alef variants → ا */
const ALEF_VARIANTS_RE = /[\u0623\u0625\u0622\u0671]/g;  // أ إ آ ٱ → ا

/** Ya / alef maqsura → ي */
const ALEF_MAQSURA_RE = /\u0649/g;  // ى → ي

/** Ta marbuta → ه */
const TA_MARBUTA_RE = /\u0629/g;  // ة → ه

function normalizeArabic(text: string): string {
  return text
    .replace(ARABIC_TATWEEL_RE, "")
    .replace(ARABIC_DIACRITICS_RE, "")
    .replace(ALEF_VARIANTS_RE, "\u0627")
    .replace(ALEF_MAQSURA_RE, "\u064A")
    .replace(TA_MARBUTA_RE, "\u0647");
}

// ── Language detection ────────────────────────────────────────────────────────

/** Arabic Unicode block range (basic Arabic characters) */
const ARABIC_CHAR_RE = /[\u0600-\u06FF]/g;
/** Latin script range */
const LATIN_CHAR_RE = /[a-zA-Z]/g;

/**
 * Detect primary language of a search query.
 * Returns null if the query is empty or contains only numbers/punctuation.
 */
export function detectQueryLanguage(
  raw: string,
): "ar" | "en" | "mixed" | null {
  const stripped = raw.replace(/[\s\d\p{P}]/gu, "");
  if (!stripped) return null;

  const arabicChars = (stripped.match(ARABIC_CHAR_RE) ?? []).length;
  const latinChars = (stripped.match(LATIN_CHAR_RE) ?? []).length;
  const total = arabicChars + latinChars;

  if (total === 0) return null;
  const arabicRatio = arabicChars / total;

  if (arabicRatio >= 0.8) return "ar";
  if (arabicRatio <= 0.2) return "en";
  return "mixed";
}

// ── City classification ───────────────────────────────────────────────────────
// Stable city keys (lowercase, no spaces). Maps common spellings to the
// canonical key used in analytics_events.city_id.

const CITY_ALIASES: Record<string, string> = {
  // KSA
  "riyadh": "riyadh", "الرياض": "riyadh", "رياض": "riyadh",
  "jeddah": "jeddah", "جدة": "jeddah", "jidda": "jeddah", "jedda": "jeddah",
  "mecca": "mecca", "makkah": "mecca", "مكة": "mecca", "مكه": "mecca", "مكة المكرمة": "mecca",
  "medina": "medina", "madinah": "medina", "المدينة": "medina", "المدينه": "medina", "المدينة المنورة": "medina",
  "dammam": "dammam", "الدمام": "dammam",
  "khobar": "khobar", "الخبر": "khobar", "khubar": "khobar",
  "dhahran": "dhahran", "الظهران": "dhahran",
  "jubail": "jubail", "الجبيل": "jubail",
  "abha": "abha", "أبها": "abha",
  "taif": "taif", "الطائف": "taif",
  "tabuk": "tabuk", "تبوك": "tabuk",
  "qassim": "qassim", "القصيم": "qassim", "buraydah": "qassim", "بريدة": "qassim",
  "hail": "hail", "حائل": "hail",
  "najran": "najran", "نجران": "najran",
  "jizan": "jizan", "جازان": "jizan",
  // UAE
  "dubai": "dubai", "دبي": "dubai",
  "abu dhabi": "abu_dhabi", "أبوظبي": "abu_dhabi", "أبو ظبي": "abu_dhabi", "abudhabi": "abu_dhabi",
  "sharjah": "sharjah", "الشارقة": "sharjah", "sharqa": "sharjah",
  "ajman": "ajman", "عجمان": "ajman",
  "fujairah": "fujairah", "الفجيرة": "fujairah",
  "ras al khaimah": "ras_al_khaimah", "رأس الخيمة": "ras_al_khaimah", "rak": "ras_al_khaimah",
  "umm al quwain": "umm_al_quwain", "أم القيوين": "umm_al_quwain",
};

/**
 * Attempt to classify a query as referring to a known city.
 * Returns the stable city_id key or null.
 */
export function classifyCityId(normalized: string): string | null {
  const lower = normalized.toLowerCase().trim();
  // Direct match or key contained in the query
  for (const [alias, cityId] of Object.entries(CITY_ALIASES)) {
    if (lower === alias || lower.includes(alias)) return cityId;
  }
  return null;
}

// ── Category classification ───────────────────────────────────────────────────
// Maps common Arabic/English category-related terms to the stable officeCategoryEnum keys.

const CATEGORY_ALIASES: Record<string, string> = {
  // Translation
  "ترجمة": "translation", "مترجم": "translation", "translation": "translation", "translator": "translation",
  // Legal
  "محامي": "legal", "محاماة": "legal", "قانوني": "legal", "legal": "legal", "lawyer": "legal", "attorney": "legal", "محكمة": "legal",
  // Marketing
  "تسويق": "marketing", "إعلان": "marketing", "marketing": "marketing", "advertising": "marketing",
  // Development
  "برمجة": "development", "تطوير": "development", "development": "development", "تطبيق": "development", "موقع": "development",
  // Design
  "تصميم": "design", "design": "design", "مصمم": "design",
  // Real estate
  "عقار": "real_estate", "عقارات": "real_estate", "real estate": "real_estate", "realty": "real_estate",
  // Company formation
  "تأسيس شركة": "company_formation", "استثمار": "company_formation", "company formation": "company_formation",
  // Business consulting
  "استشارات": "business_consulting", "consulting": "business_consulting", "استشارة": "business_consulting",
  // Accounting
  "محاسبة": "accounting", "accounting": "accounting", "محاسب": "accounting", "ضريبة": "accounting", "ضرائب": "accounting",
  // Social media
  "سوشيال": "social_media_management", "سوشال": "social_media_management", "social media": "social_media_management", "انستجرام": "social_media_management",
};

/**
 * Attempt to classify a query as referring to a known office category.
 * Returns the stable category key or null.
 */
export function classifyCategoryId(normalized: string): string | null {
  const lower = normalized.toLowerCase().trim();
  for (const [alias, categoryId] of Object.entries(CATEGORY_ALIASES)) {
    if (lower.includes(alias)) return categoryId;
  }
  return null;
}

// ── Main normalization function ───────────────────────────────────────────────

/**
 * Normalize a raw search query for storage in analytics_events.search_query_normalized.
 *
 * The raw query is preserved as-is (trimmed) in search_query_original.
 * This function produces the normalized form used for aggregation and comparison.
 *
 * @param raw - The raw search string as entered by the user.
 * @returns The normalized string, or "" for empty/whitespace-only input.
 */
export function normalizeSearchQuery(raw: string): string {
  if (!raw || !raw.trim()) return "";

  let result = raw.trim();
  // Collapse internal whitespace
  result = result.replace(/\s+/g, " ");
  // Arabic normalization
  result = normalizeArabic(result);
  // Latin lowercase
  result = result.toLowerCase();
  // PII masking
  result = maskPii(result);
  // Truncate
  if (result.length > MAX_SEARCH_QUERY_LENGTH) {
    result = result.slice(0, MAX_SEARCH_QUERY_LENGTH);
  }

  return result.trim();
}

/**
 * Prepare the raw query for storage in search_query_original.
 * Only trims and truncates — does NOT normalize, mask, or modify content.
 */
export function prepareOriginalQuery(raw: string): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  return trimmed.length > MAX_SEARCH_QUERY_LENGTH
    ? trimmed.slice(0, MAX_SEARCH_QUERY_LENGTH)
    : trimmed;
}

// ── Intent classification ─────────────────────────────────────────────────────
// Rule-based, version 1.0. Confidence is low (0.3–0.6) for rules-based heuristics.

interface IntentResult {
  intent: string;
  confidence: number;
}

const INTENT_PATTERNS: Array<{
  intent: string;
  patterns: RegExp[];
  confidence: number;
}> = [
  {
    intent: "find_nearest",
    patterns: [/قريب/i, /nearest/i, /nearby/i, /أقرب/i, /قريباً/i],
    confidence: 0.7,
  },
  {
    intent: "find_highest_rated",
    patterns: [/أفضل/i, /best/i, /top/i, /موثوق/i, /تقييم/i, /rated/i],
    confidence: 0.6,
  },
  {
    intent: "find_specific_service",
    patterns: [/خدمة/i, /service/i, /تخصص/i, /specialist/i, /expert/i, /متخصص/i],
    confidence: 0.5,
  },
  {
    intent: "compare_offices",
    patterns: [/مقارنة/i, /compare/i, /vs\b/i, /versus/i, /أم\s/i],
    confidence: 0.5,
  },
  {
    intent: "find_office",
    patterns: [/مكتب/i, /office/i, /شركة/i, /company/i, /firm/i],
    confidence: 0.4,
  },
];

/**
 * Classify the intent of a search query.
 * Returns 'unknown' when no pattern matches.
 */
export function classifySearchIntent(normalized: string): IntentResult {
  for (const { intent, patterns, confidence } of INTENT_PATTERNS) {
    if (patterns.some((p) => p.test(normalized))) {
      return { intent, confidence };
    }
  }
  return { intent: "unknown", confidence: 0 };
}
