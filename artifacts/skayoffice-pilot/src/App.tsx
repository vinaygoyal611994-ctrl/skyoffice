import React, { Suspense } from 'react';
import { Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Shell } from '@/components/layout/Shell';
import { useGetCurrentUser, getGetCurrentUserQueryKey } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/ErrorBoundary';

// HIGH-02: lazy-load all page modules so the initial bundle only ships the
// Shell + auth hook. Heavy deps (Recharts, Uppy, Admin tables) only load on
// the first navigation to the relevant page.
const Home            = React.lazy(() => import('@/pages/home').then(m => ({ default: m.Home })));
const RegisterCustomer = React.lazy(() => import('@/pages/register').then(m => ({ default: m.RegisterCustomer })));
const RegisterOffice  = React.lazy(() => import('@/pages/register').then(m => ({ default: m.RegisterOffice })));
const TermsPage       = React.lazy(() => import('@/pages/legal').then(m => ({ default: m.TermsPage })));
const PrivacyPage     = React.lazy(() => import('@/pages/legal').then(m => ({ default: m.PrivacyPage })));
const LoginCustomer   = React.lazy(() => import('@/pages/login').then(m => ({ default: m.LoginCustomer })));
const LoginOffice     = React.lazy(() => import('@/pages/login').then(m => ({ default: m.LoginOffice })));
const LoginAdmin      = React.lazy(() => import('@/pages/login-admin').then(m => ({ default: m.LoginAdmin })));
const ForgotPassword  = React.lazy(() => import('@/pages/forgot-password').then(m => ({ default: m.ForgotPassword })));
const ResetPassword   = React.lazy(() => import('@/pages/reset-password').then(m => ({ default: m.ResetPassword })));
const Discover        = React.lazy(() => import('@/pages/discover').then(m => ({ default: m.Discover })));
const OfficeProfile   = React.lazy(() => import('@/pages/office-profile').then(m => ({ default: m.OfficeProfile })));
const Dashboard       = React.lazy(() => import('@/pages/dashboard').then(m => ({ default: m.Dashboard })));
const Favourites      = React.lazy(() => import('@/pages/favourites').then(m => ({ default: m.Favourites })));
const Admin           = React.lazy(() => import('@/pages/admin').then(m => ({ default: m.Admin })));
const Account         = React.lazy(() => import('@/pages/account').then(m => ({ default: m.Account })));

import {
  officeModalAroundNav,
  getOfficeModalBackgroundLocation,
  getOfficeModalTrigger,
  clearOfficeModalTrigger,
} from '@/lib/officeModalNav';
import { getSessionToken } from '@/lib/sessionToken';
import { useI18n } from '@/lib/i18n';
import { SearchX } from 'lucide-react';

// Matches the legacy numeric route (/offices/:id) and the canonical
// slug-based public routes (/office/:slug, /ar/office/:slug,
// /en/office/:slug) — but NOT /office/dashboard, which is an unrelated
// office-portal route that happens to share the singular "/office" prefix.
const OFFICE_PROFILE_PATTERN = /^\/offices\/[^/]+|^\/office\/(?!dashboard(?:\/|$))[^/]+|^\/(ar|en)\/office\/[^/]+/;

const NotFound = () => {
  const { t } = useI18n();
  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center px-4 py-16 bg-muted/20">
      {/* Icon badge */}
      <div className="w-16 h-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-6 shadow-sm">
        <SearchX size={28} />
      </div>

      {/* Large decorative 404 */}
      <p className="text-[7rem] sm:text-[9rem] font-extrabold leading-none text-primary/10 select-none -mb-2">
        404
      </p>

      {/* Title */}
      <h1 className="text-2xl font-bold text-foreground mt-4 mb-3">
        {t('not_found.title')}
      </h1>

      {/* Description */}
      <p className="text-muted-foreground text-sm text-center max-w-sm mb-8 leading-relaxed">
        {t('not_found.description')}
      </p>

      {/* CTA */}
      <a
        href="/"
        className="inline-flex items-center px-6 py-2.5 bg-primary text-primary-foreground rounded-full hover:bg-primary/90 transition-colors font-medium text-sm shadow-sm"
      >
        {t('not_found.back_home')}
      </a>
    </div>
  );
};

// Route Guards
function ProtectedRoute({ component: Component, role }: { component: React.ComponentType<any>, role?: 'customer' | 'office' | 'admin' }) {
  const { data: user, isLoading } = useGetCurrentUser({ query: { retry: false, queryKey: getGetCurrentUserQueryKey() } });
  const [, setLocation] = useLocation();

  // Defence-in-depth against bfcache (Back/Forward Cache) restoration.
  // When the user logs out and the browser restores a protected page from
  // bfcache via the Back button, React's state (including the React Query
  // user cache) is also restored, so the normal isLoading/user effect would
  // see a valid user and render protected content for a moment.
  // Listening for `pageshow` with `event.persisted === true` catches this
  // case: if the token was cleared during logout (sessionStorage + localStorage
  // are empty) we redirect immediately before any paint.
  React.useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        // Page was restored from bfcache — check the token synchronously.
        if (!getSessionToken()) {
          const loginPath = role === 'office' ? '/login/office' : role === 'admin' ? '/admin/login' : '/login/customer';
          setLocation(loginPath, { replace: true });
        }
      }
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [role, setLocation]);

  React.useEffect(() => {
    if (!isLoading) {
      if (!user) {
        // Redirect to the role-appropriate login page so the user is never
        // sent to the wrong portal. Office → /login/office; admin → /admin/login;
        // customer → /login/customer. Each role has its own dedicated login form.
        const loginPath = role === 'office' ? '/login/office' : role === 'admin' ? '/admin/login' : '/login/customer';
        setLocation(loginPath);
      } else if (role && user.role !== role) {
        setLocation('/');
      }
    }
  }, [user, isLoading, role, setLocation]);

  if (isLoading || !user || (role && user.role !== role)) {
    return <div className="p-20 flex justify-center min-h-[60vh] items-center"><div className="animate-spin w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full" /></div>;
  }

  return <Component />;
}

// HIGH-03: global React Query defaults — treat all query data as fresh for
// 30 s so navigating back to a cached page doesn't fire a background refetch
// on every tab switch. Per-query overrides can still tighten or loosen this.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,       // 30 s before a background refetch is triggered
      gcTime: 5 * 60_000,      // 5 min before unused cache entries are GC'd
      retry: 1,                // one automatic retry on transient failures
    },
  },
});

function AppRouter() {
  const [location, setLocation] = useLocation();

  // While the Decision Card (office profile) is open, `backgroundLocation` is the
  // page the customer was on right before opening it (e.g. "/" with whatever local
  // filter state it already had). We keep the `<Switch>` matching that background
  // location the whole time the overlay is open, so the underlying page component
  // (Home, Discover, Favourites, ...) never unmounts — closing the overlay just
  // stops overriding the match, and the same still-mounted instance reappears with
  // its state and scroll position intact.
  const isOfficeModalRoute = OFFICE_PROFILE_PATTERN.test(location);
  const backgroundLocation = isOfficeModalRoute ? getOfficeModalBackgroundLocation() : null;

  const closeOfficeModal = React.useCallback(() => {
    const trigger = getOfficeModalTrigger();
    const returnLocation = getOfficeModalBackgroundLocation();
    if (!returnLocation) {
      setLocation('/');
      return;
    }
    setLocation(returnLocation);
    clearOfficeModalTrigger();
    window.requestAnimationFrame(() => {
      if (trigger && document.contains(trigger)) trigger.focus();
    });
  }, [setLocation]);

  return (
    <Shell>
      <Switch location={backgroundLocation ?? undefined}>
        <Route path="/" component={Home} />

        <Route path="/discover" component={Discover} />
        {/* Legacy numeric link (kept working for anything already shared). */}
        <Route path="/offices/:id">{() => <OfficeProfile />}</Route>

        <Route path="/register/customer" component={RegisterCustomer} />
        <Route path="/register/office" component={RegisterOffice} />
        <Route path="/login/customer" component={LoginCustomer} />
        <Route path="/login/office" component={LoginOffice} />
        <Route path="/admin/login" component={LoginAdmin} />
        <Route path="/forgot-password" component={ForgotPassword} />
        <Route path="/reset-password" component={ResetPassword} />

        <Route path="/terms" component={TermsPage} />
        <Route path="/privacy" component={PrivacyPage} />

        <Route path="/office/dashboard">
          {() => <ProtectedRoute component={Dashboard} role="office" />}
        </Route>

        {/* Canonical public Decision Card links — stable slug, not the
            internal numeric id, so a printed/shared/QR link never breaks.
            The language-prefixed variants set the active UI language on
            open so a scanned Arabic/English QR always opens in that
            language. Must be declared after /office/dashboard above so
            that literal route is matched first. */}
        <Route path="/ar/office/:slug">{() => <OfficeProfile forceLanguage="ar" />}</Route>
        <Route path="/en/office/:slug">{() => <OfficeProfile forceLanguage="en" />}</Route>
        <Route path="/office/:slug">{() => <OfficeProfile />}</Route>

        <Route path="/favourites">
          {() => <ProtectedRoute component={Favourites} role="customer" />}
        </Route>

        <Route path="/account">
          {() => <ProtectedRoute component={Account} role="customer" />}
        </Route>

        <Route path="/admin">
          {() => <ProtectedRoute component={Admin} role="admin" />}
        </Route>

        <Route component={NotFound} />
      </Switch>

      {isOfficeModalRoute && backgroundLocation && (
        <OfficeProfile variant="modal" onClose={closeOfficeModal} />
      )}
    </Shell>
  );
}

const PageSpinner = () => (
  <div className="p-20 flex justify-center min-h-[60vh] items-center">
    <div className="animate-spin w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full" />
  </div>
);

function App() {
  return (
    // M-6 (audit): ErrorBoundary catches unhandled React render errors and
    // shows a bilingual recovery screen instead of a blank white page.
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')} aroundNav={officeModalAroundNav}>
            {/* Suspense catches lazy page modules during their first load. */}
            <Suspense fallback={<PageSpinner />}>
              <AppRouter />
            </Suspense>
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;