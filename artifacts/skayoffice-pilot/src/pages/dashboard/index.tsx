import React, { useState, useEffect, useCallback } from 'react';
import { useI18n } from '@/lib/i18n';
import { useGetMyOffice, useListMyOfficeDocuments, useListMyOfficeVideoCallRequests, useGetOfficeServiceRequests, useLogout } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { clearSessionToken } from '@/lib/sessionToken';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import {
  LayoutDashboard, Building2, Image, MessageSquare, Video,
  FileText, BarChart3, CreditCard, Bell, Settings, HelpCircle,
  CheckCircle2, Clock, AlertTriangle, XCircle, ShieldCheck, ChevronRight,
  Menu, ClipboardList, LogOut, QrCode,
} from 'lucide-react';

// Section components
import { OverviewSection } from './sections/Overview';
import { ProfileSection } from './sections/Profile';
import { MediaSection } from './sections/Media';
import { DocumentsSection } from './sections/Documents';
import { ContactFeaturesSection } from './sections/ContactFeatures';
import { VideoRequestsSection } from './sections/VideoRequests';
import { ServiceRequestsSection } from './sections/ServiceRequests';
import { PerformanceSection } from './sections/Performance';
import { SubscriptionSection } from './sections/Subscription';
import { NotificationsSection } from './sections/Notifications';
import { SettingsSection } from './sections/Settings';
import { HelpSection } from './sections/Help';
import { OfficeToolsSection } from './sections/OfficeTools';

export type DashSection =
  | 'overview' | 'office_tools' | 'profile' | 'media' | 'contact' | 'requests' | 'service_requests'
  | 'documents' | 'performance' | 'subscription'
  | 'notifications' | 'settings' | 'help';

const SECTION_STORAGE_KEY = 'skayoffice-dash-section';

const VALID_SECTIONS: ReadonlySet<string> = new Set<DashSection>([
  'overview', 'office_tools', 'profile', 'media', 'contact', 'requests', 'service_requests',
  'documents', 'performance', 'subscription',
  'notifications', 'settings', 'help',
]);

function getStoredSection(): DashSection {
  try {
    const s = localStorage.getItem(SECTION_STORAGE_KEY);
    if (s && VALID_SECTIONS.has(s)) return s as DashSection;
    // Stale value (e.g. 'assistant' from a previous build) — reset it
    if (s) localStorage.removeItem(SECTION_STORAGE_KEY);
  } catch {}
  return 'overview';
}

interface NavItem {
  id: DashSection;
  icon: React.ReactNode;
  labelKey: string;
  badge?: number;
  hidden?: boolean;
}

const STATUS_META: Record<string, { tone: string; icon: React.ReactNode }> = {
  draft: { tone: 'bg-slate-100 text-slate-700', icon: <Clock size={12} /> },
  under_review: { tone: 'bg-blue-100 text-blue-700', icon: <Clock size={12} /> },
  changes_requested: { tone: 'bg-amber-100 text-amber-800', icon: <AlertTriangle size={12} /> },
  approved: { tone: 'bg-emerald-100 text-emerald-700', icon: <CheckCircle2 size={12} /> },
  active: { tone: 'bg-emerald-100 text-emerald-700', icon: <CheckCircle2 size={12} /> },
  rejected: { tone: 'bg-red-100 text-red-700', icon: <XCircle size={12} /> },
  suspended: { tone: 'bg-red-100 text-red-700', icon: <XCircle size={12} /> },
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
      onSettled: () => {
        clearSessionToken();
        queryClient.clear();
        // replace() removes this protected page from the browser history stack
        // so the Back button cannot restore it from bfcache after logout.
        window.location.replace('/');
      },
    });
  };

  const { data: office } = useGetMyOffice();
  const { data: documents } = useListMyOfficeDocuments();
  const { data: videoRequests } = useListMyOfficeVideoCallRequests();
  const { data: serviceRequests } = useGetOfficeServiceRequests();

  const newVideoCount = (videoRequests || []).filter(r => r.status === 'new').length;
  const newSrCount = (serviceRequests || []).filter(r => r.status === 'submitted').length;
  const rejectedDocCount = (documents || []).filter(d => d.status === 'rejected').length;
  const notifCount = newVideoCount + rejectedDocCount + (office?.pendingChanges ? 1 : 0);

  const setActiveSection = useCallback((section: DashSection) => {
    setActiveSectionState(section);
    try { localStorage.setItem(SECTION_STORAGE_KEY, section); } catch {}
    setMoreDrawerOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const navigate = useCallback((section: string) => {
    setActiveSection(section as DashSection);
  }, [setActiveSection]);

  const navItems: NavItem[] = [
    { id: 'overview', icon: <LayoutDashboard size={20} />, labelKey: 'dash.nav.overview' },
    { id: 'office_tools', icon: <QrCode size={20} />, labelKey: 'dash.nav.office_tools' },
    { id: 'profile', icon: <Building2 size={20} />, labelKey: 'dash.nav.profile' },
    { id: 'media', icon: <Image size={20} />, labelKey: 'dash.nav.media' },
    { id: 'contact', icon: <MessageSquare size={20} />, labelKey: 'dash.nav.contact_features' },
    {
      id: 'requests', icon: <Video size={20} />, labelKey: 'dash.nav.video_requests',
      badge: newVideoCount || undefined,
    },
    {
      id: 'service_requests', icon: <ClipboardList size={20} />, labelKey: 'dash.nav.service_requests',
      badge: newSrCount || undefined,
    },
    { id: 'documents', icon: <FileText size={20} />, labelKey: 'dash.nav.documents', badge: rejectedDocCount || undefined },
    { id: 'performance', icon: <BarChart3 size={20} />, labelKey: 'dash.nav.performance' },
    { id: 'subscription', icon: <CreditCard size={20} />, labelKey: 'dash.nav.subscription' },
    { id: 'notifications', icon: <Bell size={20} />, labelKey: 'dash.nav.notifications', badge: notifCount || undefined },
    { id: 'settings', icon: <Settings size={20} />, labelKey: 'dash.nav.settings' },
    { id: 'help', icon: <HelpCircle size={20} />, labelKey: 'dash.nav.help' },
  ];

  // Bottom bar shows 4 primary + "More" button
  const bottomPrimary: DashSection[] = ['overview', 'profile', 'requests', 'notifications'];

  const sectionTitle = navItems.find(n => n.id === activeSection)?.labelKey;

  return (
    <div className="min-h-[100dvh] w-full max-w-full overflow-x-hidden bg-background flex">
      {/* ── Desktop sidebar ── */}
      <aside
        className={`hidden lg:flex flex-col fixed inset-y-0 ${isRtl ? 'right-0' : 'left-0'} w-60 bg-card border-e border-border z-30 shadow-sm`}
      >
        {/* Office identity */}
        <div className="px-4 pt-5 pb-4 border-b">
          {office ? (
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm truncate leading-tight">{office.name}</p>
                <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                  {office.isVerified && <ShieldCheck size={11} className="text-emerald-500 shrink-0" />}
                  <Badge
                    variant="outline"
                    className={`text-[10px] gap-1 py-0 px-1.5 h-4 ${(STATUS_META[office.status] || STATUS_META.draft).tone}`}
                  >
                    {(STATUS_META[office.status] || STATUS_META.draft).icon}
                    {t(`dashboard.status.${office.status}` as any)}
                  </Badge>
                  {(office as any).providerType === 'freelancer' && (
                    <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4 border-border/50 text-muted-foreground">
                      {t('provider.freelancer')}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <Skeleton className="h-10 w-full rounded-lg" />
          )}
        </div>

        {/* Nav items */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
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

        {/* Footer */}
        <div className="px-4 py-3 border-t">
          <p className="text-[10px] text-muted-foreground/50 text-center">SkayOffice © {new Date().getFullYear()}</p>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main
        className="flex-1 min-w-0 max-w-full lg:ms-60 pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-8"
      >
        {/* Page header */}
        <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b px-4 py-3 flex items-center gap-3">
          {/* Mobile hamburger → More drawer */}
          <button
            className="lg:hidden p-1.5 rounded-lg hover:bg-muted transition-colors"
            onClick={() => setMoreDrawerOpen(true)}
            aria-label="Navigation"
          >
            <Menu size={20} />
          </button>
          <h1 className="font-semibold text-base flex-1 truncate">
            {sectionTitle ? t(sectionTitle as any) : ''}
          </h1>
        </div>

        {/* Section content */}
        <div className="dashboard-surface px-3 sm:px-4 py-4 sm:py-5 max-w-2xl mx-auto lg:max-w-3xl">
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
              <button
                key={id}
                onClick={() => setActiveSection(id)}
                className={`flex flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors relative ${
                  active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {item.badge ? (
                  <span className="relative">
                    {item.icon}
                    <span className="absolute -top-1.5 -end-1.5 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center">
                      {item.badge > 9 ? '9+' : item.badge}
                    </span>
                  </span>
                ) : item.icon}
                <span className="truncate px-1">{t(item.labelKey as any)}</span>
                {active && (
                  <span className="absolute top-0 inset-x-3 h-0.5 bg-primary rounded-b-full" />
                )}
              </button>
            );
          })}
          {/* More button */}
          <button
            onClick={() => setMoreDrawerOpen(true)}
            className="flex flex-col items-center justify-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <Menu size={20} />
            <span>{t('dash.nav.more')}</span>
          </button>
        </div>
      </nav>

      {/* ── Mobile More drawer ── */}
      <Sheet open={moreDrawerOpen} onOpenChange={setMoreDrawerOpen}>
        <SheetContent side={isRtl ? 'right' : 'left'} className="w-[min(18rem,88vw)] p-0 overflow-y-auto">
          <SheetHeader className="px-4 pt-5 pb-3 border-b">
            <SheetTitle className="text-start text-base">{t('dash.nav.more')}</SheetTitle>
          </SheetHeader>
          {/* Office mini-identity */}
          {office && (
            <div className="flex items-center gap-3 px-4 py-3 border-b bg-muted/20">
              <div className="min-w-0">
                <p className="font-medium text-sm truncate">{office.name}</p>
                <Badge variant="outline" className={`text-[10px] py-0 h-4 ${(STATUS_META[office.status] || STATUS_META.draft).tone}`}>
                  {t(`dashboard.status.${office.status}` as any)}
                </Badge>
              </div>
            </div>
          )}
          <nav className="py-2 px-2 space-y-0.5">
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
          {/* Logout — always accessible from the mobile drawer */}
          <div className="px-2 pb-4 pt-1 border-t border-border/50 mt-1">
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
            >
              <LogOut size={20} className="shrink-0" />
              <span className="flex-1 text-start">{t('dash.settings.logout' as any)}</span>
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function SidebarItem({
  item, active, onClick, t,
}: {
  item: NavItem;
  active: boolean;
  onClick: () => void;
  t: (key: any) => string;
}) {
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
      {item.badge ? (
        <span className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 ${
          active ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-primary text-primary-foreground'
        }`}>
          {item.badge > 9 ? '9+' : item.badge}
        </span>
      ) : null}
    </button>
  );
}

function SectionContent({ section, navigate }: { section: DashSection; navigate: (s: string) => void }) {
  switch (section) {
    case 'overview':      return <OverviewSection navigate={navigate} />;
    case 'office_tools':  return <OfficeToolsSection />;
    case 'profile':       return <ProfileSection />;
    case 'media':         return <MediaSection />;
    case 'contact':       return <ContactFeaturesSection navigate={navigate} />;
    case 'requests':         return <VideoRequestsSection navigate={navigate} />;
    case 'service_requests': return <ServiceRequestsSection />;
    case 'documents':     return <DocumentsSection />;
    case 'performance':   return <PerformanceSection onNavigate={navigate} />;
    case 'subscription':  return <SubscriptionSection />;
    case 'notifications': return <NotificationsSection navigate={navigate} />;
    case 'settings':      return <SettingsSection />;
    case 'help':          return <HelpSection />;
    default:              return <OverviewSection navigate={navigate} />;
  }
}
