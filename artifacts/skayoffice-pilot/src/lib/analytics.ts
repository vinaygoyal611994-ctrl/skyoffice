/**
 * Client-side analytics event sender for SkayOffice — Phase 1.
 *
 * All exported functions are fire-and-forget — they never throw, never
 * block, and never return a meaningful value. Wrap all calls in try/catch
 * as an extra safety measure (though the functions themselves catch all
 * internal errors).
 *
 * Usage:
 *   import { trackCardClick, trackVideoStart } from '@/lib/analytics';
 *   trackCardClick({ officeId: 42 });          // fire and forget
 *   trackVideoStart(42);                        // fire and forget
 */

// ── Base URL ──────────────────────────────────────────────────────────────────

function getBaseUrl(): string {
  const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
  return base;
}

// ── Session / context helpers ─────────────────────────────────────────────────

function generateUuid(): string {
  return crypto.randomUUID();
}

/** Stable search session ID stored in sessionStorage for the current search journey. */
export function getSearchSessionId(): string {
  try {
    const key = "skay_ssid";
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const id = generateUuid();
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return generateUuid();
  }
}

/**
 * Start a new search journey by generating a fresh search session ID.
 * Call this when the user performs a new search.
 */
export function resetSearchSessionId(): string {
  try {
    const id = generateUuid();
    sessionStorage.setItem("skay_ssid", id);
    return id;
  } catch {
    return generateUuid();
  }
}

/** Stable anonymous page session ID stored in sessionStorage. */
export function getSessionId(): string {
  try {
    const key = "skay_sid";
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const id = generateUuid();
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return generateUuid();
  }
}

export function getOrInferDeviceCategory(): "desktop" | "mobile" | "tablet" | "unknown" {
  if (typeof window === "undefined") return "unknown";
  const ua = navigator.userAgent.toLowerCase();
  if (/ipad|tablet|kindle|nexus 7|nexus 10/i.test(ua)) return "tablet";
  if (/mobile|android(?!.*tablet)|iphone|ipod|windows phone/i.test(ua))
    return "mobile";
  if (window.innerWidth >= 1024) return "desktop";
  if (window.innerWidth >= 768) return "tablet";
  return "mobile";
}

export function getInterfaceLanguage(): "ar" | "en" {
  try {
    const htmlLang = document.documentElement.lang;
    if (htmlLang?.startsWith("ar")) return "ar";
    if (htmlLang?.startsWith("en")) return "en";
    const i18n = localStorage.getItem("i18nextLng") ?? "";
    if (i18n.startsWith("en")) return "en";
  } catch {
    // ignore
  }
  return "ar"; // SkayOffice default is Arabic
}

export function getUtmParams(): Record<string, string | undefined> {
  try {
    const p = new URLSearchParams(window.location.search);
    return {
      utmSource: p.get("utm_source") ?? undefined,
      utmMedium: p.get("utm_medium") ?? undefined,
      utmCampaign: p.get("utm_campaign") ?? undefined,
      utmContent: p.get("utm_content") ?? undefined,
      utmTerm: p.get("utm_term") ?? undefined,
    };
  } catch {
    return {};
  }
}

export function getQrCampaignId(): string | null {
  try {
    return new URLSearchParams(window.location.search).get("qr") ?? null;
  } catch {
    return null;
  }
}

export function getReferrerDomain(): string | null {
  try {
    const ref = document.referrer;
    if (!ref) return null;
    return new URL(ref).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// ── Core event payload type ───────────────────────────────────────────────────

interface ClientEvent {
  eventName: string;
  eventId?: string;
  occurredAt?: string;
  officeId?: number;
  searchSessionId?: string;
  sessionId?: string;
  cityId?: string;
  categoryId?: string;
  source?: string;
  entryPoint?: string;
  referrerDomain?: string;
  qrCampaignId?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  interfaceLanguage?: string;
  deviceCategory?: string;
  searchQueryOriginal?: string;
  searchQueryNormalized?: string;
  searchResultsCount?: number;
  inputMethod?: string;
  resultPosition?: number;
  metadata?: Record<string, unknown>;
}

// ── Core sender ───────────────────────────────────────────────────────────────

function sendEvents(events: ClientEvent[]): void {
  if (events.length === 0) return;
  try {
    const url = `${getBaseUrl()}/api/analytics/events`;
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      keepalive: true,
      body: JSON.stringify({ events }),
    }).catch(() => {
      // Silently discard network errors
    });
  } catch {
    // Silently discard any synchronous errors
  }
}

/** Build common context fields that are the same for all events in this page. */
function commonContext() {
  const utm = getUtmParams();
  return {
    sessionId: getSessionId(),
    searchSessionId: getSearchSessionId(),
    interfaceLanguage: getInterfaceLanguage(),
    deviceCategory: getOrInferDeviceCategory(),
    referrerDomain: getReferrerDomain() ?? undefined,
    qrCampaignId: getQrCampaignId() ?? undefined,
    ...utm,
  };
}

// ── Exported tracking functions ───────────────────────────────────────────────

/**
 * Track a search. Resets the search session ID (starts a new journey).
 */
export function trackSearch(opts: {
  query: string;
  resultsCount: number;
  inputMethod?: "typed" | "voice";
  cityId?: string;
  categoryId?: string;
}): void {
  try {
    const searchSessionId = resetSearchSessionId();
    sendEvents([
      {
        ...commonContext(),
        eventName: "search_performed",
        eventId: generateUuid(),
        occurredAt: new Date().toISOString(),
        searchSessionId,
        searchQueryOriginal: opts.query.slice(0, 200),
        searchQueryNormalized: opts.query.toLowerCase().trim().slice(0, 200),
        searchResultsCount: opts.resultsCount,
        inputMethod: opts.inputMethod ?? "typed",
        cityId: opts.cityId,
        categoryId: opts.categoryId,
      },
    ]);
  } catch {
    // Never throw
  }
}

/** Track a card click (user clicked on an office card). */
export function trackCardClick(opts: {
  officeId: number;
  position?: number;
  searchSessionId?: string;
}): void {
  try {
    sendEvents([
      {
        ...commonContext(),
        eventName: "office_card_click",
        eventId: generateUuid(),
        occurredAt: new Date().toISOString(),
        officeId: opts.officeId,
        resultPosition: opts.position,
        searchSessionId: opts.searchSessionId ?? getSearchSessionId(),
      },
    ]);
  } catch {
    // Never throw
  }
}

/** Track a card impression (card was visible ≥50% for ≥1s). */
function trackCardImpression(opts: { officeId: number; position: number }): void {
  try {
    sendEvents([
      {
        ...commonContext(),
        eventName: "office_card_impression",
        eventId: generateUuid(),
        occurredAt: new Date().toISOString(),
        officeId: opts.officeId,
        resultPosition: opts.position,
        searchSessionId: getSearchSessionId(),
      },
    ]);
  } catch {
    // Never throw
  }
}

export function trackVideoStart(officeId: number): void {
  try {
    sendEvents([
      {
        eventName: "video_start",
        eventId: generateUuid(),
        occurredAt: new Date().toISOString(),
        officeId,
        ...commonContext(),
      },
    ]);
  } catch {
    // Never throw
  }
}

export function trackVideoComplete(officeId: number): void {
  try {
    sendEvents([
      {
        eventName: "video_complete",
        eventId: generateUuid(),
        occurredAt: new Date().toISOString(),
        officeId,
        ...commonContext(),
      },
    ]);
  } catch {
    // Never throw
  }
}

export function trackGalleryInteraction(officeId: number): void {
  try {
    sendEvents([
      {
        eventName: "gallery_interaction",
        eventId: generateUuid(),
        occurredAt: new Date().toISOString(),
        officeId,
        ...commonContext(),
      },
    ]);
  } catch {
    // Never throw
  }
}

export function trackCopyLink(officeId: number): void {
  try {
    sendEvents([
      {
        eventName: "copy_link",
        eventId: generateUuid(),
        occurredAt: new Date().toISOString(),
        officeId,
        ...commonContext(),
      },
    ]);
  } catch {
    // Never throw
  }
}

export function trackRegistrationStarted(): void {
  try {
    sendEvents([
      {
        eventName: "office_registration_started",
        eventId: generateUuid(),
        occurredAt: new Date().toISOString(),
        ...commonContext(),
      },
    ]);
  } catch {
    // Never throw
  }
}

// ── 8-Stage Pilot Funnel Telemetry (Blocker 11) ───────────────────────────────
//
// Strict event taxonomy for the pilot funnel. Each stage fires at most once
// per page session via a module-level deduplication set.
// Taxonomy: funnel_<stage_name> — all stages listed in analyticsEventTaxonomy.ts
//
// Stage deduplication: each stage is fired at most once per page load.
// Stages that require an officeId are further deduplicated per (stage, officeId).

const firedFunnelStages = new Set<string>();

function funnelDedupeKey(stage: string, officeId?: number): string {
  return officeId !== undefined ? `${stage}:${officeId}` : stage;
}

/**
 * Stage 1: Visitor lands on the home page.
 * Call once on Home component mount.
 */
export function trackFunnelHomeVisit(): void {
  const key = funnelDedupeKey("funnel_home_visit");
  if (firedFunnelStages.has(key)) return;
  firedFunnelStages.add(key);
  try {
    sendEvents([{
      eventName: "funnel_home_visit",
      eventId: generateUuid(),
      occurredAt: new Date().toISOString(),
      ...commonContext(),
    }]);
  } catch { /* Never throw */ }
}

/**
 * Stage 2: Visitor runs a search.
 * Called alongside trackSearch() — records the funnel stage once per page load.
 */
export function trackFunnelSearch(opts: {
  query: string;
  resultsCount: number;
  inputMethod?: "typed" | "voice";
  cityId?: string;
  categoryId?: string;
}): void {
  const key = funnelDedupeKey("funnel_search");
  if (firedFunnelStages.has(key)) return;
  firedFunnelStages.add(key);
  try {
    sendEvents([{
      eventName: "funnel_search",
      eventId: generateUuid(),
      occurredAt: new Date().toISOString(),
      searchResultsCount: opts.resultsCount,
      inputMethod: opts.inputMethod ?? "typed",
      cityId: opts.cityId,
      categoryId: opts.categoryId,
      searchQueryNormalized: opts.query.toLowerCase().trim().slice(0, 200),
      ...commonContext(),
    }]);
  } catch { /* Never throw */ }
}

/**
 * Stage 3: Visitor opens an office profile.
 * De-duplicated per (stage, officeId) per page load.
 */
export function trackFunnelProfileOpened(officeId: number): void {
  const key = funnelDedupeKey("funnel_profile_opened", officeId);
  if (firedFunnelStages.has(key)) return;
  firedFunnelStages.add(key);
  try {
    sendEvents([{
      eventName: "funnel_profile_opened",
      eventId: generateUuid(),
      occurredAt: new Date().toISOString(),
      officeId,
      ...commonContext(),
    }]);
  } catch { /* Never throw */ }
}

/**
 * Stage 4: Visitor spends ≥10 s on an office profile (engagement signal).
 * De-duplicated per (stage, officeId) per page load.
 */
export function trackFunnelProfileEngaged(officeId: number): void {
  const key = funnelDedupeKey("funnel_profile_engaged", officeId);
  if (firedFunnelStages.has(key)) return;
  firedFunnelStages.add(key);
  try {
    sendEvents([{
      eventName: "funnel_profile_engaged",
      eventId: generateUuid(),
      occurredAt: new Date().toISOString(),
      officeId,
      ...commonContext(),
    }]);
  } catch { /* Never throw */ }
}

/**
 * Stage 5: Visitor initiates a contact action (WhatsApp / map / share / video).
 * Fires for ALL visitors (authenticated or not).
 * De-duplicated per (stage, officeId) per page load.
 */
export function trackFunnelContactInitiated(
  officeId: number,
  medium: "whatsapp" | "map" | "share" | "video_call" | "other",
): void {
  const key = funnelDedupeKey("funnel_contact_initiated", officeId);
  if (firedFunnelStages.has(key)) return;
  firedFunnelStages.add(key);
  try {
    sendEvents([{
      eventName: "funnel_contact_initiated",
      eventId: generateUuid(),
      occurredAt: new Date().toISOString(),
      officeId,
      metadata: { medium },
      ...commonContext(),
    }]);
  } catch { /* Never throw */ }
}

/**
 * Stage 6: Visitor saves an office to favourites (authenticated).
 * De-duplicated per (stage, officeId) per page load.
 */
export function trackFunnelFavourited(officeId: number): void {
  const key = funnelDedupeKey("funnel_favourited", officeId);
  if (firedFunnelStages.has(key)) return;
  firedFunnelStages.add(key);
  try {
    sendEvents([{
      eventName: "funnel_favourited",
      eventId: generateUuid(),
      occurredAt: new Date().toISOString(),
      officeId,
      ...commonContext(),
    }]);
  } catch { /* Never throw */ }
}

/**
 * Stage 7: Visitor starts the office registration flow.
 * Also fires the existing raw office_registration_started event.
 * De-duplicated per page load.
 */
export function trackFunnelRegistrationStarted(): void {
  trackRegistrationStarted();
  const key = funnelDedupeKey("funnel_registration_started");
  if (firedFunnelStages.has(key)) return;
  firedFunnelStages.add(key);
  try {
    sendEvents([{
      eventName: "funnel_registration_started",
      eventId: generateUuid(),
      occurredAt: new Date().toISOString(),
      ...commonContext(),
    }]);
  } catch { /* Never throw */ }
}

/**
 * Stage 8: Office registration completed and profile submitted.
 * De-duplicated per page load.
 */
export function trackFunnelRegistrationCompleted(): void {
  const key = funnelDedupeKey("funnel_registration_completed");
  if (firedFunnelStages.has(key)) return;
  firedFunnelStages.add(key);
  try {
    sendEvents([{
      eventName: "funnel_registration_completed",
      eventId: generateUuid(),
      occurredAt: new Date().toISOString(),
      ...commonContext(),
    }]);
  } catch { /* Never throw */ }
}

/**
 * Record an anonymous pilot platform contact intent.
 * Posts to the dedicated server endpoint (POST /api/analytics/pilot-contact-intent).
 * No auth required. De-duplicated per page load.
 * (Blocker 10)
 */
export function trackPilotContactIntent(page: string = "unknown"): void {
  const key = funnelDedupeKey("pilot_contact_intent");
  if (firedFunnelStages.has(key)) return;
  firedFunnelStages.add(key);
  try {
    const base = getBaseUrl();
    fetch(`${base}/api/analytics/pilot-contact-intent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      keepalive: true,
      body: JSON.stringify({
        page: page.slice(0, 50),
        interfaceLanguage: getInterfaceLanguage(),
        deviceCategory: getOrInferDeviceCategory(),
      }),
    }).catch(() => { /* silent */ });
  } catch { /* Never throw */ }
}

// ── Impression tracker React hook ─────────────────────────────────────────────

// Module-level deduplication state (persists across renders)
const impressedOffices = new Set<number>();
const impressionCooldowns = new Map<number, number>(); // officeId → timestamp when impression fired
const IMPRESSION_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

import { useEffect, useRef, useCallback } from "react";

/**
 * React hook that returns a callback ref. Attach to the office card DOM element.
 * Fires a card impression event when the card is ≥50% visible for ≥1 second.
 * Deduplicated per officeId per page load (and 5-minute cooldown for re-entries).
 */
export function useImpressionTracker(
  officeId: number,
  position: number,
): (el: HTMLElement | null) => void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const elementRef = useRef<HTMLElement | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (observerRef.current && elementRef.current) {
      observerRef.current.unobserve(elementRef.current);
    }
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  const callbackRef = useCallback(
    (el: HTMLElement | null) => {
      cleanup();
      elementRef.current = el;
      if (!el) return;

      // Skip if already impressed with no cooldown expired
      const lastImpressionTime = impressionCooldowns.get(officeId);
      const now = Date.now();
      if (
        impressedOffices.has(officeId) &&
        lastImpressionTime !== undefined &&
        now - lastImpressionTime < IMPRESSION_COOLDOWN_MS
      ) {
        return;
      }

      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
            // Start 1-second timer
            if (!timerRef.current) {
              timerRef.current = setTimeout(() => {
                timerRef.current = null;
                impressedOffices.add(officeId);
                impressionCooldowns.set(officeId, Date.now());
                trackCardImpression({ officeId, position });
              }, 1000);
            }
          } else {
            // Element left view — cancel timer
            if (timerRef.current) {
              clearTimeout(timerRef.current);
              timerRef.current = null;
            }
          }
        },
        { threshold: 0.5 },
      );

      observerRef.current = observer;
      observer.observe(el);
    },
    [officeId, position, cleanup],
  );

  return callbackRef;
}
