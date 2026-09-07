/**
 * RegistrationRequests — the Intake Queue view.
 *
 * Owns: list fetch + status filters + row rendering.
 * All office actions (approve, reject, request-changes, activate, suspend,
 * reactivate, document review, pending changes, media moderation, admin notes)
 * are handled exclusively by OfficeDetailDialog — zero duplicated action code.
 */
import React, { useState } from 'react';
import { useI18n, categoriesMap, localizedCity } from '@/lib/i18n';
import {
  useListAdminApplications,
  getListAdminApplicationsQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format } from 'date-fns';
import { ClipboardList, Eye, FileEdit, Images } from 'lucide-react';
import { OfficeDetailDialog } from './OfficeDetailDialog';

const STATUS_META: Record<string, { tone: string; labelAr: string; labelEn: string }> = {
  draft:             { tone: 'bg-slate-100 text-slate-700 border-slate-200',       labelAr: 'مسودة',          labelEn: 'Draft' },
  under_review:      { tone: 'bg-blue-100 text-blue-700 border-blue-200',          labelAr: 'قيد المراجعة',   labelEn: 'Under Review' },
  changes_requested: { tone: 'bg-amber-100 text-amber-700 border-amber-200',       labelAr: 'مطلوب تعديلات', labelEn: 'Changes Requested' },
  approved:          { tone: 'bg-cyan-100 text-cyan-700 border-cyan-200',          labelAr: 'تمت الموافقة',  labelEn: 'Approved' },
  active:            { tone: 'bg-emerald-100 text-emerald-700 border-emerald-200', labelAr: 'نشط',            labelEn: 'Active' },
  rejected:          { tone: 'bg-red-100 text-red-700 border-red-200',             labelAr: 'مرفوض',          labelEn: 'Rejected' },
  suspended:         { tone: 'bg-orange-100 text-orange-700 border-orange-200',    labelAr: 'معلّق',          labelEn: 'Suspended' },
};

const FILTER_OPTIONS = [
  { value: undefined,           labelAr: 'الكل',            labelEn: 'All' },
  { value: 'pending_edits',     labelAr: 'تعديلات معلقة',  labelEn: 'Pending Edits' },
  { value: 'pending_works',     labelAr: 'أعمال معلقة',    labelEn: 'Pending Works' },
  { value: 'under_review',      labelAr: 'قيد المراجعة',    labelEn: 'Under Review' },
  { value: 'changes_requested', labelAr: 'مطلوب تعديلات',  labelEn: 'Changes Requested' },
  { value: 'approved',          labelAr: 'تمت الموافقة',   labelEn: 'Approved' },
  { value: 'active',            labelAr: 'نشط',             labelEn: 'Active' },
  { value: 'rejected',          labelAr: 'مرفوض',           labelEn: 'Rejected' },
  { value: 'suspended',         labelAr: 'معلّق',           labelEn: 'Suspended' },
];

export function RegistrationRequestsSection() {
  const { language } = useI18n();
  const queryClient  = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [selectedId, setSelectedId]     = useState<number | null>(null);

  // 'pending_edits' is a synthetic client-side filter — no matching API status.
  const isPendingEditsFilter = statusFilter === 'pending_edits';
  const isPendingWorksFilter = statusFilter === 'pending_works';
  const { data: rawApplications = [], isLoading } = useListAdminApplications(
    (!statusFilter || isPendingEditsFilter || isPendingWorksFilter) ? undefined : { status: statusFilter as any },
  );
  const applications = isPendingEditsFilter
    ? rawApplications.filter(a => !!(a as any).pendingChangesSubmittedAt)
    : isPendingWorksFilter
      ? rawApplications.filter(a => ((a as any).pendingWorksCount ?? 0) > 0)
      : rawApplications;

  const statusLabel   = (s: string) => { const m = STATUS_META[s]; return m ? (language === 'ar' ? m.labelAr : m.labelEn) : s; };
  const categoryLabel = (c: string) => { const m = categoriesMap[c]; return m ? (language === 'ar' ? m.ar : m.en) : c; };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2">
          <ClipboardList size={20} />
          {language === 'ar' ? 'طلبات التسجيل' : 'Registration Requests'}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          {language === 'ar'
            ? 'مراجعة طلبات المكاتب الجديدة والموافقة عليها أو رفضها'
            : 'Review, approve, or reject office registration applications'}
        </p>
      </div>

      {/* Status filters */}
      <div className="flex items-center gap-2 flex-wrap">
        {FILTER_OPTIONS.map(opt => (
          <Button
            key={opt.labelEn}
            size="sm"
            variant={statusFilter === opt.value ? 'default' : 'outline'}
            onClick={() => setStatusFilter(opt.value)}
            data-testid={`filter-status-${opt.value ?? 'all'}`}
          >
            {language === 'ar' ? opt.labelAr : opt.labelEn}
          </Button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead>{language === 'ar' ? 'المكتب' : 'Office'}</TableHead>
                <TableHead className="hidden sm:table-cell">{language === 'ar' ? 'التخصص / المدينة' : 'Category / City'}</TableHead>
                <TableHead className="hidden md:table-cell">{language === 'ar' ? 'النوع' : 'Type'}</TableHead>
                <TableHead className="hidden md:table-cell">{language === 'ar' ? 'تاريخ الإرسال' : 'Submitted'}</TableHead>
                <TableHead>{language === 'ar' ? 'الحالة' : 'Status'}</TableHead>
                <TableHead className="text-end">{language === 'ar' ? 'إجراءات' : 'Actions'}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    {language === 'ar' ? 'جاري التحميل...' : 'Loading...'}
                  </TableCell>
                </TableRow>
              ) : applications.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground italic">
                    {language === 'ar' ? 'لا توجد طلبات مطابقة' : 'No matching applications'}
                  </TableCell>
                </TableRow>
              ) : applications.map(app => {
                const sm = STATUS_META[app.status] ?? STATUS_META.draft;
                return (
                  <TableRow key={app.id} data-testid={`row-application-${app.id}`}>
                    <TableCell className="font-medium">
                      {app.name}
                      <div className="mt-1 flex items-center gap-1 sm:hidden flex-wrap">
                        <Badge variant="secondary" className="text-[10px]">{categoryLabel(app.category)}</Badge>
                        <span className="text-[10px] text-muted-foreground">{localizedCity(app.city || '', language)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <div className="flex flex-col gap-0.5">
                        <Badge variant="secondary" className="text-xs w-fit">{categoryLabel(app.category)}</Badge>
                        <span className="text-xs text-muted-foreground">{localizedCity(app.city || '', language)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Badge variant="outline" className="text-[11px] border-border/60">
                        {(app as any).providerType === 'freelancer'
                          ? (language === 'ar' ? 'مستقل' : 'Freelancer')
                          : (language === 'ar' ? 'مكتب' : 'Office')}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                      {app.submittedAt ? format(new Date(app.submittedAt), 'yyyy-MM-dd') : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge variant="outline" className={`text-xs ${sm.tone}`}>{statusLabel(app.status)}</Badge>
                        {(app as any).pendingChangesSubmittedAt && (
                          <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200 gap-1">
                            <FileEdit size={10} />{language === 'ar' ? 'تعديل معلّق' : 'Pending edit'}
                          </Badge>
                        )}
                        {((app as any).pendingWorksCount ?? 0) > 0 && (
                          <Badge variant="outline" className="gap-1 border-sky-200 bg-sky-50 text-xs text-sky-700">
                            <Images size={10} />
                            {language === 'ar'
                              ? `${(app as any).pendingWorksCount} أعمال معلقة`
                              : `${(app as any).pendingWorksCount} pending works`}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-end">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSelectedId(app.id)}
                        data-testid={`button-view-application-${app.id}`}
                        className="gap-1"
                      >
                        <Eye size={13} />{language === 'ar' ? 'مراجعة' : 'Review'}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Shared action dialog — handles all mutations, documents, media, notes */}
      <OfficeDetailDialog
        officeId={selectedId}
        onClose={() => setSelectedId(null)}
        onMutationSuccess={() =>
          queryClient.invalidateQueries({ queryKey: getListAdminApplicationsQueryKey() })
        }
        showMissingDocs
        showPendingMedia
      />
    </div>
  );
}
