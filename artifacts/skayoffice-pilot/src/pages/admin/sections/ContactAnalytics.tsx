import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '@/lib/i18n';
import { useListAdminOffices } from '@workspace/api-client-react';
import { getSessionToken } from '@/lib/sessionToken';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format } from 'date-fns';
import { MessageCircle, Share2, MapPin, Video, QrCode, BarChart3, ChevronLeft, ChevronRight } from 'lucide-react';

const BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');

const ACTION_META: Record<string, { icon: React.ReactNode; labelAr: string; labelEn: string; tone: string }> = {
  whatsapp_click:     { icon: <MessageCircle size={16} />, labelAr: 'واتساب',        labelEn: 'WhatsApp',       tone: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  share_click:        { icon: <Share2 size={16} />,        labelAr: 'مشاركة',         labelEn: 'Share',          tone: 'bg-blue-100 text-blue-700 border-blue-200' },
  location_click:     { icon: <MapPin size={16} />,        labelAr: 'موقع',           labelEn: 'Location',       tone: 'bg-purple-100 text-purple-700 border-purple-200' },
  video_call_request: { icon: <Video size={16} />,         labelAr: 'مكالمة فيديو',   labelEn: 'Video Call',     tone: 'bg-orange-100 text-orange-700 border-orange-200' },
  qr_visit:           { icon: <QrCode size={16} />,        labelAr: 'زيارة QR',       labelEn: 'QR Visit',       tone: 'bg-slate-100 text-slate-700 border-slate-200' },
};

interface ContactAnalyticsData {
  counts: {
    whatsapp_click: number;
    share_click: number;
    location_click: number;
    video_call_request: number;
    qr_visit: number;
  };
  items: {
    id: number;
    customerName: string;
    officeName: string;
    officeId: number;
    actionType: string;
    createdAt: string;
  }[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface Filters {
  officeId: string;
  dateFrom: string;
  dateTo: string;
  actionType: string;
  page: number;
}

async function fetchContactAnalytics(filters: Filters): Promise<ContactAnalyticsData> {
  const token = getSessionToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const params = new URLSearchParams();
  if (filters.officeId && filters.officeId !== 'all') params.set('officeId', filters.officeId);
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo)   params.set('dateTo',   filters.dateTo);
  if (filters.actionType && filters.actionType !== 'all') params.set('actionType', filters.actionType);
  params.set('page',  String(filters.page));
  params.set('limit', '25');

  const res = await fetch(`${BASE}/api/admin/contact-analytics?${params}`, {
    credentials: 'include',
    headers,
  });
  if (!res.ok) throw new Error(`contact-analytics ${res.status}`);
  return res.json();
}

export function ContactAnalyticsSection() {
  const { language } = useI18n();

  const { data: offices = [] } = useListAdminOffices();

  const [officeFilter, setOfficeFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [page, setPage] = useState(1);

  const filters: Filters = { officeId: officeFilter, dateFrom, dateTo, actionType: typeFilter, page };

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-contact-analytics', filters],
    queryFn: () => fetchContactAnalytics(filters),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const counts = data?.counts ?? { whatsapp_click: 0, share_click: 0, location_click: 0, video_call_request: 0, qr_visit: 0 };
  const items  = data?.items ?? [];
  const total  = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  const handleFilter = <T,>(setter: React.Dispatch<React.SetStateAction<T>>) => (v: T) => { setter(v); setPage(1); };

  const metricCards = [
    { key: 'whatsapp_click',     label: language === 'ar' ? 'نقرات واتساب'         : 'WhatsApp Clicks',      icon: <MessageCircle size={22} />, tone: 'text-emerald-600' },
    { key: 'share_click',        label: language === 'ar' ? 'مشاركات'               : 'Share Clicks',         icon: <Share2 size={22} />,        tone: 'text-blue-600' },
    { key: 'location_click',     label: language === 'ar' ? 'نقرات الموقع'          : 'Location Clicks',      icon: <MapPin size={22} />,        tone: 'text-purple-600' },
    { key: 'video_call_request', label: language === 'ar' ? 'طلبات مكالمة الفيديو' : 'Video Call Requests',  icon: <Video size={22} />,         tone: 'text-orange-600' },
    { key: 'qr_visit',           label: language === 'ar' ? 'زيارات رمز QR'         : 'QR Visits',            icon: <QrCode size={22} />,        tone: 'text-slate-600' },
  ] as const;

  const hasFilters = officeFilter !== 'all' || typeFilter !== 'all' || !!dateFrom || !!dateTo;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2"><BarChart3 size={20} />{language === 'ar' ? 'تحليلات التواصل' : 'Contact Analytics'}</h2>
        <p className="text-sm text-muted-foreground mt-1">{language === 'ar' ? 'إجمالي تفاعلات العملاء عبر المنصة' : 'Total customer interactions across the platform'}</p>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {metricCards.map(card => (
          <Card
            key={card.key}
            className={`border-border/50 shadow-sm cursor-pointer transition-shadow hover:shadow-md ${typeFilter === card.key ? 'ring-2 ring-primary' : ''}`}
            onClick={() => handleFilter(setTypeFilter)(typeFilter === card.key ? 'all' : card.key)}
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className={`opacity-60 ${card.tone}`}>{card.icon}</span>
              </div>
              <div className={`text-2xl font-bold font-mono tabular-nums ${card.tone}`}>
                {isLoading ? '—' : counts[card.key]}
              </div>
              <p className="text-xs text-muted-foreground mt-1 leading-tight">{card.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Total */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="font-semibold text-foreground text-base">{isLoading ? '…' : total}</span>
        {language === 'ar' ? 'إجمالي التفاعلات في الفترة المحددة' : 'total interactions in selected period'}
        {hasFilters && (
          <Button
            variant="ghost" size="sm" className="h-6 text-xs px-2 text-muted-foreground"
            onClick={() => { setOfficeFilter('all'); setTypeFilter('all'); setDateFrom(''); setDateTo(''); setPage(1); }}
          >
            {language === 'ar' ? 'إعادة تعيين الفلاتر' : 'Reset filters'}
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
        <Select value={officeFilter} onValueChange={handleFilter(setOfficeFilter)}>
          <SelectTrigger className="w-full sm:w-52">
            <SelectValue placeholder={language === 'ar' ? 'جميع المكاتب' : 'All Offices'} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{language === 'ar' ? 'جميع المكاتب' : 'All Offices'}</SelectItem>
            {offices.map(o => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={typeFilter} onValueChange={handleFilter(setTypeFilter)}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder={language === 'ar' ? 'جميع الأنواع' : 'All Types'} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{language === 'ar' ? 'جميع الأنواع' : 'All Types'}</SelectItem>
            {Object.entries(ACTION_META).map(([key, meta]) => (
              <SelectItem key={key} value={key}>{language === 'ar' ? meta.labelAr : meta.labelEn}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-2">
          <Input type="date" className="w-40 text-sm" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} />
          <span className="text-muted-foreground text-sm">—</span>
          <Input type="date" className="w-40 text-sm" value={dateTo}   onChange={e => { setDateTo(e.target.value);   setPage(1); }} />
        </div>
      </div>

      {/* Event log table */}
      <Card>
        <CardHeader className="pb-3 border-b">
          <CardTitle className="text-base">{language === 'ar' ? 'سجل الأحداث' : 'Event Log'}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow>
                  <TableHead>{language === 'ar' ? 'العميل' : 'Customer'}</TableHead>
                  <TableHead>{language === 'ar' ? 'المكتب' : 'Office'}</TableHead>
                  <TableHead>{language === 'ar' ? 'الإجراء' : 'Action'}</TableHead>
                  <TableHead>{language === 'ar' ? 'التاريخ' : 'Date'}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">{language === 'ar' ? 'جاري التحميل...' : 'Loading...'}</TableCell></TableRow>
                ) : isError ? (
                  <TableRow><TableCell colSpan={4} className="text-center py-8 text-red-500 text-sm">{language === 'ar' ? 'حدث خطأ أثناء التحميل' : 'Failed to load data'}</TableCell></TableRow>
                ) : items.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground italic">{language === 'ar' ? 'لا توجد أحداث في هذه الفترة' : 'No events found for the selected period'}</TableCell></TableRow>
                ) : items.map(evt => {
                  const meta = ACTION_META[evt.actionType];
                  return (
                    <TableRow key={`${evt.actionType}-${evt.id}`}>
                      <TableCell className="font-medium text-sm">{evt.customerName || '—'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{evt.officeName}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`gap-1 text-xs ${meta?.tone ?? ''}`}>
                          {meta?.icon}
                          {language === 'ar' ? (meta?.labelAr ?? evt.actionType) : (meta?.labelEn ?? evt.actionType)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap" dir="ltr">
                        {format(new Date(evt.createdAt), 'yyyy-MM-dd HH:mm')}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
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
