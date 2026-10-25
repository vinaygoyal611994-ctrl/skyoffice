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
  { id: 'overview',          icon: <LayoutDashboard size={18} />, labelKey: 'admin.nav.overview' },
  { id: 'office-management', icon: <Building2 size={18} />,       labelKey: 'admin.nav.officeManagement' },
  { id: 'customers',         icon: <Users size={18} />,           labelKey: 'admin.nav.customers' },
  { id: 'intelligence',      icon: <TrendingUp size={18} />,      labelKey: 'admin.nav.intelligence' },
  { id: 'activity',          icon: <Activity size={18} />,        labelKey: 'admin.nav.activity' },
  { id: 'health',            icon: <HeartPulse size={18} />,      labelKey: 'admin.nav.health' },
  { id: 'settings',          icon: <Settings size={18} />,        labelKey: 'admin.nav.settings' },
];

const bottomPrimary: AdminSection[] = ['overview', 'office-management', 'intelligence', 'health'];

/* ─── sidebar palette (same as office dashboard) ─────────────────── */
const SB = {
  bg:           '#0f172a',
  border:       'rgba(255,255,255,0.07)',
  iconInactive: 'rgba(255,255,255,0.42)',
  iconActive:   '#ffffff',
  textInactive: 'rgba(255,255,255,0.55)',
  textActive:   '#ffffff',
  rowHover:     'rgba(255,255,255,0.06)',
  rowActive:    'rgba(255,255,255,0.10)',
  accent:       'hsl(var(--primary))',
};

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
        setLocation('/admin/login', { replace: true });
      },
    });
  };

  const sectionTitle = navItems.find(n => n.id === activeSection)?.labelKey;

  return (
    <div className="min-h-[100dvh] w-full max-w-full overflow-x-hidden flex" style={{ background: '#f1f5f9' }}>

      {/* ══ DESKTOP SIDEBAR ══ */}
      <aside
        className={`group hidden lg:flex flex-col fixed top-16 bottom-0 ${isRtl ? 'right-0' : 'left-0'} w-[62px] hover:w-[240px] transition-[width] duration-300 ease-in-out overflow-hidden z-30`}
        style={{ background: SB.bg, borderRight: `1px solid ${SB.border}` }}
      >
        {/* Admin identity */}
        <div className="flex items-center px-3 py-4 shrink-0" style={{ borderBottom: `1px solid ${SB.border}` }}>
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-white"
            style={{ background: 'hsl(var(--primary))' }}
          >
            <Shield size={17} />
          </div>
          <div className="ms-3 min-w-0 overflow-hidden opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <p className="text-[13px] font-semibold leading-snug truncate whitespace-nowrap" style={{ color: SB.textActive }}>
              {t('admin.title')}
            </p>
            <p className="text-[10px] mt-0.5 whitespace-nowrap" style={{ color: SB.iconInactive }}>
              {language === 'ar' ? 'صلاحيات الإدارة' : 'Admin Access'}
            </p>
          </div>
        </div>

        {/* Nav */}
        <nav
          className="flex-1 overflow-y-auto overflow-x-hidden py-2"
          style={{ scrollbarWidth: 'none' } as React.CSSProperties}
        >
          {navItems.map(item => (
            <SidebarItem
              key={item.id}
              item={item}
              active={activeSection === item.id}
              onClick={() => setActiveSection(item.id)}
              t={t}
            />
          ))}
        </nav>

        {/* Footer: lang + logout */}
        <div className="shrink-0 py-2 space-y-0.5" style={{ borderTop: `1px solid ${SB.border}` }}>
          {/* Language toggle */}
          <div className="flex items-center px-3 py-2 gap-2 overflow-hidden">
            <div className="w-9 h-9 flex items-center justify-center shrink-0">
              <span className="text-[11px] font-semibold" style={{ color: SB.iconInactive }}>
                {language === 'ar' ? 'AR' : 'EN'}
              </span>
            </div>
            <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex gap-1 whitespace-nowrap">
              <button
                onClick={() => setLanguage('ar')}
                className="cursor-pointer px-2 py-0.5 rounded text-[11px] font-medium transition-colors"
                style={{
                  background: language === 'ar' ? 'hsl(var(--primary))' : 'rgba(255,255,255,0.08)',
                  color: '#fff',
                }}
              >
                AR
              </button>
              <button
                onClick={() => setLanguage('en')}
                className="cursor-pointer px-2 py-0.5 rounded text-[11px] font-medium transition-colors"
                style={{
                  background: language === 'en' ? 'hsl(var(--primary))' : 'rgba(255,255,255,0.08)',
                  color: '#fff',
                }}
              >
                EN
              </button>
            </div>
          </div>

          {/* Logout */}
          <button
            onClick={handleLogout}
            title={language === 'ar' ? 'تسجيل الخروج' : 'Logout'}
            className="cursor-pointer w-full flex items-center px-3 py-2.5 transition-colors"
            style={{ color: SB.iconInactive }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.12)';
              (e.currentTarget as HTMLElement).style.color = '#f87171';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = 'transparent';
              (e.currentTarget as HTMLElement).style.color = SB.iconInactive;
            }}
          >
            <span className="w-9 h-9 flex items-center justify-center shrink-0">
              <LogOut size={17} />
            </span>
            <span className="ms-3 text-[13px] font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-200">
              {language === 'ar' ? 'تسجيل الخروج' : 'Logout'}
            </span>
          </button>
        </div>
      </aside>

      {/* ══ MAIN CONTENT ══ */}
      <main className="flex-1 min-w-0 max-w-full lg:ms-[62px] pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-10">

        {/* Mobile hamburger bar */}
        <div className="lg:hidden sticky top-0 z-20 bg-white border-b border-border/50 px-4 py-3 flex items-center gap-3">
          <button
            className="cursor-pointer p-1.5 rounded-lg hover:bg-muted transition-colors"
            onClick={() => setMoreDrawerOpen(true)}
          >
            <Menu size={20} />
          </button>
          <h1 className="font-semibold text-sm text-foreground truncate">
            {sectionTitle ? t(sectionTitle as any) : ''}
          </h1>
        </div>

        {/* Page content */}
        <div className="px-4 sm:px-6 pt-5 pb-10">
          <div className="hidden lg:flex items-center justify-between mb-5">
            <h1 className="text-lg font-bold text-foreground">
              {sectionTitle ? t(sectionTitle as any) : ''}
            </h1>
          </div>
          <div className="dashboard-surface">
            <SectionContent section={activeSection} navigate={navigate} />
          </div>
        </div>
      </main>

      {/* ══ MOBILE BOTTOM NAV ══ */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-border shadow-lg">
        <div className="grid grid-cols-5 h-16">
          {bottomPrimary.map(id => {
            const item = navItems.find(n => n.id === id)!;
            const active = activeSection === id;
            return (
              <button key={id} onClick={() => setActiveSection(id)}
                className={`cursor-pointer flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors relative ${
                  active ? 'text-primary' : 'text-muted-foreground'
                }`}>
                {item.icon}
                <span className="truncate px-1 leading-none mt-0.5">{t(item.labelKey as any)}</span>
                {active && <span className="absolute top-0 inset-x-2 h-0.5 bg-primary rounded-b-full" />}
              </button>
            );
          })}
          <button onClick={() => setMoreDrawerOpen(true)}
            className="cursor-pointer flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-muted-foreground">
            <Menu size={20} />
            <span className="leading-none mt-0.5">{t('admin.nav.more')}</span>
          </button>
        </div>
      </nav>

      {/* ══ MOBILE DRAWER ══ */}
      <Sheet open={moreDrawerOpen} onOpenChange={setMoreDrawerOpen}>
        <SheetContent side={isRtl ? 'right' : 'left'} className="w-[min(17rem,90vw)] p-0 overflow-hidden flex flex-col" style={{ background: SB.bg }}>
          <SheetHeader className="px-4 pt-5 pb-4 shrink-0" style={{ borderBottom: `1px solid ${SB.border}` }}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-white" style={{ background: 'hsl(var(--primary))' }}>
                <Shield size={17} />
              </div>
              <div className="min-w-0">
                <SheetTitle className="text-sm font-semibold text-white text-start leading-tight truncate">
                  {t('admin.title')}
                </SheetTitle>
                <p className="text-[10px] mt-0.5" style={{ color: SB.iconInactive }}>
                  {language === 'ar' ? 'صلاحيات الإدارة' : 'Admin Access'}
                </p>
              </div>
            </div>
          </SheetHeader>

          <nav className="flex-1 overflow-y-auto py-2" style={{ scrollbarWidth: 'none' } as React.CSSProperties}>
            {navItems.map(item => (
              <SidebarItem
                key={item.id}
                item={item}
                active={activeSection === item.id}
                onClick={() => setActiveSection(item.id)}
                t={t}
                expanded
              />
            ))}
          </nav>

          <div className="shrink-0 py-3 px-4 space-y-3" style={{ borderTop: `1px solid ${SB.border}` }}>
            <div className="flex gap-1.5">
              <Button
                size="sm"
                className="h-7 text-xs px-3"
                style={{
                  background: language === 'ar' ? 'hsl(var(--primary))' : 'rgba(255,255,255,0.10)',
                  color: '#fff',
                  border: 'none',
                }}
                onClick={() => setLanguage('ar')}
              >AR</Button>
              <Button
                size="sm"
                className="h-7 text-xs px-3"
                style={{
                  background: language === 'en' ? 'hsl(var(--primary))' : 'rgba(255,255,255,0.10)',
                  color: '#fff',
                  border: 'none',
                }}
                onClick={() => setLanguage('en')}
              >EN</Button>
            </div>
            <button
              onClick={handleLogout}
              className="cursor-pointer w-full flex items-center gap-3 py-2 text-sm font-medium transition-colors"
              style={{ color: SB.iconInactive }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#f87171'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = SB.iconInactive; }}
            >
              <LogOut size={16} />
              <span>{language === 'ar' ? 'تسجيل الخروج' : 'Logout'}</span>
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/* ─── SidebarItem ─────────────────────────────────────────────────── */
function SidebarItem({
  item, active, onClick, t, expanded = false,
}: {
  item: NavItem; active: boolean; onClick: () => void; t: (k: any) => string; expanded?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const rowStyle: React.CSSProperties = {
    background:  active ? SB.rowActive : hovered ? SB.rowHover : 'transparent',
    color:       active ? SB.textActive : hovered ? 'rgba(255,255,255,0.80)' : SB.textInactive,
    borderLeft:  active ? `3px solid ${SB.accent}` : '3px solid transparent',
  };

  return (
    <button
      onClick={onClick}
      title={!expanded ? t(item.labelKey as any) : undefined}
      className="cursor-pointer w-full flex items-center px-3 py-2.5 transition-all text-[13px] font-medium"
      style={rowStyle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Icon — always visible */}
      <span
        className="w-9 h-9 flex items-center justify-center rounded-lg shrink-0 transition-colors"
        style={{ background: active ? 'hsl(var(--primary))' : 'transparent', color: active ? '#fff' : 'inherit' }}
      >
        {item.icon}
      </span>

      {/* Label */}
      {expanded ? (
        <span className="ms-3 flex-1 text-start whitespace-nowrap">{t(item.labelKey as any)}</span>
      ) : (
        <span className="ms-3 flex-1 text-start whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-200 overflow-hidden">
          {t(item.labelKey as any)}
        </span>
      )}
    </button>
  );
}
