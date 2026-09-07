/**
 * Visitor session management for SkayOffice analytics.
 *
 * Issues and reads the anonymous visitor ID cookie (_skay_vid).
 *
 * Privacy design:
 *   - No IP addresses stored anywhere in analytics
 *   - visitor_id is a server-generated UUID with no linkage to account data
 *   - 365-day fixed expiry (not refreshed on every request, so the
 *     VISITOR_COOKIE_MAX_AGE_SECONDS countdown is not reset on each visit)
 *   - HttpOnly: true — JS cannot read or tamper with it
 *   - SameSite: Lax — sent on same-site navigations, blocked on CSRF attempts
 *   - Secure: production only (set via NODE_ENV check)
 *   - Not issued for admin sessions (req.session.user?.role === 'admin')
 *
 * The visitor cookie is the ONLY cookie this module manages.
 * It is separate from the session cookie which tracks authentication state.
 */

import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import {
  VISITOR_COOKIE_NAME,
  VISITOR_COOKIE_MAX_AGE_SECONDS,
} from "./analyticsConfig";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

/**
 * Read the existing visitor ID cookie, or generate + set a new one.
 *
 * Skips issuing a new cookie for:
 *   - Admin-authenticated requests (role === 'admin')
 *   - Requests with no response object (should not occur in express middleware)
 *
 * @returns The visitor UUID string (existing or freshly generated).
 *          Returns null only for admin sessions.
 */
export function getOrCreateVisitorId(
  req: Request,
  res: Response,
): string | null {
  // Do not track admin sessions in analytics
  if (req.session?.user?.role === "admin") {
    return null;
  }

  const existing = req.cookies?.[VISITOR_COOKIE_NAME];
  if (existing && isValidUuid(existing)) {
    return existing;
  }

  // Issue a new visitor ID
  const newId = randomUUID();
  res.cookie(VISITOR_COOKIE_NAME, newId, {
    httpOnly: true,
    sameSite: "lax",
    secure: IS_PRODUCTION,
    maxAge: VISITOR_COOKIE_MAX_AGE_SECONDS * 1000, // express expects ms
    path: "/",
  });

  return newId;
}

/**
 * Read the existing visitor ID from the request without issuing a new one.
 * Used for analytics-ingestion endpoints that receive events from the frontend
 * (the cookie was already set on the page load request).
 *
 * Returns null if no valid cookie is present.
 */
export function readVisitorId(req: Request): string | null {
  const value = req.cookies?.[VISITOR_COOKIE_NAME];
  if (value && isValidUuid(value)) return value;
  return null;
}

// ── Source attribution from request context ───────────────────────────────────

/**
 * Resolve the traffic source for this request by examining:
 *   1. UTM parameters (paid_campaign if utm_source present + utm_medium=cpc|paid|email)
 *   2. QR campaign ID in the path / query  
 *   3. Referrer domain matching
 *   4. presence of search_session_id → internal_search
 *   5. Otherwise: direct
 *
 * The frontend sends these via the analytics event payload. This function
 * handles the server-side resolution for server-recorded events (search,
 * profile_view, favorite_remove).
 */
export function resolveSource(opts: {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  referrerDomain?: string | null;
  qrCampaignId?: string | null;
  searchSessionId?: string | null;
}): string {
  const { utmSource, utmMedium, qrCampaignId, referrerDomain, searchSessionId } =
    opts;

  if (qrCampaignId) return "qr";

  if (utmSource) {
    const medium = (utmMedium ?? "").toLowerCase();
    if (
      medium === "cpc" ||
      medium === "paid" ||
      medium === "paidsearch" ||
      medium === "paid_social" ||
      medium === "email"
    ) {
      return "paid_campaign";
    }
    if (medium === "social" || isSocialDomain(utmSource)) return "social";
    return "referral";
  }

  if (referrerDomain) {
    if (isSearchEngineDomain(referrerDomain)) return "organic_search";
    if (isSocialDomain(referrerDomain)) return "social";
    if (isWhatsAppDomain(referrerDomain)) return "whatsapp_share";
    return "referral";
  }

  if (searchSessionId) return "internal_search";

  return "direct";
}

/**
 * Extract the domain-only portion of a Referer/Origin header value.
 * Strips scheme, port, path, and query.
 */
export function extractReferrerDomain(
  referrer: string | undefined,
): string | null {
  if (!referrer) return null;
  try {
    const url = new URL(
      referrer.startsWith("http") ? referrer : `https://${referrer}`,
    );
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(v: string): boolean {
  return UUID_RE.test(v);
}

const SEARCH_ENGINE_DOMAINS = [
  "google.com", "google.com.sa", "google.ae", "bing.com", "yahoo.com",
  "duckduckgo.com", "yandex.ru", "baidu.com", "ask.com",
];

function isSearchEngineDomain(domain: string): boolean {
  return SEARCH_ENGINE_DOMAINS.some(
    (d) => domain === d || domain.endsWith(`.${d}`),
  );
}

const SOCIAL_DOMAINS = [
  "facebook.com", "instagram.com", "twitter.com", "x.com", "linkedin.com",
  "tiktok.com", "snapchat.com", "youtube.com", "t.me", "telegram.org",
];

function isSocialDomain(domain: string): boolean {
  return SOCIAL_DOMAINS.some(
    (d) => domain === d || domain.endsWith(`.${d}`),
  );
}

const WHATSAPP_DOMAINS = ["wa.me", "whatsapp.com", "api.whatsapp.com"];

function isWhatsAppDomain(domain: string): boolean {
  return WHATSAPP_DOMAINS.some(
    (d) => domain === d || domain.endsWith(`.${d}`),
  );
}
