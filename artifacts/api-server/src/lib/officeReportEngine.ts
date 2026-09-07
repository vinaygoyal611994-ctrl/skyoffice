/**
 * Office Report Engine — Phase 1
 *
 * Pure, side-effect-free functions for the office-facing analytics report.
 * All inputs are plain data; no DB calls here.  The route handler collects
 * data and calls these functions to produce the final response.
 *
 * Keeping this module pure makes it fully testable without a database.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PeriodMetricPair {
  current: number;
  previous: number;
  /** null when both are 0, or when previous=0 and current>0 ("New") */
  change: number | null;
}

export interface RatePair {
  current: number | null;
  previous: number | null;
  change: number | null;
}

export type ActionTarget =
  | "profile"
  | "services"
  | "media"
  | "quick_card"
  | "contact"
  | "location"
  | "copy_link"
  | "public_profile";

export interface Recommendation {
  priority: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
  actionLabelEn: string;
  actionLabelAr: string;
  actionTarget: ActionTarget;
}

export interface TopServiceSignal {
  serviceKey: string;
  nameEn: string;
  nameAr: string;
  count: number;
  share: number; // 0–1
}

export interface TopCitySignal {
  cityId: string;
  nameEn?: string;
  nameAr?: string;
  count: number;
  share: number; // 0–1
}

export interface Opportunity {
  currentRate: number; // 0–1
  targetRate: number;  // 0–1
  estimatedAdditionalContacts: number;
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
}

export interface OfficeReportResponse {
  period: { from: string; to: string; days: number };
  comparisonPeriod: { from: string; to: string };
  dataAvailabilityNote: "full" | "partial" | "none";
  metrics: {
    cardImpressions: PeriodMetricPair;
    profileViews: PeriodMetricPair;
    uniqueVisitors: PeriodMetricPair;
    contactActions: PeriodMetricPair;
    whatsappClicks: PeriodMetricPair;
    phoneClicks: PeriodMetricPair | null; // null when phone calls disabled
    shareClicks: PeriodMetricPair;
    copyLinkClicks: PeriodMetricPair;
    qrVisits: PeriodMetricPair;
    visitToContactRate: RatePair;
  };
  topSignals: {
    topService: TopServiceSignal | null;
    topCity: TopCitySignal | null;
  };
  dailyTrend: Array<{ date: string; profileViews: number; contactActions: number }>;
  recommendation: Recommendation;
  opportunity: Opportunity | null;
}

// ── Thresholds ────────────────────────────────────────────────────────────────

export const THRESHOLDS = {
  MIN_IMPRESSIONS_FOR_RATE_ANALYSIS: 20,
  MIN_PROFILE_VIEWS_FOR_CONVERSION:  10,
  MIN_EVENTS_FOR_SERVICE_SIGNAL:      5,
  MIN_EVENTS_FOR_CITY_SIGNAL:        10,
  INSUFFICIENT_DATA_PROFILE_VIEWS:    5,
  LOW_CTR:                          0.05, // < 5%
  LOW_CONVERSION:                   0.05, // < 5%
  LOW_IMPRESSIONS:                   10,
  DOMINANT_SERVICE_SHARE:           0.60,
  DOMINANT_CITY_SHARE:              0.50,
  OPPORTUNITY_MIN_VIEWS:             20,
  OPPORTUNITY_HIGH_CONVERSION:      0.20,
  OPPORTUNITY_TARGET_STEP:          0.02,
  OPPORTUNITY_BASE_TARGET:          0.10,
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Compute the percentage change between two periods.
 * Returns null when both are 0, or when previous=0 and current>0 ("New").
 * Rounds to the nearest integer.
 */
export function computeChange(current: number, previous: number): number | null {
  if (current === 0 && previous === 0) return null;
  if (previous === 0) return null; // "New" — caller displays this separately
  return Math.round(((current - previous) / previous) * 100);
}

/** Build a PeriodMetricPair from two raw numbers. */
export function metricPair(current: number, previous: number): PeriodMetricPair {
  return { current, previous, change: computeChange(current, previous) };
}

/**
 * Compute visit-to-contact rate pair.
 * Rate is expressed as a value 0–100 (percentage) for display.
 */
export function computeRatePair(
  currentContacts: number, currentViews: number,
  prevContacts: number,    prevViews: number,
): RatePair {
  const cur = currentViews > 0 ? (currentContacts / currentViews) * 100 : null;
  const prv = prevViews    > 0 ? (prevContacts    / prevViews)    * 100 : null;

  let change: number | null = null;
  if (cur !== null && prv !== null && prv > 0) {
    change = Math.round(((cur - prv) / prv) * 100);
  }
  return { current: cur, previous: prv, change };
}

// ── City display name map ─────────────────────────────────────────────────────
// Mirrors the stable keys emitted by classifyCityId() in searchNormalizer.ts.

export const CITY_DISPLAY_NAMES: Record<string, { nameEn: string; nameAr: string }> = {
  riyadh:          { nameEn: "Riyadh",         nameAr: "الرياض" },
  jeddah:          { nameEn: "Jeddah",          nameAr: "جدة" },
  mecca:           { nameEn: "Mecca",           nameAr: "مكة" },
  medina:          { nameEn: "Medina",          nameAr: "المدينة" },
  dammam:          { nameEn: "Dammam",          nameAr: "الدمام" },
  khobar:          { nameEn: "Khobar",          nameAr: "الخبر" },
  dhahran:         { nameEn: "Dhahran",         nameAr: "الظهران" },
  jubail:          { nameEn: "Jubail",          nameAr: "الجبيل" },
  abha:            { nameEn: "Abha",            nameAr: "أبها" },
  taif:            { nameEn: "Taif",            nameAr: "الطائف" },
  tabuk:           { nameEn: "Tabuk",           nameAr: "تبوك" },
  qassim:          { nameEn: "Qassim",          nameAr: "القصيم" },
  hail:            { nameEn: "Hail",            nameAr: "حائل" },
  najran:          { nameEn: "Najran",          nameAr: "نجران" },
  jizan:           { nameEn: "Jizan",           nameAr: "جازان" },
  dubai:           { nameEn: "Dubai",           nameAr: "دبي" },
  abu_dhabi:       { nameEn: "Abu Dhabi",       nameAr: "أبوظبي" },
  sharjah:         { nameEn: "Sharjah",         nameAr: "الشارقة" },
  ajman:           { nameEn: "Ajman",           nameAr: "عجمان" },
  fujairah:        { nameEn: "Fujairah",        nameAr: "الفجيرة" },
  ras_al_khaimah:  { nameEn: "Ras Al Khaimah",  nameAr: "رأس الخيمة" },
  umm_al_quwain:   { nameEn: "Umm Al Quwain",   nameAr: "أم القيوين" },
  amman:           { nameEn: "Amman",           nameAr: "عمان" },
  cairo:           { nameEn: "Cairo",           nameAr: "القاهرة" },
  beirut:          { nameEn: "Beirut",          nameAr: "بيروت" },
  doha:            { nameEn: "Doha",            nameAr: "الدوحة" },
  muscat:          { nameEn: "Muscat",          nameAr: "مسقط" },
  kuwait_city:     { nameEn: "Kuwait City",     nameAr: "مدينة الكويت" },
};

// ── Profile completeness ──────────────────────────────────────────────────────

export interface ProfileCompletenessInput {
  hasWhatsapp: boolean;
  hasDescription: boolean; // description or shortDescription
  hasCoverUrl: boolean;
  servicesCount: number;
}

/** Returns true only when all critical profile items are present. */
export function isProfileComplete(p: ProfileCompletenessInput): boolean {
  return p.hasWhatsapp && p.hasDescription && p.hasCoverUrl && p.servicesCount > 0;
}

/**
 * When profile is incomplete, return the most important missing item
 * (drives actionTarget for priority-1 recommendation).
 * Priority order per spec: contact > services > cover > description
 */
export function missingProfileItem(
  p: ProfileCompletenessInput,
): { target: ActionTarget; nameEn: string; nameAr: string } | null {
  if (!p.hasWhatsapp)       return { target: "contact",  nameEn: "contact method",  nameAr: "طريقة التواصل" };
  if (p.servicesCount === 0) return { target: "services", nameEn: "services",        nameAr: "الخدمات" };
  if (!p.hasCoverUrl)        return { target: "media",    nameEn: "cover image",     nameAr: "صورة الغلاف" };
  if (!p.hasDescription)     return { target: "profile",  nameEn: "description",     nameAr: "نبذة عن المكتب" };
  return null;
}

// ── Recommendation engine ─────────────────────────────────────────────────────

export interface RecommendationInput {
  profile: ProfileCompletenessInput;
  // Current-period analytics
  profileViews: number;
  cardImpressions: number;
  contactActions: number;
  topService: { nameEn: string; nameAr: string; count: number; share: number } | null;
  topCity: { cityId: string; nameEn?: string; nameAr?: string; count: number; share: number } | null;
}

export function computeRecommendation(input: RecommendationInput): Recommendation {
  const { profile, profileViews, cardImpressions, contactActions, topService, topCity } = input;

  // ── Priority 1: Incomplete profile ─────────────────────────────────────────
  const missing = missingProfileItem(profile);
  if (missing !== null) {
    let bodyEn: string;
    let bodyAr: string;
    switch (missing.target) {
      case "contact":
        bodyEn = "Visitors can't contact you directly. Adding a WhatsApp number makes it easy for potential clients to reach out.";
        bodyAr = "لا يستطيع الزوار التواصل معك مباشرةً. إضافة رقم واتساب تُسهّل على العملاء المحتملين التواصل معك.";
        break;
      case "services":
        bodyEn = "Your profile has no services listed. Customers search by service — listing yours helps them find you.";
        bodyAr = "ملفك لا يحتوي على خدمات. العملاء يبحثون عن خدمات محددة — إضافتها يساعدهم على إيجادك.";
        break;
      case "media":
        bodyEn = "A cover image makes your office card stand out and significantly increases the chance of a profile visit.";
        bodyAr = "صورة الغلاف تجعل بطاقتك مميزة وتزيد بشكل ملحوظ من احتمالية زيارة ملفك.";
        break;
      default:
        bodyEn = "Adding a description helps visitors understand what you offer before they decide to contact you.";
        bodyAr = "إضافة نبذة تُساعد الزوار على فهم ما تقدمه قبل أن يقرروا التواصل معك.";
    }
    return {
      priority: 1,
      titleEn: "Complete Your Profile",
      titleAr: "أكمل ملفك التعريفي",
      bodyEn,
      bodyAr,
      actionLabelEn: `Add ${missing.nameEn}`,
      actionLabelAr: `أضف ${missing.nameAr}`,
      actionTarget: missing.target,
    };
  }

  // ── Priority 2: Insufficient data (profile is complete) ────────────────────
  if (profileViews < THRESHOLDS.INSUFFICIENT_DATA_PROFILE_VIEWS) {
    return {
      priority: 2,
      titleEn: "Share Your Link to Start Measuring",
      titleAr: "شارك رابطك لتبدأ القياس",
      bodyEn: "Your profile hasn't received enough visits yet to generate meaningful insights. Share your office link or QR code to start attracting visitors.",
      bodyAr: "لم يتلقَّ ملفك زيارات كافية بعد لإنتاج رؤى مفيدة. شارك رابط مكتبك أو رمز QR لبدء استقطاب الزوار.",
      actionLabelEn: "Copy Profile Link",
      actionLabelAr: "نسخ رابط الملف",
      actionTarget: "copy_link",
    };
  }

  // ── Priority 3: Strong impressions but weak card CTR ───────────────────────
  if (
    cardImpressions >= THRESHOLDS.MIN_IMPRESSIONS_FOR_RATE_ANALYSIS &&
    profileViews / cardImpressions < THRESHOLDS.LOW_CTR
  ) {
    const ctrPct = Math.round((profileViews / cardImpressions) * 100);
    return {
      priority: 3,
      titleEn: "Improve Your Listing Card",
      titleAr: "حسّن بطاقة مكتبك",
      bodyEn: `Your office appeared in search ${cardImpressions.toLocaleString()} times, but only ${ctrPct}% of those views led to a profile visit. A stronger image, title, or short description can help.`,
      bodyAr: `ظهر مكتبك في البحث ${cardImpressions.toLocaleString()} مرة، لكن ${ctrPct}% فقط من هذه الظهورات أدت إلى زيارة الملف. صورة أفضل أو عنوان أوضح قد يحدث فرقاً.`,
      actionLabelEn: "Update Media & Card",
      actionLabelAr: "تحديث الصور والبطاقة",
      actionTarget: "media",
    };
  }

  // ── Priority 4: Profile interest but weak conversion ──────────────────────
  if (
    profileViews >= THRESHOLDS.MIN_PROFILE_VIEWS_FOR_CONVERSION &&
    contactActions / profileViews < THRESHOLDS.LOW_CONVERSION
  ) {
    const cntV = profileViews.toLocaleString();
    const cntC = contactActions.toLocaleString();
    return {
      priority: 4,
      titleEn: "Make It Easier to Contact You",
      titleAr: "اجعل التواصل معك أسهل",
      bodyEn: `Your profile received ${cntV} views, but only ${cntC} visitor${contactActions !== 1 ? "s" : ""} contacted you. Enabling WhatsApp, a phone number, or a video call option can turn more visitors into clients.`,
      bodyAr: `تلقّى ملفك ${cntV} زيارة، لكن ${cntC} زائر فقط ${contactActions !== 1 ? "" : "واحد "}تواصل معك. تفعيل واتساب أو رقم هاتف أو طلب مكالمة فيديو يمكن أن يحوّل المزيد من الزوار إلى عملاء.`,
      actionLabelEn: "Update Contact Options",
      actionLabelAr: "تحديث خيارات التواصل",
      actionTarget: "contact",
    };
  }

  // ── Priority 5: Low visibility (profile complete, some visits) ─────────────
  if (cardImpressions < THRESHOLDS.LOW_IMPRESSIONS) {
    return {
      priority: 5,
      titleEn: "Increase Your Visibility",
      titleAr: "زِد ظهورك",
      bodyEn: "Your office is receiving very few search impressions. Sharing your office link or QR code on social media and messaging apps helps more people discover you.",
      bodyAr: "مكتبك يظهر في عدد قليل جداً من نتائج البحث. مشاركة رابطك أو رمز QR على وسائل التواصل والتطبيقات تساعد المزيد من الناس على اكتشافك.",
      actionLabelEn: "Copy Profile Link",
      actionLabelAr: "نسخ رابط الملف",
      actionTarget: "copy_link",
    };
  }

  // ── Priority 6: Dominant service opportunity ───────────────────────────────
  if (
    topService !== null &&
    topService.count >= THRESHOLDS.MIN_EVENTS_FOR_SERVICE_SIGNAL &&
    topService.share >= THRESHOLDS.DOMINANT_SERVICE_SHARE
  ) {
    const pct = Math.round(topService.share * 100);
    return {
      priority: 6,
      titleEn: "Highlight Your Top Service",
      titleAr: "أبرز خدمتك الأكثر طلباً",
      bodyEn: `${pct}% of visitors came looking specifically for "${topService.nameEn}". Making this service more prominent in your profile can convert more of that demand directly to contacts.`,
      bodyAr: `${pct}% من الزوار جاؤوا يبحثون تحديداً عن "${topService.nameAr}". إبراز هذه الخدمة بشكل أوضح في ملفك يمكن أن يحوّل المزيد من هذا الطلب إلى تواصل مباشر.`,
      actionLabelEn: "Update Services",
      actionLabelAr: "تحديث الخدمات",
      actionTarget: "services",
    };
  }

  // ── Priority 7: Dominant city opportunity ─────────────────────────────────
  if (
    topCity !== null &&
    topCity.count >= THRESHOLDS.MIN_EVENTS_FOR_CITY_SIGNAL &&
    topCity.share >= THRESHOLDS.DOMINANT_CITY_SHARE
  ) {
    const pct = Math.round(topCity.share * 100);
    const cityNameEn = topCity.nameEn ?? topCity.cityId;
    const cityNameAr = topCity.nameAr ?? topCity.cityId;
    return {
      priority: 7,
      titleEn: `Strengthen Your Presence in ${cityNameEn}`,
      titleAr: `عزّز حضورك في ${cityNameAr}`,
      bodyEn: `${pct}% of your visitors came from ${cityNameEn}. Sharing your link with local communities there can amplify this existing demand.`,
      bodyAr: `${pct}% من زوارك قادمون من ${cityNameAr}. مشاركة رابطك مع المجتمعات المحلية هناك يمكن أن يضاعف هذا الطلب القائم.`,
      actionLabelEn: "Copy Profile Link",
      actionLabelAr: "نسخ رابط الملف",
      actionTarget: "copy_link",
    };
  }

  // ── Priority 8: Healthy performance ───────────────────────────────────────
  return {
    priority: 8,
    titleEn: "Your Office Is Performing Well",
    titleAr: "مكتبك يؤدي أداءً جيداً",
    bodyEn: `You've received ${profileViews.toLocaleString()} profile visits and ${contactActions.toLocaleString()} contact action${contactActions !== 1 ? "s" : ""} in this period. Keep your profile up to date to maintain momentum.`,
    bodyAr: `تلقّيت ${profileViews.toLocaleString()} زيارة للملف و${contactActions.toLocaleString()} إجراء تواصل خلال هذه الفترة. حافظ على تحديث ملفك للحفاظ على هذا الزخم.`,
    actionLabelEn: "View Public Profile",
    actionLabelAr: "عرض الملف العام",
    actionTarget: "public_profile",
  };
}

// ── Opportunity card ──────────────────────────────────────────────────────────

export function computeOpportunity(
  profileViews: number,
  contactActions: number,
): Opportunity | null {
  if (profileViews < THRESHOLDS.OPPORTUNITY_MIN_VIEWS) return null;

  const currentRate = profileViews > 0 ? contactActions / profileViews : 0;

  // Determine target rate
  let targetRate: number;
  if (currentRate < THRESHOLDS.OPPORTUNITY_BASE_TARGET) {
    targetRate = THRESHOLDS.OPPORTUNITY_BASE_TARGET;
  } else if (currentRate < THRESHOLDS.OPPORTUNITY_HIGH_CONVERSION) {
    targetRate = currentRate + THRESHOLDS.OPPORTUNITY_TARGET_STEP;
  } else {
    return null; // Already above 20% — don't show
  }

  const estimatedAdditionalContacts = Math.round(
    profileViews * targetRate - contactActions,
  );
  if (estimatedAdditionalContacts < 1) return null;

  const currentPct = Math.round(currentRate * 100 * 10) / 10; // 1 dp
  const targetPct  = Math.round(targetRate  * 100 * 10) / 10;

  const bodyEn =
    `You received ${profileViews.toLocaleString()} profile views and ${contactActions.toLocaleString()} contact ` +
    `action${contactActions !== 1 ? "s" : ""}. Improving conversion from ${currentPct}% to ${targetPct}% ` +
    `could generate approximately ${estimatedAdditionalContacts} additional contact ` +
    `action${estimatedAdditionalContacts !== 1 ? "s" : ""}.`;

  const bodyAr =
    `تلقّيت ${profileViews.toLocaleString()} زيارة للملف و${contactActions.toLocaleString()} إجراء تواصل. ` +
    `رفع معدل التحويل من ${currentPct}% إلى ${targetPct}% قد يولّد ` +
    `تقريباً ${estimatedAdditionalContacts} إجراء تواصل إضافي${estimatedAdditionalContacts !== 1 ? "" : "اً"}.`;

  return {
    currentRate,
    targetRate,
    estimatedAdditionalContacts,
    titleEn: "Your Opportunity This Month",
    titleAr: "فرصتك هذا الشهر",
    bodyEn,
    bodyAr,
  };
}
