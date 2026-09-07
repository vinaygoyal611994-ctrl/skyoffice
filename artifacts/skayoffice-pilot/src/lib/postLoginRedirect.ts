// Preserves "return to the same Decision Card after login" when a customer
// taps a gated contact action (WhatsApp, video call, location, share) while
// logged out. We stash the current office-profile path before redirecting to
// the login page, then consume it once login succeeds.
//
// sessionStorage (not in-memory) survives the full page navigation to
// /login/customer and back.

const KEY = 'skayoffice-post-login-redirect';

export function stashPostLoginRedirect(path: string) {
  try {
    sessionStorage.setItem(KEY, path);
  } catch {
    // storage unavailable; the user will just land on the default page
  }
}

export function consumePostLoginRedirect(): string | null {
  try {
    const value = sessionStorage.getItem(KEY);
    if (value) sessionStorage.removeItem(KEY);
    return value;
  } catch {
    return null;
  }
}
