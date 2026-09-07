// Autoscale's infrastructure layer replaces this app's `Set-Cookie` header
// before it reaches the browser, so the published site can't rely on a
// cookie-delivered session id (see artifacts/api-server/src/app.ts for the
// server-side half of this). Login/register instead return the session id
// in the JSON response body, and we carry it ourselves — stored here, and
// resent as `Authorization: Bearer <token>` on every API request via
// `setAuthTokenGetter` (wired up in main.tsx).
const STORAGE_KEY = 'skayoffice.sessionToken';

// ---------------------------------------------------------------------------
// Storage strategy — sessionStorage only (security hardening)
//
// Autoscale strips HttpOnly cookies before they reach the browser, so the
// Bearer token must live in JS-accessible storage.  We store the token
// exclusively in sessionStorage (tab-scoped; cleared when the browser
// session ends or all tabs close).  This eliminates the long-lived
// localStorage mirror that existed previously, which persisted the token
// indefinitely on the device and increased the blast radius of an XSS attack.
//
// Trade-off: a new tab opened while the user is already logged in will not
// automatically inherit the session.  The user sees the login page and
// re-authenticates, which issues a fresh session token.  This is the
// correct security posture — a new tab is a new browser context that has
// not yet proven the user's identity.
//
// The CSP `script-src 'self'` remains the primary XSS mitigation; this is
// a defence-in-depth layer that removes persistent token storage from the
// attack surface.
// ---------------------------------------------------------------------------

export function getSessionToken(): string | null {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setSessionToken(token: string | null | undefined): void {
  try {
    if (token) {
      window.sessionStorage.setItem(STORAGE_KEY, token);
    } else {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Storage unavailable (e.g. private mode) — session simply won't
    // persist across reloads, but the current tab keeps working.
  }
}

export function clearSessionToken(): void {
  setSessionToken(null);
}

/** Pulls `sessionToken` off a login/register response body, if present,
 * and stores it. Safe to call on any response shape. */
export function captureSessionToken(data: unknown): void {
  if (data && typeof data === 'object' && 'sessionToken' in data) {
    const token = (data as { sessionToken?: unknown }).sessionToken;
    if (typeof token === 'string') {
      setSessionToken(token);
    }
  }
}

/**
 * `fetch` wrapper that attaches the stored bearer token, for the handful of
 * call sites that talk to the API directly instead of going through the
 * generated `@workspace/api-client-react` hooks (which already attach it
 * via `setAuthTokenGetter` in main.tsx — see custom-fetch.ts).
 *
 * Without this, direct `fetch()` calls (e.g. the object-storage upload-URL
 * request in dashboard.tsx) silently rely on a `connect.sid` cookie that
 * never arrives on the published Autoscale deployment (see
 * autoscale-cookie-stripping in .agents/memory), so they 401 in production
 * while working fine in dev — which reads as an upload that "hangs" or
 * never starts, since the request never got a working credential at all.
 */
export async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = getSessionToken();
  const headers = new Headers(init.headers);
  if (token && !headers.has('authorization')) {
    headers.set('authorization', `Bearer ${token}`);
  }
  return fetch(url, { ...init, headers });
}
