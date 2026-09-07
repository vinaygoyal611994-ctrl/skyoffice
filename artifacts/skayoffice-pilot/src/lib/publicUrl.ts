import type { Language } from '@/lib/i18n';

/**
 * Canonical production base URL for every public-facing link this app
 * generates — the homepage "Share SkayOffice" link, office share/QR links,
 * everything. Comes from exactly one source: VITE_PUBLIC_APP_URL, set at
 * build time (the official production domain is "https://skayoffice.com").
 *
 * Deliberately has NO runtime fallback to `window.location.origin` /
 * `window.location.href` — a shared/public link must never be derived from
 * whatever origin happened to serve the current page (a *.replit.dev
 * preview domain, a stale tab, etc.). If VITE_PUBLIC_APP_URL is missing,
 * that is a configuration bug: fail loudly in the console rather than
 * silently handing out a wrong or unreachable URL.
 */
function getAppBaseUrl(): string {
  const configured = import.meta.env.VITE_PUBLIC_APP_URL as string | undefined;
  if (configured && configured.trim()) return configured.trim().replace(/\/+$/, '');

  // eslint-disable-next-line no-console
  console.error(
    'VITE_PUBLIC_APP_URL is not configured. Public share/QR links cannot be ' +
      'generated correctly. Set VITE_PUBLIC_APP_URL to the production URL ' +
      '"https://skayoffice.com" in both the shared and ' +
      'production environment configuration — never a *.replit.dev preview URL.'
  );
  return '';
}

// ---------------------------------------------------------------------------
// Startup validation — runs once when this module is first imported.
// Catches a missing or misconfigured VITE_PUBLIC_APP_URL at page load so
// the problem is visible in the browser console immediately, not only when
// the first user attempts to open a share/QR dialog.
// ---------------------------------------------------------------------------
(function validatePublicAppUrlOnStartup() {
  const url = import.meta.env.VITE_PUBLIC_APP_URL as string | undefined;
  if (!url || !url.trim()) {
    // eslint-disable-next-line no-console
    console.warn(
      '[SkayOffice] VITE_PUBLIC_APP_URL is not set. ' +
      'Share, copy-link, and QR code URLs will be empty in production. ' +
      'Set VITE_PUBLIC_APP_URL to the canonical production domain ' +
      '"https://skayoffice.com" in both the shared and ' +
      'production environment configuration.',
    );
  } else if (url.includes('.replit.dev') || url.includes('.repl.co')) {
    // eslint-disable-next-line no-console
    console.warn(
      '[SkayOffice] VITE_PUBLIC_APP_URL is set to a Replit preview domain: ' +
      url + '. This URL changes per session and will produce broken share/QR ' +
      'links for other users. Replace it with the stable production domain.',
    );
  }
})();

/**
 * Builds the office's canonical, stable public URL:
 * `${base}/${language}/office/${slug}` — independent of the office's
 * internal numeric id, so already-printed/shared/scanned links keep
 * working even if the id changes. Used consistently for the QR code,
 * copy-link, native share, and WhatsApp share so every surface points to
 * the same canonical link.
 */
export function getOfficePublicUrl(slug: string, language: Language): string {
  return `${getAppBaseUrl()}/${language}/office/${slug}`;
}

/**
 * The single URL used for platform-level sharing (the homepage "Share
 * SkayOffice" section) — copying/sharing the *platform itself*, not any
 * specific office.
 *
 * Always the bare production root, with no query string, hash, or other
 * parameter. The homepage itself is responsible for always starting in a
 * clean default state (empty search, "All" category) on every load — see
 * the mount-time reset effect and `onHomeFiltersResetRequested` handling in
 * home.tsx — so no URL-based workaround is needed here.
 */
export function getPlatformShareUrl(): string {
  return `${getAppBaseUrl()}/`;
}
