/**
 * Analytics event taxonomy — Phase 1.
 *
 * This module is the single source of truth for valid event names.
 * Every event stored in analytics_events must have a name from this list.
 *
 * Event naming convention: <noun>_<past_tense_verb>
 *
 * Events tracked directly in analytics_events (Phase 1):
 *
 *   DISCOVERY (server-side, high confidence)
 *   ─────────────────────────────────────────
 *   search_performed          — A non-empty search was executed (server logs it on GET /offices with ?search=)
 *   office_profile_view       — An active office profile page was served (server logs on GET /offices/:slug)
 *
 *   DISCOVERY (client-side, needs JS)
 *   ─────────────────────────────────
 *   office_card_impression    — 50% of a card visible for ≥1s (IntersectionObserver, batched)
 *   office_card_click         — User clicked on an office card to open its profile
 *
 *   ENGAGEMENT (client-side)
 *   ────────────────────────
 *   video_start               — Video playback started (>0s)
 *   video_complete            — Video played to ≥80% of duration
 *   gallery_interaction       — User swiped/navigated the photo gallery
 *   copy_link                 — User copied the share link to clipboard / used native share
 *
 *   SUPPLY (client + server)
 *   ────────────────────────
 *   office_registration_started — Office user reached registration step 1 (client)
 *   favorite_remove           — Authenticated customer removed an office from favourites (server)
 *
 * Events NOT stored in analytics_events (derived at aggregation time):
 *   - favorite_add            ← favourites table (INSERT)
 *   - whatsapp_click          ← contact_events (actionType='whatsapp_click')
 *   - map_click               ← contact_events (actionType='location_click')
 *   - share_click             ← contact_events (actionType='share_click')
 *   - video_call_request      ← contact_events (actionType='video_call_request')
 *   - office_registration_completed ← audit_log (event='office.register')
 *   - office_profile_submitted ← audit_log (event='office.application.submit')
 *   - office_profile_approved ← audit_log (event='office.application.approve')
 *   - office_profile_rejected ← audit_log (event='office.application.reject')
 *   - office_activated        ← audit_log (event='office.application.activate')
 *   - office_suspended        ← audit_log (event='office.application.suspend')
 *   - review_submitted        ← service_request_reviews (INSERT)
 *
 * Note on derived events:
 *   qr_visit = profile_view WHERE source='qr' (not a separate row)
 *   search_zero_results = search_performed WHERE search_results_count=0 (not a separate row)
 */

import { z } from "zod";

export const ANALYTICS_EVENT_NAMES = [
  // Discovery — server-side
  "search_performed",
  "office_profile_view",
  // Discovery — client-side
  "office_card_impression",
  "office_card_click",
  // Engagement — client-side
  "video_start",
  "video_complete",
  "gallery_interaction",
  "copy_link",
  // Supply — mixed
  "office_registration_started",
  "favorite_remove",
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];

/** Validate that a string is a known Phase 1 event name. */
export const analyticsEventNameSchema = z.enum(ANALYTICS_EVENT_NAMES);

export const ANALYTICS_SOURCE_VALUES = [
  "direct",
  "internal_search",
  "qr",
  "social",
  "referral",
  "paid_campaign",
  "organic_search",
  "whatsapp_share",
  "unknown",
] as const;
export type AnalyticsSource = (typeof ANALYTICS_SOURCE_VALUES)[number];

export const ANALYTICS_INPUT_METHOD_VALUES = ["typed", "voice"] as const;
export type AnalyticsInputMethod =
  (typeof ANALYTICS_INPUT_METHOD_VALUES)[number];

export const ANALYTICS_INTERFACE_LANGUAGE_VALUES = ["ar", "en"] as const;
export type AnalyticsInterfaceLanguage =
  (typeof ANALYTICS_INTERFACE_LANGUAGE_VALUES)[number];

export const ANALYTICS_DEVICE_CATEGORY_VALUES = [
  "desktop",
  "mobile",
  "tablet",
  "unknown",
] as const;
export type AnalyticsDeviceCategory =
  (typeof ANALYTICS_DEVICE_CATEGORY_VALUES)[number];

export const ANALYTICS_SEARCH_INTENT_VALUES = [
  "find_office",
  "find_nearest",
  "find_highest_rated",
  "find_specific_service",
  "compare_offices",
  "general_question",
  "unknown",
] as const;
export type AnalyticsSearchIntent =
  (typeof ANALYTICS_SEARCH_INTENT_VALUES)[number];

export const ANALYTICS_EXCLUSION_REASONS = [
  "bot_ua",
  "preview_bot",
  "uptime_monitor",
  "headless_browser",
  "automation",
  "admin_session",
  "health_check",
  "duplicate",
  "test_traffic",
] as const;
export type AnalyticsExclusionReason =
  (typeof ANALYTICS_EXCLUSION_REASONS)[number];

/**
 * Attribution priority order (highest priority first).
 * Used by visitorSession.ts when resolving source for an event.
 */
export const SOURCE_ATTRIBUTION_PRIORITY: AnalyticsSource[] = [
  "qr",
  "paid_campaign",
  "social",
  "organic_search",
  "whatsapp_share",
  "referral",
  "internal_search",
  "direct",
  "unknown",
];
