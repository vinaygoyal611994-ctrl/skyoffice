// Supports showing the Decision Card (office profile) as a full-screen overlay
// above the page the customer was already on, instead of a real page navigation.
//
// Approach: wrap wouter's navigation (`aroundNav`) to remember, purely in memory,
// which location we were on right before navigating into `/offices/:id`. The app
// router then keeps rendering that background location's page (e.g. Home) behind
// the overlay, and closing the overlay simply navigates back to that exact
// location — the background page is never unmounted, so its component state
// (search text, selected category) and scroll position are preserved with no
// extra plumbing and no URL/query-string changes.
//
// If `/offices/:id` is the first location of the session (a direct link or QR
// scan, not an in-app click), there is no recorded background location, and the
// Decision Card renders as an ordinary standalone page instead.

let backgroundLocation: string | null = null;
let modalTriggerElement: HTMLElement | null = null;

// Matches the legacy numeric route (/offices/:id) and the canonical
// slug-based public routes (/office/:slug, /ar/office/:slug,
// /en/office/:slug) — but NOT /office/dashboard, which is an unrelated
// office-portal route that happens to share the singular "/office" prefix.
const OFFICE_PROFILE_PATTERN = /^\/offices\/[^/]+|^\/office\/(?!dashboard(?:\/|$))[^/]+|^\/(ar|en)\/office\/[^/]+/;

export function officeModalAroundNav(
  navigate: (to: string, opts?: any) => void,
  to: string,
  opts?: any
) {
  if (typeof window !== 'undefined') {
    const from = window.location.pathname + window.location.search;
    const toPath = to.split('?')[0];
    const enteringOfficeModal = OFFICE_PROFILE_PATTERN.test(toPath) && !OFFICE_PROFILE_PATTERN.test(from);

    if (enteringOfficeModal) {
      backgroundLocation = from;
      modalTriggerElement = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    } else if (!OFFICE_PROFILE_PATTERN.test(toPath)) {
      backgroundLocation = null;
      modalTriggerElement = null;
    }
  }

  navigate(to, opts);
}

export function getOfficeModalBackgroundLocation() {
  return backgroundLocation;
}

export function getOfficeModalTrigger() {
  return modalTriggerElement;
}

export function clearOfficeModalTrigger() {
  modalTriggerElement = null;
}
