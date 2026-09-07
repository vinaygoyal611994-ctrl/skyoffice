import * as Sentry from '@sentry/react';

const sentryDsn = import.meta.env.VITE_SENTRY_DSN;

/**
 * Field names and common value patterns that must never leave the browser in
 * an error report. This is deliberately broader than the current forms so a
 * future feature cannot accidentally expose a credential in diagnostics.
 */
const sensitiveKey = /password|token|authorization|cookie|card(?:number)?|cvv|cvc|secret|api[-_]?key/i;
const sensitiveValue = /(?:bearer\s+|(?:password|token|authorization|cookie|card(?:number)?|cvv|cvc|secret|api[-_]?key)=)[^\s&]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gi;
const emailAddress = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

function redactString(value: string): string {
  return value
    .replace(sensitiveValue, '[REDACTED]')
    .replace(emailAddress, '[REDACTED_EMAIL]');
}

/**
 * Scrub event payloads recursively. Sentry events are plain JSON-like data;
 * should an unexpected non-serializable value appear, beforeSend drops the
 * event rather than risk sending unexamined data.
 */
function scrubValue(
  value: unknown,
  seen: WeakSet<object>,
  depth = 0,
): unknown {
  if (depth > 12) return '[REDACTED_DEEP_VALUE]';
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[REDACTED_CYCLE]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item, seen, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = sensitiveKey.test(key)
      ? '[REDACTED]'
      : scrubValue(child, seen, depth + 1);
  }
  return result;
}

export function initializeFrontendSentry(): void {
  if (!sentryDsn) return;

  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE,
    sendDefaultPii: false,
    // Error reporting only. No browser performance trace/request detail is
    // collected in production.
    tracesSampleRate: 0,
    beforeSend(event) {
      try {
        const scrubbed = scrubValue(event, new WeakSet()) as typeof event;

        // Even with sendDefaultPii:false, discard the event structures most
        // likely to carry page URLs, headers, user data or typed UI text.
        delete scrubbed.request;
        delete scrubbed.user;
        delete scrubbed.breadcrumbs;
        delete scrubbed.contexts;
        delete scrubbed.extra;

        return scrubbed;
      } catch {
        // Failing closed is safer than exporting an event that was not
        // successfully sanitized.
        return null;
      }
    },
  });
}

/** Used by ErrorBoundary; a no-op when VITE_SENTRY_DSN has not been set. */
export function captureFrontendException(error: Error): void {
  if (sentryDsn) {
    Sentry.captureException(error);
  }
}