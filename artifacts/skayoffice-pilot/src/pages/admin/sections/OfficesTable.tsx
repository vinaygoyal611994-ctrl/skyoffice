/**
 * OfficesTable — All Offices view.
 *
 * Owns: list fetch, search/filters, pagination, OfficeActionMenu with quick
 * row-level ops (verify, delete, video preview, activate/suspend/reactivate),
 * and the three AlertDialogs that back them.
 *
 * Full office detail panel (approve/reject/request-changes/document review/
 * pending changes/admin notes) is handled by the shared OfficeDetailDialog.
 */
import React, { useState, useMemo } from 'react';
import { useI18n, categoriesMap, localizedCity } from '@/lib/i18n';
import {
  useListAdminOffices,
  useDeleteAdminOffice,
  useSetOfficeVerification,
  useActivateAdminApplication,
  useSuspendAdminApplication,
  useReactivateAdminApplication,
  useRemoveAdminOfficeMarketingVideo,
  getListAdminOfficesQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { getOfficePublicUrl } from '@/lib/publicUrl';
import {
  Building2, Search, MoreHorizontal, Eye, CheckCircle2,
  PlayCircle, PauseCircle, RotateCcw, Trash2, ExternalLink, ShieldCheck,
  ShieldAlert, FileEdit, ChevronLeft, ChevronRight, Video,
} from 'lucide-react';
import { OfficeDetailDialog } from './OfficeDetailDialog';
import { safeApiError } from '@/lib/apiError';

const STATUS_META: Record<string, { tone: string; labelAr: string; labelEn: string }> = {
  draft:             { tone: 'bg-slate-100 text-slate-700 border-slate-200',       labelAr: 'مسودة',          labelEn: 'Draft' },
  under_review:      { tone: 'bg-blue-100 text-blue-700 border-blue-200',          labelAr: 'قيد المراجعة',   labelEn: 'Under Review' },
  changes_requested: { tone: 'bg-amber-100 text-amber-700 border-amber-200',       labelAr: 'مطلوب تعديلات', labelEn: 'Changes Requested' },
  approved:          { tone: 'bg-cyan-100 text-cyan-700 border-cyan-200',          labelAr: 'تمت الموافقة',  labelEn: 'Approved' },
  active:            { tone: 'bg-emerald-100 text-emerald-700 border-emerald-200', labelAr: 'نشط',            labelEn: 'Active' },
  rejected:          { tone: 'bg-red-100 text-red-700 border-red-200',             labelAr: 'مرفوض',          labelEn: 'Rejected' },
  suspended:         { tone: 'bg-orange-100 text-orange-700 border-orange-200',    labelAr: 'معلّق',          labelEn: 'Suspended' },
};

const ACTIVATION_BLOCKER_LABELS: Record<string, { ar: string; en: string }> = {
  application_not_approved:       { ar: 'الطلب ليس في حالة "تمت الموافقة"', en: 'Application not approved' },
  incomplete_required_info:       { ar: 'بيانات المكتب الأساسية غير مكتملة', en: 'Required info incomplete' },
  missing_spoken_language:        { ar: 'لم يتم تحديد لغة تواصل', en: 'No language selected' },
  missing_service:                { ar: 'لم تتم إضافة خدمة', en: 'No service added' },
  invalid_whatsapp:               { ar: 'رقم واتساب غير صالح', en: 'Invalid WhatsApp number' },
  identity_document_not_approved: { ar: 'مستند الهوية لم تتم الموافقة عليه', en: 'ID document not approved' },
  trade_license_not_approved:     { ar: 'السجل التجاري لم تتم الموافقة عليه', en: 'Trade license not approved' },
};

const PAGE_SIZE = 20;

const STATUS_FILTERS = [
  { value: 'all',               labelAr: 'جميع الحالات',   labelEn: 'All Statuses' },
  { value: 'pending_edits',     labelAr: 'تعديلات معلقة',  labelEn: 'Pending Edits' },
  { value: 'under_review',      labelAr: 'قيد المراجعة',   labelEn: 'Under Review' },
  { value: 'approved',          labelAr: 'تمت الموافقة',  labelEn: 'Approved' },
  { value: 'active',            labelAr: 'نشط',            labelEn: 'Active' },
  { value: 'changes_requested', labelAr: 'مطلوب تعديلات', labelEn: 'Changes Requested' },
  { value: 'suspended',         labelAr: 'معلّق',          labelEn: 'Suspended' },
  { value: 'rejected',          labelAr: 'مرفوض',          labelEn: 'Rejected' },
  { value: 'draft',             labelAr: 'مسودة',          labelEn: 'Draft' },
];

export function OfficesTableSection({ initialStatus = 'all' }: { initialStatus?: string }) {
  const { language } = useI18n();
  const { toast }    = useToast();
  const queryClient  = useQueryClient();

  // List / filter / pagination state
  const [search,             setSearch]             = useState('');
  const [statusFilter,       setStatusFilter]       = useState(initialStatus);
  const [categoryFilter,     setCategoryFilter]     = useState('all');
  const [providerTypeFilter, setProviderTypeFilter] = useState<'all' | 'office' | 'freelancer'>('all');
  const [page,               setPage]               = useState(1);

  // Dialog state
  const [selectedId,       setSelectedId]       = useState<number | null>(null);
  const [deleteConfirmId,  setDeleteConfirmId]  = useState<number | null>(null);
  const [previewVideo,     setPreviewVideo]     = useState<{ id: number; name: string; url: string } | null>(null);
  const [videoDeleteConfirm, setVideoDeleteConfirm] = useState(false);

  const { data: offices = [], isLoading } = useListAdminOffices(
    providerTypeFilter !== 'all' ? { providerType: providerTypeFilter } : undefined,
  );

  // ── Row-level mutations (owned by this view, not the shared dialog) ──────
  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListAdminOfficesQueryKey() });

  const onErr = (err: any) => toast({
    title: language === 'ar' ? 'تعذّر تنفيذ الإجراء' : 'Action failed',
    description: safeApiError(err, language),
    variant: 'destructive',
  });
  const onActivationErr = (err: any) => {
    const blockers: string[] = err?.data?.blockers || [];
    if (blockers.length > 0) {
      toast({
        title: language === 'ar' ? 'تعذّر التفعيل' : 'Activation blocked',
        description: blockers.map(c => {
          const l = ACTIVATION_BLOCKER_LABELS[c];
          return l ? `• ${language === 'ar' ? l.ar : l.en}` : `• ${c}`;
        }).join('\n'),
        variant: 'destructive',
      });
      return;
    }
    onErr(err);
  };

  const deleteMut     = useDeleteAdminOffice({ mutation: { onSuccess: () => { invalidate(); setSelectedId(null); toast({ title: language === 'ar' ? 'تم الحذف' : 'Deleted' }); }, onError: onErr } });
  const verifyMut     = useSetOfficeVerification({ mutation: { onSuccess: invalidate, onError: onErr } });
  const activateMut   = useActivateAdminApplication({ mutation: { onSuccess: invalidate, onError: onActivationErr } });
  const suspendMut    = useSuspendAdminApplication({ mutation: { onSuccess: invalidate, onError: onErr } });
  const reactivateMut = useReactivateAdminApplication({ mutation: { onSuccess: invalidate, onError: onActivationErr } });
  const removeVideoMut = useRemoveAdminOfficeMarketingVideo({ mutation: { onSuccess: () => { invalidate(); setPreviewVideo(null); toast({ title: language === 'ar' ? 'تم الحذف' : 'Video deleted' }); }, onError: onErr } });

  // ── Filtering ─────────────────────────────────────────────────────────────
  const filtered = useMemo(() => offices.filter(o => {
    if (statusFilter === 'pending_edits') {
      if (!(o as any).pendingChangesSubmittedAt) return false;
    } else if (statusFilter !== 'all' && o.status !== statusFilter) {
      return false;
    }
    if (categoryFilter !== 'all' && o.category !== categoryFilter) return false;
    if (providerTypeFilter !== 'all' && (o as any).providerType !== providerTypeFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (
        !o.name?.toLowerCase().includes(q) &&
        !o.email?.toLowerCase().includes(q) &&
        !(o.phone ?? '').toLowerCase().includes(q) &&
        !(o.whatsapp ?? '').toLowerCase().includes(q) &&
        !o.city?.toLowerCase().includes(q) &&
        !o.category?.toLowerCase().includes(q) &&
        !String(o.id).includes(q)
      ) return false;
    }
    return true;
  }), [offices, statusFilter, categoryFilter, search, providerTypeFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged      = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleSearch           = (v: string) => { setSearch(v); setPage(1); };
  const handleStatusFilter     = (v: string) => { setStatusFilter(v); setPage(1); };
  const handleCategoryFilter   = (v: string) => { setCategoryFilter(v); setPage(1); };
  const handleProviderTypeFilter = (v: string) => { setProviderTypeFilter(v as any); setPage(1); };

  const statusLabel   = (s: string) => { const m = STATUS_META[s]; return m ? (language === 'ar' ? m.labelAr : m.labelEn) : s; };
  const categoryLabel = (c: string) => { const m = categoriesMap[c]; return m ? (language === 'ar' ? m.ar : m.en) : c; };

  // ── Row action dropdown ───────────────────────────────────────────────────
  const OfficeActionMenu = ({ office }: { office: (typeof offices)[0] }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" data-testid={`button-office-actions-${office.id}`}>
          <MoreHorizontal size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={() => setSelectedId(office.id)}>
          <Eye size={14} className="me-2" />{language === 'ar' ? 'عرض التفاصيل' : 'View Details'}
        </DropdownMenuItem>
        {office.slug && (
          <DropdownMenuItem asChild>
            <a href={getOfficePublicUrl(office.slug, language)} target="_blank" rel="noreferrer">
              <ExternalLink size={14} className="me-2" />{language === 'ar' ? 'فتح الملف العام' : 'Open Public Profile'}
            </a>
          </DropdownMenuItem>
        )}
        {office.marketingVideoUrl && (
          <DropdownMenuItem onClick={() => setPreviewVideo({ id: office.id, name: office.name, url: office.marketingVideoUrl! })}>
            <Video size={14} className="me-2" />{language === 'ar' ? 'معاينة الفيديو' : 'Preview Video'}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {office.status === 'under_review' && (
          <DropdownMenuItem onClick={() => setSelectedId(office.id)} className="text-emerald-600">
            <CheckCircle2 size={14} className="me-2" />{language === 'ar' ? 'مراجعة / موافقة' : 'Review / Approve'}
          </DropdownMenuItem>
        )}
        {office.status === 'approved' && (
          <DropdownMenuItem onClick={() => activateMut.mutate({ officeId: office.id })} className="text-emerald-600">
            <PlayCircle size={14} className="me-2" />{language === 'ar' ? 'تفعيل المكتب' : 'Activate Office'}
          </DropdownMenuItem>
        )}
        {office.status === 'active' && (
          <DropdownMenuItem onClick={() => suspendMut.mutate({ officeId: office.id })} className="text-amber-600">
            <PauseCircle size={14} className="me-2" />{language === 'ar' ? 'تعليق المكتب' : 'Suspend Office'}
          </DropdownMenuItem>
        )}
        {office.status === 'suspended' && (
          <DropdownMenuItem onClick={() => reactivateMut.mutate({ officeId: office.id })} className="text-emerald-600">
            <RotateCcw size={14} className="me-2" />{language === 'ar' ? 'إعادة التفعيل' : 'Reactivate'}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => verifyMut.mutate({ officeId: office.id, data: { isVerified: !office.isVerified } })}>
          {office.isVerified
            ? <><ShieldAlert size={14} className="me-2" />{language === 'ar' ? 'إلغاء التوثيق' : 'Unverify'}</>
            : <><ShieldCheck size={14} className="me-2" />{language === 'ar' ? 'توثيق المكتب' : 'Verify Office'}</>}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteConfirmId(office.id)}>
          <Trash2 size={14} className="me-2" />{language === 'ar' ? 'حذف نهائي' : 'Delete Permanently'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Building2 size={20} />
          {language === 'ar' ? 'جميع المكاتب' : 'All Offices'}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          {language === 'ar' ? `${offices.length} مكتب مسجل` : `${offices.length} registered offices`}
        </p>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
        <div className="relative flex-1 min-w-0">
          <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="ps-9"
            placeholder={language === 'ar' ? 'ابحث بالاسم، البريد، الهاتف، المدينة، التصنيف، رقم المكتب...' : 'Search by name, email, phone, city, category, ID...'}
            value={search}
            onChange={e => handleSearch(e.target.value)}
            data-testid="input-office-search"
          />
        </div>
        <Select value={statusFilter} onValueChange={handleStatusFilter}>
          <SelectTrigger className="w-full sm:w-44" data-testid="select-office-status-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map(f => (
              <SelectItem key={f.value} value={f.value}>{language === 'ar' ? f.labelAr : f.labelEn}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={handleCategoryFilter}>
          <SelectTrigger className="w-full sm:w-44" data-testid="select-office-category-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{language === 'ar' ? 'جميع التخصصات' : 'All Categories'}</SelectItem>
            {Object.entries(categoriesMap).map(([k, v]) => (
              <SelectItem key={k} value={k}>{language === 'ar' ? v.ar : v.en}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={providerTypeFilter} onValueChange={handleProviderTypeFilter}>
          <SelectTrigger className="w-full sm:w-40" data-testid="select-office-provider-type-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{language === 'ar' ? 'الكل' : 'All Types'}</SelectItem>
            <SelectItem value="office">{language === 'ar' ? 'مكتب' : 'Office'}</SelectItem>
            <SelectItem value="freelancer">{language === 'ar' ? 'مستقل' : 'Freelancer'}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Results count */}
      <p className="text-sm text-muted-foreground">
        {language === 'ar' ? `${filtered.length} نتيجة` : `${filtered.length} results`}
        {(search || statusFilter !== 'all' || categoryFilter !== 'all' || providerTypeFilter !== 'all') && (
          <Button variant="ghost" size="sm" className="h-6 text-xs px-2 ms-2" onClick={() => { setSearch(''); setStatusFilter('all'); setCategoryFilter('all'); setProviderTypeFilter('all'); setPage(1); }}>
            {language === 'ar' ? 'مسح الفلاتر' : 'Clear filters'}
          </Button>
        )}
      </p>

      {/* Desktop table */}
      <div className="hidden md:block rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead>{language === 'ar' ? 'المكتب' : 'Office'}</TableHead>
                <TableHead>{language === 'ar' ? 'التخصص' : 'Category'}</TableHead>
                <TableHead>{language === 'ar' ? 'النوع' : 'Type'}</TableHead>
                <TableHead>{language === 'ar' ? 'المدينة' : 'City'}</TableHead>
                <TableHead>{language === 'ar' ? 'الحالة' : 'Status'}</TableHead>
                <TableHead>{language === 'ar' ? 'تاريخ التسجيل' : 'Registered'}</TableHead>
                <TableHead className="text-end">{language === 'ar' ? 'إجراءات' : 'Actions'}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">{language === 'ar' ? 'جاري التحميل...' : 'Loading...'}</TableCell></TableRow>
              ) : paged.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground italic">{language === 'ar' ? 'لا توجد مكاتب مطابقة' : 'No offices match your search'}</TableCell></TableRow>
              ) : paged.map(office => {
                const sm = STATUS_META[office.status] ?? STATUS_META.draft;
                return (
                  <TableRow key={office.id} className="hover:bg-muted/10">
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium text-sm">{office.name}</span>
                        <span className="text-[10px] text-muted-foreground">{office.email}</span>
                        {office.isDemo && <Badge variant="outline" className="text-[10px] h-4 px-1 w-fit bg-yellow-100 text-yellow-800 border-yellow-200">DEMO</Badge>}
                      </div>
                    </TableCell>
                    <TableCell><Badge variant="secondary" className="text-xs">{categoryLabel(office.category)}</Badge></TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[11px] border-border/60">
                        {(office as any).providerType === 'freelancer'
                          ? (language === 'ar' ? 'مستقل' : 'Freelancer')
                          : (language === 'ar' ? 'مكتب' : 'Office')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{localizedCity(office.city || '', language)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className={`text-xs ${sm.tone}`}>{statusLabel(office.status)}</Badge>
                        {office.isVerified && <ShieldCheck size={12} className="text-emerald-500 shrink-0" />}
                        {(office as any).pendingChangesSubmittedAt && (
                          <span title={language === 'ar' ? 'تعديل مقترح بانتظار المراجعة' : 'Pending edit awaiting review'}>
                            <FileEdit size={12} className="text-amber-500 shrink-0" />
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(office.createdAt), 'yyyy-MM-dd')}
                    </TableCell>
                    <TableCell className="text-end">
                      <OfficeActionMenu office={office} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {isLoading ? (
          <p className="text-center text-muted-foreground py-8">{language === 'ar' ? 'جاري التحميل...' : 'Loading...'}</p>
        ) : paged.length === 0 ? (
          <p className="text-center text-muted-foreground italic py-8">{language === 'ar' ? 'لا توجد مكاتب مطابقة' : 'No offices match your search'}</p>
        ) : paged.map(office => {
          const sm = STATUS_META[office.status] ?? STATUS_META.draft;
          return (
            <Card key={office.id} className="border-border/50">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-sm truncate">{office.name}</p>
                      <OfficeActionMenu office={office} />
                    </div>
                    <p className="text-xs text-muted-foreground">{categoryLabel(office.category)} · {localizedCity(office.city || '', language)}</p>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <Badge variant="outline" className={`text-xs ${sm.tone}`}>{statusLabel(office.status)}</Badge>
                      {office.isVerified && <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200 gap-1"><ShieldCheck size={10} />{language === 'ar' ? 'موثق' : 'Verified'}</Badge>}
                      {(office as any).pendingChangesSubmittedAt && (
                        <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200 gap-1">
                          <FileEdit size={10} />{language === 'ar' ? 'تعديل معلّق' : 'Pending edit'}
                        </Badge>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">{format(new Date(office.createdAt), 'yyyy-MM-dd')}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-4">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            <ChevronLeft size={16} className={language === 'ar' ? 'rotate-180' : ''} />{language === 'ar' ? 'السابق' : 'Prev'}
          </Button>
          <span className="text-sm text-muted-foreground">
            {language === 'ar' ? `صفحة ${page} من ${totalPages}` : `Page ${page} of ${totalPages}`}
          </span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
            {language === 'ar' ? 'التالي' : 'Next'}<ChevronRight size={16} className={language === 'ar' ? 'rotate-180' : ''} />
          </Button>
        </div>
      )}

      {/* Shared action dialog (approve/reject/docs/pending-changes/notes) */}
      <OfficeDetailDialog
        officeId={selectedId}
        onClose={() => setSelectedId(null)}
        onMutationSuccess={() =>
          queryClient.invalidateQueries({ queryKey: getListAdminOfficesQueryKey() })
        }
        showPendingMedia
      />

      {/* Marketing video preview */}
      <Dialog open={previewVideo !== null} onOpenChange={open => { if (!open) setPreviewVideo(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{language === 'ar' ? 'الفيديو التعريفي' : 'Marketing Video'} — {previewVideo?.name}</DialogTitle>
            <DialogDescription>
              {language === 'ar' ? 'الحذف فوري ولا يمكن التراجع عنه.' : 'Deletion is immediate and cannot be undone.'}
            </DialogDescription>
          </DialogHeader>
          {previewVideo && (
            <div className="space-y-4">
              <video src={`/api/storage${previewVideo.url}`} controls playsInline className="w-full rounded-lg border bg-slate-900 aspect-video" />
              <div className="flex justify-end">
                <Button variant="destructive" size="sm" onClick={() => setVideoDeleteConfirm(true)} disabled={removeVideoMut.isPending} data-testid="button-admin-delete-marketing-video">
                  <Trash2 size={14} className="me-1.5" />{language === 'ar' ? 'حذف الفيديو' : 'Delete Video'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* AlertDialog — permanent office deletion */}
      <AlertDialog open={deleteConfirmId !== null} onOpenChange={open => { if (!open) setDeleteConfirmId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{language === 'ar' ? 'تأكيد الحذف النهائي' : 'Confirm Permanent Deletion'}</AlertDialogTitle>
            <AlertDialogDescription>
              {language === 'ar' ? 'هذا الإجراء لا يمكن التراجع عنه. سيتم حذف المكتب وجميع بياناته نهائياً.' : 'This action cannot be undone. The office and all its data will be permanently deleted.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteConfirmId(null)}>{language === 'ar' ? 'إلغاء' : 'Cancel'}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (deleteConfirmId !== null) { deleteMut.mutate({ officeId: deleteConfirmId }); setDeleteConfirmId(null); } }}
            >
              {language === 'ar' ? 'حذف نهائياً' : 'Delete Permanently'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* AlertDialog — delete marketing video */}
      <AlertDialog open={videoDeleteConfirm} onOpenChange={open => { if (!open) setVideoDeleteConfirm(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{language === 'ar' ? 'حذف الفيديو التعريفي' : 'Delete Marketing Video'}</AlertDialogTitle>
            <AlertDialogDescription>
              {language === 'ar' ? 'سيتم حذف الفيديو التعريفي نهائياً ولا يمكن استرجاعه.' : 'The marketing video will be permanently deleted and cannot be recovered.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setVideoDeleteConfirm(false)}>{language === 'ar' ? 'إلغاء' : 'Cancel'}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (previewVideo) { removeVideoMut.mutate({ officeId: previewVideo.id }); setVideoDeleteConfirm(false); } }}
            >
              {language === 'ar' ? 'حذف الفيديو' : 'Delete Video'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
