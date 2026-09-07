import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '@/lib/i18n';
import { getSessionToken } from '@/lib/sessionToken';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { format } from 'date-fns';
import { Activity, Search, ChevronLeft, ChevronRight } from 'lucide-react';

const BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');

// Maps raw audit action codes to human-readable AR/EN labels
const ACTION_LABELS: Record<string, { ar: string; en: string; tone: string }> = {
  'office.application.approve':             { ar: 'تمت الموافقة على طلب',          en: 'Application approved',           tone: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  'office.application.reject':              { ar: 'تم رفض طلب',                    en: 'Application rejected',           tone: 'bg-red-100 text-red-700 border-red-200' },
  'office.application.request_changes':     { ar: 'طُلبت تعديلات على طلب',         en: 'Changes requested',              tone: 'bg-amber-100 text-amber-700 border-amber-200' },
  'office.application.activate':            { ar: 'تم تفعيل مكتب',                 en: 'Office activated',               tone: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  'office.application.suspend':             { ar: 'تم تعليق مكتب',                 en: 'Office suspended',               tone: 'bg-amber-100 text-amber-700 border-amber-200' },
  'office.application.reactivate':          { ar: 'تم إعادة تفعيل مكتب',          en: 'Office reactivated',             tone: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  'office.delete':                          { ar: 'تم حذف مكتب',                   en: 'Office deleted',                 tone: 'bg-red-100 text-red-700 border-red-200' },
  'office.verify':                          { ar: 'تم توثيق مكتب',                 en: 'Office verified',                tone: 'bg-blue-100 text-blue-700 border-blue-200' },
  'office.unverify':                        { ar: 'تم إلغاء توثيق مكتب',          en: 'Office unverified',              tone: 'bg-slate-100 text-slate-700 border-slate-200' },
  'office.document.review':                 { ar: 'تمت مراجعة مستند',              en: 'Document reviewed',              tone: 'bg-blue-100 text-blue-700 border-blue-200' },
  'office.admin_note.add':                  { ar: 'تمت إضافة ملاحظة إدارية',      en: 'Admin note added',               tone: 'bg-slate-100 text-slate-700 border-slate-200' },
  'office.pending_changes.approve':         { ar: 'تمت الموافقة على تعديل مقترح', en: 'Pending changes approved',       tone: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  'office.pending_changes.reject':          { ar: 'تم رفض تعديل مقترح',           en: 'Pending changes rejected',       tone: 'bg-red-100 text-red-700 border-red-200' },
  'office.marketing_video.remove_by_admin': { ar: 'تم حذف فيديو تعريفي',          en: 'Marketing video removed',        tone: 'bg-amber-100 text-amber-700 border-amber-200' },
  'customer.status.change':                 { ar: 'تم تغيير حالة عميل',            en: 'Customer status changed',        tone: 'bg-slate-100 text-slate-700 border-slate-200' },
  'auth.login':                             { ar: 'تسجيل دخول',                    en: 'User logged in',                 tone: 'bg-slate-100 text-slate-600 border-slate-200' },
  'bilingual_content_gap':                  { ar: 'محتوى عربي ناقص',               en: 'Bilingual content gap detected', tone: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
};

function getActionLabel(action: string, language: string): { label: string; tone: string } {
  const entry = ACTION_LABELS[action.toLowerCase()];
  if (entry) return { label: language === 'ar' ? entry.ar : entry.en, tone: entry.tone };
  const humanized = action.replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return { label: humanized, tone: 'bg-slate-100 text-slate-700 border-slate-200' };
}

const ACTION_CATEGORIES = [
  { value: 'all',                labelAr: 'جميع الأحداث',    labelEn: 'All Events' },
  { value: 'office.application', labelAr: 'طلبات المكاتب',   labelEn: 'Office Applications' },
  { value: 'office',             labelAr: 'إجراءات المكاتب', labelEn: 'Office Actions' },
  { value: 'customer',           labelAr: 'إجراءات العملاء', labelEn: 'Customer Actions' },
  { value: 'auth',               labelAr: 'تسجيل الدخول',    labelEn: 'Logins' },
];

interface LogItem {
  id: number;
  actorId: number | null;
  actorRole: string | null;
  action: string;
  targetType: string | null;
  targetId: number | null;
  metadata: string | null;
  createdAt: string;
}

interface ActivityLogData {
  items: LogItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface Filters {
  search: string;
  category: string;
  page: number;
}

async function fetchActivityLog(filters: Filters): Promise<ActivityLogData> {
  const token = getSessionToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const params = new URLSearchParams();
  if (filters.search)                        params.set('search',   filters.search);
  if (filters.category && filters.category !== 'all') params.set('category', filters.category);
  params.set('page',  String(filters.page));
  params.set('limit', '25');

  const res = await fetch(`${BASE}/api/admin/activity-log?${params}`, {
    credentials: 'include',
    headers,
  });
  if (!res.ok) throw new Error(`activity-log ${res.status}`);
  return res.json();
}

export function ActivityLogSection() {
  const { language } = useI18n();
  const [search,   setSearch]   = useState('');
  const [category, setCategory] = useState('all');
  const [page,     setPage]     = useState(1);

  const filters: Filters = { search, category, page };

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-activity-log', filters],
    queryFn: () => fetchActivityLog(filters),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const items      = data?.items      ?? [];
  const total      = data?.total      ?? 0;
  const totalPages = data?.totalPages ?? 1;

  const handleSearch   = (v: string) => { setSearch(v);   setPage(1); };
  const handleCategory = (v: string) => { setCategory(v); setPage(1); };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Activity size={20} />
          {language === 'ar' ? 'سجل النشاط' : 'Activity Log'}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          {language === 'ar' ? 'سجل كامل بنشاط المنصة بصيغة قابلة للقراءة' : 'Complete platform activity history in human-readable format'}
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="ps-9"
            placeholder={language === 'ar' ? 'ابحث في السجل...' : 'Search activity log...'}
            value={search}
            onChange={e => handleSearch(e.target.value)}
          />
        </div>
        <Select value={category} onValueChange={handleCategory}>
          <SelectTrigger className="w-full sm:w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACTION_CATEGORIES.map(c => (
              <SelectItem key={c.value} value={c.value}>
                {language === 'ar' ? c.labelAr : c.labelEn}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Log */}
      <Card>
        <CardHeader className="pb-3 border-b">
          <CardTitle className="text-base">
            {isLoading ? '…' : total} {language === 'ar' ? 'حدث' : 'events'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">{language === 'ar' ? 'جاري التحميل...' : 'Loading...'}</div>
          ) : isError ? (
            <div className="p-8 text-center text-red-500 text-sm">{language === 'ar' ? 'حدث خطأ أثناء التحميل' : 'Failed to load activity log'}</div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground italic">
              {language === 'ar' ? 'لا توجد سجلات مطابقة' : 'No matching activity logs'}
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {items.map(log => {
                const { label, tone } = getActionLabel(log.action, language);
                let meta: Record<string, unknown> = {};
                try { if (log.metadata) meta = JSON.parse(log.metadata); } catch {}

                return (
                  <div key={log.id} className="flex items-start gap-4 px-4 py-3 hover:bg-muted/20 transition-colors">
                    {/* Time */}
                    <div className="text-xs text-muted-foreground whitespace-nowrap pt-0.5 w-32 shrink-0" dir="ltr">
                      {format(new Date(log.createdAt), 'MMM dd, HH:mm')}
                    </div>

                    {/* Action */}
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className={`text-xs ${tone}`}>{label}</Badge>
                        {log.targetId != null && (
                          <span className="text-[10px] text-muted-foreground font-mono">#{log.targetId}</span>
                        )}
                      </div>
                      {/* Actor */}
                      <p className="text-xs text-muted-foreground">
                        {log.actorId != null
                          ? `${log.actorRole === 'admin' ? (language === 'ar' ? 'مدير' : 'Admin') : log.actorRole} #${log.actorId}`
                          : (language === 'ar' ? 'النظام' : 'System')}
                      </p>
                      {/* Metadata preview */}
                      {!!meta.reason && (
                        <p className="text-xs text-muted-foreground/70 truncate">
                          {language === 'ar' ? 'السبب: ' : 'Reason: '}{String(meta.reason)}
                        </p>
                      )}
                      {!!meta.status && !meta.reason && (
                        <p className="text-xs text-muted-foreground/70">
                          {language === 'ar' ? 'الحالة: ' : 'Status: '}{String(meta.status)}
                        </p>
                      )}
                      {!!meta.officeName && (
                        <p className="text-xs text-muted-foreground/70 truncate">{String(meta.officeName)}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-4">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            <ChevronLeft size={16} className={language === 'ar' ? 'rotate-180' : ''} />
            {language === 'ar' ? 'السابق' : 'Previous'}
          </Button>
          <span className="text-sm text-muted-foreground">
            {language === 'ar' ? `صفحة ${page} من ${totalPages}` : `Page ${page} of ${totalPages}`}
          </span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
            {language === 'ar' ? 'التالي' : 'Next'}
            <ChevronRight size={16} className={language === 'ar' ? 'rotate-180' : ''} />
          </Button>
        </div>
      )}
    </div>
  );
}
