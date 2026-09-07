/**
 * Bot detection — Phase 1, version 1.0.
 *
 * Rule-based User-Agent classification. Returns a BotDetectionResult that
 * contains both whether the request is a bot and the exclusion reason (for
 * analytics_events.exclusion_reason and bot_detection_version columns).
 *
 * Version bumped in MEMORY/analyticsConfig.ts when rules change; stored
 * alongside each event so historical classification can be reprocessed.
 *
 * Not all automation is treated identically:
 *   - known_bot / preview_bot / uptime_monitor: excluded from all metrics
 *   - headless_browser / automation: excluded from all metrics but flagged
 *     separately for potential fraud review
 *
 * Future: add IP-range blocklists, request-rate heuristics, honeypot paths.
 * Those will be version 2.x; do NOT add them here without bumping the version.
 */

import { BOT_DETECTION_VERSION } from "./analyticsConfig";
import type { AnalyticsExclusionReason } from "./analyticsEventTaxonomy";

export interface BotDetectionResult {
  isBot: boolean;
  exclusionReason: AnalyticsExclusionReason | null;
  botDetectionVersion: string;
}

// ── Known-bot UA substrings (case-insensitive) ────────────────────────────────
// Ordered from most-specific to least-specific. The first match wins.

const KNOWN_BOT_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  reason: AnalyticsExclusionReason;
}> = [
  // Search engine crawlers
  { pattern: /googlebot/i,          reason: "bot_ua" },
  { pattern: /bingbot/i,            reason: "bot_ua" },
  { pattern: /yandexbot/i,          reason: "bot_ua" },
  { pattern: /baiduspider/i,        reason: "bot_ua" },
  { pattern: /duckduckbot/i,        reason: "bot_ua" },
  { pattern: /slurp/i,              reason: "bot_ua" }, // Yahoo Slurp
  { pattern: /semrushbot/i,         reason: "bot_ua" },
  { pattern: /ahrefsbot/i,          reason: "bot_ua" },
  { pattern: /mj12bot/i,            reason: "bot_ua" },
  { pattern: /dotbot/i,             reason: "bot_ua" },
  { pattern: /rogerbot/i,           reason: "bot_ua" },
  { pattern: /linkdexbot/i,         reason: "bot_ua" },
  { pattern: /exabot/i,             reason: "bot_ua" },
  { pattern: /ia_archiver/i,        reason: "bot_ua" }, // Wayback Machine
  { pattern: /archive\.org/i,       reason: "bot_ua" },
  { pattern: /seznambot/i,          reason: "bot_ua" },
  { pattern: /blexbot/i,            reason: "bot_ua" },
  { pattern: /spbot/i,              reason: "bot_ua" },
  { pattern: /scoutjet/i,           reason: "bot_ua" },
  { pattern: /screaming frog/i,     reason: "bot_ua" },

  // Social / preview bots (fetch for link previews)
  { pattern: /facebookexternalhit/i, reason: "preview_bot" },
  { pattern: /twitterbot/i,          reason: "preview_bot" },
  { pattern: /linkedinbot/i,         reason: "preview_bot" },
  { pattern: /whatsapp/i,            reason: "preview_bot" },
  { pattern: /telegrambot/i,         reason: "preview_bot" },
  { pattern: /slackbot/i,            reason: "preview_bot" },
  { pattern: /discordbot/i,          reason: "preview_bot" },
  { pattern: /snapchat/i,            reason: "preview_bot" },
  { pattern: /applebot/i,            reason: "preview_bot" },
  { pattern: /pinterest/i,           reason: "preview_bot" },
  { pattern: /roam research/i,       reason: "preview_bot" },
  { pattern: /iframely/i,            reason: "preview_bot" },
  { pattern: /embedly/i,             reason: "preview_bot" },

  // Uptime / monitoring services
  { pattern: /uptimerobot/i,        reason: "uptime_monitor" },
  { pattern: /pingdom/i,            reason: "uptime_monitor" },
  { pattern: /site24x7/i,           reason: "uptime_monitor" },
  { pattern: /statuscake/i,         reason: "uptime_monitor" },
  { pattern: /freshping/i,          reason: "uptime_monitor" },
  { pattern: /hetrixtools/i,        reason: "uptime_monitor" },
  { pattern: /newrelic synthetics/i, reason: "uptime_monitor" },
  { pattern: /datadog\/synthetics/i, reason: "uptime_monitor" },
  { pattern: /zabbix/i,             reason: "uptime_monitor" },

  // Headless / browser automation
  { pattern: /headlesschrome/i,     reason: "headless_browser" },
  { pattern: /phantomjs/i,          reason: "headless_browser" },
  { pattern: /playwright/i,         reason: "headless_browser" },
  { pattern: /puppeteer/i,          reason: "headless_browser" },
  { pattern: /selenium/i,           reason: "headless_browser" },

  // Generic automation signals (lower confidence, match last)
  { pattern: /python-requests/i,    reason: "automation" },
  { pattern: /python-urllib/i,      reason: "automation" },
  { pattern: /go-http-client/i,     reason: "automation" },
  { pattern: /java\//i,             reason: "automation" },
  { pattern: /okhttp/i,             reason: "automation" },
  { pattern: /axios/i,              reason: "automation" },
  { pattern: /curl\//i,             reason: "automation" },
  { pattern: /wget\//i,             reason: "automation" },
  { pattern: /httpie/i,             reason: "automation" },
  { pattern: /libwww-perl/i,        reason: "automation" },
  { pattern: /node-fetch/i,         reason: "automation" },
];

// Blank or suspiciously short user-agents are also flagged as automation.
const UA_MIN_LENGTH = 10;

/**
 * Classify a User-Agent string.
 *
 * @param ua - The value of the `User-Agent` request header, or undefined/null
 *             if the header was absent.
 * @returns BotDetectionResult — always present, never throws.
 */
export function detectBot(ua: string | undefined | null): BotDetectionResult {
  const base: BotDetectionResult = {
    isBot: false,
    exclusionReason: null,
    botDetectionVersion: BOT_DETECTION_VERSION,
  };

  if (!ua || ua.trim().length < UA_MIN_LENGTH) {
    return { ...base, isBot: true, exclusionReason: "automation" };
  }

  for (const { pattern, reason } of KNOWN_BOT_PATTERNS) {
    if (pattern.test(ua)) {
      return { ...base, isBot: true, exclusionReason: reason };
    }
  }

  return base;
}

/**
 * Returns true if the request path looks like an internal health or
 * readiness probe that should be excluded from analytics entirely.
 */
export function isHealthCheckPath(path: string): boolean {
  return /^\/(health|healthz|ping|ready|liveness|metrics)(\?.*)?$/i.test(path);
}
