import React, { useState, useCallback } from 'react';
import { useI18n } from '@/lib/i18n';
import {
  LayoutDashboard, Building2, Users,
  Activity, Menu, Shield, LogOut, Settings, TrendingUp, HeartPulse,
} from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useLogout } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { clearSessionToken } from '@/lib/sessionToken';

import { OverviewSection }          from './sections/Overview';
import { CustomerManagementSection } from './sections/CustomerManagement';
import { ActivityLogSection }        from './sections/ActivityLog';
import { AccountSettingsSection }    from './sections/AccountSettings';
import { PlatformHealthSection }     from './sections/PlatformHealth';
import { OfficeManagementSection }   from './sections/OfficeManagement';
import { IntelligenceHubSection }    from './sections/IntelligenceHub';

// ── Section type ─────────────────────────────────────────────────────────────
export type AdminSection =
  | 'overview'
  | 'office-management'
  | 'customers'
  | 'intelligence'
  | 'activity'
  | 'health'
  | 'settings';

const VALID_SECTIONS: AdminSection[] = [
  'overview', 'office-management', 'customers',
  'intelligence', 'activity', 'health', 'settings',
];

const SECTION_STORAGE_KEY = 'skayoffice-admin-section';

function getStoredSection(): AdminSection {
  try {
    const raw = localStorage.getItem(SECTION_STORAGE_KEY);
    if (!raw) return 'overview';
    // Migrate old section keys that no longer exist.
    if (raw === 'requests' || raw === 'offices') return 'office-management';
    if (raw === 'analytics')                     return 'intelligence';
    if ((VALID_SECTIONS as string[]).includes(raw)) return raw as AdminSection;
  } catch {}
  return 'overview';
}

// ── Nav items ─────────────────────────────────────────────────────────────────
interface NavItem {
  id: AdminSection;
  icon: React.ReactNode;
  labelKey: string;
}

const navItems: NavItem[] = [
  { id: 'overview',          icon: <LayoutDashboard size={20} />, labelKey: 'admin.nav.overview' },
  { id: 'office-management', icon: <Building2 size={20} />,       labelKey: 'admin.nav.officeManagement' },
  { id: 'customers',         icon: <Users size={20} />,           labelKey: 'admin.nav.customers' },
  { id: 'intelligence',      icon: <TrendingUp size={20} />,      labelKey: 'admin.nav.intelligence' },
  { id: 'activity',          icon: <Activity size={20} />,        labelKey: 'admin.nav.activity' },
  { id: 'health',            icon: <HeartPulse size={20} />,      labelKey: 'admin.nav.health' },
  { id: 'settings',          icon: <Settings size={20} />,        labelKey: 'admin.nav.settings' },
];

// Primary icons in the mobile bottom bar (the rest go in the More drawer).
const bottomPrimary: AdminSection[] = ['overview', 'office-management', 'intelligence', 'health'];

// ── Sidebar item ──────────────────────────────────────────────────────────────
function SidebarItem({
  item, active, onClick, t,
}: { item: NavItem; active: boolean; onClick: () => void; t: (k: any) => string }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
        active
          ? 'bg-primary text-primary-foreground shadow-sm'
          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
      }`}
    >
      <span className="shrink-0">{item.icon}</span>
      <span className="flex-1 text-start truncate">{t(item.labelKey as any)}</span>
    </button>
  );
}

// ── Section router ────────────────────────────────────────────────────────────
function SectionContent({ section, navigate }: { section: AdminSection; navigate: (s: string) => void }) {
  switch (section) {
    case 'overview':          return <OverviewSection navigate={navigate} />;
    case 'office-management': return <OfficeManagementSection />;
    case 'customers':         return <CustomerManagementSection />;
    case 'intelligence':      return <IntelligenceHubSection />;
    case 'activity':          return <ActivityLogSection />;
    case 'health':            return <PlatformHealthSection />;
    case 'settings':          return <AccountSettingsSection />;
    default:                  return <OverviewSection navigate={navigate} />;
  }
}

// ── Admin shell ───────────────────────────────────────────────────────────────
export function Admin() {
  const { t, language, setLanguage } = useI18n();
  const isRtl = language === 'ar';

  const [activeSection, setActiveSectionState] = useState<AdminSection>(getStoredSection);
  const [moreDrawerOpen, setMoreDrawerOpen]     = useState(false);

  const logoutMut    = useLogout();
  const queryClient  = useQueryClient();
  const [, setLocation] = useLocation();

  const setActiveSection = useCallback((section: AdminSection) => {
    setActiveSectionState(section);
    try { localStorage.setItem(SECTION_STORAGE_KEY, section); } catch {}
    setMoreDrawerOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const navigate = useCallback((section: string) => {
    setActiveSection(section as AdminSection);
  }, [setActiveSection]);

  const handleLogout = () => {
    logoutMut.mutate(undefined, {
      onSettled: () => {
        clearSessionToken();
        queryClient.removeQueries();
        setLocation('/', { replace: true });
      },
    });
  };

  const langToggle = (
    <div className="flex gap-1">
      <Button size="sm" variant={language === 'ar' ? 'default' : 'outline'} className="h-7 text-xs px-2" onClick={() => setLanguage('ar')}>AR</Button>
      <Button size="sm" variant={language === 'en' ? 'default' : 'outline'} className="h-7 text-xs px-2" onClick={() => setLanguage('en')}>EN</Button>
    </div>
  );

  return (
    <div className="min-h-[100dvh] w-full max-w-full overflow-x-hidden bg-background flex">

      {/* ── Desktop sidebar ── */}
      <aside className={`hidden lg:flex flex-col fixed inset-y-0 ${isRtl ? 'right-0' : 'left-0'} w-60 bg-card border-e border-border z-30 shadow-sm`}>
        <div className="px-4 pt-5 pb-4 border-b flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shrink-0">
            <Shield size={18} />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate">{t('admin.title')}</p>
            <p className="text-[10px] text-muted-foreground">{language === 'ar' ? 'صلاحيات الإدارة' : 'Admin Access'}</p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {navItems.map(item => (
            <SidebarItem key={item.id} item={item} active={activeSection === item.id} onClick={() => setActiveSection(item.id)} t={t} />
          ))}
        </nav>

        <div className="px-3 py-3 border-t space-y-2">
          {langToggle}
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-muted-foreground text-xs" onClick={handleLogout}>
            <LogOut size={14} />{t('common.logout')}
          </Button>
        </div>
      </aside>

      {/* ── Main content ── */}
       <main className="flex-1 min-w-0 max-w-full lg:ms-60 pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-8">
        <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b px-4 py-3 flex items-center gap-3">
          <button className="lg:hidden p-1.5 rounded-lg hover:bg-muted transition-colors" onClick={() => setMoreDrawerOpen(true)} aria-label="Navigation">
            <Menu size={20} />
          </button>
          <h1 className="font-semibold text-base flex-1 truncate">
            {t(navItems.find(n => n.id === activeSection)?.labelKey as any)}
          </h1>
          <div className="hidden lg:flex">{langToggle}</div>
        </div>

         <div className="dashboard-surface px-3 sm:px-4 py-4 sm:py-5 max-w-7xl mx-auto">
          <SectionContent section={activeSection} navigate={navigate} />
        </div>
      </main>

      {/* ── Mobile bottom nav ── */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-card border-t border-border safe-bottom">
        <div className="grid grid-cols-5 h-16">
          {bottomPrimary.map(id => {
            const item = navItems.find(n => n.id === id)!;
            const active = activeSection === id;
            return (
              <button key={id} onClick={() => setActiveSection(id)}
                className={`flex flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors relative ${active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
                {item.icon}
                <span className="truncate px-1">{t(item.labelKey as any)}</span>
                {active && <span className="absolute top-0 inset-x-3 h-0.5 bg-primary rounded-b-full" />}
              </button>
            );
          })}
          <button onClick={() => setMoreDrawerOpen(true)}
            className="flex flex-col items-center justify-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors">
            <Menu size={20} />
            <span>{t('admin.nav.more')}</span>
          </button>
        </div>
      </nav>

      {/* ── Mobile More drawer ── */}
      <Sheet open={moreDrawerOpen} onOpenChange={setMoreDrawerOpen}>
         <SheetContent side={isRtl ? 'right' : 'left'} className="w-[min(18rem,88vw)] p-0 overflow-y-auto">
          <SheetHeader className="px-4 pt-5 pb-3 border-b">
            <SheetTitle className="text-start text-base">{t('admin.nav.more')}</SheetTitle>
          </SheetHeader>
          <div className="flex items-center gap-3 px-4 py-3 border-b bg-muted/20">
            <div className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center shrink-0">
              <Shield size={16} />
            </div>
            <p className="font-medium text-sm truncate">{t('admin.title')}</p>
          </div>
          <nav className="py-2 px-2 space-y-0.5">
            {navItems.map(item => (
              <SidebarItem key={item.id} item={item} active={activeSection === item.id} onClick={() => setActiveSection(item.id)} t={t} />
            ))}
          </nav>
          <div className="px-4 py-3 border-t space-y-2">
            <div className="flex gap-2">{langToggle}</div>
            <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-muted-foreground text-xs" onClick={handleLogout}>
              <LogOut size={14} />{t('common.logout')}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
