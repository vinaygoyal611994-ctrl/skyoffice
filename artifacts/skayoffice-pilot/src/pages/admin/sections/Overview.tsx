import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '@/lib/i18n';
import {
  useListAdminApplications,
  useListAdminCustomers,
  useListAdminContactEvents,
} from '@workspace/api-client-react';
import { getSessionToken } from '@/lib/sessionToken';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Building2, Users, Clock, CheckCircle2, XCircle, PauseCircle,
  AlertTriangle, MessageCircle, Video, TrendingUp, ChevronRight,
  FileText, PlayCircle,
} from 'lucide-react';

const BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');

async function fetchOverviewStats(): Promise<{
  totalInteractions: number;
  contactsToday: number;
  videoCallsToday: number;
}> {
  const token = getSessionToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}/api/admin/overview-stats`, { credentials: 'include', headers });
  if (!res.ok) throw new Error(`overview-stats ${res.status}`);
  return res.json();
}

interface KpiCardProps {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  tone?: string;
  onClick?: () => void;
}

function KpiCard({ label, value, icon, tone = 'text-foreground', onClick }: KpiCardProps) {
  return (
    <Card
      className={`border-border/50 shadow-sm ${onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-muted-foreground text-xs font-medium leading-tight">{label}</span>
          <span className="opacity-40">{icon}</span>
        </div>
        <div className={`text-2xl font-bold font-mono tabular-nums ${tone}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

interface ActionItem {
  key: string;
  label: string;
  desc: string;
  count: number;
  priority: 'high' | 'medium' | 'low';
  icon: React.ReactNode;
  section: string;
}

const PRIORITY_STYLES = {
  high:   { dot: 'bg-red-500',    badge: 'bg-red-100 text-red-700 border-red-200',       bar: 'bg-red-500' },
  medium: { dot: 'bg-amber-500',  badge: 'bg-amber-100 text-amber-700 border-amber-200', bar: 'bg-amber-500' },
  low:    { dot: 'bg-blue-500',   badge: 'bg-blue-100 text-blue-700 border-blue-200',    bar: 'bg-blue-500' },
};

const PRIORITY_LABELS: Record<string, { ar: string; en: string }> = {
  high:   { ar: 'عاجل',   en: 'Urgent' },
  medium: { ar: 'مهم',    en: 'Important' },
  low:    { ar: 'مراجعة', en: 'Review' },
};

export function OverviewSection({ navigate }: { navigate: (s: string) => void }) {
  const { language } = useI18n();

  const { data: applications = [], isLoading: appsLoading } = useListAdminApplications();
  const { data: customers = [], isLoading: customersLoading } = useListAdminCustomers();
  // Limit 5 — only used for the recent interactions feed; KPI counts come from the server
  const { data: recentEvents = [] } = useListAdminContactEvents({ limit: 5 });

  // Server-side KPI counts — no 200-row cap
  const { data: stats } = useQuery({
    queryKey: ['admin-overview-stats'],
    queryFn: fetchOverviewStats,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  // Compute counts from applications data
  const totalOffices       = applications.length;
  const activeOffices      = applications.filter(a => a.status === 'active').length;
  const pendingApproval    = applications.filter(a => a.status === 'under_review').length;
  const needsChanges       = applications.filter(a => a.status === 'changes_requested').length;
  const suspendedOffices   = applications.filter(a => a.status === 'suspended').length;
  const rejectedOffices    = applications.filter(a => a.status === 'rejected').length;
  const awaitingActivation = applications.filter(a => a.status === 'approved').length;

  const loading = appsLoading || customersLoading;

  // Action Center items
  const rawActionItems = [
    {
      key: 'new_registrations',
      label: language === 'ar' ? 'طلبات تسجيل جديدة قيد المراجعة' : 'New Registration Requests',
      desc: language === 'ar' ? 'طلبات مكاتب جديدة تنتظر مراجعة المستندات والموافقة' : 'New office applications waiting for document review and approval',
      count: pendingApproval,
      priority: 'high' as const,
      icon: <FileText size={18} />,
      section: 'requests',
    },
    {
      key: 'awaiting_activation',
      label: language === 'ar' ? 'مكاتب بانتظار التفعيل' : 'Offices Awaiting Activation',
      desc: language === 'ar' ? 'طلبات تمت الموافقة عليها وتنتظر تفعيل المكتب' : 'Approved applications waiting for office activation',
      count: awaitingActivation,
      priority: 'high' as const,
      icon: <PlayCircle size={18} />,
      section: 'requests',
    },
    {
      key: 'requiring_changes',
      label: language === 'ar' ? 'مكاتب تحتاج تعديلات' : 'Offices Requiring Changes',
      desc: language === 'ar' ? 'مكاتب طُلب منها إجراء تعديلات ولم تُرسل بعد' : 'Offices asked to make changes but have not resubmitted yet',
      count: needsChanges,
      priority: 'medium' as const,
      icon: <AlertTriangle size={18} />,
      section: 'requests',
    },
    {
      key: 'suspended',
      label: language === 'ar' ? 'مكاتب معلّقة' : 'Suspended Offices',
      desc: language === 'ar' ? 'مكاتب معلّقة حالياً غير مرئية للعملاء' : 'Currently suspended offices not visible to customers',
      count: suspendedOffices,
      priority: 'low' as const,
      icon: <PauseCircle size={18} />,
      section: 'offices',
    },
  ];
  const actionItems: ActionItem[] = rawActionItems.filter(item => item.count > 0);

  const kpiCards = [
    { label: language === 'ar' ? 'إجمالي المكاتب' : 'Total Offices',          value: totalOffices,                          icon: <Building2 size={20} />,     tone: 'text-foreground' },
    { label: language === 'ar' ? 'مكاتب نشطة' : 'Active Offices',              value: activeOffices,                         icon: <CheckCircle2 size={20} />,  tone: 'text-emerald-600' },
    { label: language === 'ar' ? 'قيد المراجعة' : 'Pending Approval',          value: pendingApproval,                       icon: <Clock size={20} />,         tone: 'text-blue-600', onClick: () => navigate('requests') },
    { label: language === 'ar' ? 'مطلوب تعديلات' : 'Needs Changes',            value: needsChanges,                          icon: <AlertTriangle size={20} />, tone: needsChanges > 0 ? 'text-amber-600' : 'text-foreground', onClick: needsChanges > 0 ? () => navigate('requests') : undefined },
    { label: language === 'ar' ? 'مكاتب معلّقة' : 'Suspended Offices',         value: suspendedOffices,                      icon: <PauseCircle size={20} />,   tone: suspendedOffices > 0 ? 'text-amber-600' : 'text-foreground' },
    { label: language === 'ar' ? 'مكاتب مرفوضة' : 'Rejected Offices',          value: rejectedOffices,                       icon: <XCircle size={20} />,       tone: rejectedOffices > 0 ? 'text-red-600' : 'text-foreground' },
    { label: language === 'ar' ? 'عملاء مسجلون' : 'Registered Customers',      value: customers.length,                      icon: <Users size={20} />,         tone: 'text-foreground', onClick: () => navigate('customers') },
    { label: language === 'ar' ? 'تواصل اليوم' : "Today's Contacts",           value: stats?.contactsToday   ?? '…',         icon: <MessageCircle size={20} />, tone: 'text-foreground', onClick: () => navigate('analytics') },
    { label: language === 'ar' ? 'مكالمات فيديو اليوم' : 'Video Calls Today',  value: stats?.videoCallsToday ?? '…',         icon: <Video size={20} />,         tone: 'text-foreground' },
    { label: language === 'ar' ? 'إجمالي التفاعلات' : 'Total Interactions',     value: stats?.totalInteractions ?? '…',       icon: <TrendingUp size={20} />,    tone: 'text-foreground', onClick: () => navigate('analytics') },
  ];

  return (
    <div className="space-y-8">
      {/* KPI Grid */}
      <section>
        <h2 className="text-lg font-semibold mb-4">{language === 'ar' ? 'مؤشرات الأداء الرئيسية' : 'Key Performance Indicators'}</h2>
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {Array.from({ length: 10 }).map((_, i) => (
              <Card key={i} className="border-border/50"><CardContent className="p-4"><div className="h-12 bg-muted/40 rounded animate-pulse" /></CardContent></Card>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {kpiCards.map((card, i) => (
              <KpiCard key={i} label={card.label} value={card.value} icon={card.icon} tone={card.tone} onClick={card.onClick} />
            ))}
          </div>
        )}
      </section>

      {/* Action Center */}
      <section>
        <h2 className="text-lg font-semibold mb-1">{language === 'ar' ? 'مركز الإجراءات — الأولوية القصوى' : 'Action Center — Highest Priority'}</h2>
        <p className="text-sm text-muted-foreground mb-4">{language === 'ar' ? 'العناصر التالية تحتاج تدخلاً فورياً' : 'The following items need immediate attention'}</p>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <Card key={i}><CardContent className="p-4"><div className="h-16 bg-muted/40 rounded animate-pulse" /></CardContent></Card>)}
          </div>
        ) : actionItems.length === 0 ? (
          <Card className="border-emerald-200 bg-emerald-50">
            <CardContent className="p-6 flex items-center gap-4">
              <CheckCircle2 size={32} className="text-emerald-500 shrink-0" />
              <div>
                <p className="font-semibold text-emerald-800">{language === 'ar' ? 'لا توجد إجراءات معلّقة' : 'No pending actions'}</p>
                <p className="text-sm text-emerald-700 mt-1">{language === 'ar' ? 'المنصة في وضع جيد — لا توجد عناصر تحتاج تدخلاً فورياً.' : 'The platform looks great — no items need immediate attention.'}</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {actionItems.map(item => {
              const style = PRIORITY_STYLES[item.priority];
              const priorityLabel = PRIORITY_LABELS[item.priority][language];
              return (
                <Card key={item.key} className="border-border/50 hover:shadow-sm transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-4">
                      <div className={`w-1 self-stretch rounded-full ${style.bar} shrink-0`} />
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${style.badge} border`}>
                        {item.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <span className="font-semibold text-sm">{item.label}</span>
                          <Badge variant="outline" className={`text-[10px] h-5 px-1.5 ${style.badge}`}>{priorityLabel}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">{item.desc}</p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className={`text-2xl font-bold font-mono tabular-nums ${style.dot === 'bg-red-500' ? 'text-red-600' : style.dot === 'bg-amber-500' ? 'text-amber-600' : 'text-blue-600'}`}>
                          {item.count}
                        </span>
                        <Button size="sm" variant="outline" className="gap-1 shrink-0" onClick={() => navigate(item.section)}>
                          {language === 'ar' ? 'انتقل' : 'Go'}
                          <ChevronRight size={14} className={language === 'ar' ? 'rotate-180' : ''} />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Quick summary of recent contacts */}
      {recentEvents.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">{language === 'ar' ? 'آخر تفاعلات العملاء' : 'Recent Customer Interactions'}</h2>
            <Button variant="ghost" size="sm" onClick={() => navigate('analytics')}>{language === 'ar' ? 'عرض الكل' : 'View All'}</Button>
          </div>
          <div className="space-y-2">
            {recentEvents.map(evt => (
              <div key={evt.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/20 border border-border/40">
                <MessageCircle size={14} className="text-muted-foreground shrink-0" />
                <span className="text-sm flex-1 truncate">
                  <span className="font-medium">{evt.customerName}</span>
                  <span className="text-muted-foreground mx-1">→</span>
                  <span>{evt.officeName}</span>
                </span>
                <Badge variant="outline" className="text-[10px] shrink-0">{evt.actionType?.replace(/_/g, ' ')}</Badge>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
