import React from 'react';
import { Link } from 'wouter';
import { useI18n, categoriesMap, localizedCity, pickLocalized } from '@/lib/i18n';
import { trackCardClick, useImpressionTracker } from '@/lib/analytics';
import { useToast } from '@/hooks/use-toast';
import { useGetOfficeServiceMetrics } from '@workspace/api-client-react';
import { Badge } from '@/components/ui/badge';
import { ImageLightbox } from '@/components/ImageLightbox';
import {
  Building2,
  ShieldCheck,
  ThumbsUp,
  CheckCircle2,
  Heart,
  Eye,
  Navigation,
  Zap,
} from 'lucide-react';

export interface QuickOfficeCardOffice {
  id: number;
  name: string;
  nameAr?: string | null;
  slug?: string | null;
  category: string;
  city: string;
  shortDescription?: string | null;
  shortDescriptionAr?: string | null;
  coverUrl?: string | null;
  isOnline: boolean;
  isVerified: boolean;
  /** @deprecated Legacy static columns — no longer used for display. */
  completedTransactions?: number;
  /** @deprecated Legacy static columns — no longer used for display. */
  clientsRecommendPercent?: number;
  providerType?: string | null;
  serviceTags?: { name: string; nameAr?: string | null }[] | null;
  /** Km from customer — present only when customer coords were provided and provider has coords. */
  distance?: number | null;
}

interface QuickOfficeCardProps {
  office: QuickOfficeCardOffice;
  index?: number;
  isFavourite?: boolean;
  onToggleFavourite?: () => void;
  favouriteDisabled?: boolean;
  showFavourite?: boolean;
}

/**
 * Format a completed-count integer for compact display.
 * Examples: 999 → "999", 1200 → "1.2K+", 15000 → "15K+"
 */
function formatCount(n: number): string {
  if (n >= 10_000) return `${Math.floor(n / 1000)}K+`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}K+`;
  return String(n);
}

/**
 * Format average first-response minutes as a short human-readable label.
 * Examples (en): "8 min", "2 hr", "1 d"
 * Examples (ar): "8 د", "2 س", "1 ي"
 */
function formatResponseShort(minutes: number, lang: 'ar' | 'en'): string {
  if (minutes < 60) {
    return lang === 'ar' ? `${minutes} د` : `${minutes} min`;
  }
  if (minutes < 1440) {
    const hours = Math.round(minutes / 60);
    return lang === 'ar' ? `${hours} س` : `${hours} hr`;
  }
  const days = Math.round(minutes / 1440);
  return lang === 'ar' ? `${days} ي` : `${days} d`;
}

/**
 * Full human-readable response-time sentence used as a tooltip.
 * Examples (en): "Usually responds within 8 minutes"
 */
function formatResponseFull(minutes: number, lang: 'ar' | 'en'): string {
  if (minutes < 60) {
    return lang === 'ar'
      ? `يرد عادةً خلال ${minutes} دقيقة`
      : `Usually responds within ${minutes} minute${minutes !== 1 ? 's' : ''}`;
  }
  if (minutes < 1440) {
    const hours = Math.round(minutes / 60);
    return lang === 'ar'
      ? `يرد عادةً خلال ${hours} ساعة`
      : `Usually responds within ${hours} hour${hours !== 1 ? 's' : ''}`;
  }
  const days = Math.round(minutes / 1440);
  return lang === 'ar'
    ? `يرد عادةً خلال ${days} يوم`
    : `Usually responds within ${days} day${days !== 1 ? 's' : ''}`;
}

/**
 * Quick Office Card — discovery surface.
 *
 * Purpose: help the customer decide within 3–5 seconds whether to open the
 * office profile. Shows cover, name (with online dot), primary info, verified
 * service metrics, and a single clear CTA.
 *
 * Metrics shown are VERIFIED ONLY — sourced from the live service-request
 * workflow:
 *   • completedCount       — completed transactions (with or without reviews)
 *   • recommendPct         — % of reviewers who would recommend
 *   • avgFirstResponseMinutes — computed from first_response_at timestamps
 *
 * If no verified data exists, a neutral "No verified data yet" label is shown
 * instead of misleading zeros or legacy seeded numbers.
 */
export function QuickOfficeCard({
  office,
  index = 0,
  isFavourite,
  onToggleFavourite,
  favouriteDisabled,
  showFavourite = false,
}: QuickOfficeCardProps) {
  const { t, language } = useI18n();
  const { toast } = useToast();
  const displayName = pickLocalized(office.name, office.nameAr, language) || office.name;
  const displayCity = localizedCity(office.city, language);
  const [imageLoaded, setImageLoaded] = React.useState(false);
  const [lightboxOpen, setLightboxOpen] = React.useState(false);
  const coverTriggerRef = React.useRef<HTMLButtonElement>(null);

  // Fetch verified service metrics for this office (when slug available).
  // Cache for 5 minutes; only fires when slug is known.
  const { data: metrics, isLoading: metricsLoading } = useGetOfficeServiceMetrics(office.slug ?? '', {
    query: {
      enabled: !!office.slug,
      staleTime: 5 * 60 * 1000,
    },
  });

  const hasResponseData = metrics != null && metrics.avgFirstResponseMinutes != null;
  const hasCompletedData = metrics != null && metrics.completedCount > 0;
  const hasVerifiedData = hasResponseData || hasCompletedData;

  // Phase 1 analytics: impression + click tracking
  const impressionCallbackRef = useImpressionTracker(office.id, index);

  return (
    <div ref={impressionCallbackRef} className="h-full">
    <Link
      href={`/offices/${office.id}`}
      data-testid={`card-office-${office.id}`}
      className="group relative flex flex-col h-full overflow-hidden rounded-2xl border border-border/50 bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg animate-in fade-in slide-in-from-bottom-4"
      style={{ animationDelay: `${index * 50}ms` }}
      onClick={() => { try { trackCardClick({ officeId: office.id, position: index }); } catch {} }}
    >
      {/* ── Cover image ── */}
      <div
        className="relative w-full flex-shrink-0 overflow-hidden bg-muted"
        style={{ aspectRatio: '25 / 9' }}
        data-testid="quick-card-media"
      >
        {office.coverUrl ? (
          <>
            {!imageLoaded && (
              <div className="absolute inset-0 animate-pulse bg-gradient-to-tr from-muted to-muted/60" />
            )}
            <button
              ref={coverTriggerRef}
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setLightboxOpen(true);
              }}
              aria-label={t('card.enlarge_cover')}
              className="absolute inset-0 z-[1] block h-full w-full cursor-zoom-in text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
              data-testid="button-enlarge-quick-card-cover"
            >
              <img
                src={`/api/storage${office.coverUrl}`}
                alt={displayName}
                loading="lazy"
                decoding="async"
                onLoad={() => setImageLoaded(true)}
                className={`h-full w-full object-cover transition-all duration-500 group-hover:scale-105 ${
                  imageLoaded ? 'opacity-100' : 'opacity-0'
                }`}
              />
            </button>
          </>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-tr from-primary/15 to-muted">
            <Building2 className="h-14 w-14 text-primary/60" />
          </div>
        )}

        {/* Favourite */}
        {showFavourite && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleFavourite?.();
              toast({
                title: isFavourite ? t('fav.removed_title') : t('fav.added_title'),
                description: isFavourite ? t('fav.removed_desc') : t('fav.added_desc'),
              });
            }}
            disabled={favouriteDisabled}
            aria-label={isFavourite ? t('profile.remove_favourite') : t('profile.add_favourite')}
            className={`absolute top-3 ltr:right-3 rtl:left-3 flex h-8 w-8 items-center justify-center rounded-full backdrop-blur transition-colors cursor-pointer ${
              isFavourite
                ? 'bg-rose-500 text-white'
                : 'bg-black/30 text-white hover:bg-black/50'
            }`}
          >
            <Heart size={15} className={isFavourite ? 'fill-current' : ''} />
          </button>
        )}
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 flex-col gap-2 p-3">

        {/* Name row */}
        <div className="flex items-start gap-1.5">
          {office.isOnline ? (
            <span
              className="mt-[5px] h-2 w-2 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_0_2.5px_rgba(16,185,129,0.18)]"
              aria-label={t('profile.online_only')}
              data-testid="online-dot"
            />
          ) : (
            <span
              className="mt-[5px] h-2 w-2 shrink-0 rounded-full bg-muted-foreground/25"
              data-testid="offline-dot"
            />
          )}
          <div className="min-w-0 flex-1 flex items-start gap-1">
            <h3
              dir="auto"
              className="line-clamp-1 text-[15px] font-bold leading-snug text-foreground"
            >
              <bdi>{displayName}</bdi>
            </h3>
            {office.isVerified && (
              <ShieldCheck
                size={14}
                className="mt-0.5 shrink-0 text-emerald-500"
                aria-label="verified"
              />
            )}
          </div>
        </div>

        {/* Category · city · distance · provider type */}
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span className="text-xs font-semibold text-primary/80 break-words">
            {categoriesMap[office.category]?.[language] || office.category}
          </span>
          {office.city && (
            <>
              <span className="text-muted-foreground/40 select-none text-xs">·</span>
              <span className="text-xs text-muted-foreground">{displayCity}</span>
            </>
          )}
          {office.distance != null && office.distance <= 5 ? (
            <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded-full border border-emerald-200/60">
              <Navigation size={9} className="shrink-0" />
              {t('proximity.near_you')} · {office.distance} {t('proximity.km')}
            </span>
          ) : office.distance != null ? (
            <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-muted-foreground px-1.5 py-0.5 rounded-full border border-border/50">
              <Navigation size={9} className="shrink-0" />
              {office.distance} {t('proximity.km')}
            </span>
          ) : null}
          {office.providerType === 'freelancer' && (
            <Badge
              variant="outline"
              className="text-[11px] font-normal border-border/50 text-muted-foreground py-0 px-1.5 h-5"
            >
              {language === 'ar' ? 'مستقل' : 'Freelancer'}
            </Badge>
          )}
        </div>

        {/* Response line */}
        {office.isOnline && (
          <div
            className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-600"
            data-testid="response-line"
          >
            <Zap size={11} className="shrink-0 fill-emerald-500 text-emerald-500" />
            <span>{t('card.online_response')}</span>
          </div>
        )}

        {/* ── Verified Service Metrics ──
            Source: live service-request workflow only.
            • completedCount       — ALL completed transactions (with or without reviews)
            • recommendPct         — % of reviewers who would recommend
            • avgFirstResponseMinutes — computed from first_response_at - created_at
            Never shows legacy static seeded numbers.
        */}
        <div
          className="mt-auto rounded-lg border border-border/40 bg-muted/20 p-2.5"
          data-testid="card-service-metrics"
        >
          {metricsLoading ? (
            <div className="h-8 animate-pulse rounded bg-muted/40" />
          ) : hasVerifiedData ? (
            <div className="grid grid-cols-3 gap-1.5">
              {/* Response time — computed from first_response_at timestamps */}
              <div className="flex flex-col items-start gap-0.5">
                {hasResponseData ? (
                  <div
                    className="flex items-center gap-1 text-emerald-600"
                    title={formatResponseFull(metrics!.avgFirstResponseMinutes!, language)}
                  >
                    <Zap size={11} className="shrink-0 fill-emerald-500 text-emerald-500" />
                    <span className="font-mono text-sm font-semibold" dir="ltr">
                      {formatResponseShort(metrics!.avgFirstResponseMinutes!, language)}
                    </span>
                  </div>
                ) : (
                  <span className="font-mono text-sm font-semibold text-muted-foreground/40">—</span>
                )}
                <span className="text-[10px] leading-tight text-muted-foreground">
                  {t('srm.avg_response_speed')}
                </span>
              </div>

              {/* Completed services */}
              <div className="flex flex-col items-start gap-0.5 border-x border-border/50 px-2">
                {hasCompletedData ? (
                  <div className="flex items-center gap-1 text-emerald-600">
                    <CheckCircle2 size={12} className="shrink-0" />
                    <span className="font-mono text-sm font-semibold">
                      {formatCount(metrics!.completedCount)}
                    </span>
                  </div>
                ) : (
                  <span className="font-mono text-sm font-semibold text-muted-foreground/40">—</span>
                )}
                <span className="text-[10px] leading-tight text-muted-foreground">
                  {t('srm.completed_services')}
                </span>
              </div>

              {/* Recommend pct */}
              <div className="flex flex-col items-start gap-0.5">
                {hasCompletedData ? (
                  <div className="flex items-center gap-1 text-emerald-600">
                    <ThumbsUp size={12} className="shrink-0" />
                    <span className="font-mono text-sm font-semibold">
                      {metrics!.recommendPct}%
                    </span>
                  </div>
                ) : (
                  <span className="font-mono text-sm font-semibold text-muted-foreground/40">—</span>
                )}
                <span className="text-[10px] leading-tight text-muted-foreground">
                  {t('srm.recommend_pct')}
                </span>
              </div>
            </div>
          ) : (
            /* Neutral state — no verified data yet */
            <p className="text-[11px] text-muted-foreground/70 text-center py-0.5">
              {t('srm.no_data')}
            </p>
          )}
        </div>

        {/* Primary CTA */}
        <div
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground min-h-[44px] transition-colors group-hover:bg-primary/90"
          data-testid="button-view-office"
          role="button"
          aria-label={t('card.view_office')}
        >
          <Eye size={16} />
          <span>{t('card.view_office')}</span>
        </div>
      </div>
    </Link>
    {office.coverUrl && (
      <ImageLightbox
        images={[{ id: office.id, url: office.coverUrl }]}
        open={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
        officeName={displayName}
        restoreFocusRef={coverTriggerRef}
        closeOnBackdropClick
      />
    )}
    </div>
  );
}
