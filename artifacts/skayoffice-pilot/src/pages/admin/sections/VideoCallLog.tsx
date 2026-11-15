import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '@/lib/i18n';
import { getSessionToken } from '@/lib/sessionToken';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { format } from 'date-fns';
import { Video, ChevronLeft, ChevronRight, User, Building2, Calendar, Clock } from 'lucide-react';

const BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');

const STATUS_META: Record<string, { labelAr: string; labelEn: string; tone: string }> = {
  new:                 { labelAr: 'جديد',          labelEn: 'New',                 tone: 'bg-blue-50 text-blue-700 border-blue-200' },
  viewed:              { labelAr: 'تمت المشاهدة',  labelEn: 'Viewed',              tone: 'bg-amber-50 text-amber-700 border-amber-200' },
  accepted:            { labelAr: 'مقبول',          labelEn: 'Accepted',            tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  declined:            { labelAr: 'مرفوض',          labelEn: 'Declined',            tone: 'bg-red-50 text-red-700 border-red-200' },
  completed:           { labelAr: 'مكتمل',          labelEn: 'Completed',           tone: 'bg-slate-100 text-slate-600 border-slate-200' },
  cancellation_pending:{ labelAr: 'طلب إلغاء',     labelEn: 'Cancellation Pending', tone: 'bg-orange-50 text-orange-700 border-orange-200' },
  cancelled:           { labelAr: 'ملغى',           labelEn: 'Cancelled',           tone: 'bg-zinc-100 text-zinc-500 border-zinc-200' },
};

const FILTER_OPTIONS = [
  { value: 'all',                  labelAr: 'الكل',          labelEn: 'All' },
  { value: 'new',                  labelAr: 'جديد',          labelEn: 'New' },
  { value: 'accepted',             labelAr: 'مقبول',          labelEn: 'Accepted' },
  { value: 'completed',            labelAr: 'مكتمل',          labelEn: 'Completed' },
  { value: 'declined',             labelAr: 'مرفوض',          labelEn: 'Declined' },
  { value: 'cancellation_pending', labelAr: 'طلب إلغاء',     labelEn: 'Cancellation Pending' },
  { value: 'cancelled',            labelAr: 'ملغى',           labelEn: 'Cancelled' },
];

interface VideoCallItem {
  id: number;
  status: string;
  preferredDate: string;
  preferredTime: string;
  timezone: string;
  contactNumber: string;
  note: string | null;
  createdAt: string;
  customerName: string | null;
  customerId: number;
  officeName: string | null;
  officeId: number;
  meetingId: string | null;
  scheduledAt: string | null;
}

interface VideoCallLogData {
  items: VideoCallItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

async function fetchVideoCallLog(status: string, page: number): Promise<VideoCallLogData> {
  const token = getSessionToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const params = new URLSearchParams({ page: String(page), limit: '25' });
  if (status && status !== 'all') params.set('status', status);

  const res = await fetch(`${BASE}/api/admin/video-call-requests?${params}`, {
    credentials: 'include',
    headers,
  });
  if (!res.ok) throw new Error(`video-call-log ${res.status}`);
  return res.json();
}

export function VideoCallLogSection() {
  const { language } = useI18n();
  const isAr = language === 'ar';

  const [status, setStatus] = useState('all');
  const [page,   setPage]   = useState(1);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-video-call-log', status, page],
    queryFn: () => fetchVideoCallLog(status, page),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const items      = data?.items      ?? [];
  const total      = data?.total      ?? 0;
  const totalPages = data?.totalPages ?? 1;

  const handleStatus = (v: string) => { setStatus(v); setPage(1); };

  const statusBadge = (s: string) => {
    const m = STATUS_META[s];
    return m
      ? <Badge variant="outline" className={`text-xs ${m.tone}`}>{isAr ? m.labelAr : m.labelEn}</Badge>
      : <Badge variant="outline" className="text-xs">{s}</Badge>;
  };

  return (
    <div className="space-y-6">

      {/* Header */}
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Video size={20} />
          {isAr ? 'سجل مكالمات الفيديو' : 'Video Call Log'}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          {isAr
            ? 'جميع طلبات حجز مكالمات الفيديو — العميل والمكتب والحالة'
            : 'All video call booking requests — customer, office, and status'}
        </p>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={status} onValueChange={handleStatus}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILTER_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>
                {isAr ? o.labelAr : o.labelEn}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          {isLoading ? '…' : total} {isAr ? 'طلب' : 'requests'}
        </span>
      </div>

      {/* Table card */}
      <Card>
        {/* Column headers */}
        <CardHeader className="pb-0 border-b">
          <div className="grid grid-cols-[1fr_1fr_9rem_8rem_8rem] gap-4 pb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/60">
            <span className="flex items-center gap-1"><User size={11} />{isAr ? 'العميل' : 'Customer'}</span>
            <span className="flex items-center gap-1"><Building2 size={11} />{isAr ? 'المكتب' : 'Office'}</span>
            <span className="flex items-center gap-1"><Calendar size={11} />{isAr ? 'التاريخ / الوقت' : 'Date / Time'}</span>
            <span>{isAr ? 'الحالة' : 'Status'}</span>
            <span className="flex items-center gap-1"><Clock size={11} />{isAr ? 'تاريخ الطلب' : 'Requested'}</span>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">
              {isAr ? 'جاري التحميل...' : 'Loading...'}
            </div>
          ) : isError ? (
            <div className="p-8 text-center text-red-500 text-sm">
              {isAr ? 'حدث خطأ أثناء التحميل' : 'Failed to load video call log'}
            </div>
          ) : items.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground italic">
              {isAr ? 'لا توجد طلبات مطابقة' : 'No matching requests'}
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {items.map(item => (
                <div
                  key={item.id}
                  className="grid grid-cols-[1fr_1fr_9rem_8rem_8rem] items-start gap-4 px-4 py-3 hover:bg-muted/20 transition-colors"
                >
                  {/* Customer */}
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{item.customerName ?? '—'}</p>
                    <p className="text-xs text-muted-foreground font-mono">#{item.customerId}</p>
                    {item.contactNumber && (
                      <p className="text-xs text-muted-foreground dir-ltr" dir="ltr">{item.contactNumber}</p>
                    )}
                  </div>

                  {/* Office */}
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{item.officeName ?? '—'}</p>
                    <p className="text-xs text-muted-foreground font-mono">#{item.officeId}</p>
                  </div>

                  {/* Date / Time */}
                  <div className="text-xs text-muted-foreground space-y-0.5" dir="ltr">
                    <p className="font-medium text-foreground">{item.preferredDate}</p>
                    <p>{item.preferredTime}</p>
                    <p className="text-[10px] text-muted-foreground/70">{item.timezone}</p>
                    {item.meetingId && (
                      <p className="text-[10px] text-emerald-600 font-mono">Zoom ✓</p>
                    )}
                  </div>

                  {/* Status */}
                  <div>
                    {statusBadge(item.status)}
                    {item.note && (
                      <p className="text-[11px] text-muted-foreground/70 mt-1 truncate max-w-[7rem]" title={item.note}>
                        {isAr ? 'ملاحظة: ' : 'Note: '}{item.note}
                      </p>
                    )}
                  </div>

                  {/* Requested at */}
                  <div className="text-xs text-muted-foreground" dir="ltr">
                    {format(new Date(item.createdAt), 'MMM dd, HH:mm')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-4">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            <ChevronLeft size={16} className={isAr ? 'rotate-180' : ''} />
            {isAr ? 'السابق' : 'Previous'}
          </Button>
          <span className="text-sm text-muted-foreground">
            {isAr ? `صفحة ${page} من ${totalPages}` : `Page ${page} of ${totalPages}`}
          </span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
            {isAr ? 'التالي' : 'Next'}
            <ChevronRight size={16} className={isAr ? 'rotate-180' : ''} />
          </Button>
        </div>
      )}
    </div>
  );
}
