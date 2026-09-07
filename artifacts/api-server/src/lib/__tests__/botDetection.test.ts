/**
 * Unit tests — botDetection.ts
 *
 * Covers:
 *   - detectBot: all bot categories (known_bot, preview_bot, uptime_monitor,
 *     headless_browser, automation)
 *   - detectBot: real browser UAs should NOT be flagged
 *   - detectBot: blank / short / null / undefined UA → automation
 *   - detectBot: case-insensitivity of all patterns
 *   - detectBot: botDetectionVersion always present
 *   - isHealthCheckPath: known health paths + non-health paths
 */

import { describe, it, expect } from "vitest";
import { detectBot, isHealthCheckPath } from "../botDetection";

// ── Helper ────────────────────────────────────────────────────────────────────

// Real browser UAs (must not be flagged as bots)
const REAL_BROWSER_UAS = [
  // Chrome on Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  // Chrome on Android
  "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.71 Mobile Safari/537.36",
  // Safari on iPhone
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  // Firefox on Linux
  "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0",
  // Safari on macOS
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  // Edge on Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
  // Samsung Internet
  "Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
];

// ── detectBot — real browsers ─────────────────────────────────────────────────

describe("detectBot — real browser UAs", () => {
  for (const ua of REAL_BROWSER_UAS) {
    it(`does NOT flag real browser: ${ua.slice(0, 50)}...`, () => {
      const result = detectBot(ua);
      expect(result.isBot).toBe(false);
      expect(result.exclusionReason).toBeNull();
    });
  }
});

// ── detectBot — always provides version ──────────────────────────────────────

describe("detectBot — botDetectionVersion", () => {
  it("always returns a non-empty botDetectionVersion", () => {
    const result = detectBot("Mozilla/5.0 Chrome/126.0.0.0");
    expect(result.botDetectionVersion).toBeTruthy();
    expect(typeof result.botDetectionVersion).toBe("string");
  });

  it("returns the same version for bot UAs", () => {
    const result = detectBot("Googlebot/2.1");
    expect(result.botDetectionVersion).toBeTruthy();
  });
});

// ── detectBot — search engine bots (bot_ua) ───────────────────────────────────

describe("detectBot — search engine bots (bot_ua)", () => {
  const searchBots = [
    ["Googlebot/2.1 (+http://www.google.com/bot.html)", "googlebot"],
    ["Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)", "bingbot"],
    ["Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)", "yandexbot"],
    ["Baiduspider+(+http://www.baidu.com/search/spider.htm)", "baiduspider"],
    ["DuckDuckBot/1.0; (+http://duckduckgo.com/duckduckbot.html)", "duckduckbot"],
    ["Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)", "yahoo slurp"],
    ["Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)", "semrushbot"],
    ["Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)", "ahrefsbot"],
    ["Mozilla/5.0 (compatible; MJ12bot/v1.4.8; http://mj12bot.com/)", "mj12bot"],
    ["Mozilla/5.0 (compatible; DotBot/1.2; +https://opensiteexplorer.org/dotbot)", "dotbot"],
    ["rogerbot/1.0 (http://www.moz.com/dp/rogerbot)", "rogerbot"],
    ["Linkdex/1.0 Linkdexbot/2.0; +http://www.linkdex.com/about/bots/", "linkdexbot"],
    ["Mozilla/5.0 (compatible; Exabot/3.0; +http://www.exabot.com/go/robot)", "exabot"],
    ["ia_archiver (+http://www.alexa.com/site/help/webmasters; crawler@alexa.com)", "ia_archiver"],
    ["Mozilla/5.0 (compatible; archive.org_bot +http://www.archive.org/details/archive.org_bot)", "archive.org"],
    ["Mozilla/5.0 (compatible; SeznamBot/3.2-test2; +http://napoveda.seznam.cz/en/seznambot-intro/)", "seznambot"],
    ["Mozilla/5.0 (compatible; BLEXBot/1.0; +http://webmeup-crawler.com/)", "blexbot"],
    ["Mozilla/5.0 (compatible; spbot/5.0.3; +http://www.seoprofiler.com/bot)", "spbot"],
    ["Screaming Frog SEO Spider/18.0", "screaming frog"],
  ];

  for (const [ua, name] of searchBots) {
    it(`detects ${name} as bot_ua`, () => {
      const result = detectBot(ua);
      expect(result.isBot).toBe(true);
      expect(result.exclusionReason).toBe("bot_ua");
    });
  }
});

// ── detectBot — preview bots (preview_bot) ────────────────────────────────────

describe("detectBot — preview bots (preview_bot)", () => {
  const previewBots = [
    ["facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)", "facebook preview"],
    ["Twitterbot/1.0", "twitter preview"],
    ["LinkedInBot/1.0 (compatible; Mozilla/5.0; Jakarta Commons-HttpClient/3.1 +http://www.linkedin.com)", "linkedin preview"],
    ["WhatsApp/2.23.24.78 A", "whatsapp preview"],
    ["TelegramBot (like TwitterBot)", "telegram preview"],
    ["Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)", "slack preview"],
    ["Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)", "discord preview"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 7_0 like Mac OS X) Snapchat/9.0.0", "snapchat preview"],
    ["Mozilla/5.0 (compatible; Applebot/0.1; +http://www.apple.com/go/applebot)", "applebot"],
    ["Pinterest/0.2 (+https://www.pinterest.com/bot.html)Mozilla/5.0", "pinterest"],
    ["Iframely/1.3.1 (+https://iframely.com/docs/about)", "iframely"],
    ["Mozilla/5.0 (compatible; embedly/0.1; +http://support.embed.ly/)", "embedly"],
  ];

  for (const [ua, name] of previewBots) {
    it(`detects ${name} as preview_bot`, () => {
      const result = detectBot(ua);
      expect(result.isBot).toBe(true);
      expect(result.exclusionReason).toBe("preview_bot");
    });
  }
});

// ── detectBot — uptime monitors (uptime_monitor) ──────────────────────────────

describe("detectBot — uptime monitors (uptime_monitor)", () => {
  const uptimeBots = [
    ["Mozilla/5.0+(compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)", "uptimerobot"],
    ["Pingdom.com_bot_version_1.4_(http://www.pingdom.com/)", "pingdom"],
    ["Mozilla/5.0 (compatible; Site24x7 uptime Monitoring; http://www.site24x7.com/bot.html)", "site24x7"],
    ["StatusCake TEST Agent v1.0", "statuscake"],
    ["FreshPing/1.0 (+https://www.freshping.io)", "freshping"],
    ["HetrixTools Uptime Monitor/1.0", "hetrixtools"],
    ["NewRelic Synthetics/1.0", "newrelic synthetics"],
    ["Datadog/Synthetics monitoring agent", "datadog/synthetics"],
    ["Zabbix/5.4 (http://www.zabbix.com/)", "zabbix"],
  ];

  for (const [ua, name] of uptimeBots) {
    it(`detects ${name} as uptime_monitor`, () => {
      const result = detectBot(ua);
      expect(result.isBot).toBe(true);
      expect(result.exclusionReason).toBe("uptime_monitor");
    });
  }
});

// ── detectBot — headless browsers (headless_browser) ─────────────────────────

describe("detectBot — headless browsers (headless_browser)", () => {
  const headlessBots = [
    ["Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0.0.0 Safari/537.36", "headless chrome"],
    ["Mozilla/5.0 (Unknown; Linux x86_64) AppleWebKit/534.34 (KHTML, like Gecko) PhantomJS/1.9.8 Safari/534.34", "phantomjs"],
    ["Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.101 Safari/537.36 Playwright/1.0", "playwright"],
    ["Mozilla/5.0 Puppeteer/19.0.0 Chrome/107.0.0.0", "puppeteer"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Selenium/4.0", "selenium"],
  ];

  for (const [ua, name] of headlessBots) {
    it(`detects ${name} as headless_browser`, () => {
      const result = detectBot(ua);
      expect(result.isBot).toBe(true);
      expect(result.exclusionReason).toBe("headless_browser");
    });
  }
});

// ── detectBot — automation tools (automation) ─────────────────────────────────

describe("detectBot — automation tools (automation)", () => {
  const automationBots = [
    ["python-requests/2.31.0", "python-requests"],
    ["Python-urllib/3.11", "python-urllib"],
    ["Go-http-client/2.0", "go-http-client"],
    ["Java/17.0.7", "java"],
    ["okhttp/4.9.0", "okhttp"],
    ["axios/1.4.0", "axios"],
    ["curl/7.88.1", "curl"],
    ["Wget/1.21.4", "wget"],
    ["HTTPie/3.2.2", "httpie"],
    ["libwww-perl/6.72", "libwww-perl"],
    ["node-fetch/3.0.0", "node-fetch"],
  ];

  for (const [ua, name] of automationBots) {
    it(`detects ${name} as automation`, () => {
      const result = detectBot(ua);
      expect(result.isBot).toBe(true);
      expect(result.exclusionReason).toBe("automation");
    });
  }
});

// ── detectBot — blank / missing UA ────────────────────────────────────────────

describe("detectBot — blank or missing UA", () => {
  it("flags null UA as automation", () => {
    const result = detectBot(null);
    expect(result.isBot).toBe(true);
    expect(result.exclusionReason).toBe("automation");
  });

  it("flags undefined UA as automation", () => {
    const result = detectBot(undefined);
    expect(result.isBot).toBe(true);
    expect(result.exclusionReason).toBe("automation");
  });

  it("flags empty string UA as automation", () => {
    const result = detectBot("");
    expect(result.isBot).toBe(true);
    expect(result.exclusionReason).toBe("automation");
  });

  it("flags very short UA (< 10 chars) as automation", () => {
    const result = detectBot("bot");
    expect(result.isBot).toBe(true);
    expect(result.exclusionReason).toBe("automation");
  });

  it("flags whitespace-only UA as automation", () => {
    const result = detectBot("   ");
    expect(result.isBot).toBe(true);
    expect(result.exclusionReason).toBe("automation");
  });

  it("accepts a UA of exactly 10 characters if it doesn't match patterns", () => {
    // 10 chars, no bot pattern
    const result = detectBot("Mozilla/5X");
    expect(result.isBot).toBe(false);
  });
});

// ── detectBot — case insensitivity ────────────────────────────────────────────

describe("detectBot — case insensitivity", () => {
  it("detects GOOGLEBOT (uppercase) as bot_ua", () => {
    const result = detectBot("GOOGLEBOT/2.1");
    expect(result.isBot).toBe(true);
    expect(result.exclusionReason).toBe("bot_ua");
  });

  it("detects Googlebot (mixed case) as bot_ua", () => {
    const result = detectBot("Googlebot/2.1");
    expect(result.isBot).toBe(true);
    expect(result.exclusionReason).toBe("bot_ua");
  });

  it("detects PYTHON-REQUESTS (uppercase) as automation", () => {
    const result = detectBot("PYTHON-REQUESTS/2.31.0");
    expect(result.isBot).toBe(true);
    expect(result.exclusionReason).toBe("automation");
  });

  it("detects HEADLESSCHROME (uppercase) as headless_browser", () => {
    const result = detectBot("Mozilla/5.0 HEADLESSCHROME/126");
    expect(result.isBot).toBe(true);
    expect(result.exclusionReason).toBe("headless_browser");
  });
});

// ── detectBot — return shape ──────────────────────────────────────────────────

describe("detectBot — return object shape", () => {
  it("always returns isBot, exclusionReason, botDetectionVersion", () => {
    const result = detectBot("Mozilla/5.0 Chrome/126.0.0.0");
    expect(typeof result.isBot).toBe("boolean");
    expect(result.exclusionReason === null || typeof result.exclusionReason === "string").toBe(true);
    expect(typeof result.botDetectionVersion).toBe("string");
  });

  it("does not throw on any input", () => {
    const inputs: Array<string | null | undefined> = [
      null, undefined, "", " ", "a", "a".repeat(10000),
      "Googlebot/2.1", "Mozilla/5.0 Chrome/126",
    ];
    for (const ua of inputs) {
      expect(() => detectBot(ua)).not.toThrow();
    }
  });
});

// ── isHealthCheckPath ─────────────────────────────────────────────────────────

describe("isHealthCheckPath", () => {
  // Should return true (health check paths)
  const healthPaths = [
    "/health",
    "/healthz",
    "/ping",
    "/ready",
    "/liveness",
    "/metrics",
    "/health?verbose=1",
    "/healthz?check=all",
    "/HEALTH",      // case-insensitive
    "/HEALTHZ",
    "/PING",
    "/Metrics",
  ];

  for (const path of healthPaths) {
    it(`returns true for health path: ${path}`, () => {
      expect(isHealthCheckPath(path)).toBe(true);
    });
  }

  // Should return false (non-health paths)
  const nonHealthPaths = [
    "/",
    "/api",
    "/api/health",       // health is a sub-path, not the exact path
    "/offices",
    "/admin/health",     // health is not at root
    "/health/check",     // has a sub-path
    "/healthcheck",      // not an exact match for /health
    "/api/offices",
    "/analytics/events",
    "",
  ];

  for (const path of nonHealthPaths) {
    it(`returns false for non-health path: ${path}`, () => {
      expect(isHealthCheckPath(path)).toBe(false);
    });
  }
});
