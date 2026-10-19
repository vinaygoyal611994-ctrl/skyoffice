import React from 'react';
import { useRoute, useLocation } from 'wouter';
import { trackVideoStart, trackVideoComplete, trackGalleryInteraction, trackCopyLink } from '@/lib/analytics';
import { useI18n, categoriesMap, localizedCity, type TranslationKey } from '@/lib/i18n';
import {
  useGetOffice,
  useGetCurrentUser,
  useAddFavourite,
  useRemoveFavourite,
  useListFavourites,
  useCreateContactEvent,
  useCreateVideoCallRequest,
  useSubmitServiceRequest,
  getListFavouritesQueryKey,
  getGetCurrentUserQueryKey,
  getGetOfficeQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Building2, MapPin, ShieldCheck, Heart, CheckCircle2,
  MessageCircle, Video, Play, Award, Share2, Link2, Check, X, AlertTriangle,
  ChevronLeft, ChevronRight, PhoneCall, Globe, Lock, User,
  Bookmark, BookmarkCheck, Image as ImageIcon,
  ClipboardList,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { stashPostLoginRedirect } from '@/lib/postLoginRedirect';
import { getOfficePublicUrl } from '@/lib/publicUrl';
import { useToast } from '@/hooks/use-toast';
import useEmblaCarousel from 'embla-carousel-react';
import { ImageLightbox } from '@/components/ImageLightbox';
type MediaItem = { id: string | number; url: string; type: 'image' | 'video'; poster?: string };
type DecisionTab = 'about' | 'services' | 'work';

const AUTOPLAY_INTERVAL_MS = 8000;
const RESUME_AFTER_INTERACTION_MS = 3000;

// VIDEO_CALL PUBLIC GATE
// Set to true ONLY when the Video Call feature is officially released.
const VIDEO_CALL_FEATURE_RELEASED = false as const;

function MarketingScreen({
  items,
  officeName,
  watchIntroLabel,
  prevSlideLabel,
  nextSlideLabel,
  scrollerAspect = 'aspect-[2/1]',
  onVideoStart,
  onVideoComplete,
  onGalleryNavigate,
  paused = false,
  onImageClick,
}: {
  items: MediaItem[];
  officeName: string;
  watchIntroLabel: string;
  prevSlideLabel: string;
  nextSlideLabel: string;
  scrollerAspect?: string;
  /** Phase 1 analytics — called when a video starts playing */
  onVideoStart?: () => void;
  /** Phase 1 analytics — called once when the video passes 80% */
  onVideoComplete?: () => void;
  /** Phase 1 analytics — called when the user swipes or clicks to a new slide */
  onGalleryNavigate?: () => void;
  /** When true, the 8-second autoplay rotation is suspended (e.g. while the lightbox is open). */
  paused?: boolean;
  /** Called when the user taps/clicks an image slide. Used to open the fullscreen lightbox. */
  onImageClick?: (item: MediaItem) => void;
}) {
  const { language } = useI18n();
  const isRTL = language === 'ar';
  const [active, setActive] = React.useState(0);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [isInteracting, setIsInteracting] = React.useState(false);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const resumeTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const reducedMotionRef = React.useRef(false);
  // Phase 1 analytics: track 80% video completion once per play
  const videoCompleteFiredRef = React.useRef(false);
  const hasMultiple = items.length > 1;

  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: hasMultiple,
    direction: isRTL ? 'rtl' : 'ltr',
    watchDrag: hasMultiple,
  });

  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotionRef.current = mq.matches;
    const handler = (e: MediaQueryListEvent) => { reducedMotionRef.current = e.matches; };
    mq.addEventListener?.('change', handler);
    return () => mq.removeEventListener?.('change', handler);
  }, []);

  const current = items[active];

  React.useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => {
      // Pause any currently-playing video BEFORE active index changes.
      // videoRef.current still points to the old slide's <video> here because
      // React hasn't re-rendered yet; after setActive() triggers a re-render the
      // ref gets nulled out, making it too late to call .pause().
      if (videoRef.current && !videoRef.current.paused) {
        videoRef.current.pause();
      }
      setActive(emblaApi.selectedScrollSnap());
    };
    onSelect();
    emblaApi.on('select', onSelect);
    emblaApi.on('reInit', onSelect);
    return () => { emblaApi.off('select', onSelect); emblaApi.off('reInit', onSelect); };
  }, [emblaApi]);

  React.useEffect(() => { setIsPlaying(false); videoCompleteFiredRef.current = false; }, [active]);

  React.useEffect(() => {
    return () => {
      videoRef.current?.pause();
      if (resumeTimeoutRef.current) clearTimeout(resumeTimeoutRef.current);
    };
  }, []);

  const pauseAutoplay = () => {
    if (resumeTimeoutRef.current) { clearTimeout(resumeTimeoutRef.current); resumeTimeoutRef.current = null; }
    setIsInteracting(true);
  };
  const scheduleResume = () => {
    if (resumeTimeoutRef.current) clearTimeout(resumeTimeoutRef.current);
    resumeTimeoutRef.current = setTimeout(() => { setIsInteracting(false); }, RESUME_AFTER_INTERACTION_MS);
  };

  const goTo = (idx: number) => { pauseAutoplay(); emblaApi?.scrollTo(idx, reducedMotionRef.current); scheduleResume(); try { onGalleryNavigate?.(); } catch {} };
  const goPrev = () => { pauseAutoplay(); emblaApi?.scrollPrev(reducedMotionRef.current); scheduleResume(); try { onGalleryNavigate?.(); } catch {} };
  const goNext = () => { pauseAutoplay(); emblaApi?.scrollNext(reducedMotionRef.current); scheduleResume(); try { onGalleryNavigate?.(); } catch {} };

  React.useEffect(() => {
    if (!emblaApi || !hasMultiple || isInteracting || isPlaying || reducedMotionRef.current || paused) return;
    const timer = setInterval(() => { emblaApi.scrollNext(); }, AUTOPLAY_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [emblaApi, hasMultiple, isInteracting, isPlaying, paused]);

  React.useEffect(() => {
    if (!emblaApi) return;
    const onPointerDown = () => pauseAutoplay();
    const onSettle = () => scheduleResume();
    emblaApi.on('pointerDown', onPointerDown);
    emblaApi.on('settle', onSettle);
    return () => { emblaApi.off('pointerDown', onPointerDown); emblaApi.off('settle', onSettle); };
  }, [emblaApi]);

  const PrevIcon = isRTL ? ChevronRight : ChevronLeft;
  const NextIcon = isRTL ? ChevronLeft : ChevronRight;

  if (items.length === 0) {
    return (
      <div className={`relative ${scrollerAspect} w-full overflow-hidden rounded-2xl bg-gradient-to-tr from-primary/20 to-primary/5 flex items-center justify-center`}>
        <Building2 className="h-14 w-14 text-primary/30" />
      </div>
    );
  }

  return (
    <div
      className="relative w-full overflow-hidden rounded-2xl bg-muted shadow-sm"
      data-testid="marketing-screen"
      onMouseEnter={hasMultiple ? pauseAutoplay : undefined}
      onMouseLeave={hasMultiple ? scheduleResume : undefined}
    >
      <div
        ref={emblaRef}
        onTouchStart={hasMultiple ? pauseAutoplay : undefined}
        onTouchEnd={hasMultiple ? scheduleResume : undefined}
        className={`${scrollerAspect} w-full overflow-hidden`}
        data-testid="marketing-screen-scroller"
      >
        <div className="flex h-full">
          {items.map((item, idx) => (
            <div key={item.id} className="relative h-full min-w-0 flex-shrink-0 flex-grow-0 basis-full">
              {item.type === 'video' ? (
                <>
                  <video
                    ref={idx === active ? videoRef : undefined}
                    src={`/api/storage${item.url}`}
                    poster={item.poster ? `/api/storage${item.poster}` : undefined}
                    preload="none"
                    className="h-full w-full object-cover"
                    controls={isPlaying && idx === active}
                    playsInline
                    onPlay={() => { setIsPlaying(true); try { onVideoStart?.(); } catch {} }}
                    onPause={() => setIsPlaying(false)}
                    onEnded={(e) => { e.currentTarget.currentTime = 0; setIsPlaying(false); }}
                    onTimeUpdate={(e) => {
                      const el = e.currentTarget;
                      if (!videoCompleteFiredRef.current && el.duration > 0 && el.currentTime / el.duration >= 0.8) {
                        videoCompleteFiredRef.current = true;
                        try { onVideoComplete?.(); } catch {}
                      }
                    }}
                    data-testid={`marketing-video-${idx}`}
                  />
                  {!(isPlaying && idx === active) && (
                    <button
                      type="button"
                      aria-label={watchIntroLabel}
                      onClick={(event) => {
                        if (idx !== active) goTo(idx);
                        const video = event.currentTarget.parentElement?.querySelector('video');
                        void video?.play();
                      }}
                      className="absolute inset-0 flex items-center justify-center"
                    >
                      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/40 text-white shadow-md backdrop-blur-sm">
                        <Play className="h-5 w-5 fill-current" />
                      </span>
                    </button>
                  )}
                </>
              ) : onImageClick ? (
                /* Clickable image — opens fullscreen lightbox */
                <button
                  type="button"
                  className="absolute inset-0 h-full w-full cursor-zoom-in appearance-none p-0 border-0"
                  onClick={() => onImageClick(item)}
                  aria-label={officeName}
                  tabIndex={idx === active ? 0 : -1}
                >
                  <img
                    src={`/api/storage${item.url}`}
                    alt={officeName}
                    className="h-full w-full object-cover pointer-events-none"
                    loading="lazy"
                    decoding="async"
                    data-testid={`marketing-image-${idx}`}
                  />
                </button>
              ) : (
                <img
                  src={`/api/storage${item.url}`}
                  alt={officeName}
                  className="h-full w-full object-cover"
                  loading="lazy"
                  decoding="async"
                  data-testid={`marketing-image-${idx}`}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {hasMultiple && (
        <>
          <button
            type="button"
            aria-label={prevSlideLabel}
            onClick={goPrev}
            className="absolute inset-y-0 ltr:left-1 rtl:right-1 hidden sm:flex items-center justify-center px-1.5 text-white transition-colors"
            data-testid="button-carousel-prev"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/30 backdrop-blur-sm hover:bg-black/50">
              <PrevIcon className="h-5 w-5" />
            </span>
          </button>
          <button
            type="button"
            aria-label={nextSlideLabel}
            onClick={goNext}
            className="absolute inset-y-0 ltr:right-1 rtl:left-1 hidden sm:flex items-center justify-center px-1.5 text-white transition-colors"
            data-testid="button-carousel-next"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/30 backdrop-blur-sm hover:bg-black/50">
              <NextIcon className="h-5 w-5" />
            </span>
          </button>
          <div className="absolute bottom-2.5 left-0 right-0 flex items-center justify-center gap-1.5">
            {items.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                aria-label={`${officeName} ${idx + 1}/${items.length}`}
                aria-current={idx === active}
                onClick={() => goTo(idx)}
                className="h-6 w-6 flex items-center justify-center"
                data-testid={`button-carousel-dot-${idx}`}
              >
                <span className={`rounded-full transition-all ${idx === active ? 'h-1.5 w-5 bg-white' : 'h-1.5 w-1.5 bg-white/50'}`} />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Tab bar ──────────────────────────────────────────────────────────────────
function TabBar({
  active,
  onChange,
  tabs,
}: {
  active: DecisionTab | null;
  onChange: (tab: DecisionTab | null) => void;
  tabs: { key: DecisionTab; label: string }[];
}) {
  return (
    <div
      className="flex gap-0 rounded-xl border border-border/50 bg-muted/40 p-0.5"
      role="tablist"
      data-testid="decision-card-tabs"
    >
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={active === tab.key}
          data-testid={`tab-${tab.key}`}
          onClick={() => onChange(active === tab.key ? null : tab.key)}
          className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors min-h-[36px] cursor-pointer ${
            active === tab.key
              ? 'bg-primary/10 text-primary shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function OfficeProfile({
  variant = 'page',
  onClose,
  forceLanguage,
}: {
  variant?: 'page' | 'modal';
  onClose?: () => void;
  forceLanguage?: 'ar' | 'en';
} = {}) {
  const [, legacyParams] = useRoute('/offices/:id');
  const [, slugParams] = useRoute('/office/:slug');
  const [, arSlugParams] = useRoute('/ar/office/:slug');
  const [, enSlugParams] = useRoute('/en/office/:slug');
  const idOrSlug =
    legacyParams?.id ?? slugParams?.slug ?? arSlugParams?.slug ?? enSlugParams?.slug ?? '';
  const routeNumericId = legacyParams?.id ? parseInt(legacyParams.id, 10) : null;
  const { t, language, setLanguage } = useI18n();

  React.useEffect(() => {
    if (forceLanguage && forceLanguage !== language) setLanguage(forceLanguage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceLanguage]);

  const queryClient = useQueryClient();
  const [linkCopied, setLinkCopied] = React.useState(false);
  const [showAllLangs, setShowAllLangs] = React.useState(false);
  const [showFullDesc, setShowFullDesc] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<DecisionTab | null>('about');
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const handleClose = onClose ?? (() => setLocation('/'));
  const canNativeShare = typeof navigator !== 'undefined' && !!(navigator as any).share;

  const handleNativeShare = async () => {
    if (typeof navigator !== 'undefined' && (navigator as any).share) {
      try {
        await (navigator as any).share({ title: office?.name, url: profileUrl });
        try { trackCopyLink(officeId); } catch {}
      } catch { /* user cancelled */ }
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(profileUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
      try { trackCopyLink(officeId); } catch {}
    } catch { /* clipboard unavailable */ }
  };

  const { data: user } = useGetCurrentUser({ query: { retry: false, queryKey: getGetCurrentUserQueryKey() } });
  const isCustomer = user?.role === 'customer';

  const { data: office, isLoading, isError, error, refetch } = useGetOffice(idOrSlug, {
    query: {
      enabled: !!idOrSlug,
      queryKey: getGetOfficeQueryKey(idOrSlug),
      retry: 1,
      retryDelay: 1500,
      staleTime: 0,
      refetchOnMount: 'always',
      refetchOnWindowFocus: 'always',
      // Admin approval happens in another session. Poll lightly so an open
      // Decision Card gains newly-approved Works without requiring a hard reload.
      refetchInterval: 15_000,
    },
    request: { cache: 'no-store' },
  });

  const officeId = office?.id ?? routeNumericId ?? 0;
  const profileUrl = office ? getOfficePublicUrl(office.slug, forceLanguage ?? language) : '';

  const { data: favourites } = useListFavourites({
    query: { enabled: isCustomer, queryKey: getListFavouritesQueryKey() },
  });

  const addFavMutation = useAddFavourite({
    mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListFavouritesQueryKey() }) },
  });
  const removeFavMutation = useRemoveFavourite({
    mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListFavouritesQueryKey() }) },
  });
  const isFav = favourites?.some((f) => f.id === officeId);

  const toggleFavourite = () => {
    if (isFav) {
      const fav = favourites?.find((f) => f.id === officeId);
      if (fav) removeFavMutation.mutate({ officeId: fav.id });
      toast({ title: t('fav.removed_title'), description: t('fav.removed_desc') });
    } else {
      addFavMutation.mutate({ data: { officeId } });
      toast({ title: t('fav.added_title'), description: t('fav.added_desc') });
    }
  };

  const isLoggedIn = !!user;
  const canContact = isCustomer && user?.status !== 'suspended' && user?.status !== 'deactivated';
  const contactEventMutation = useCreateContactEvent();
  const [videoDialogOpen, setVideoDialogOpen] = React.useState(false);
  const [shareDialogOpen, setShareDialogOpen] = React.useState(false);
  const [srDialogOpen, setSrDialogOpen] = React.useState(false);
  // Fullscreen image lightbox state (Decision Card only)
  const [lightboxOpen, setLightboxOpen] = React.useState(false);
  const [lightboxIndex, setLightboxIndex] = React.useState(0);
  const [worksLightboxOpen, setWorksLightboxOpen] = React.useState(false);
  const [worksLightboxIndex, setWorksLightboxIndex] = React.useState(0);
  const modalRef = React.useRef<HTMLDivElement>(null);
  const modalInitialFocusRef = React.useRef<HTMLButtonElement>(null);
  const [srForm, setSrForm] = React.useState({ serviceName: '', description: '' });
  const [srSuccess, setSrSuccess] = React.useState(false);
  const [srError, setSrError] = React.useState('');

  const requireLogin = (): boolean => {
    if (isCustomer) return true;
    stashPostLoginRedirect(`/offices/${officeId}`);
    setLocation('/login/customer');
    return false;
  };

  const suspendedToast = (message?: string) => {
    toast({ title: message || t('account.status_suspended_notice'), variant: 'destructive' });
  };

  const gateContactAction = async (
    actionType: 'whatsapp_click' | 'location_click' | 'share_click',
  ): Promise<boolean> => {
    if (!requireLogin()) return false;
    try {
      await contactEventMutation.mutateAsync({ data: { officeId, actionType, sourcePage: 'office_profile', language } });
      return true;
    } catch (err: any) {
      suspendedToast(err?.data?.error);
      return false;
    }
  };

  const handleWhatsappClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!whatsappHref) { toast({ title: t('profile.whatsapp_unavailable'), variant: 'destructive' }); return; }
    gateContactAction('whatsapp_click').then((allowed) => { if (allowed) window.open(whatsappHref, '_blank', 'noreferrer'); });
  };

  const handleLocationClick = (e: React.MouseEvent) => {
    e.preventDefault();
    const href = e.currentTarget.getAttribute('href');
    gateContactAction('location_click').then((allowed) => { if (allowed && href) window.open(href, '_blank', 'noreferrer'); });
  };

  const handleOpenVideoDialog = () => {
    if (!requireLogin()) return;
    if (!canContact) { suspendedToast(); return; }
    setVideoDialogOpen(true);
  };

  const handleOpenShareDialog = () => {
    // Share is a public discovery action — no auth required.
    // Record analytics silently for logged-in customers; unauthenticated
    // visitors can share freely without being redirected to the login page.
    setShareDialogOpen(true);
    if (isCustomer) {
      contactEventMutation.mutate({
        data: { officeId, actionType: 'share_click', sourcePage: 'office_profile', language },
      });
    }
  };

  const [videoForm, setVideoForm] = React.useState({
    preferredDate: '', preferredTime: '', timezone: 'Asia/Riyadh', contactNumber: '', note: '',
  });
  const [videoSuccess, setVideoSuccess] = React.useState(false);
  const videoCallMutation = useCreateVideoCallRequest({ mutation: { onSuccess: () => setVideoSuccess(true) } });
  const videoCallError = (videoCallMutation.error as any)?.data?.error as string | undefined;

  // ── Service Request ──────────────────────────────────────────────────────────
  const srMutation = useSubmitServiceRequest({
    mutation: { onSuccess: () => setSrSuccess(true) },
  });

  const handleOpenSrDialog = () => {
    if (!isLoggedIn) {
      stashPostLoginRedirect(`/offices/${officeId}`);
      setLocation('/login/customer');
      return;
    }
    if (!isCustomer) {
      // Office owners and other non-customer roles: explain instead of silently doing nothing
      toast({ title: t('sr.office_cannot_submit') });
      return;
    }
    if (!canContact) { suspendedToast(); return; }
    setSrSuccess(false);
    setSrError('');
    setSrForm({ serviceName: '', description: '' });
    setSrDialogOpen(true);
  };

  const handleSubmitSrRequest = () => {
    if (!srForm.serviceName.trim()) { setSrError(t('sr.error_name_required')); return; }
    if (!srForm.description.trim()) { setSrError(t('sr.error_desc_required')); return; }
    srMutation.mutate(
      { officeId, serviceName: srForm.serviceName.trim(), description: srForm.description.trim() },
      { onError: (err: any) => setSrError(err?.data?.error || t('common.error')) },
    );
  };

  const resetSrDialog = (open: boolean) => {
    setSrDialogOpen(open);
    if (!open) {
      setSrSuccess(false);
      setSrError('');
      setSrForm({ serviceName: '', description: '' });
      srMutation.reset();
    }
  };

  const handleVideoFieldChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setVideoForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmitVideoRequest = () => {
    videoCallMutation.mutate({
      data: {
        officeId,
        preferredDate: videoForm.preferredDate,
        preferredTime: videoForm.preferredTime,
        timezone: videoForm.timezone,
        contactNumber: videoForm.contactNumber,
        note: videoForm.note || undefined,
      },
    });
  };

  const resetVideoDialog = (open: boolean) => {
    setVideoDialogOpen(open);
    if (!open) {
      setVideoSuccess(false);
      setVideoForm({ preferredDate: '', preferredTime: '', timezone: 'Asia/Riyadh', contactNumber: '', note: '' });
      videoCallMutation.reset();
    }
  };

  React.useEffect(() => {
    if (variant !== 'modal' || !office || !modalRef.current) return;
    const initialFocus = modalInitialFocusRef.current;
    initialFocus?.focus();

    const modal = modalRef.current;
    const getFocusableElements = () => Array.from(
      modal.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => !element.closest('[aria-hidden="true"]'));

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[role="dialog"]') !== modal) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        handleClose();
        return;
      }

      if (event.key !== 'Tab') return;
      const focusable = getFocusableElements();
      if (focusable.length === 0) {
        event.preventDefault();
        modal.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === modal)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    modal.addEventListener('keydown', onKeyDown);
    return () => modal.removeEventListener('keydown', onKeyDown);
  }, [handleClose, office, variant]);

  if (isError) {
    const errorCode = (error as any)?.data?.code as string | undefined;
    const isRetryable = !errorCode || errorCode === 'db_unavailable';
    const description =
      errorCode === 'office_not_found' ? t('profile.error_not_found')
      : errorCode === 'office_pending'  ? t('profile.error_pending')
      : errorCode === 'office_inactive' ? t('profile.error_inactive')
      : t('profile.unavailable_description');
    return (
      <div className={variant === 'modal' ? 'fixed inset-0 z-50 overflow-y-auto bg-background' : 'min-h-screen bg-muted/20'}>
        <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-4 py-16 text-center" data-testid="office-unavailable">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Building2 className="h-8 w-8" />
          </div>
          <h1 className="text-xl font-bold text-foreground">{t('profile.unavailable_title')}</h1>
          <p className="max-w-xs text-sm text-muted-foreground">{description}</p>
          {isRetryable && (
            <Button variant="outline" onClick={() => refetch()} data-testid="button-unavailable-retry">
              {t('common.retry')}
            </Button>
          )}
          <Button onClick={handleClose} data-testid="button-unavailable-close">
            {t('profile.unavailable_back')}
          </Button>
        </div>
      </div>
    );
  }

  if (isLoading || !office) {
    return (
      <div className={variant === 'modal' ? 'fixed inset-0 z-50 overflow-y-auto bg-background' : 'min-h-screen bg-muted/20'}>
        <div className="mx-auto max-w-lg px-4 py-3 space-y-3 animate-pulse">
          <Skeleton className="aspect-[7/3] w-full rounded-2xl" />
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-14 w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  // ── Media assembly ──────────────────────────────────────────────────────────
  const MAX_GALLERY_IMAGES = 4;

  // Decision Card hero priority:
  //   1. First approved office_media row with placement='decision_card_cover'
  //   2. offices.heroMediaUrl (legacy field)
  // Quick Card coverUrl is intentionally excluded because its 25:9 composition
  // must not be silently cropped into this 7:3 frame.
  const approvedDecisionCardCover: { url: string; type?: string } | null =
    (office as any).approvedDecisionCardCover ?? null;
  // Full priority chain: approved DC cover → legacy Decision Card hero.
  const heroUrl: string | null =
    approvedDecisionCardCover?.url ?? office.heroMediaUrl ?? null;
  const heroType: string =
    approvedDecisionCardCover?.type ?? office.heroMediaType ?? 'image';

  // ID of the gallery item being used as the DC hero (to avoid carousel duplication).
  const heroGalleryItemId: number | null = (office as any).heroGalleryItemId ?? null;

  const galleryImages: MediaItem[] = [];
  if (heroUrl && (heroType === 'image')) {
    galleryImages.push({ id: 'hero', url: heroUrl, type: 'image' });
  }
  // gallery from serializer is filtered to decision_gallery + approved only;
  // skip the item that is already shown as the hero to avoid duplication.
  for (const g of office.gallery ?? []) {
    if (g.type === 'image' && g.id !== heroGalleryItemId) {
      galleryImages.push({ id: g.id, url: g.url, type: 'image' });
    }
  }
  // Lightbox images: same image set as the carousel, video excluded, capped at 4.
  // Computed before mediaItems so it's available to the ImageLightbox renderer.
  const lightboxImages = galleryImages.slice(0, MAX_GALLERY_IMAGES);

  const mediaItems: MediaItem[] = [];
  if (office.marketingVideoUrl) {
    mediaItems.push({
      id: 'marketing-video',
      url: office.marketingVideoUrl,
      type: 'video',
      poster: heroUrl && heroType === 'image' ? heroUrl : undefined,
    });
  }
  mediaItems.push(...lightboxImages);

  // ── Derived values ──────────────────────────────────────────────────────────
  const isAr = language === 'ar';
  const displayName = (isAr && office.nameAr?.trim()) ? office.nameAr : office.name;

  const whatsappMessage = isAr
    ? `مرحبًا مكتب ${displayName}\nوجدت مكتبكم عبر SkayOffice وأرغب في الاستفسار عن خدماتكم.`
    : `Hello ${displayName}\nI found your office through SkayOffice and would like to inquire about your services.`;
  const rawWhatsappDigits = office.whatsapp ? office.whatsapp.replace(/\D/g, '') : '';
  const whatsappDigits = rawWhatsappDigits.startsWith('00') ? rawWhatsappDigits.slice(2) : rawWhatsappDigits;
  const hasValidWhatsapp = whatsappDigits.length >= 8;
  const whatsappHref = hasValidWhatsapp
    ? `https://wa.me/${whatsappDigits}?text=${encodeURIComponent(whatsappMessage)}`
    : null;
  const telHref = office.acceptsPhoneCalls && hasValidWhatsapp ? `tel:+${whatsappDigits}` : null;

  const shortDescriptionLocalized = (isAr && office.shortDescriptionAr?.trim()) ? office.shortDescriptionAr : office.shortDescription;
  const descriptionLocalized = (isAr && office.descriptionAr?.trim()) ? office.descriptionAr : office.description;
  const certificationsLocalized = (isAr && (office.certificationsAr ?? []).length > 0)
    ? office.certificationsAr!
    : (office.certifications ?? []);

  const mapQuery = encodeURIComponent(office.address ? `${office.address}, ${office.city}` : office.city);
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${mapQuery}`;

  const hasAnyContact = hasValidWhatsapp || !!telHref;

  // Communication languages
  const allLanguages: Array<{ key: string; label: string }> = [
    ...(office.spokenLanguages ?? []).map((code) => ({
      key: `code:${code}`,
      label: t(`languages.${code}` as TranslationKey),
    })),
    ...(office.customLanguages ?? []).map((val) => ({ key: `custom:${val}`, label: val })),
  ];
  const MAX_VISIBLE_LANGS = 4;
  const visibleLangs = showAllLangs ? allLanguages : allLanguages.slice(0, MAX_VISIBLE_LANGS);
  const extraLangsCount = allLanguages.length - MAX_VISIBLE_LANGS;

  // Full services list (from detailed profile response)
  const allServices: Array<{ id: number; name: string; nameAr: string | null }> =
    (office as any).services ?? [];

  // Works are intentionally separate from the Decision Card gallery. The public
  // serializer provides approved items only; never fall back to gallery here.
  const workImages: MediaItem[] = ((office as any).works ?? [])
    .filter((item: any) => item.type === 'image')
    .sort((a: any, b: any) => ((a.sortOrder ?? a.id) - (b.sortOrder ?? b.id)))
    .slice(0, 4)
    .map((item: any) => ({ id: item.id, url: item.url, type: 'image' as const }));

  const openLightboxForImage = (item: MediaItem) => {
    const idx = lightboxImages.findIndex((img) => img.id === item.id);
    if (idx >= 0) {
      setLightboxIndex(idx);
      setLightboxOpen(true);
    }
  };
  const openWorksLightbox = (item: MediaItem) => {
    const idx = workImages.findIndex((img) => img.id === item.id);
    if (idx >= 0) {
      setWorksLightboxIndex(idx);
      setWorksLightboxOpen(true);
    }
  };

  // Tab definitions — Reviews removed (trust metrics are on the Quick Card only)
  const tabs: { key: DecisionTab; label: string }[] = [
    { key: 'about',    label: t('tab.about') },
    { key: 'services', label: t('tab.services') },
    ...(office.worksEnabled ? [{ key: 'work' as const, label: t('tab.work') }] : []),
  ];

  return (
      <div
        ref={variant === 'modal' ? modalRef : undefined}
        role={variant === 'modal' ? 'dialog' : undefined}
        aria-modal={variant === 'modal' ? 'true' : undefined}
        aria-labelledby={variant === 'modal' ? 'decision-card-title' : undefined}
        tabIndex={variant === 'modal' ? -1 : undefined}
        onMouseDown={(event) => {
          if (variant === 'modal' && event.target === event.currentTarget) handleClose();
        }}
        className={
          variant === 'modal'
            ? 'fixed inset-0 z-50 overflow-y-auto bg-background pb-10'
            : 'min-h-screen bg-muted/20 pb-10'
        }
        data-testid={variant === 'modal' ? 'decision-card-modal' : undefined}
      >
      <div className="mx-auto w-full max-w-lg px-4 py-3">
        {/* Digital-office masthead */}
        <p className="mb-1 text-center text-[11px] font-medium text-slate-400/80">
          {t('profile.digital_office_by')}
        </p>

        <div
          className="overflow-hidden rounded-3xl border border-neutral-200/60 bg-card shadow-[0_2px_20px_0_rgba(0,0,0,0.07),0_1px_4px_0_rgba(0,0,0,0.04)] dark:border-border/50 dark:shadow-md"
          data-testid="decision-card"
        >
          {/* ── Card header: language toggle + close ── */}
          <div className={`flex items-center px-3 pt-1 ${variant === 'modal' ? 'justify-between' : 'justify-end'}`}>
            {variant === 'modal' && (
              <button
                type="button"
                onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
                className="min-h-11 min-w-11 px-2.5 py-1.5 inline-flex items-center justify-center text-xs font-semibold rounded-md border border-border/60 hover:bg-secondary hover:border-border transition-colors uppercase tracking-wider text-muted-foreground hover:text-foreground xl:min-h-0 xl:min-w-0"
                dir="ltr"
                data-testid="button-modal-language-toggle"
                aria-label={language === 'ar' ? t('nav.switch_to_english') : t('nav.switch_to_arabic')}
              >
                {language === 'ar' ? 'EN' : 'عربي'}
              </button>
            )}
            <button
              type="button"
              onClick={handleClose}
              ref={variant === 'modal' ? modalInitialFocusRef : undefined}
              className="flex h-11 w-11 items-center justify-center rounded-full text-foreground transition-colors hover:bg-muted xl:h-8 xl:w-8"
              data-testid="button-close"
              aria-label={t('common.close')}
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* ── Media area ── */}
          <div className="relative px-2.5 pt-1">
            <MarketingScreen
              key={office.id}
              items={mediaItems}
              officeName={displayName}
              watchIntroLabel={t('profile.watch_intro')}
              prevSlideLabel={t('profile.carousel_prev')}
              nextSlideLabel={t('profile.carousel_next')}
              scrollerAspect="aspect-[7/3]"
              onVideoStart={() => { try { trackVideoStart(officeId); } catch {} }}
              onVideoComplete={() => { try { trackVideoComplete(officeId); } catch {} }}
              onGalleryNavigate={() => { try { trackGalleryInteraction(officeId); } catch {} }}
              paused={lightboxOpen}
              onImageClick={openLightboxForImage}
            />
          </div>

          {/* Fullscreen image viewer — Decision Card images only, no video */}
          <ImageLightbox
            images={lightboxImages}
            initialIndex={lightboxIndex}
            open={lightboxOpen}
            onClose={() => setLightboxOpen(false)}
            officeName={displayName}
          />
          <ImageLightbox
            images={workImages}
            initialIndex={worksLightboxIndex}
            open={worksLightboxOpen}
            onClose={() => setWorksLightboxOpen(false)}
            officeName={displayName}
            comfortableViewport
          />

          {/* ── Card body ── */}
          <div className="space-y-3 px-4 pb-4 pt-3">

            {/* 1. Identity — name + online dot; category · city beneath */}
            <div data-testid="office-identity">
              <div className="flex items-start gap-1.5">
                {/* Online dot */}
                {office.isOnline ? (
                  <span
                    className="mt-[6px] h-2 w-2 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_0_2.5px_rgba(16,185,129,0.18)]"
                    aria-label={t('profile.online_only')}
                    data-testid="dc-online-dot"
                  />
                ) : (
                  <span className="mt-[6px] h-2 w-2 shrink-0 rounded-full bg-muted-foreground/25" data-testid="dc-offline-dot" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h1 id="decision-card-title" dir="auto" className="break-words text-lg font-bold leading-snug text-foreground">
                      <bdi>{displayName}</bdi>
                    </h1>
                    {office.isVerified && (
                      <span title={office.providerType === 'freelancer' ? t('entity.verified_freelancer') : t('entity.verified_office')}>
                        <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
                      </span>
                    )}
                    {office.providerType === 'freelancer' && (
                      <Badge variant="outline" className="text-[11px] font-normal border-border/50 text-muted-foreground py-0 px-1.5">
                        {t('provider.freelancer')}
                      </Badge>
                    )}
                  </div>
                  {/* Category · city — no response-time text in Decision Card */}
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
                    <span dir="auto" className="font-semibold text-primary/80 break-words">
                      <bdi>{categoriesMap[office.category]?.[language] || office.category}</bdi>
                    </span>
                    {office.city && (
                      <>
                        <span className="text-muted-foreground/40 select-none">·</span>
                        <span className="flex items-center gap-0.5 text-muted-foreground">
                          <MapPin className="h-2.5 w-2.5 shrink-0" />
                          <span>{localizedCity(office.city, language)}{office.country ? `, ${office.country}` : ''}</span>
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* 2. WhatsApp CTA — full-width, dominant green */}
            {hasAnyContact && (
              <div className="flex flex-col gap-1.5" data-testid="primary-actions">
                {hasValidWhatsapp && (
                  <Button
                    asChild
                    className="h-12 w-full gap-2 rounded-xl bg-emerald-600 text-sm font-bold text-white hover:bg-emerald-700"
                    data-testid="button-whatsapp"
                  >
                    <a href={whatsappHref || '#'} target="_blank" rel="noreferrer" onClick={handleWhatsappClick}>
                      <MessageCircle className="h-5 w-5 shrink-0" />
                      {t('profile.whatsapp_cta')}
                    </a>
                  </Button>
                )}
                {telHref && (
                  <a
                    href={telHref}
                    className="flex items-center justify-center gap-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                    data-testid="button-call"
                  >
                    <PhoneCall className="h-3.5 w-3.5 shrink-0" />
                    {t('profile.call_cta')}
                  </a>
                )}
                {VIDEO_CALL_FEATURE_RELEASED && office.videoCallEnabled && (
                  <Dialog open={videoDialogOpen} onOpenChange={resetVideoDialog}>
                    <Button
                      variant="secondary"
                      className="h-11 min-w-0 flex-1 gap-1 whitespace-normal rounded-xl bg-primary px-2 text-center text-xs font-bold leading-tight text-primary-foreground hover:bg-primary/90 sm:text-sm"
                      data-testid="button-schedule-call"
                      onClick={handleOpenVideoDialog}
                    >
                      <Video className="h-5 w-5 shrink-0" />
                      <span className="break-words">{t('profile.schedule_call')}</span>
                    </Button>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{t('videocall.form_title')}</DialogTitle>
                        <DialogDescription>{t('profile.call_placeholder_note')}</DialogDescription>
                      </DialogHeader>
                      {videoSuccess ? (
                        <div className="flex flex-col items-center gap-3 py-6 text-center">
                          <CheckCircle2 className="h-10 w-10 text-emerald-600" />
                          <p className="font-semibold">{t('videocall.success_title')}</p>
                          <p className="text-sm text-muted-foreground">{t('videocall.success_description')}</p>
                          <Button className="w-full" onClick={() => resetVideoDialog(false)}>{t('common.close')}</Button>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-4 py-2">
                          <p dir="auto" className="text-center text-sm font-medium">
                            {user?.name ? `${user.name} — ` : ''}<bdi>{displayName}</bdi>
                          </p>
                          {!canContact && (
                            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                              <AlertTriangle className="h-4 w-4 shrink-0" />
                              <span>{t('account.status_suspended_notice')}</span>
                            </div>
                          )}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <Label className="text-xs">{t('videocall.preferred_date')}</Label>
                              <Input type="date" name="preferredDate" value={videoForm.preferredDate} onChange={handleVideoFieldChange} className="min-h-[44px]" data-testid="input-video-date" />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs">{t('videocall.preferred_time')}</Label>
                              <Input type="time" name="preferredTime" value={videoForm.preferredTime} onChange={handleVideoFieldChange} className="min-h-[44px]" data-testid="input-video-time" />
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">{t('videocall.timezone')}</Label>
                            <Input name="timezone" value={videoForm.timezone} onChange={handleVideoFieldChange} dir="ltr" className="text-left" data-testid="input-video-timezone" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">{t('videocall.contact_number')}</Label>
                            <Input name="contactNumber" value={videoForm.contactNumber} onChange={handleVideoFieldChange} dir="ltr" className="text-left" placeholder="+966500000000" data-testid="input-video-contact-number" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">{t('videocall.note')}</Label>
                            <Textarea name="note" value={videoForm.note} onChange={handleVideoFieldChange} className="min-h-[70px]" data-testid="input-video-note" />
                          </div>
                          {videoCallError && <p className="text-xs text-red-600" data-testid="text-video-call-error">{videoCallError}</p>}
                          <Button
                            className="w-full"
                            disabled={!canContact || videoCallMutation.isPending || !videoForm.preferredDate || !videoForm.preferredTime || !videoForm.timezone || !videoForm.contactNumber}
                            onClick={handleSubmitVideoRequest}
                            data-testid="button-submit-video-request"
                          >
                            {videoCallMutation.isPending ? t('videocall.submitting') : t('videocall.submit')}
                          </Button>
                        </div>
                      )}
                    </DialogContent>
                  </Dialog>
                )}
              </div>
            )}

            {/* 2b. Request a Service CTA — shown to all non-admin visitors.
                  Anonymous users → redirect to customer login on click.
                  Office owners  → informative toast on click (cannot file SRs).
                  Customers      → SR form dialog opens on click. */}
            {user?.role !== 'admin' && (
              <>
                <Button
                  variant="outline"
                  className="h-11 w-full gap-2 rounded-xl border-primary/40 text-sm font-semibold text-primary hover:bg-primary/5"
                  onClick={handleOpenSrDialog}
                  data-testid="button-request-service"
                >
                  <ClipboardList className="h-[18px] w-[18px] shrink-0" />
                  {t('sr.request_service')}
                </Button>

                {/* Service Request Dialog — only mounts for customers */}
                {isCustomer && (
                  <Dialog open={srDialogOpen} onOpenChange={resetSrDialog}>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{t('sr.form_title')}</DialogTitle>
                        <DialogDescription>{t('sr.form_subtitle')}</DialogDescription>
                      </DialogHeader>
                      {srSuccess ? (
                        <div className="flex flex-col items-center gap-3 py-6 text-center">
                          <CheckCircle2 className="h-10 w-10 text-emerald-600" />
                          <p className="font-semibold">{t('sr.success_message')}</p>
                          <Button className="w-full" onClick={() => resetSrDialog(false)}>
                            {t('common.close')}
                          </Button>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-4 py-2">
                          <p dir="auto" className="text-center text-sm font-medium">
                            {user?.name ? `${user.name} — ` : ''}<bdi>{displayName}</bdi>
                          </p>
                          <div className="space-y-1.5">
                            <Label className="text-xs">{t('sr.service_name')}</Label>
                            <Input
                              dir="auto"
                              value={srForm.serviceName}
                              onChange={e => setSrForm(p => ({ ...p, serviceName: e.target.value }))}
                              placeholder={t('sr.service_name_placeholder')}
                              maxLength={200}
                              data-testid="input-sr-service-name"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">{t('sr.description')}</Label>
                            <Textarea
                              dir="auto"
                              value={srForm.description}
                              onChange={e => setSrForm(p => ({ ...p, description: e.target.value }))}
                              placeholder={t('sr.description_placeholder')}
                              maxLength={1000}
                              className="min-h-[80px]"
                              data-testid="input-sr-description"
                            />
                          </div>
                          {srError && (
                            <p className="text-xs text-red-600" data-testid="text-sr-error">{srError}</p>
                          )}
                          <Button
                            className="w-full"
                            disabled={srMutation.isPending || !srForm.serviceName.trim() || !srForm.description.trim()}
                            onClick={handleSubmitSrRequest}
                            data-testid="button-submit-sr"
                          >
                            {srMutation.isPending ? t('sr.submitting') : t('sr.submit_request')}
                          </Button>
                        </div>
                      )}
                    </DialogContent>
                  </Dialog>
                )}
              </>
            )}

            {/* 3. Tabs — نبذة | الخدمات | الأعمال | التقييمات */}
            <TabBar active={activeTab} onChange={setActiveTab} tabs={tabs} />

            {/* 4. Tab content panel */}
            {activeTab && <div data-testid={`tab-panel-${activeTab}`}>

              {/* ── About tab ── */}
              {activeTab === 'about' && (
                <div className="space-y-3">
                  {/* Short description */}
                  {shortDescriptionLocalized ? (
                    <div data-testid="office-summary">
                      <p
                        dir="auto"
                        className={`text-sm leading-relaxed text-foreground/80 break-words ${showFullDesc ? '' : 'line-clamp-3'}`}
                      >
                        {shortDescriptionLocalized}
                      </p>
                      {shortDescriptionLocalized.length > 120 && (
                        <button
                          type="button"
                          onClick={() => setShowFullDesc(!showFullDesc)}
                          className="mt-0.5 text-xs font-medium text-primary hover:underline"
                        >
                          {showFullDesc ? t('profile.show_less') : t('profile.show_more')}
                        </button>
                      )}
                    </div>
                  ) : descriptionLocalized ? (
                    <p dir="auto" className="text-sm leading-relaxed text-foreground/80 break-words line-clamp-4">
                      {descriptionLocalized}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">{t('profile.no_summary')}</p>
                  )}

                  {/* Certifications (in About) */}
                  {certificationsLocalized.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {certificationsLocalized.map((tag, i) => (
                        <Badge key={i} variant="secondary" className="gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium">
                          <Award className="h-3 w-3 shrink-0 text-primary" />
                          <bdi dir="auto">{tag}</bdi>
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* Communication languages */}
                  {allLanguages.length > 0 && (
                    <div data-testid="office-languages">
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {t('profile.communication_languages')}
                      </p>
                      <div className="flex flex-wrap items-center gap-1">
                        {visibleLangs.map((lang) => (
                          <Badge
                            key={lang.key}
                            variant="outline"
                            className="rounded-full px-2 py-0 text-xs font-medium"
                            data-testid={`badge-office-language-${lang.key}`}
                          >
                            <bdi dir="auto">{lang.label}</bdi>
                          </Badge>
                        ))}
                        {!showAllLangs && extraLangsCount > 0 && (
                          <button
                            type="button"
                            onClick={() => setShowAllLangs(true)}
                            className="rounded-full border border-border/70 px-2 py-0 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
                          >
                            +{extraLangsCount}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Services tab ── */}
              {activeTab === 'services' && (
                <div data-testid="tab-content-services">
                  {allServices.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {allServices.map((svc) => {
                        const label = (isAr && svc.nameAr?.trim()) ? svc.nameAr : svc.name;
                        return (
                          <span
                            key={svc.id}
                            dir="auto"
                            className="rounded-full bg-primary/8 px-3 py-1.5 text-xs font-medium text-primary border border-primary/10"
                          >
                            <bdi>{label}</bdi>
                          </span>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="py-4 text-center text-sm text-muted-foreground">{t('profile.tab_empty_services')}</p>
                  )}
                </div>
              )}

              {/* ── Work tab ── */}
              {activeTab === 'work' && (
                <div data-testid="tab-content-work">
                  {workImages.length > 0 ? (
                    <div className="grid min-w-0 grid-cols-2 gap-2">
                      {workImages.map((img) => (
                        <button
                          type="button"
                          key={img.id}
                          onClick={() => openWorksLightbox(img)}
                          className="group block aspect-[4/3] min-w-0 w-full overflow-hidden rounded-xl bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                          aria-label={displayName}
                        >
                          <img
                            src={`/api/storage${img.url}`}
                            alt={displayName}
                            className="block h-full w-full object-cover object-center transition-transform group-hover:scale-105"
                            loading="lazy"
                            decoding="async"
                          />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground">
                      <ImageIcon className="h-8 w-8 opacity-30" />
                      <p className="text-sm">{t('profile.tab_empty_work')}</p>
                    </div>
                  )}
                </div>
              )}

            </div>}

            {/* 5. Utility actions — 4-column grid (Location, Share, QR, Save) */}
            <div className="grid grid-cols-4 gap-1.5" data-testid="footer-actions">

              {/* Location */}
              <a
                href={mapUrl}
                target="_blank"
                rel="noreferrer"
                onClick={handleLocationClick}
                className="flex flex-col items-center justify-center gap-1 rounded-xl border border-border/50 bg-background min-h-[60px] py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                data-testid="button-location"
              >
                <MapPin className="h-[18px] w-[18px] shrink-0" />
                <span className="break-words px-0.5 text-center text-[11px] font-medium leading-tight">
                  {t('profile.location')}
                </span>
              </a>

              {/* Share */}
              <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
                <button
                  type="button"
                  className="flex flex-col items-center justify-center gap-1 rounded-xl border border-border/50 bg-background min-h-[60px] py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
                  data-testid="button-share-office"
                  onClick={handleOpenShareDialog}
                >
                  <Share2 className="h-[18px] w-[18px] shrink-0" />
                  <span className="break-words px-0.5 text-center text-[11px] font-medium leading-tight">
                    {t('profile.share_office')}
                  </span>
                </button>
                <DialogContent className="max-w-xs">
                  <DialogHeader>
                    <DialogTitle dir="auto" className="text-center"><bdi>{t('profile.share_office')}</bdi></DialogTitle>
                  </DialogHeader>
                  <div className="flex flex-col gap-2 py-2">
                    {canNativeShare && (
                      <Button variant="outline" className="w-full justify-start gap-2" onClick={handleNativeShare} data-testid="button-share-native">
                        <Share2 className="h-4 w-4 shrink-0" />
                        <span dir="auto" className="break-words"><bdi>{t('profile.share_native')}</bdi></span>
                      </Button>
                    )}
                    <Button variant="outline" className="w-full justify-start gap-2" onClick={handleCopyLink} data-testid="button-share-copy-link">
                      {linkCopied ? <Check className="h-4 w-4 shrink-0 text-emerald-600" /> : <Link2 className="h-4 w-4 shrink-0" />}
                      <span dir="auto" className="break-words"><bdi>{linkCopied ? t('profile.link_copied') : t('profile.copy_link')}</bdi></span>
                    </Button>
                    <Button asChild variant="outline" className="w-full justify-start gap-2" data-testid="button-share-whatsapp">
                      <a href={`https://wa.me/?text=${encodeURIComponent(`${displayName} - ${profileUrl}`)}`} target="_blank" rel="noreferrer">
                        <MessageCircle className="h-4 w-4 shrink-0" />
                        <span dir="auto" className="break-words"><bdi>{t('profile.share_whatsapp')}</bdi></span>
                      </a>
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>

              {/* Save / Favourite */}
              <button
                type="button"
                onClick={isCustomer ? toggleFavourite : () => requireLogin()}
                disabled={addFavMutation.isPending || removeFavMutation.isPending}
                className={`flex flex-col items-center justify-center gap-1 rounded-xl border min-h-[60px] py-2 transition-colors cursor-pointer ${
                  isFav
                    ? 'border-rose-200/60 bg-rose-50 text-rose-500 dark:bg-rose-950/20 hover:bg-rose-100'
                    : 'border-border/50 bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
                data-testid="button-save-office"
                aria-label={isFav ? t('profile.saved_office') : t('profile.save_office')}
              >
                {isFav ? (
                  <BookmarkCheck className="h-[18px] w-[18px] shrink-0" />
                ) : (
                  <Bookmark className="h-[18px] w-[18px] shrink-0" />
                )}
                <span className="break-words px-0.5 text-center text-[11px] font-medium leading-tight">
                  {isFav ? t('profile.saved_office') : t('profile.save_office')}
                </span>
              </button>
            </div>

            {/* Privacy notice — subtle */}
            <p className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground/50">
              <Lock className="h-2.5 w-2.5 shrink-0" />
              {t('profile.privacy_notice')}
            </p>

          </div>
        </div>
      </div>
    </div>
  );
}
