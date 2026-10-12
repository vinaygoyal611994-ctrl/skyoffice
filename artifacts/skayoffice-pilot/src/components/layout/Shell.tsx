import React from 'react';
import { useI18n } from '@/lib/i18n';
import { Link, useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Menu, X, LogOut, Heart, LayoutDashboard, UserCircle, Mail, Building2, Users, ShieldCheck, ChevronRight, LogIn, UserPlus, Lock } from 'lucide-react';
import { FaWhatsapp } from 'react-icons/fa';
import { useGetCurrentUser, useLogout, getGetCurrentUserQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { clearSessionToken } from '@/lib/sessionToken';
import { requestHomeFiltersReset } from '@/lib/homeReset';
import { trackPilotContactIntent } from '@/lib/analytics';

// Official brand contact details (per SkayOffice branding requirements).
const CONTACT_EMAIL = 'info@skayoffice.com';
const CONTACT_PHONE_DISPLAY = '+966 55 722 7818';
const CONTACT_PHONE_TECHNICAL = '+966557227818';
const WHATSAPP_URL = `https://wa.me/${CONTACT_PHONE_TECHNICAL.replace(/[^\d]/g, '')}`;

export function Shell({ children }: { children: React.ReactNode }) {
  const { t, language, setLanguage } = useI18n();
  const [location, setLocation] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const menuButtonRef = React.useRef<HTMLButtonElement>(null);
  const mobileMenuRef = React.useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data: user } = useGetCurrentUser({
    query: {
      retry: false,
      queryKey: getGetCurrentUserQueryKey(),
    }
  });

  const logoutMutation = useLogout({
    mutation: {
      onSuccess: () => {
        // Navigate client-side and drop all cached queries (favourites,
        // account/dashboard/admin data, current-user) instead of a hard
        // `window.location` reload. The full-document reload was the cause
        // of the brief blank screen on logout — the browser tears down and
        // re-fetches/re-parses the whole app before anything paints. A
        // client-side route change plus a query-cache reset clears the
        // session state immediately without that flash, and still lands on
        // the public homepage regardless of which role (customer, office,
        // admin) just logged out.
        //
        // Use removeQueries (not invalidateQueries): react-query keeps the
        // last successful `data` around after a query errors, so merely
        // invalidating left the stale authenticated `user` object visible
        // in the header even though /api/auth/me was already returning 401.
        // Removing the cache entries clears `data` back to undefined
        // immediately, before the background refetch even resolves.
        clearSessionToken();
        queryClient.removeQueries();
        // Use replace so the protected page is removed from the browser history
        // stack entirely. A plain pushState keeps it in history and the browser
        // can restore it from bfcache when the user presses Back, briefly
        // exposing authenticated content on a now-invalid session.
        setLocation('/', { replace: true });
      },
      // If the destroy call fails (network error, server 5xx), the session
      // is unusable anyway — clear client-side state so the UI doesn't stay
      // stuck on the authenticated screen.
      onError: () => {
        clearSessionToken();
        queryClient.removeQueries();
        setLocation('/', { replace: true });
      },
    }
  });

  const toggleLang = () => {
    setLanguage(language === 'ar' ? 'en' : 'ar');
  };

  const closeMenu = React.useCallback(() => {
    setMobileMenuOpen(false);
  }, []);

  const closeMenuAndRestoreFocus = React.useCallback(() => {
    setMobileMenuOpen(false);
    window.requestAnimationFrame(() => menuButtonRef.current?.focus());
  }, []);

  React.useEffect(() => {
    if (!mobileMenuOpen || !mobileMenuRef.current) return;
    const menu = mobileMenuRef.current;
    const getFocusableElements = () => Array.from(
      menu.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    const focusable = getFocusableElements();
    focusable[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenuAndRestoreFocus();
        return;
      }
      if (event.key !== 'Tab') return;

      const elements = getFocusableElements();
      if (elements.length === 0) {
        event.preventDefault();
        menu.focus();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === menu)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    menu.addEventListener('keydown', onKeyDown);
    return () => menu.removeEventListener('keydown', onKeyDown);
  }, [closeMenuAndRestoreFocus, mobileMenuOpen]);

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background selection:bg-primary selection:text-primary-foreground">
      {/* Navbar */}
      <header className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur-md">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link
              href="/"
              className="flex items-center group"
              onClick={() => {
                closeMenu();
                requestHomeFiltersReset();
              }}
            >
              <div className="overflow-hidden h-[24px] md:h-[28px] lg:h-[34px]">
                <img
                  src="/brand/skayoffice-logo-horizontal.png"
                  alt="SkayOffice"
                  className="h-[30px] md:h-[34px] lg:h-[40px] w-auto max-w-[42vw] md:max-w-none object-contain object-top transition-transform group-hover:scale-105"
                />
              </div>
            </Link>

            <nav className="hidden md:flex items-center gap-1 font-medium text-sm text-muted-foreground">
              <Link href="/discover" className="px-3 py-2 rounded-md hover:text-foreground hover:bg-secondary transition-colors">
                {t('nav.discover')}
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={toggleLang}
              className="min-h-11 min-w-11 px-2.5 py-1.5 inline-flex items-center justify-center text-xs font-semibold rounded-md border border-border/60 hover:bg-secondary hover:border-border transition-colors uppercase tracking-wider text-muted-foreground hover:text-foreground cursor-pointer"
              dir="ltr"
              aria-label={language === 'ar' ? t('nav.switch_to_english') : t('nav.switch_to_arabic')}
            >
              {language === 'ar' ? 'EN' : 'عربي'}
            </button>

            <div className="hidden md:flex items-center gap-2">
              {user ? (
                <>
                  {user.role === 'customer' && (
                    <>
                      <Link href="/favourites" className="text-muted-foreground hover:text-foreground p-2 rounded-md hover:bg-secondary transition-colors" aria-label={t('nav.favourites')}>
                        <Heart size={18} />
                      </Link>
                      <Link href="/account" className="text-muted-foreground hover:text-foreground p-2 rounded-md hover:bg-secondary transition-colors flex items-center gap-2" data-testid="link-account">
                        <UserCircle size={18} />
                        <span className="text-sm font-medium">{t('account.title')}</span>
                      </Link>
                    </>
                  )}
                  
                  {user.role === 'office' && (
                    <Link href="/office/dashboard" className="text-muted-foreground hover:text-foreground p-2 rounded-md hover:bg-secondary transition-colors flex items-center gap-2">
                      <LayoutDashboard size={18} />
                      <span className="text-sm font-medium">{t('nav.dashboard')}</span>
                    </Link>
                  )}
                  
                  {user.role === 'admin' && (
                    <Link href="/admin" className="text-muted-foreground hover:text-foreground p-2 rounded-md hover:bg-secondary transition-colors">
                      <LayoutDashboard size={18} />
                      <span className="text-sm font-medium">{t('nav.admin')}</span>
                    </Link>
                  )}

                  <Button variant="ghost" size="sm" onClick={() => logoutMutation.mutate()} className="gap-2">
                    <LogOut size={16} className="text-muted-foreground" />
                    <span>{t('common.logout')}</span>
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href="/login/customer">{t('common.login')}</Link>
                  </Button>
                  <Button size="sm" asChild className="rounded-full px-5">
                    <Link href="/register/office">{t('auth.register_office')}</Link>
                  </Button>
                </>
              )}
            </div>

            <button
              ref={menuButtonRef}
              type="button"
              className="md:hidden h-11 w-11 p-0 inline-flex items-center justify-center text-muted-foreground"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-navigation-menu"
              aria-label={mobileMenuOpen ? t('nav.close_menu') : t('nav.open_menu')}
            >
              {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div
          ref={mobileMenuRef}
          id="mobile-navigation-menu"
          role="dialog"
          aria-modal="true"
          aria-label={t('nav.mobile_menu')}
          tabIndex={-1}
          className="md:hidden fixed inset-0 z-30 pt-16 bg-background overflow-y-auto animate-in slide-in-from-top-4 border-b border-border/40"
        >
          <nav className="py-3 flex flex-col">

            {user ? (
              /* ── Authenticated ─────────────────────────────────────── */
              <>
                {user.role === 'customer' && (
                  <>
                    <Link href="/favourites" onClick={closeMenu} className="flex items-center gap-3.5 px-5 py-3.5 hover:bg-secondary/70 transition-colors text-[15px] font-medium" data-testid="link-favourites-mobile">
                      <Heart size={18} className="shrink-0 text-muted-foreground" />
                      {t('nav.favourites')}
                    </Link>
                    <Link href="/account" onClick={closeMenu} className="flex items-center gap-3.5 px-5 py-3.5 hover:bg-secondary/70 transition-colors text-[15px] font-medium" data-testid="link-account-mobile">
                      <UserCircle size={18} className="shrink-0 text-muted-foreground" />
                      {t('account.title')}
                    </Link>
                  </>
                )}
                {user.role === 'office' && (
                  <Link href="/office/dashboard" onClick={closeMenu} className="flex items-center gap-3.5 px-5 py-3.5 hover:bg-secondary/70 transition-colors text-[15px] font-medium">
                    <LayoutDashboard size={18} className="shrink-0 text-muted-foreground" />
                    {t('nav.dashboard')}
                  </Link>
                )}
                {user.role === 'admin' && (
                  <Link href="/admin" onClick={closeMenu} className="flex items-center gap-3.5 px-5 py-3.5 hover:bg-secondary/70 transition-colors text-[15px] font-medium">
                    <LayoutDashboard size={18} className="shrink-0 text-muted-foreground" />
                    {t('nav.admin')}
                  </Link>
                )}
                <div className="mx-5 my-2 h-px bg-border/60" />
                <button
                  onClick={() => { logoutMutation.mutate(); closeMenu(); }}
                  className="flex items-center gap-3.5 px-5 py-3.5 hover:bg-destructive/8 transition-colors text-[15px] font-medium text-destructive w-full text-start"
                >
                  <LogOut size={18} className="shrink-0" />
                  {t('common.logout')}
                </button>
              </>
            ) : (
              /* ── Unauthenticated — sectioned account menu ──────────── */
              <div className="px-3 pt-1 pb-5 flex flex-col gap-0">

                {/* ── OFFICES ─────────────────────────────────────────── */}
                <div className="flex items-center gap-2 px-2 pt-3 pb-1.5">
                  <Building2 size={12} className="shrink-0 text-muted-foreground" />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground select-none">
                    {t('menu.offices')}
                  </span>
                </div>

                {/* Primary CTA — tinted brand row */}
                <Link
                  href="/register/office"
                  onClick={closeMenu}
                  className="flex items-center gap-3 px-3 h-[52px] rounded-xl bg-primary/10 hover:bg-primary/15 active:bg-primary/20 transition-colors text-[15px] font-bold text-primary"
                >
                  <Building2 size={18} className="shrink-0" />
                  <span className="flex-1 leading-none">{t('home.establish_digital_office')}</span>
                  <ChevronRight size={15} className="shrink-0 rtl:rotate-180 opacity-50" />
                </Link>

                {/* Secondary row */}
                <Link
                  href="/login/office"
                  onClick={closeMenu}
                  className="flex items-center gap-3 px-3 h-12 rounded-lg hover:bg-secondary/70 active:bg-secondary transition-colors text-[14px] font-medium text-muted-foreground"
                >
                  <LogIn size={16} className="shrink-0" />
                  <span className="flex-1 leading-none">{t('auth.login_office')}</span>
                  <ChevronRight size={13} className="shrink-0 rtl:rotate-180 opacity-30" />
                </Link>

                {/* ── CUSTOMERS ───────────────────────────────────────── */}
                <div className="mx-1 my-2 h-px bg-border/60" />
                <div className="flex items-center gap-2 px-2 pt-1 pb-1.5">
                  <Users size={12} className="shrink-0 text-muted-foreground" />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground select-none">
                    {t('menu.customers')}
                  </span>
                </div>

                <Link
                  href="/register/customer"
                  onClick={closeMenu}
                  className="flex items-center gap-3 px-3 h-[52px] rounded-xl bg-secondary/80 hover:bg-secondary active:bg-secondary/90 transition-colors text-[15px] font-semibold text-foreground"
                >
                  <UserPlus size={17} className="shrink-0 text-muted-foreground" />
                  <span className="flex-1 leading-none">{t('auth.register_customer')}</span>
                  <ChevronRight size={15} className="shrink-0 rtl:rotate-180 opacity-30" />
                </Link>

                <Link
                  href="/login/customer"
                  onClick={closeMenu}
                  className="flex items-center gap-3 px-3 h-12 rounded-lg hover:bg-secondary/70 active:bg-secondary transition-colors text-[14px] font-medium text-muted-foreground"
                >
                  <LogIn size={16} className="shrink-0" />
                  <span className="flex-1 leading-none">{t('auth.login_customer')}</span>
                  <ChevronRight size={13} className="shrink-0 rtl:rotate-180 opacity-30" />
                </Link>

                {/* ── ADMINISTRATION ──────────────────────────────────── */}
                <div className="mx-1 my-2 h-px bg-border/60" />
                <div className="flex items-center gap-2 px-2 pt-1 pb-1.5">
                  <ShieldCheck size={12} className="shrink-0 text-muted-foreground" />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground select-none">
                    {t('menu.administration')}
                  </span>
                </div>

                <Link
                  href="/admin/login"
                  onClick={closeMenu}
                  className="flex items-center gap-3 px-3 h-11 rounded-lg hover:bg-secondary/50 active:bg-secondary/70 transition-colors text-[13px] font-medium text-muted-foreground/70"
                >
                  <Lock size={15} className="shrink-0 opacity-60" />
                  <span className="flex-1 leading-none">{t('auth.login_admin')}</span>
                  <ChevronRight size={12} className="shrink-0 rtl:rotate-180 opacity-25" />
                </Link>

              </div>
            )}

          </nav>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 flex flex-col">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t bg-muted/30 py-12 mt-auto">
        <div className="container mx-auto px-4 grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <Link
              href="/"
              className="flex items-center mb-4"
              onClick={requestHomeFiltersReset}
            >
              <img
                src="/brand/skayoffice-logo.png"
                alt="SkayOffice"
                className="h-8 w-auto object-contain"
              />
            </Link>
            <p className="text-muted-foreground text-sm max-w-sm">
              {t('footer.project_of')}
            </p>
          </div>
          
          <div>
            <h4 className="font-semibold mb-4">{t('footer.contact_title')}</h4>
            <ul className="space-y-3 text-sm text-muted-foreground">
              <li>
                <a
                  href={`mailto:${CONTACT_EMAIL}`}
                  className="hover:text-primary transition-colors flex items-center gap-2"
                  data-testid="link-footer-email"
                  onClick={() => { try { trackPilotContactIntent('footer_email'); } catch {} }}
                >
                  <Mail size={16} className="shrink-0" />
                  <span dir="ltr" className="[unicode-bidi:plaintext]">{CONTACT_EMAIL}</span>
                </a>
              </li>
              <li>
                <a
                  href={WHATSAPP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-primary transition-colors flex items-center gap-2"
                  data-testid="link-footer-whatsapp"
                  onClick={() => { try { trackPilotContactIntent('footer_whatsapp'); } catch {} }}
                >
                  <FaWhatsapp size={16} className="shrink-0" />
                  <span dir="ltr">{CONTACT_PHONE_DISPLAY}</span>
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold mb-4">{t('footer.legal_title')}</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <Link href="/terms" className="hover:text-primary transition-colors">
                  {t('footer.terms_link')}
                </Link>
              </li>
              <li>
                <Link href="/privacy" className="hover:text-primary transition-colors">
                  {t('footer.privacy_link')}
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="container mx-auto px-4 pt-8 mt-8 border-t flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground text-center sm:text-start">
          <p>
            {language === 'ar'
              ? `© ${new Date().getFullYear()} شركة فيوتشر رود لابز. جميع الحقوق محفوظة.`
              : `© ${new Date().getFullYear()} Future Road Labs. All rights reserved.`}
          </p>
          <div className="flex gap-4">
            <button
              onClick={toggleLang}
              className="min-h-11 min-w-11 px-2.5 py-1.5 inline-flex items-center justify-center text-xs font-semibold rounded-md border border-border/60 hover:bg-secondary hover:border-border transition-colors uppercase tracking-wider text-muted-foreground hover:text-foreground cursor-pointer"
              dir="ltr"
              aria-label={language === 'ar' ? t('nav.switch_to_english') : t('nav.switch_to_arabic')}
            >
              {language === 'ar' ? 'EN' : 'عربي'}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
