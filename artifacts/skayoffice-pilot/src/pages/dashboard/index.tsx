import React, { useState, useCallback } from 'react';
import { useI18n } from '@/lib/i18n';
import { useGetMyOffice, useListMyOfficeDocuments, useListMyOfficeVideoCallRequests, useGetOfficeServiceRequests, useLogout } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { clearSessionToken } from '@/lib/sessionToken';
import { Badge } from '@/components/ui/badge';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import {
  LayoutDashboard, Building2, Image, MessageSquare, Video,
  FileText, BarChart3, CreditCard, Bell, Settings, HelpCircle,
  CheckCircle2, Clock, AlertTriangle, XCircle, ShieldCheck,
  Menu, ClipboardList, LogOut, QrCode,
} from 'lucide-react';

import { OverviewSection }        from './sections/Overview';
import { ProfileSection }         from './sections/Profile';
import { MediaSection }           from './sections/Media';
import { DocumentsSection }       from './sections/Documents';
import { ContactFeaturesSection } from './sections/ContactFeatures';
import { VideoRequestsSection }   from './sections/VideoRequests';
import { ServiceRequestsSection } from './sections/ServiceRequests';
import { PerformanceSection }     from './sections/Performance';
import { SubscriptionSection }    from './sections/Subscription';
import { NotificationsSection }   from './sections/Notifications';
import { SettingsSection }        from './sections/Settings';
import { HelpSection }            from './sections/Help';
import { OfficeToolsSection }     from './sections/OfficeTools';

export type DashSection =
  | 'overview' | 'office_tools' | 'profile' | 'media' | 'contact' | 'requests'
  | 'service_requests' | 'documents' | 'performance' | 'subscription'
  | 'notifications' | 'settings' | 'help';

const SECTION_STORAGE_KEY = 'skayoffice-dash-section';
const VALID_SECTIONS: ReadonlySet<string> = new Set<DashSection>([
  'overview','office_tools','profile','media','contact','requests',
  'service_requests','documents','performance','subscription',
  'notifications','settings','help',
]);

function getStoredSection(): DashSection {
  try {
    const s = localStorage.getItem(SECTION_STORAGE_KEY);
    if (s && VALID_SECTIONS.has(s)) return s as DashSection;
    if (s) localStorage.removeItem(SECTION_STORAGE_KEY);
  } catch {}
  return 'overview';
}

interface NavItem { id: DashSection; icon: React.ReactNode; labelKey: string; badge?: number; }

const STATUS_META: Record<string, { tone: string; icon: React.ReactNode }> = {
  draft:             { tone: 'bg-slate-100 text-slate-600 border-slate-200',      icon: <Clock size={10} /> },
  under_review:      { tone: 'bg-blue-100 text-blue-700 border-blue-200',         icon: <Clock size={10} /> },
  changes_requested: { tone: 'bg-amber-100 text-amber-800 border-amber-200',      icon: <AlertTriangle size={10} /> },
  approved:          { tone: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: <CheckCircle2 size={10} /> },
  active:            { tone: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: <CheckCircle2 size={10} /> },
  rejected:          { tone: 'bg-red-100 text-red-700 border-red-200',            icon: <XCircle size={10} /> },
  suspended:         { tone: 'bg-red-100 text-red-700 border-red-200',            icon: <XCircle size={10} /> },
};

/* ─── sidebar palette ─────────────────────────────────────────── */
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

export function Dashboard() {
  const { t, language } = useI18n();
  const isRtl = language === 'ar';

  const [activeSection, setActiveSectionState] = useState<DashSection>(getStoredSection);
  const [moreDrawerOpen, setMoreDrawerOpen] = useState(false);

  const queryClient = useQueryClient();
  const logoutMutation = useLogout();
  const handleLogout = () => {
    logoutMutation.mutate(undefined, {
      onSettled: () => { clearSessionToken(); queryClient.clear(); window.location.replace('/'); },
    });
  };

  const { data: office }         = useGetMyOffice();
  const { data: documents }      = useListMyOfficeDocuments();
  const { data: videoRequests }  = useListMyOfficeVideoCallRequests();
  const { data: serviceRequests }= useGetOfficeServiceRequests();

  const newVideoCount    = (videoRequests   || []).filter(r => r.status === 'new').length;
  const newSrCount       = (serviceRequests || []).filter(r => r.status === 'submitted').length;
  const rejectedDocCount = (documents       || []).filter(d => d.status === 'rejected').length;
  const notifCount       = newVideoCount + rejectedDocCount + (office?.pendingChanges ? 1 : 0);

  const setActiveSection = useCallback((section: DashSection) => {
    setActiveSectionState(section);
    try { localStorage.setItem(SECTION_STORAGE_KEY, section); } catch {}
    setMoreDrawerOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const navigate = useCallback((s: string) => setActiveSection(s as DashSection), [setActiveSection]);

  const navItems: NavItem[] = [
    { id: 'overview',         icon: <LayoutDashboard size={18} />, labelKey: 'dash.nav.overview' },
    { id: 'office_tools',     icon: <QrCode size={18} />,          labelKey: 'dash.nav.office_tools' },
    { id: 'profile',          icon: <Building2 size={18} />,       labelKey: 'dash.nav.profile' },
    { id: 'media',            icon: <Image size={18} />,           labelKey: 'dash.nav.media' },
    { id: 'contact',          icon: <MessageSquare size={18} />,   labelKey: 'dash.nav.contact_features' },
    { id: 'requests',         icon: <Video size={18} />,           labelKey: 'dash.nav.video_requests',   badge: newVideoCount || undefined },
    { id: 'service_requests', icon: <ClipboardList size={18} />,   labelKey: 'dash.nav.service_requests', badge: newSrCount || undefined },
    { id: 'documents',        icon: <FileText size={18} />,        labelKey: 'dash.nav.documents',        badge: rejectedDocCount || undefined },
    { id: 'performance',      icon: <BarChart3 size={18} />,       labelKey: 'dash.nav.performance' },
    { id: 'subscription',     icon: <CreditCard size={18} />,      labelKey: 'dash.nav.subscription' },
    { id: 'notifications',    icon: <Bell size={18} />,            labelKey: 'dash.nav.notifications',    badge: notifCount || undefined },
    { id: 'settings',         icon: <Settings size={18} />,        labelKey: 'dash.nav.settings' },
    { id: 'help',             icon: <HelpCircle size={18} />,      labelKey: 'dash.nav.help' },
  ];

  const bottomPrimary: DashSection[] = ['overview', 'profile', 'requests', 'notifications'];
  const sectionTitle = navItems.find(n => n.id === activeSection)?.labelKey;
  const statusMeta   = STATUS_META[office?.status ?? 'draft'] || STATUS_META.draft;
  const officeLetter = office?.name?.charAt(0)?.toUpperCase() || '?';

  return (
    <div className="min-h-[100dvh] w-full max-w-full overflow-x-hidden flex" style={{ background: '#f1f5f9' }}>

      {/* ══ DESKTOP SIDEBAR ══ */}
      <aside
        className={`group hidden lg:flex flex-col fixed top-16 bottom-0 ${isRtl ? 'right-0' : 'left-0'} w-[62px] hover:w-[240px] transition-[width] duration-300 ease-in-out overflow-hidden z-30`}
        style={{ background: SB.bg, borderRight: `1px solid ${SB.border}` }}
      >
        {/* Office identity */}
        <div className="flex items-center px-3 py-4 shrink-0" style={{ borderBottom: `1px solid ${SB.border}` }}>
          {/* Avatar */}
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-white text-sm font-bold select-none"
            style={{ background: 'hsl(var(--primary))' }}
          >
            {officeLetter}
          </div>
          {/* Name + status — reveals on hover */}
          <div className="ms-3 min-w-0 overflow-hidden opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <p className="text-[13px] font-semibold leading-snug truncate whitespace-nowrap" style={{ color: SB.textActive }}>
              {office?.name || '—'}
            </p>
            {office && (
              <p className="text-[10px] mt-0.5 whitespace-nowrap" style={{ color: SB.iconInactive }}>
                {t(`dashboard.status.${office.status}` as any)}
              </p>
            )}
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

        {/* Logout */}
        <div className="shrink-0 py-2" style={{ borderTop: `1px solid ${SB.border}` }}>
          <button
            onClick={handleLogout}
            title={t('dash.settings.logout' as any)}
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
              {t('dash.settings.logout' as any)}
            </span>
          </button>
        </div>
      </aside>

      {/* ══ MAIN CONTENT ══ */}
      <main className="flex-1 min-w-0 max-w-full lg:ms-[62px] pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-10">

        {/* Mobile hamburger */}
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
            {office?.isVerified && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                <ShieldCheck size={11} /> {t('dashboard.verified_badge')}
              </span>
            )}
          </div>
          <SectionContent section={activeSection} navigate={navigate} />
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
                {item.badge ? (
                  <span className="relative">
                    {item.icon}
                    <span className="absolute -top-1.5 -end-1.5 w-4 h-4 rounded-full bg-primary text-white text-[9px] font-bold flex items-center justify-center">
                      {item.badge > 9 ? '9+' : item.badge}
                    </span>
                  </span>
                ) : item.icon}
                <span className="truncate px-1 leading-none mt-0.5">{t(item.labelKey as any)}</span>
                {active && <span className="absolute top-0 inset-x-2 h-0.5 bg-primary rounded-b-full" />}
              </button>
            );
          })}
          <button onClick={() => setMoreDrawerOpen(true)}
            className="cursor-pointer flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-muted-foreground">
            <Menu size={20} />
            <span className="leading-none mt-0.5">{t('dash.nav.more')}</span>
          </button>
        </div>
      </nav>

      {/* ══ MOBILE DRAWER ══ */}
      <Sheet open={moreDrawerOpen} onOpenChange={setMoreDrawerOpen}>
        <SheetContent side={isRtl ? 'right' : 'left'} className="w-[min(17rem,90vw)] p-0 overflow-hidden flex flex-col" style={{ background: SB.bg }}>
          <SheetHeader className="px-4 pt-5 pb-4 shrink-0" style={{ borderBottom: `1px solid ${SB.border}` }}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-white text-sm font-bold" style={{ background: 'hsl(var(--primary))' }}>
                {officeLetter}
              </div>
              <div className="min-w-0">
                <SheetTitle className="text-sm font-semibold text-white text-start leading-tight truncate">
                  {office?.name || 'SkayOffice'}
                </SheetTitle>
                {office && (
                  <p className="text-[10px] mt-0.5" style={{ color: SB.iconInactive }}>
                    {t(`dashboard.status.${office.status}` as any)}
                  </p>
                )}
              </div>
            </div>
          </SheetHeader>
          <nav className="flex-1 overflow-y-auto py-2" style={{ scrollbarWidth: 'none' } as React.CSSProperties}>
            {navItems.map(item => (
              <SidebarItem key={item.id} item={item} active={activeSection === item.id}
                onClick={() => setActiveSection(item.id)} t={t} expanded />
            ))}
          </nav>
          <div className="shrink-0 py-2" style={{ borderTop: `1px solid ${SB.border}` }}>
            <button onClick={handleLogout}
              className="cursor-pointer w-full flex items-center gap-3 px-4 py-3 transition-colors text-sm font-medium"
              style={{ color: SB.iconInactive }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#f87171'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = SB.iconInactive; }}
            >
              <LogOut size={17} />
              <span>{t('dash.settings.logout' as any)}</span>
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/* ─── SidebarItem ─────────────────────────────────────────────── */
function SidebarItem({
  item, active, onClick, t, expanded = false,
}: {
  item: NavItem; active: boolean; onClick: () => void; t: (k: any) => string; expanded?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const rowStyle: React.CSSProperties = {
    background: active ? SB.rowActive : hovered ? SB.rowHover : 'transparent',
    color: active ? SB.textActive : hovered ? 'rgba(255,255,255,0.80)' : SB.textInactive,
    borderLeft: active ? `3px solid ${SB.accent}` : '3px solid transparent',
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

      {/* Badge */}
      {item.badge ? (
        <span className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 bg-red-500 text-white ${!expanded ? 'opacity-0 group-hover:opacity-100 transition-opacity' : ''}`}>
          {item.badge > 9 ? '9+' : item.badge}
        </span>
      ) : null}
    </button>
  );
}

/* ─── Section router ──────────────────────────────────────────── */
function SectionContent({ section, navigate }: { section: DashSection; navigate: (s: string) => void }) {
  switch (section) {
    case 'overview':         return <OverviewSection navigate={navigate} />;
    case 'office_tools':     return <OfficeToolsSection />;
    case 'profile':          return <ProfileSection />;
    case 'media':            return <MediaSection />;
    case 'contact':          return <ContactFeaturesSection navigate={navigate} />;
    case 'requests':         return <VideoRequestsSection navigate={navigate} />;
    case 'service_requests': return <ServiceRequestsSection />;
    case 'documents':        return <DocumentsSection />;
    case 'performance':      return <PerformanceSection onNavigate={navigate} />;
    case 'subscription':     return <SubscriptionSection />;
    case 'notifications':    return <NotificationsSection navigate={navigate} />;
    case 'settings':         return <SettingsSection />;
    case 'help':             return <HelpSection />;
    default:                 return <OverviewSection navigate={navigate} />;
  }
}
