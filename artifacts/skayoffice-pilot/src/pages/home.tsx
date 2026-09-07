import React from 'react';
import { Link, useLocation } from 'wouter';
import { useI18n, categoriesMap } from '@/lib/i18n';
import { onHomeFiltersResetRequested } from '@/lib/homeReset';
import {
  useListOffices,
  useListCategories,
  useGetCurrentUser,
  useListFavourites,
  useAddFavourite,
  useRemoveFavourite,
  getListFavouritesQueryKey,
  getGetCurrentUserQueryKey,
  getListOfficesQueryKey,
  type OfficeSortType,
} from '@workspace/api-client-react';
import { LocationConsentDialog } from '@/components/LocationConsentDialog';
import { useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Search,
  Mic,
  Palette,
  Megaphone,
  Code2,
  Building2,
  Languages,
  MapPin,
  Scale,
  Briefcase,
  Calculator,
  MoreHorizontal,
  Share2,
  User,
  X,

} from 'lucide-react';
import { QuickOfficeCard } from '@/components/office/QuickOfficeCard';
import { trackSearch } from '@/lib/analytics';
import { SharePlatformSection } from '@/components/home/SharePlatformSection';
import { CategoryCarousel, type CategoryItem } from '@/components/home/CategoryCarousel';
import { SortDropdown } from '@/components/home/SortDropdown';
import { useToast } from '@/hooks/use-toast';

// Icon map — keyed by category key from the API
const CATEGORY_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  design: Palette,
  marketing: Megaphone,
  development: Code2,
  company_formation: Building2,
  translation: Languages,
  real_estate: MapPin,
  legal: Scale,
  business_consulting: Briefcase,
  accounting: Calculator,
  social_media_management: Share2,
  other: MoreHorizontal,
};

export function Home() {
  const { t, language } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [location] = useLocation();

  const [search, setSearch] = React.useState('');
  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  // '' means no category filter — distinct from the old 'all' sentinel
  const [category, setCategory] = React.useState<string>('');
  const [providerType, setProviderType] = React.useState<'office' | 'freelancer'>('office');
  const [sort, setSort] = React.useState<OfficeSortType>('nearest');
  const [visibleLimit, setVisibleLimit] = React.useState(20);
  const [customerCoords, setCustomerCoords] = React.useState<{ lat: number; lon: number } | null>(null);
  const [showLocationConsent, setShowLocationConsent] = React.useState(false);
  const [listening, setListening] = React.useState(false);
  const recognitionRef = React.useRef<any>(null);

  // Reset to a clean unfiltered state whenever the user lands on "/"
  React.useEffect(() => {
    if (location === '/') {
      setSearch('');
      setDebouncedSearch('');
      setCategory('');
      setProviderType('office');
      setSort('nearest');
      setVisibleLimit(20);
    }
  }, [location]);

  // Covers clicking the logo while already sitting on "/" (no location change fires)
  React.useEffect(() => {
    return onHomeFiltersResetRequested(() => {
      setSearch('');
      setDebouncedSearch('');
      setCategory('');
      setProviderType('office');
      setSort('nearest');
      setVisibleLimit(20);
    });
  }, []);

  // Belt-and-suspenders: force-clear on first mount regardless of location
  React.useEffect(() => {
    setSearch('');
    setDebouncedSearch('');
    setCategory('');
    setProviderType('office');
    setSort('nearest');
    setVisibleLimit(20);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset pagination whenever any primary filter / sort changes
  React.useEffect(() => {
    setVisibleLimit(20);
  }, [debouncedSearch, category, providerType, sort, customerCoords]);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(timer);
  }, [search]);

  const listOfficesParams = {
    providerType,
    sort,
    search: debouncedSearch || undefined,
    category: (category || undefined) as any,
    latitude: customerCoords?.lat,
    longitude: customerCoords?.lon,
    page: 1,
    limit: visibleLimit,
  };

  const { data, isLoading, isError, refetch } = useListOffices(
    listOfficesParams,
    // queryKey must be supplied to satisfy UseQueryOptions; the hook
    // overrides it from params anyway. retry:1/retryDelay:1500 covers the
    // cold-start case where the first request arrives while the Autoscale
    // instance is still waking up.
    { query: { queryKey: getListOfficesQueryKey(listOfficesParams), retry: 1, retryDelay: 1500 } },
  );

  const offices = data?.items ?? [];
  const totalCount = data?.total ?? 0;
  const hasMore = totalCount > offices.length && !isLoading;

  // Phase 1 analytics: track search_performed when debounced search resolves
  const lastTrackedSearchRef = React.useRef('');
  // Track the inputMethod for voice vs typed
  const lastInputMethodRef = React.useRef<'typed' | 'voice'>('typed');
  React.useEffect(() => {
    if (!debouncedSearch || isLoading) return;
    if (lastTrackedSearchRef.current === debouncedSearch) return;
    lastTrackedSearchRef.current = debouncedSearch;
    const method = lastInputMethodRef.current;
    try {
      trackSearch({ query: debouncedSearch, resultsCount: offices.length, inputMethod: method });
    } catch { /* never block */ }
    // reset to typed after the voice result was fired
    lastInputMethodRef.current = 'typed';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, isLoading, offices.length]);

  // True when search text or a category is narrowing the result set
  const hasActiveFilter = Boolean(debouncedSearch) || Boolean(category);

  const handleSortChange = (newSort: OfficeSortType) => {
    if (newSort === 'nearest' && !customerCoords) {
      setShowLocationConsent(true);
      return;
    }
    setSort(newSort);
  };

  const { data: rawCategories } = useListCategories();

  // Adapt API category shape to the CategoryItem interface
  const adaptedCategories: CategoryItem[] = React.useMemo(() => {
    if (!Array.isArray(rawCategories)) return [];
    return rawCategories.map((cat) => ({
      key: cat.key,
      labelAr: cat.labelAr,
      labelEn: cat.labelEn,
    }));
  }, [rawCategories]);

  const { data: user } = useGetCurrentUser({ query: { retry: false, queryKey: getGetCurrentUserQueryKey() } });
  const isCustomer = user?.role === 'customer';

  const { data: favourites } = useListFavourites({
    query: { enabled: isCustomer, queryKey: getListFavouritesQueryKey() },
  });

  const addFavMutation = useAddFavourite({
    mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListFavouritesQueryKey() }) },
  });
  const removeFavMutation = useRemoveFavourite({
    mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListFavouritesQueryKey() }) },
  });

  const favouriteIds = new Set(favourites?.map((f) => f.id));

  const toggleFavourite = (officeId: number) => {
    if (favouriteIds.has(officeId)) {
      removeFavMutation.mutate({ officeId });
    } else {
      addFavMutation.mutate({ data: { officeId } });
    }
  };

  const handleVoiceSearch = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      toast({ title: t('discover.voice_unsupported'), variant: 'destructive' });
      return;
    }

    if (listening) {
      recognitionRef.current?.stop();
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = language === 'ar' ? 'ar-SA' : 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognition.onresult = (event: any) => {
      const transcript = event.results?.[0]?.[0]?.transcript;
      if (transcript) {
        lastInputMethodRef.current = 'voice';
        setSearch(transcript);
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  const handleProviderTypeChange = (type: 'office' | 'freelancer') => {
    setProviderType(type);
    // Search and category are preserved; pagination resets via the effect above
  };

  const isFreelancer = providerType === 'freelancer';

  return (
    <div className="container mx-auto px-4 py-5 flex flex-col gap-3.5 min-h-[80vh]">

      {/* ── 1. Hero ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col items-center gap-1 pb-0.5 text-center">
        <h1 className="max-w-2xl text-2xl font-serif font-bold tracking-tight text-foreground sm:text-3xl whitespace-pre-line">
          {t('home.hero_title')}
        </h1>
        <p className="max-w-xl text-xs text-blue-700/80 sm:text-sm font-medium">
          {t('home.hero_subtitle')}
        </p>
      </div>

      {/* ── 2. Search bar ───────────────────────────────────────────────────── */}
      <div className="relative">
        <Search className="absolute ltr:left-4 rtl:right-4 top-1/2 -translate-y-1/2 h-[18px] w-[18px] text-muted-foreground/60 pointer-events-none" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('discover.search_placeholder')}
          className="h-14 ltr:pl-12 rtl:pr-12 ltr:pr-14 rtl:pl-14 rounded-2xl text-base shadow-sm border-border/70 hover:border-border/90 focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/15 transition-colors"
        />
        <button
          type="button"
          onClick={handleVoiceSearch}
          aria-label={t('discover.voice_search')}
          className={`absolute ltr:right-2 rtl:left-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full flex items-center justify-center transition-colors ${
            listening
              ? 'bg-rose-500 text-white animate-pulse'
              : 'bg-primary text-primary-foreground hover:bg-primary/90'
          }`}
        >
          <Mic size={17} />
        </button>
      </div>

      {/* ── 3. Provider segmented control ───────────────────────────────────── */}
      <div
        role="group"
        aria-label={t('provider.type_label')}
        className="flex rounded-xl border border-border/60 overflow-hidden shadow-sm"
      >
        <button
          type="button"
          onClick={() => handleProviderTypeChange('office')}
          aria-pressed={providerType === 'office'}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors min-h-[44px] ${
            providerType === 'office'
              ? 'bg-primary text-primary-foreground'
              : 'bg-card text-foreground hover:bg-muted/50'
          }`}
        >
          <Building2 size={16} />
          {t('provider.switch_offices')}
        </button>
        {/* Hairline divider between segments */}
        <div className="w-px bg-border/60 shrink-0" />
        <button
          type="button"
          onClick={() => handleProviderTypeChange('freelancer')}
          aria-pressed={providerType === 'freelancer'}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors min-h-[44px] ${
            providerType === 'freelancer'
              ? 'bg-primary text-primary-foreground'
              : 'bg-card text-foreground hover:bg-muted/50'
          }`}
        >
          <User size={16} />
          {t('provider.switch_freelancers')}
        </button>
      </div>

      {/* ── 4. Sort control + location clear ────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <SortDropdown sort={sort} onSortChange={handleSortChange} t={t} />
        {customerCoords && (
          <button
            type="button"
            onClick={() => { setCustomerCoords(null); setSort('newest'); }}
            className="flex items-center gap-1 px-3 py-1.5 rounded-full border text-xs text-muted-foreground border-border/40 hover:text-destructive hover:border-destructive/40 transition-colors min-h-[36px]"
          >
            <X size={12} />
            {t('location.deny')}
          </button>
        )}
      </div>

      {/* ── Location consent dialog ──────────────────────────────────────────── */}
      <LocationConsentDialog
        open={showLocationConsent}
        onAllow={(lat, lon) => {
          setCustomerCoords({ lat, lon });
          setSort('nearest');
          setShowLocationConsent(false);
        }}
        onDeny={() => {
          setSort('nearest'); // city-match fallback
          setShowLocationConsent(false);
        }}
      />

      {/* ── 5. Category carousel ────────────────────────────────────────────── */}
      <CategoryCarousel
        categories={adaptedCategories}
        activeCategory={category}
        onCategoryChange={setCategory}
        language={language}
        t={t}
        categoryIcons={CATEGORY_ICONS}
      />

      {/* ── 6. Results heading + cards ──────────────────────────────────────── */}
      <div className="flex-1 flex flex-col gap-4">
        <h2 className="text-lg font-bold">
          {isFreelancer ? t('discover.section_title_freelancers') : t('discover.section_title')}
        </h2>

        {/* Loading skeleton */}
        {isLoading && offices.length === 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-64 rounded-2xl bg-muted/50 animate-pulse" />
            ))}
          </div>

        /* API failure — distinct from empty results */
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-20 text-center border rounded-xl border-dashed bg-muted/10">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
              <Search className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-xl font-semibold mb-2">{t('discover.api_error')}</h3>
            <Button variant="outline" className="mt-4" onClick={() => refetch()}>
              {t('common.retry')}
            </Button>
          </div>

        /* Zero results */
        ) : offices.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center border rounded-xl border-dashed bg-muted/10">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
              <Search className="h-8 w-8 text-muted-foreground" />
            </div>
            {hasActiveFilter ? (
              <>
                <h3 className="text-xl font-semibold mb-2">
                  {isFreelancer
                    ? t('discover.no_results_freelancer')
                    : t('discover.no_results_office')}
                </h3>
                {/* Clearing filters does NOT reset provider type */}
                <Button
                  variant="outline"
                  className="mt-6"
                  onClick={() => { setSearch(''); setCategory(''); }}
                >
                  {t('discover.reset_search')}
                </Button>
              </>
            ) : (
              /* No text/category filters — truly no live listings for this provider type */
              <h3 className="text-xl font-semibold mb-2">
                {isFreelancer
                  ? t('discover.no_offices_available_freelancer')
                  : t('discover.no_offices_available_office')}
              </h3>
            )}
          </div>

        /* Results grid */
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {offices.map((office, index) => (
                <QuickOfficeCard
                  key={office.id}
                  office={office}
                  index={index}
                  showFavourite={isCustomer}
                  isFavourite={favouriteIds.has(office.id)}
                  favouriteDisabled={addFavMutation.isPending || removeFavMutation.isPending}
                  onToggleFavourite={() => toggleFavourite(office.id)}
                />
              ))}
            </div>
            {hasMore && (
              <div className="flex justify-center pt-2">
                <Button
                  variant="outline"
                  onClick={() => setVisibleLimit((v) => v + 20)}
                  disabled={isLoading}
                  className="px-8"
                >
                  {isLoading ? t('discover.load_more_loading') : t('discover.load_more')}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Share-the-platform section */}
      <SharePlatformSection />
    </div>
  );
}
