import React from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import { MoreHorizontal, X, Grid3X3 } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { type Language } from '@/lib/i18n';

// ---------------------------------------------------------------------------
// Priority order for the initial four visible carousel tiles.
// Structured as a standalone export so future analytics-based ordering can
// replace this list without touching the render logic.
// ---------------------------------------------------------------------------
export const CATEGORY_PRIORITY_ORDER: string[] = [
  'marketing',
  'design',
  'development',
  'social_media_management',
];

const INITIAL_DELAY_MS = 8_000;
const ROTATION_INTERVAL_MS = 12_000;
const INTERACTION_PAUSE_MS = 25_000;

// ---------------------------------------------------------------------------
// Reduced-motion hook — reactive to OS-level changes
// ---------------------------------------------------------------------------
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduced;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface CategoryItem {
  key: string;
  labelAr: string;
  labelEn: string;
}

interface Props {
  /** Full category list from the API — 'all' and 'other' are stripped internally */
  categories: CategoryItem[];
  /** '' means no category filter is active */
  activeCategory: string;
  onCategoryChange: (key: string) => void;
  language: Language;
  t: (key: any) => string;
  categoryIcons: Record<string, React.ComponentType<{ size?: number; className?: string }>>;
}

// ---------------------------------------------------------------------------
// CategoryCarousel
// ---------------------------------------------------------------------------
export function CategoryCarousel({
  categories,
  activeCategory,
  onCategoryChange,
  language,
  t,
  categoryIcons,
}: Props) {
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const prefersReducedMotion = usePrefersReducedMotion();
  const interactedAtRef = React.useRef<number>(0);
  const rotationTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref so the rotation closure always reads the latest sheetOpen value without
  // needing it as a dep (which would restart the timer on every open/close)
  const sheetOpenRef = React.useRef(false);
  sheetOpenRef.current = sheetOpen;

  // Filter out 'all' and 'other'; apply priority order, then remaining in API order
  const sortedCategories = React.useMemo<CategoryItem[]>(() => {
    const excluded = new Set(['all', 'other']);
    const filtered = categories.filter((c) => !excluded.has(c.key));
    const prioritySet = new Set(CATEGORY_PRIORITY_ORDER);
    const priorityItems = CATEGORY_PRIORITY_ORDER
      .map((k) => filtered.find((c) => c.key === k))
      .filter((c): c is CategoryItem => c != null);
    const rest = filtered.filter((c) => !prioritySet.has(c.key));
    return [...priorityItems, ...rest];
  }, [categories]);

  const isRtl = language === 'ar';

  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: 'start',
    loop: false,
    direction: isRtl ? 'rtl' : 'ltr',
    dragFree: false,
    slidesToScroll: 1,
  });

  const markInteraction = React.useCallback(() => {
    interactedAtRef.current = Date.now();
  }, []);

  // ---------------------------------------------------------------------------
  // Auto-rotation: first tick at INITIAL_DELAY_MS, subsequent at
  // ROTATION_INTERVAL_MS. Pauses when: reduced-motion, tab hidden, sheet open,
  // or within INTERACTION_PAUSE_MS of any user interaction.
  // ---------------------------------------------------------------------------
  React.useEffect(() => {
    if (!emblaApi || prefersReducedMotion) return;

    const scheduleRotation = (delay: number) => {
      if (rotationTimerRef.current) clearTimeout(rotationTimerRef.current);
      rotationTimerRef.current = setTimeout(() => {
        if (
          document.hidden ||
          sheetOpenRef.current ||
          Date.now() - interactedAtRef.current < INTERACTION_PAUSE_MS
        ) {
          // Conditions not met — re-check after the normal interval
          scheduleRotation(ROTATION_INTERVAL_MS);
          return;
        }
        if (emblaApi.canScrollNext()) {
          emblaApi.scrollNext();
        } else {
          // End of carousel — wrap to first slide
          emblaApi.scrollTo(0);
        }
        scheduleRotation(ROTATION_INTERVAL_MS);
      }, delay);
    };

    scheduleRotation(INITIAL_DELAY_MS);

    const onPointerDown = () => markInteraction();
    emblaApi.on('pointerDown', onPointerDown);

    const onVisibilityChange = () => {
      if (document.hidden) {
        if (rotationTimerRef.current) clearTimeout(rotationTimerRef.current);
      } else {
        scheduleRotation(ROTATION_INTERVAL_MS);
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      if (rotationTimerRef.current) clearTimeout(rotationTimerRef.current);
      emblaApi.off('pointerDown', onPointerDown);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [emblaApi, prefersReducedMotion, markInteraction]);

  // Scroll the active category tile into view whenever selection changes
  React.useEffect(() => {
    if (!emblaApi || !activeCategory) return;
    const idx = sortedCategories.findIndex((c) => c.key === activeCategory);
    if (idx >= 0) {
      emblaApi.scrollTo(idx, prefersReducedMotion);
    }
  }, [activeCategory, emblaApi, sortedCategories, prefersReducedMotion]);

  const handleCarouselSelect = (key: string) => {
    markInteraction();
    // Tapping the active category again deselects it
    onCategoryChange(activeCategory === key ? '' : key);
  };

  const handleSheetSelect = (key: string) => {
    markInteraction();
    onCategoryChange(activeCategory === key ? '' : key);
    setSheetOpen(false);
  };

  const handleClearFilter = () => {
    markInteraction();
    onCategoryChange('');
  };

  const getLabel = (cat: CategoryItem) =>
    language === 'ar' ? cat.labelAr : cat.labelEn;

  const activeCategoryItem = sortedCategories.find((c) => c.key === activeCategory);

  return (
    <>
      <div
        role="group"
        aria-label={t('home.categories_title')}
        onTouchStart={markInteraction}
        onFocus={markInteraction}
      >
        {/* Embla viewport — negative horizontal margin to bleed to the container edge */}
        <div ref={emblaRef} className="overflow-hidden -mx-4">
          <div className="flex px-4 gap-3">
            {sortedCategories.map((cat) => {
              const Icon = categoryIcons[cat.key] ?? MoreHorizontal;
              const isActive = activeCategory === cat.key;
              return (
                <button
                  key={cat.key}
                  type="button"
                  onClick={() => handleCarouselSelect(cat.key)}
                  aria-pressed={isActive}
                  aria-label={getLabel(cat)}
                  className="flex flex-col items-center gap-1.5 shrink-0 w-20 group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-xl"
                >
                  {/* w-16 h-16 = 64px — above the 44px minimum touch target */}
                  <div
                    className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-all border ${
                      isActive
                        ? 'bg-primary border-primary text-primary-foreground shadow-md scale-105'
                        : 'bg-card border-border/60 shadow-sm text-muted-foreground group-hover:border-primary/40 group-hover:shadow-md'
                    }`}
                  >
                    <Icon size={22} />
                  </div>
                  <span
                    className={`text-xs font-medium text-center leading-tight line-clamp-2 w-full px-0.5 ${
                      isActive ? 'text-primary font-semibold' : 'text-muted-foreground'
                    }`}
                  >
                    {getLabel(cat)}
                  </span>
                </button>
              );
            })}

            {/* More tile — always the final item in the carousel */}
            <button
              type="button"
              onClick={() => {
                markInteraction();
                setSheetOpen(true);
              }}
              aria-label={t('category.more_title')}
              className="flex flex-col items-center gap-1.5 shrink-0 w-20 group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-xl"
            >
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center transition-all border bg-card border-border/60 shadow-sm text-muted-foreground group-hover:border-primary/40 group-hover:shadow-md">
                <Grid3X3 size={22} />
              </div>
              <span className="text-xs font-medium text-center text-muted-foreground leading-tight">
                {t('category.more')}
              </span>
            </button>
          </div>
        </div>

        {/* Active filter pill shown beneath the carousel */}
        {activeCategoryItem && (
          <div className="flex items-center gap-1.5 mt-2.5 ltr:pl-0.5 rtl:pr-0.5">
            <span className="text-xs text-primary font-semibold">
              {getLabel(activeCategoryItem)}
            </span>
            <button
              type="button"
              onClick={handleClearFilter}
              aria-label={t('category.clear_filter')}
              className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-destructive transition-colors min-h-[32px] px-1"
            >
              <X size={12} />
              {t('category.clear_filter')}
            </button>
          </div>
        )}
      </div>

      {/* More sheet — shows all categories for quick access without swiping */}
      <Sheet
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) markInteraction();
        }}
      >
        <SheetContent side="bottom" className="rounded-t-3xl max-h-[82vh] p-0">
          <div className="px-6 pt-6 pb-2">
            <SheetHeader className="text-start">
              <SheetTitle className="text-base font-semibold">
                {t('category.more_title')}
              </SheetTitle>
            </SheetHeader>
          </div>
          <div
            className="overflow-y-auto px-6 pb-8"
            style={{ maxHeight: 'calc(82vh - 90px)' }}
          >
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-4 pt-2">
              {sortedCategories.map((cat) => {
                const Icon = categoryIcons[cat.key] ?? MoreHorizontal;
                const isActive = activeCategory === cat.key;
                return (
                  <button
                    key={cat.key}
                    type="button"
                    onClick={() => handleSheetSelect(cat.key)}
                    aria-pressed={isActive}
                    className="flex flex-col items-center gap-2 group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-xl p-1"
                  >
                    <div
                      className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all border ${
                        isActive
                          ? 'bg-primary border-primary text-primary-foreground shadow-md'
                          : 'bg-card border-border/60 shadow-sm text-muted-foreground group-hover:border-primary/40 group-hover:shadow-md'
                      }`}
                    >
                      <Icon size={20} />
                    </div>
                    <span
                      className={`text-xs font-medium text-center leading-tight line-clamp-2 ${
                        isActive ? 'text-primary font-semibold' : 'text-muted-foreground'
                      }`}
                    >
                      {getLabel(cat)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
