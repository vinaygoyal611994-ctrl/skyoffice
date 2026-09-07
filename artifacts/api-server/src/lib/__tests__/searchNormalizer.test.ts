/**
 * Unit tests — searchNormalizer.ts
 *
 * Covers:
 *   - normalizeSearchQuery: Arabic normalization, Latin lowercase, PII masking,
 *     whitespace collapse, truncation, empty-string handling
 *   - detectQueryLanguage: ar / en / mixed / null classification
 *   - classifyCityId: Arabic + English aliases (KSA + UAE)
 *   - classifyCategoryId: Arabic + English aliases (all categories)
 *   - classifySearchIntent: all intent patterns + unknown fallback
 *   - prepareOriginalQuery: trim + truncate, no masking
 */

import { describe, it, expect } from "vitest";
import {
  normalizeSearchQuery,
  detectQueryLanguage,
  classifyCityId,
  classifyCategoryId,
  classifySearchIntent,
  prepareOriginalQuery,
} from "../searchNormalizer";

// ── normalizeSearchQuery ──────────────────────────────────────────────────────

describe("normalizeSearchQuery", () => {
  // Empty / whitespace
  it("returns empty string for empty input", () => {
    expect(normalizeSearchQuery("")).toBe("");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(normalizeSearchQuery("   ")).toBe("");
  });

  // Whitespace normalization
  it("collapses internal whitespace runs to a single space", () => {
    // Note: ة (ta-marbuta) is normalized to ه, so ترجمة → ترجمه
    expect(normalizeSearchQuery("مكتب   ترجمة")).toBe("مكتب ترجمه");
  });

  it("trims leading/trailing whitespace", () => {
    expect(normalizeSearchQuery("  design  ")).toBe("design");
  });

  // Latin lowercase
  it("lowercases Latin characters", () => {
    expect(normalizeSearchQuery("LAWYER Riyadh")).toBe("lawyer riyadh");
  });

  it("lowercases mixed case", () => {
    expect(normalizeSearchQuery("Legal Services")).toBe("legal services");
  });

  // Arabic: diacritics (tashkeel) removal
  it("removes fatha (ـَ)", () => {
    // مَكتب → مكتب
    const withDiacritic = "\u0645\u064E\u0643\u062A\u0628"; // مَكتب
    expect(normalizeSearchQuery(withDiacritic)).toBe("مكتب");
  });

  it("removes kasra (ـِ)", () => {
    const withKasra = "\u0645\u0643\u062A\u0628\u0650"; // مكتبِ
    expect(normalizeSearchQuery(withKasra)).toBe("مكتب");
  });

  it("removes shadda (ـّ)", () => {
    const withShadda = "\u0645\u062D\u0627\u0645\u0651\u064A"; // محامّي
    const withoutShadda = "\u0645\u062D\u0627\u0645\u064A"; // محامي
    expect(normalizeSearchQuery(withShadda)).toBe(withoutShadda);
  });

  it("removes damma (ـُ)", () => {
    const withDamma = "\u0645\u0643\u062A\u064F\u0628"; // مكتُب
    expect(normalizeSearchQuery(withDamma)).toBe("مكتب");
  });

  it("removes tanwin fath (ـً)", () => {
    const withTanwin = "\u0634\u0643\u0631\u064B\u0627"; // شكرًا
    expect(normalizeSearchQuery(withTanwin)).toBe("شكرا");
  });

  it("removes superscript alef (ٰ)", () => {
    const withSuperAlef = "\u0627\u0644\u0631\u064E\u062D\u0653\u0645\u0646"; // الرَحٓمن
    expect(normalizeSearchQuery(withSuperAlef).includes("\u0653")).toBe(false);
  });

  // Arabic: tatweel (kashida)
  it("removes tatweel / kashida (ـ)", () => {
    // مـكـتـب → مكتب
    const withTatweel = "\u0645\u0640\u0643\u0640\u062A\u0640\u0628";
    expect(normalizeSearchQuery(withTatweel)).toBe("مكتب");
  });

  // Arabic: Alef variants normalization
  it("normalizes ألف with hamza above (أ U+0623) → alef (ا)", () => {
    // أبوظبي → ابوظبي
    expect(normalizeSearchQuery("\u0623\u0628\u0648\u0638\u0628\u064A")).toBe(
      "\u0627\u0628\u0648\u0638\u0628\u064A",
    );
  });

  it("normalizes ألف with hamza below (إ U+0625) → alef (ا)", () => {
    expect(normalizeSearchQuery("\u0625\u0646\u062C\u0644\u064A\u0632\u064A")).toBe(
      "\u0627\u0646\u062C\u0644\u064A\u0632\u064A",
    );
  });

  it("normalizes ألف madd (آ U+0622) → alef (ا)", () => {
    // آرا → ارا
    expect(normalizeSearchQuery("\u0622\u0631\u0627")).toBe("\u0627\u0631\u0627");
  });

  it("normalizes alef wasla (ٱ U+0671) → alef (ا)", () => {
    expect(normalizeSearchQuery("\u0671\u0644\u0644\u0647")).toBe("\u0627\u0644\u0644\u0647");
  });

  // Arabic: Ya / Alef maqsura
  it("normalizes alef maqsura (ى U+0649) → ya (ي)", () => {
    // مستشفى → مستشفي
    const withAlefMaqsura = "\u0645\u0633\u062A\u0634\u0641\u0649";
    const normalized = "\u0645\u0633\u062A\u0634\u0641\u064A";
    expect(normalizeSearchQuery(withAlefMaqsura)).toBe(normalized);
  });

  // Arabic: Ta marbuta
  it("normalizes ta marbuta (ة U+0629) → ha (ه)", () => {
    // ترجمة → ترجمه
    const withTaMarbuta = "\u062A\u0631\u062C\u0645\u0629";
    const normalized = "\u062A\u0631\u062C\u0645\u0647";
    expect(normalizeSearchQuery(withTaMarbuta)).toBe(normalized);
  });

  // PII masking
  it("masks Saudi phone numbers with country code", () => {
    const result = normalizeSearchQuery("call +966501234567 for info");
    expect(result).toContain("[MASKED_CONTACT]");
    expect(result).not.toContain("966501234567");
  });

  it("masks email addresses", () => {
    const result = normalizeSearchQuery("contact me at user@example.com please");
    expect(result).toContain("[MASKED_CONTACT]");
    expect(result).not.toContain("user@example.com");
  });

  it("masks URLs", () => {
    const result = normalizeSearchQuery("visit https://example.com/page");
    expect(result).toContain("[MASKED_CONTACT]");
    expect(result).not.toContain("https://");
  });

  it("masks long standalone numeric sequences (7+ digits)", () => {
    const result = normalizeSearchQuery("id 1234567890");
    expect(result).toContain("[MASKED_CONTACT]");
    expect(result).not.toContain("1234567890");
  });

  it("does NOT mask short numeric strings (4 digits)", () => {
    // 4-digit numbers are safe (e.g. years)
    const result = normalizeSearchQuery("2024 riyadh");
    expect(result).not.toContain("[MASKED_CONTACT]");
    expect(result).toBe("2024 riyadh");
  });

  // Truncation (MAX_SEARCH_QUERY_LENGTH = 200)
  it("truncates queries longer than 200 characters", () => {
    const long = "a".repeat(250);
    const result = normalizeSearchQuery(long);
    expect(result.length).toBeLessThanOrEqual(200);
  });

  it("does not truncate queries at exactly 200 characters", () => {
    const exactly200 = "a".repeat(200);
    expect(normalizeSearchQuery(exactly200)).toBe(exactly200);
  });

  // Combined scenarios
  it("applies full pipeline: Arabic with diacritics + tatweel", () => {
    // مَكـتَب with fatha + tatweel → مكتب (lowercase doesn't affect Arabic)
    const complex = "\u0645\u064E\u0643\u0640\u062A\u064E\u0628";
    expect(normalizeSearchQuery(complex)).toBe("مكتب");
  });

  it("applies full pipeline: Arabic city with ta marbuta + diacritics", () => {
    // ترجمةٌ في الرِيَاض
    const query = "\u062A\u0631\u062C\u0645\u0629\u064C \u0641\u064A \u0627\u0644\u0631\u0650\u064A\u064E\u0627\u0636";
    const result = normalizeSearchQuery(query);
    // ta marbuta → ه, diacritics removed
    expect(result).toContain("ترجمه");
    expect(result).toContain("الرياض");
    expect(result).not.toMatch(/[\u064B-\u065F]/); // no diacritics
  });

  it("handles query with both Arabic and Latin (mixed) content", () => {
    const result = normalizeSearchQuery("محامي Legal");
    expect(result).toBe("محامي legal");
  });
});

// ── prepareOriginalQuery ──────────────────────────────────────────────────────

describe("prepareOriginalQuery", () => {
  it("trims whitespace but does NOT normalize", () => {
    // Diacritics preserved
    const withDiacritics = "  مَكتب  ";
    expect(prepareOriginalQuery(withDiacritics)).toBe("مَكتب");
  });

  it("does NOT mask PII (original is preserved)", () => {
    const raw = "user@email.com";
    expect(prepareOriginalQuery(raw)).toBe("user@email.com");
  });

  it("truncates to 200 characters", () => {
    const long = "b".repeat(300);
    expect(prepareOriginalQuery(long).length).toBe(200);
  });

  it("returns empty string for undefined-like empty", () => {
    expect(prepareOriginalQuery("")).toBe("");
  });
});

// ── detectQueryLanguage ───────────────────────────────────────────────────────

describe("detectQueryLanguage", () => {
  it("returns 'ar' for pure Arabic text (≥80%)", () => {
    expect(detectQueryLanguage("محامي في الرياض")).toBe("ar");
  });

  it("returns 'en' for pure English text (≤20% Arabic)", () => {
    expect(detectQueryLanguage("legal services riyadh")).toBe("en");
  });

  it("returns 'mixed' for mixed Arabic-English content", () => {
    // ~50% each
    expect(detectQueryLanguage("محامي lawyer")).toBe("mixed");
  });

  it("returns null for empty string", () => {
    expect(detectQueryLanguage("")).toBeNull();
  });

  it("returns null for numbers-only query", () => {
    expect(detectQueryLanguage("12345")).toBeNull();
  });

  it("returns null for punctuation-only query", () => {
    expect(detectQueryLanguage("...???!")).toBeNull();
  });

  it("returns 'ar' for Arabic text with some numbers", () => {
    expect(detectQueryLanguage("محامي 2024")).toBe("ar");
  });

  it("returns 'en' for English text with numbers", () => {
    expect(detectQueryLanguage("lawyer 2024")).toBe("en");
  });

  it("handles single Arabic character", () => {
    expect(detectQueryLanguage("م")).toBe("ar");
  });

  it("handles single English character", () => {
    expect(detectQueryLanguage("a")).toBe("en");
  });

  it("returns 'ar' when Arabic chars are ≥80% of total script chars", () => {
    // محاماة = 6 Arabic chars, "a" = 1 Latin char → 6/7 = 85.7% Arabic → 'ar'
    expect(detectQueryLanguage("محاماة a")).toBe("ar");
  });
});

// ── classifyCityId ────────────────────────────────────────────────────────────

describe("classifyCityId", () => {
  // KSA - English
  it("matches 'riyadh' exactly", () => {
    expect(classifyCityId("riyadh")).toBe("riyadh");
  });

  it("matches 'jeddah' and variant 'jidda'", () => {
    // "jiddah" contains "jidda" as a substring → correctly matches jeddah
    expect(classifyCityId("jiddah")).toBe("jeddah");
    expect(classifyCityId("jidda")).toBe("jeddah");
    expect(classifyCityId("jeddah")).toBe("jeddah");
  });

  it("matches 'mecca' and 'makkah'", () => {
    expect(classifyCityId("mecca")).toBe("mecca");
    expect(classifyCityId("makkah")).toBe("mecca");
  });

  it("matches 'dammam'", () => {
    expect(classifyCityId("dammam")).toBe("dammam");
  });

  it("matches 'khobar' and 'khubar'", () => {
    expect(classifyCityId("khobar")).toBe("khobar");
    expect(classifyCityId("khubar")).toBe("khobar");
  });

  // UAE - English
  it("matches 'dubai'", () => {
    expect(classifyCityId("dubai")).toBe("dubai");
  });

  it("matches 'abu dhabi' and variants", () => {
    expect(classifyCityId("abu dhabi")).toBe("abu_dhabi");
    expect(classifyCityId("abudhabi")).toBe("abu_dhabi");
  });

  it("matches 'sharjah'", () => {
    expect(classifyCityId("sharjah")).toBe("sharjah");
  });

  it("matches 'ras al khaimah' and 'rak'", () => {
    expect(classifyCityId("ras al khaimah")).toBe("ras_al_khaimah");
    expect(classifyCityId("rak")).toBe("ras_al_khaimah");
  });

  // KSA - Arabic
  it("matches 'الرياض'", () => {
    expect(classifyCityId("الرياض")).toBe("riyadh");
  });

  it("matches 'جدة'", () => {
    expect(classifyCityId("جدة")).toBe("jeddah");
  });

  it("matches 'مكة'", () => {
    expect(classifyCityId("مكة")).toBe("mecca");
  });

  it("matches 'الدمام'", () => {
    expect(classifyCityId("الدمام")).toBe("dammam");
  });

  // UAE - Arabic
  it("matches 'دبي'", () => {
    expect(classifyCityId("دبي")).toBe("dubai");
  });

  it("matches 'أبوظبي'", () => {
    expect(classifyCityId("أبوظبي")).toBe("abu_dhabi");
  });

  // Substring matching in context
  it("matches city name as part of a longer query", () => {
    expect(classifyCityId("محامي في الرياض")).toBe("riyadh");
  });

  it("matches English city in a mixed query", () => {
    expect(classifyCityId("lawyer in riyadh")).toBe("riyadh");
  });

  // No match
  it("returns null for unrecognized city", () => {
    expect(classifyCityId("london")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(classifyCityId("")).toBeNull();
  });
});

// ── classifyCategoryId ────────────────────────────────────────────────────────

describe("classifyCategoryId", () => {
  // Arabic category terms
  it("classifies 'ترجمة' as translation", () => {
    expect(classifyCategoryId("ترجمة")).toBe("translation");
  });

  it("classifies 'محامي' as legal", () => {
    expect(classifyCategoryId("محامي")).toBe("legal");
  });

  it("classifies 'تسويق' as marketing", () => {
    expect(classifyCategoryId("تسويق")).toBe("marketing");
  });

  it("classifies 'برمجة' as development", () => {
    expect(classifyCategoryId("برمجة")).toBe("development");
  });

  it("classifies 'تصميم' as design", () => {
    expect(classifyCategoryId("تصميم")).toBe("design");
  });

  it("classifies 'عقارات' as real_estate", () => {
    expect(classifyCategoryId("عقارات")).toBe("real_estate");
  });

  it("classifies 'استشارات' as business_consulting", () => {
    expect(classifyCategoryId("استشارات")).toBe("business_consulting");
  });

  it("classifies 'محاسبة' as accounting", () => {
    expect(classifyCategoryId("محاسبة")).toBe("accounting");
  });

  it("classifies 'ضريبة' as accounting (VAT-related)", () => {
    expect(classifyCategoryId("ضريبة")).toBe("accounting");
  });

  it("classifies 'سوشيال' as social_media_management", () => {
    expect(classifyCategoryId("سوشيال")).toBe("social_media_management");
  });

  // English category terms
  it("classifies 'translation' as translation", () => {
    expect(classifyCategoryId("translation")).toBe("translation");
  });

  it("classifies 'lawyer' as legal", () => {
    expect(classifyCategoryId("lawyer")).toBe("legal");
  });

  it("classifies 'marketing' as marketing", () => {
    expect(classifyCategoryId("marketing")).toBe("marketing");
  });

  it("classifies 'development' as development", () => {
    expect(classifyCategoryId("development")).toBe("development");
  });

  it("classifies 'design' as design", () => {
    expect(classifyCategoryId("design")).toBe("design");
  });

  it("classifies 'real estate' as real_estate", () => {
    expect(classifyCategoryId("real estate")).toBe("real_estate");
  });

  it("classifies 'accounting' as accounting", () => {
    expect(classifyCategoryId("accounting")).toBe("accounting");
  });

  it("classifies 'social media' as social_media_management", () => {
    expect(classifyCategoryId("social media")).toBe("social_media_management");
  });

  // In query context
  it("classifies from longer Arabic query", () => {
    expect(classifyCategoryId("أبحث عن محامي في الرياض")).toBe("legal");
  });

  it("classifies from longer English query", () => {
    expect(classifyCategoryId("best translation office in dubai")).toBe("translation");
  });

  // No match
  it("returns null for unrecognized category", () => {
    expect(classifyCategoryId("plumber near me")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(classifyCategoryId("")).toBeNull();
  });
});

// ── classifySearchIntent ──────────────────────────────────────────────────────

describe("classifySearchIntent", () => {
  it("classifies 'nearest' queries as find_nearest (English)", () => {
    const result = classifySearchIntent("lawyer nearest to me");
    expect(result.intent).toBe("find_nearest");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("classifies 'قريب' queries as find_nearest (Arabic)", () => {
    const result = classifySearchIntent("مكتب قريب");
    expect(result.intent).toBe("find_nearest");
  });

  it("classifies 'best' queries as find_highest_rated", () => {
    const result = classifySearchIntent("best translation office");
    expect(result.intent).toBe("find_highest_rated");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("classifies 'أفضل' queries as find_highest_rated (Arabic)", () => {
    const result = classifySearchIntent("أفضل محامي");
    expect(result.intent).toBe("find_highest_rated");
  });

  it("classifies 'service' queries as find_specific_service", () => {
    const result = classifySearchIntent("translation service riyadh");
    expect(result.intent).toBe("find_specific_service");
  });

  it("classifies 'compare' queries as compare_offices", () => {
    const result = classifySearchIntent("compare legal offices");
    expect(result.intent).toBe("compare_offices");
  });

  it("classifies 'office'/'مكتب' queries as find_office", () => {
    const result = classifySearchIntent("مكتب ترجمة");
    expect(result.intent).toBe("find_office");
  });

  it("returns 'unknown' with confidence 0 for no match", () => {
    const result = classifySearchIntent("riyadh");
    expect(result.intent).toBe("unknown");
    expect(result.confidence).toBe(0);
  });

  it("returns confidence > 0 for any matched intent", () => {
    const result = classifySearchIntent("nearest lawyer");
    expect(result.confidence).toBeGreaterThan(0);
  });

  // Intent priorities (first match wins)
  it("returns find_nearest before find_highest_rated when both match", () => {
    // "أقرب وأفضل" — has both nearest and best
    const result = classifySearchIntent("أقرب وأفضل محامي");
    // find_nearest comes first in pattern list
    expect(result.intent).toBe("find_nearest");
  });
});
