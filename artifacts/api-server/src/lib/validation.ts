/**
 * Manual email/phone validation and normalization.
 *
 * We intentionally do NOT use OpenAPI `format: email` / `format: uri` in
 * openapi.yaml — that makes orval emit zod v4-only methods that break this
 * repo's zod v3 catalog. Validation instead happens here, in plain
 * TypeScript, and is invoked explicitly from the auth/office routes.
 */

// Reasonably strict but not pedantic: local@domain.tld, no spaces.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Accepts an optional leading "+" followed by 7-15 digits (E.164-ish), after
// stripping spaces/dashes/parentheses that people commonly type.
const PHONE_DIGITS_RE = /^\+?\d{7,15}$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Strips spaces, dashes, and parentheses so "050-000 0000" and "050 0000000" compare equal. */
export function normalizePhone(phone: string): string {
  return phone.trim().replace(/[\s\-()]/g, "");
}

export function isValidPhone(phone: string): boolean {
  return PHONE_DIGITS_RE.test(normalizePhone(phone));
}
