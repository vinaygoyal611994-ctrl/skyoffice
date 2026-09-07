// Lets any "go to the SkayOffice homepage" affordance (header logo, footer
// logo, mobile-menu home link, ...) force the homepage's discovery filters
// (search text, category) back to their defaults, even when wouter doesn't
// consider it a navigation because the user is already on "/".
//
// Why this exists: `Home`'s own effect resets filters whenever the current
// path *changes* to "/", which covers a fresh load of the shared platform
// link and in-app navigation from another route (e.g. /discover). But
// clicking the logo while already sitting on "/" with a stale search is a
// same-path click — wouter's location string doesn't change, so nothing
// re-triggers that effect. This event closes that gap without coupling the
// header to Home's internal state.
const RESET_EVENT = 'skayoffice:reset-home-filters';

export function requestHomeFiltersReset() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(RESET_EVENT));
  }
}

export function onHomeFiltersResetRequested(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(RESET_EVENT, callback);
  return () => window.removeEventListener(RESET_EVENT, callback);
}
