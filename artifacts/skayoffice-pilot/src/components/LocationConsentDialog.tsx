/**
 * LocationConsentDialog
 *
 * Shown when the user selects "Nearest" sort and no customer coordinates are
 * available yet. Explains why location is needed and offers Allow / Continue
 * without options. Never auto-triggers on page load — only shown on explicit
 * user action (clicking the Nearest sort button).
 *
 * Privacy guarantees:
 * • Coordinates are stored only in component state for the duration of the
 *   session — never written to localStorage, a cookie, or a database.
 * • Coordinates are sent only as query parameters on the listing API call.
 * • If the user denies or dismisses, we fall back to city-match / completeness
 *   ordering without blocking the platform.
 */

import React from 'react';
import { useI18n } from '@/lib/i18n';
import { MapPin, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface LocationConsentDialogProps {
  open: boolean;
  onAllow: (lat: number, lon: number) => void;
  onDeny: () => void;
}

export function LocationConsentDialog({
  open,
  onAllow,
  onDeny,
}: LocationConsentDialogProps) {
  const { t, language } = useI18n();
  const [requesting, setRequesting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleAllow = () => {
    if (!navigator.geolocation) {
      setError(t('location.unavailable'));
      return;
    }
    setRequesting(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setRequesting(false);
        onAllow(pos.coords.latitude, pos.coords.longitude);
      },
      () => {
        setRequesting(false);
        setError(t('location.denied_fallback'));
        // After a short delay, proceed without coordinates
        setTimeout(onDeny, 1500);
      },
      { timeout: 10_000, maximumAge: 5 * 60 * 1000 },
    );
  };

  if (!open) return null;

  return (
    /* Fixed overlay — z-50 so it sits above sticky headers */
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="location-dialog-title"
        className="relative w-full max-w-sm rounded-2xl bg-card border border-border shadow-xl p-6 animate-in slide-in-from-bottom-4 fade-in duration-200"
        dir={language === 'ar' ? 'rtl' : 'ltr'}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={onDeny}
          aria-label={t('common.close')}
          className="absolute top-4 ltr:right-4 rtl:left-4 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X size={18} />
        </button>

        {/* Icon */}
        <div className="flex justify-center mb-4">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
            <MapPin size={28} className="text-primary" />
          </div>
        </div>

        {/* Heading */}
        <h2
          id="location-dialog-title"
          className="text-lg font-bold text-center mb-3"
        >
          {t('location.consent_title')}
        </h2>

        {/* Body — exact required copy */}
        <p className="text-sm text-muted-foreground text-center leading-relaxed mb-5">
          {t('location.consent_body')}
        </p>

        {/* Error state */}
        {error && (
          <p className="text-xs text-destructive text-center mb-3">{error}</p>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-2">
          <Button
            className="w-full"
            onClick={handleAllow}
            disabled={requesting}
          >
            {requesting ? t('location.requesting') : t('location.allow')}
          </Button>
          <Button
            variant="ghost"
            className="w-full text-muted-foreground"
            onClick={onDeny}
            disabled={requesting}
          >
            {t('location.deny')}
          </Button>
        </div>
      </div>
    </div>
  );
}
