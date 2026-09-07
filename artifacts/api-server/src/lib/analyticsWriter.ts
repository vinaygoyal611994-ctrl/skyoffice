/**
 * Analytics event writer — Phase 1.
 *
 * RULE: Analytics writes must NEVER block, throw, or affect the response
 * to the user. Every write is fire-and-forget, wrapped in try/catch.
 *
 * Usage pattern (in routes):
 *
 *   // At the END of the route handler, after the response is sent:
 *   fireAnalyticsEvent({
 *     eventName: "office_profile_view",
 *     officeId: office.id,
 *     visitorId: getOrCreateVisitorId(req, res),
 *     ...commonContext(req),
 *   });
 *
 * Do NOT await fireAnalyticsEvent. It returns void.
 *
 * Deduplication:
 *   - client sends a client-generated event_id UUID for client-side events
 *     (card_impression, card_click, video_start etc.)
 *   - INSERT ... ON CONFLICT (event_id) DO NOTHING de-dupes network retries
 *   - server-side events (search_performed, profile_view) use DB-default UUIDs
 *     (no deduplication; very low duplicate risk for server-side events)
 *
 * Bot filtering:
 *   - detectBot() is called on every server-side event; result is stored in
 *     is_bot and exclusion_reason columns (not filtered out — kept for audit)
 *   - Client-side events are trusted re: bot filtering because they originate
 *     from a JS execution environment (headless bots rarely execute JS);
 *     is_bot defaults to false for client-side events
 */

import { db, analyticsEventsTable, type InsertAnalyticsEvent } from "@workspace/db";
import { logger } from "./logger";
import { detectBot } from "./botDetection";
import { extractReferrerDomain, resolveSource } from "./visitorSession";
import { PARSER_VERSION } from "./analyticsConfig";
import type { Request } from "express";

// ── Common context extraction ─────────────────────────────────────────────────

export interface AnalyticsRequestContext {
  visitorId: string | null;
  sessionId: string | null;
  searchSessionId: string | null;
  authenticatedUserId: number | null;
  interfaceLanguage: "ar" | "en" | null;
  deviceCategory: "desktop" | "mobile" | "tablet" | "unknown" | null;
  osFamily: string | null;
  browserFamily: string | null;
  isBot: boolean;
  exclusionReason: string | null;
  botDetectionVersion: string;
  referrerDomain: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  qrCampaignId: string | null;
}

/**
 * Extract the request context fields that are common to all analytics events.
 * Call this once per request and pass the result to fireAnalyticsEvent.
 */
export function extractRequestContext(req: Request): AnalyticsRequestContext {
  const ua = req.headers["user-agent"] ?? undefined;
  const botResult = detectBot(ua);
  const referrer = req.headers["referer"] ?? req.headers["referrer"] as string | undefined;
  const query = req.query as Record<string, string>;

  return {
    visitorId: null, // caller must set from getOrCreateVisitorId / readVisitorId
    sessionId: null,
    searchSessionId: query["search_session_id"] ?? null,
    authenticatedUserId: req.session?.user?.id ?? null,
    interfaceLanguage: (query["lang"] === "en" ? "en" : "ar") as "ar" | "en",
    deviceCategory: classifyDevice(ua ?? ""),
    osFamily: extractOsFamily(ua ?? ""),
    browserFamily: extractBrowserFamily(ua ?? ""),
    isBot: botResult.isBot,
    exclusionReason: botResult.exclusionReason,
    botDetectionVersion: botResult.botDetectionVersion,
    referrerDomain: extractReferrerDomain(referrer),
    utmSource: query["utm_source"] ?? null,
    utmMedium: query["utm_medium"] ?? null,
    utmCampaign: query["utm_campaign"] ?? null,
    utmContent: query["utm_content"] ?? null,
    utmTerm: query["utm_term"] ?? null,
    qrCampaignId: validateQrCampaignId(query["qr"] ?? null),
  };
}

// ── Event payload type ────────────────────────────────────────────────────────

export type AnalyticsEventPayload = Omit<
  InsertAnalyticsEvent,
  "id" | "receivedAt"
> & {
  /** For client-side events: the idempotency UUID from the client. */
  eventId?: string;
};

// ── Fire-and-forget writer ────────────────────────────────────────────────────

/**
 * Write an analytics event to the database without blocking the caller.
 * Never throws. Logs errors at warn level.
 */
export function fireAnalyticsEvent(payload: AnalyticsEventPayload): void {
  // Resolve source if not explicitly set
  const source =
    payload.source ??
    resolveSource({
      utmSource: payload.utmSource,
      utmMedium: payload.utmMedium,
      utmCampaign: payload.utmCampaign,
      referrerDomain: payload.referrerDomain,
      qrCampaignId: payload.qrCampaignId,
      searchSessionId: payload.searchSessionId,
    });

  const record: InsertAnalyticsEvent = {
    ...payload,
    source,
    parserVersion: payload.parserVersion ?? PARSER_VERSION,
    receivedAt: new Date(),
  };

  // Remove undefined keys to avoid Drizzle type errors
  const clean = removeUndefined(record);

  // Fire-and-forget
  db.insert(analyticsEventsTable)
    .values(clean)
    .onConflictDoNothing({ target: analyticsEventsTable.eventId })
    .execute()
    .catch((err: Error) => {
      logger.warn(
        { err: err.message, eventName: payload.eventName },
        "[analytics] Failed to write analytics event — suppressed",
      );
    });
}

/**
 * Batch-write multiple client-side events (e.g. card impressions) in a
 * single INSERT statement. At most 20 events per batch.
 * Never throws.
 */
export function fireAnalyticsEventBatch(
  payloads: AnalyticsEventPayload[],
): void {
  if (payloads.length === 0) return;
  const limited = payloads.slice(0, 20);

  const records = limited.map((payload) => {
    const source =
      payload.source ??
      resolveSource({
        utmSource: payload.utmSource,
        utmMedium: payload.utmMedium,
        utmCampaign: payload.utmCampaign,
        referrerDomain: payload.referrerDomain,
        qrCampaignId: payload.qrCampaignId,
        searchSessionId: payload.searchSessionId,
      });
    return removeUndefined({
      ...payload,
      source,
      parserVersion: payload.parserVersion ?? PARSER_VERSION,
      receivedAt: new Date(),
    } as InsertAnalyticsEvent);
  });

  db.insert(analyticsEventsTable)
    .values(records)
    .onConflictDoNothing({ target: analyticsEventsTable.eventId })
    .execute()
    .catch((err: Error) => {
      logger.warn(
        { err: err.message, count: limited.length },
        "[analytics] Failed to write analytics event batch — suppressed",
      );
    });
}

// ── Device classification ─────────────────────────────────────────────────────

function classifyDevice(ua: string): "desktop" | "mobile" | "tablet" | "unknown" {
  if (!ua) return "unknown";
  const lower = ua.toLowerCase();
  if (/ipad|tablet|kindle|playbook|nexus 7|nexus 10/i.test(lower)) return "tablet";
  if (
    /mobile|android(?!.*tablet)|iphone|ipod|windows phone|blackberry|opera mini/i.test(
      lower,
    )
  )
    return "mobile";
  if (/windows|macintosh|linux|x11|cros/i.test(lower)) return "desktop";
  return "unknown";
}

function extractOsFamily(ua: string): string | null {
  if (!ua) return null;
  if (/windows nt/i.test(ua)) return "windows";
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod|mac os x/i.test(ua)) return "ios_macos";
  if (/linux/i.test(ua)) return "linux";
  if (/cros/i.test(ua)) return "chromeos";
  return null;
}

function extractBrowserFamily(ua: string): string | null {
  if (!ua) return null;
  if (/edg\//i.test(ua)) return "edge";
  if (/opr\//i.test(ua)) return "opera";
  if (/chrome/i.test(ua) && !/chromium/i.test(ua)) return "chrome";
  if (/firefox/i.test(ua)) return "firefox";
  if (/safari/i.test(ua) && !/chrome/i.test(ua)) return "safari";
  if (/samsung/i.test(ua)) return "samsung_internet";
  return null;
}

// ── QR campaign ID validation ─────────────────────────────────────────────────

const QR_CAMPAIGN_RE = /^[a-z0-9-]{1,64}$/;

function validateQrCampaignId(raw: string | null): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  return QR_CAMPAIGN_RE.test(lower) ? lower : null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function removeUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as T;
}
