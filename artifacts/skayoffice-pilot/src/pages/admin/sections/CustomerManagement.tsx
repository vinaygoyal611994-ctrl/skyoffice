import React, { useState, useMemo } from 'react';
import { useI18n } from '@/lib/i18n';
import {
  useListAdminCustomers,
  useSetAdminCustomerStatus,
  getListAdminCustomersQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { Users, Search, RotateCcw, PauseCircle, Ban, ChevronLeft, ChevronRight } from 'lucide-react';
import { safeApiError } from '@/lib/apiError';

const STATUS_TONE: Record<string, string> = {
  active:      'bg-emerald-100 text-emerald-700 border-emerald-200',
  suspended:   'bg-amber-100 text-amber-800 border-amber-200',
  deactivated: 'bg-red-100 text-red-700 border-red-200',
};

const PAGE_SIZE = 20;

export function CustomerManagementSection() {
  const { language } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [statusReasonFor, setStatusReasonFor] = useState<{ userId: number; status: 'suspended' | 'deactivated'; name: string } | null>(null);
  const [reasonText, setReasonText] = useState('');

  const { data: customers = [], isLoading } = useListAdminCustomers();

  const setStatusMut = useSetAdminCustomerStatus({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAdminCustomersQueryKey() });
        setStatusReasonFor(null);
        setReasonText('');
        toast({ title: language === 'ar' ? 'تم تغيير الحالة' : 'Status updated' });
      },
      onError: (err: any) => {
        toast({ title: language === 'ar' ? 'تعذّر تنفيذ الإجراء' : 'Action failed', description: safeApiError(err, language), variant: 'destructive' });
      },
    },
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return customers;
    const q = search.toLowerCase();
    return customers.filter(c =>
      c.name?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      c.phone?.toLowerCase().includes(q)
    );
  }, [customers, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleSearch = (v: string) => { setSearch(v); setPage(1); };

  const applyStatus = (userId: number, name: string, status: 'active' | 'suspended' | 'deactivated') => {
    if (status === 'active') {
      setStatusMut.mutate({ userId, data: { status } });
    } else {
      setStatusReasonFor({ userId, status, name });
      setReasonText('');
    }
  };

  const confirmStatus = () => {
    if (!statusReasonFor) return;
    setStatusMut.mutate({ userId: statusReasonFor.userId, data: { status: statusReasonFor.status, reason: reasonText || undefined } });
  };

  const statusLabel = (s: string) => {
    const labels: Record<string, { ar: string; en: string }> = {
      active:      { ar: 'نشط',    en: 'Active' },
      suspended:   { ar: 'معلّق',  en: 'Suspended' },
      deactivated: { ar: 'معطّل', en: 'Deactivated' },
    };
    return language === 'ar' ? (labels[s]?.ar ?? s) : (labels[s]?.en ?? s);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2"><Users size={20} />{language === 'ar' ? 'إدارة العملاء' : 'Customer Management'}</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {language === 'ar' ? `${customers.length} عميل مسجل` : `${customers.length} registered customers`}
        </p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="ps-9"
          placeholder={language === 'ar' ? 'ابحث بالاسم أو البريد أو الهاتف...' : 'Search by name, email or phone...'}
          value={search}
          onChange={e => handleSearch(e.target.value)}
          data-testid="input-customer-search"
        />
      </div>

      {/* Desktop table */}
      <div className="hidden md:block rounded-lg border overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/30">
            <TableRow>
              <TableHead>{language === 'ar' ? 'العميل' : 'Customer'}</TableHead>
              <TableHead>{language === 'ar' ? 'البريد الإلكتروني' : 'Email'}</TableHead>
              <TableHead>{language === 'ar' ? 'الهاتف' : 'Phone'}</TableHead>
              <TableHead className="text-center">{language === 'ar' ? 'المفضلة' : 'Favourites'}</TableHead>
              <TableHead>{language === 'ar' ? 'تاريخ التسجيل' : 'Joined'}</TableHead>
              <TableHead>{language === 'ar' ? 'الحالة' : 'Status'}</TableHead>
              <TableHead className="text-end">{language === 'ar' ? 'إجراءات' : 'Actions'}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">{language === 'ar' ? 'جاري التحميل...' : 'Loading...'}</TableCell></TableRow>
            ) : paged.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground italic">{language === 'ar' ? 'لا توجد نتائج' : 'No results found'}</TableCell></TableRow>
            ) : paged.map(customer => (
              <TableRow key={customer.id} data-testid={`row-customer-${customer.id}`}>
                <TableCell className="font-medium">{customer.name}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{customer.email}</TableCell>
                <TableCell dir="ltr" className="text-sm">{customer.phone || '—'}</TableCell>
                <TableCell className="text-center font-mono font-semibold">{customer.favouritesCount}</TableCell>
                <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{format(new Date(customer.createdAt), 'yyyy-MM-dd')}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={`${STATUS_TONE[customer.status] ?? ''}`} data-testid={`badge-customer-status-${customer.id}`}>
                    {statusLabel(customer.status)}
                  </Badge>
                </TableCell>
                <TableCell className="text-end">
                  <div className="flex justify-end gap-1.5 flex-wrap">
                    {customer.status !== 'active' && (
                      <Button size="sm" variant="outline" className="gap-1 h-8 text-xs" onClick={() => applyStatus(customer.id, customer.name, 'active')} data-testid={`button-reactivate-customer-${customer.id}`}>
                        <RotateCcw size={13} />{language === 'ar' ? 'تفعيل' : 'Activate'}
                      </Button>
                    )}
                    {customer.status !== 'suspended' && (
                      <Button size="sm" variant="secondary" className="gap-1 h-8 text-xs" onClick={() => applyStatus(customer.id, customer.name, 'suspended')} data-testid={`button-suspend-customer-${customer.id}`}>
                        <PauseCircle size={13} />{language === 'ar' ? 'تعليق' : 'Suspend'}
                      </Button>
                    )}
                    {customer.status !== 'deactivated' && (
                      <Button size="sm" variant="destructive" className="gap-1 h-8 text-xs" onClick={() => applyStatus(customer.id, customer.name, 'deactivated')} data-testid={`button-deactivate-customer-${customer.id}`}>
                        <Ban size={13} />{language === 'ar' ? 'تعطيل' : 'Deactivate'}
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {isLoading ? (
          <p className="text-center text-muted-foreground py-8">{language === 'ar' ? 'جاري التحميل...' : 'Loading...'}</p>
        ) : paged.length === 0 ? (
          <p className="text-center text-muted-foreground italic py-8">{language === 'ar' ? 'لا توجد نتائج' : 'No results found'}</p>
        ) : paged.map(customer => (
          <Card key={customer.id} className="border-border/50">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-sm truncate">{customer.name}</p>
                <Badge variant="outline" className={`text-xs shrink-0 ${STATUS_TONE[customer.status] ?? ''}`}>{statusLabel(customer.status)}</Badge>
              </div>
              <div className="text-xs text-muted-foreground space-y-1">
                <p>{customer.email}</p>
                {customer.phone && <p dir="ltr">{customer.phone}</p>}
                <p>{language === 'ar' ? `${customer.favouritesCount} مفضلة` : `${customer.favouritesCount} favourites`} · {format(new Date(customer.createdAt), 'yyyy-MM-dd')}</p>
              </div>
              <div className="flex gap-2 flex-wrap">
                {customer.status !== 'active' && (
                  <Button size="sm" variant="outline" className="gap-1 text-xs h-8 flex-1" onClick={() => applyStatus(customer.id, customer.name, 'active')}>
                    <RotateCcw size={13} />{language === 'ar' ? 'تفعيل' : 'Activate'}
                  </Button>
                )}
                {customer.status !== 'suspended' && (
                  <Button size="sm" variant="secondary" className="gap-1 text-xs h-8 flex-1" onClick={() => applyStatus(customer.id, customer.name, 'suspended')}>
                    <PauseCircle size={13} />{language === 'ar' ? 'تعليق' : 'Suspend'}
                  </Button>
                )}
                {customer.status !== 'deactivated' && (
                  <Button size="sm" variant="destructive" className="gap-1 text-xs h-8 flex-1" onClick={() => applyStatus(customer.id, customer.name, 'deactivated')}>
                    <Ban size={13} />{language === 'ar' ? 'تعطيل' : 'Deactivate'}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-4">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            <ChevronLeft size={16} className={language === 'ar' ? 'rotate-180' : ''} />{language === 'ar' ? 'السابق' : 'Previous'}
          </Button>
          <span className="text-sm text-muted-foreground">
            {language === 'ar' ? `صفحة ${page} من ${totalPages}` : `Page ${page} of ${totalPages}`}
          </span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
            {language === 'ar' ? 'التالي' : 'Next'}<ChevronRight size={16} className={language === 'ar' ? 'rotate-180' : ''} />
          </Button>
        </div>
      )}

      {/* Status reason dialog */}
      <Dialog open={statusReasonFor !== null} onOpenChange={open => { if (!open) setStatusReasonFor(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {statusReasonFor?.status === 'suspended'
                ? (language === 'ar' ? 'تعليق الحساب' : 'Suspend Account')
                : (language === 'ar' ? 'تعطيل الحساب' : 'Deactivate Account')}
            </DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">{statusReasonFor?.name}</span>
              <span className="block text-xs mt-1 text-muted-foreground">
                {language === 'ar' ? 'سبب تغيير الحالة (اختياري)' : 'Reason for status change (optional)'}
              </span>
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reasonText}
            onChange={e => setReasonText(e.target.value)}
            className="min-h-[90px] max-h-[140px] resize-none text-sm"
            placeholder={language === 'ar' ? 'أدخل السبب...' : 'Enter reason...'}
            data-testid="input-customer-status-reason"
          />
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => setStatusReasonFor(null)}>
              {language === 'ar' ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={setStatusMut.isPending}
              onClick={confirmStatus}
              data-testid="button-confirm-customer-status"
            >
              {setStatusMut.isPending ? '...' : (language === 'ar' ? 'تأكيد' : 'Confirm')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
