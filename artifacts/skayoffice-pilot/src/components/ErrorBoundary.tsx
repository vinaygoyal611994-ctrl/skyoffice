import React from 'react';
import { captureFrontendException } from '@/lib/sentry';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  /** Short opaque code the user can quote to support. Never contains PII. */
  errorCode: string;
}

/**
 * Top-level error boundary that catches unhandled React render errors and
 * displays a bilingual (Arabic / English) recovery screen instead of a blank
 * white page.
 *
 * Language detection: reads document.documentElement.dir at render time so
 * it works even though class components cannot call hooks.  Falls back to
 * English when the direction is not explicitly 'rtl'.
 *
 * Error reporting: captures the exception through the optional frontend
 * Sentry integration. The integration removes request/user/breadcrumb data
 * and redacts credential-like fields before any event leaves the browser.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorCode: '' };
  }

  static getDerivedStateFromError(): State {
    // Generate a short random code so the user can reference this specific
    // crash in a support conversation. No stack trace or PII is included.
    const errorCode = Math.random().toString(36).slice(2, 9).toUpperCase();
    return { hasError: true, errorCode };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    captureFrontendException(error);

    // Keep the component stack available to local development without adding
    // it to the remote error report.
    console.error(
      '[ErrorBoundary] Uncaught render error:',
      error,
      info.componentStack,
    );
  }

  handleReload = (): void => {
    window.location.reload();
  };

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    // Read direction at render time — the app sets dir on <html> before any
    // React tree renders, so this is stable even after a crash.
    const isRtl = typeof document !== 'undefined' &&
      document.documentElement.dir === 'rtl';

    return (
      <div
        dir={isRtl ? 'rtl' : 'ltr'}
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          fontFamily: 'system-ui, sans-serif',
          background: 'var(--background, #ffffff)',
          color: 'var(--foreground, #111827)',
        }}
      >
        <div style={{ maxWidth: '28rem', textAlign: 'center' }}>
          {/* Warning glyph — no external image dependency. */}
          <div style={{ fontSize: '3.5rem', marginBottom: '1rem' }}>⚠️</div>

          {isRtl ? (
            <>
              <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.75rem' }}>
                حدث خطأ غير متوقع
              </h1>
              <p style={{ color: 'var(--muted-foreground, #6b7280)', marginBottom: '1.5rem', lineHeight: 1.6 }}>
                واجه التطبيق مشكلة ولم يتمكن من الاستمرار.
                يرجى إعادة تحميل الصفحة للمحاولة مجدداً.
                إذا استمرت المشكلة، تواصل مع فريق الدعم.
              </p>
              <button
                onClick={this.handleReload}
                style={{
                  padding: '0.625rem 1.5rem',
                  background: 'var(--primary, #0f172a)',
                  color: 'var(--primary-foreground, #ffffff)',
                  border: 'none',
                  borderRadius: '9999px',
                  fontWeight: 500,
                  fontSize: '0.9375rem',
                  cursor: 'pointer',
                }}
              >
                إعادة تحميل الصفحة
              </button>
              <p style={{ marginTop: '1.25rem', fontSize: '0.75rem', color: 'var(--muted-foreground, #9ca3af)' }}>
                رمز الخطأ: {this.state.errorCode}
              </p>
            </>
          ) : (
            <>
              <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.75rem' }}>
                Something went wrong
              </h1>
              <p style={{ color: 'var(--muted-foreground, #6b7280)', marginBottom: '1.5rem', lineHeight: 1.6 }}>
                The application encountered an unexpected error and could not
                continue. Please reload the page to try again. If the problem
                persists, contact support.
              </p>
              <button
                onClick={this.handleReload}
                style={{
                  padding: '0.625rem 1.5rem',
                  background: 'var(--primary, #0f172a)',
                  color: 'var(--primary-foreground, #ffffff)',
                  border: 'none',
                  borderRadius: '9999px',
                  fontWeight: 500,
                  fontSize: '0.9375rem',
                  cursor: 'pointer',
                }}
              >
                Reload page
              </button>
              <p style={{ marginTop: '1.25rem', fontSize: '0.75rem', color: 'var(--muted-foreground, #9ca3af)' }}>
                Error code: {this.state.errorCode}
              </p>
            </>
          )}
        </div>
      </div>
    );
  }
}
