/**
 * OfficeDetailDialog — the single shared admin action panel for all office
 * operations: approve, reject, request-changes, activate, suspend, reactivate,
 * document review, pending-changes review, media moderation (intake only),
 * admin notes, and the public-profile link.
 *
 * Used by both the Intake Queue (RegistrationRequests) and All Offices
 * (OfficesTable) views.  Feature flags control intake-only panels.
 */
import React, { useState } from 'react';
import { useI18n, categoriesMap, localizedCity } from '@/lib/i18n';
import { safeApiError } from '@/lib/apiError';
import {
  useGetAdminApplication,
  useApproveAdminApplication,
  useRejectAdminApplication,
  useRequestChangesAdminApplication,
  useActivateAdminApplication,
  useActivateAdminApplicationOverride,
  useSuspendAdminApplication,
  useReactivateAdminApplication,
  useReviewAdminApplicationDocument,
  useApproveAdminApplicationPendingChanges,
  useRejectAdminApplicationPendingChanges,
  useListAdminApplicationNotes,
  useAddAdminApplicationNote,
  getGetAdminApplicationQueryKey,
  getListAdminApplicationNotesQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { getOfficePublicUrl } from '@/lib/publicUrl';
import {
  CheckCircle2, XCircle, AlertTriangle, PlayCircle, PauseCircle, RotateCcw,
  FileText, StickyNote, Eye, FileEdit, ExternalLink, Building2,
} from 'lucide-react';

// ── Constants ────────────────────────────────────────────────────────────────

export const STATUS_META: Record<string, { tone: string; labelAr: string; labelEn: string }> = {
  draft:             { tone: 'bg-slate-100 text-slate-700 border-slate-200',       labelAr: 'مسودة',          labelEn: 'Draft' },
  under_review:      { tone: 'bg-blue-100 text-blue-700 border-blue-200',          labelAr: 'قيد المراجعة',   labelEn: 'Under Review' },
  changes_requested: { tone: 'bg-amber-100 text-amber-700 border-amber-200',       labelAr: 'مطلوب تعديلات', labelEn: 'Changes Requested' },
  approved:          { tone: 'bg-cyan-100 text-cyan-700 border-cyan-200',          labelAr: 'تمت الموافقة',  labelEn: 'Approved' },
  active:            { tone: 'bg-emerald-100 text-emerald-700 border-emerald-200', labelAr: 'نشط',            labelEn: 'Active' },
  rejected:          { tone: 'bg-red-100 text-red-700 border-red-200',             labelAr: 'مرفوض',          labelEn: 'Rejected' },
  suspended:         { tone: 'bg-orange-100 text-orange-700 border-orange-200',    labelAr: 'معلّق',          labelEn: 'Suspended' },
};

export const ACTIVATION_BLOCKER_LABELS: Record<string, { ar: string; en: string }> = {
  application_not_approved:       { ar: 'الطلب ليس في حالة "تمت الموافقة"',   en: 'Application not approved' },
  incomplete_required_info:       { ar: 'بيانات المكتب الأساسية غير مكتملة',  en: 'Required info incomplete' },
  missing_spoken_language:        { ar: 'لم يتم تحديد لغة تواصل',              en: 'No language selected' },
  missing_service:                { ar: 'لم تتم إضافة خدمة',                   en: 'No service added' },
  invalid_whatsapp:               { ar: 'رقم واتساب غير صالح',                  en: 'Invalid WhatsApp number' },
  identity_document_not_approved: { ar: 'مستند الهوية لم تتم الموافقة عليه',   en: 'ID document not approved' },
  trade_license_not_approved:     { ar: 'السجل التجاري لم تتم الموافقة عليه',  en: 'Trade license not approved' },
  email_not_verified:             { ar: 'البريد الإلكتروني غير موثّق',          en: 'Email address not verified' },
  phone_not_verified:             { ar: 'رقم الهاتف غير موثّق',                 en: 'Phone number not verified' },
};

// ── AdminMediaRejectButton ───────────────────────────────────────────────────
// Inline expandable reject button for media moderation panels.

function AdminMediaRejectButton({
  label,
  onReject,
}: {
  label: string;
  onReject: (reason: string) => Promise<void>;
}) {
  const { language } = useI18n();
  const [open, setOpen]     = useState(false);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  if (!open) {
    return (
      <Button size="sm" variant="destructive" className="text-xs px-2 py-1 h-auto" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-1 border rounded p-2 bg-background" style={{ minWidth: 180 }}>
      <Textarea
        value={reason}
        onChange={e => setReason(e.target.value)}
        placeholder={language === 'ar' ? 'السبب (اختياري)' : 'Reason (optional)'}
        className="min-h-[40px] text-xs"
      />
      <div className="flex gap-1 justify-end">
        <Button variant="ghost" size="sm" className="text-xs h-auto py-1"
          onClick={() => { setOpen(false); setReason(''); }}>
          {language === 'ar' ? 'إلغاء' : 'Cancel'}
        </Button>
        <Button size="sm" variant="destructive" className="text-xs h-auto py-1" disabled={loading}
          onClick={async () => {
            setLoading(true);
            try { await onReject(reason); } finally { setLoading(false); setOpen(false); }
          }}>
          {loading ? '...' : (language === 'ar' ? 'تأكيد' : 'Confirm')}
        </Button>
      </div>
    </div>
  );
}

// ── OfficeDetailDialog ───────────────────────────────────────────────────────

export interface OfficeDetailDialogProps {
  /** The office/application ID to display, or null to hide the dialog. */
  officeId: number | null;
  onClose: () => void;
  /**
   * Called after any successful mutation so the parent view can invalidate
   * its own list query (applications list or offices list).
   */
  onMutationSuccess: () => void;
  /** Show missing-document warning — true for intake queue. */
  showMissingDocs?: boolean;
  /** Show pending media moderation panel. */
  showPendingMedia?: boolean;
}

export function OfficeDetailDialog({
  officeId,
  onClose,
  onMutationSuccess,
  showMissingDocs = false,
  showPendingMedia = false,
}: OfficeDetailDialogProps) {
  const { language } = useI18n();
  const { toast }    = useToast();
  const queryClient  = useQueryClient();

  // ── Local dialog state ──
  const [reasonDialog, setReasonDialog] = useState<'reject' | 'request-changes' | 'reject-pending-changes' | null>(null);
  const [reasonText, setReasonText]     = useState('');
  const [rejectDocId, setRejectDocId]   = useState<number | null>(null);
  const [docRejectReason, setDocRejectReason] = useState('');
  const [noteText, setNoteText]         = useState('');
  const [previewDoc, setPreviewDoc]     = useState<{ objectPath: string; documentType: string } | null>(null);
  const [approveUnreviewed, setApproveUnreviewed] = useState<{ officeId: number; count: number } | null>(null);
  const [activationOverride, setActivationOverride] = useState<{ officeId: number; blockers: string[] } | null>(null);

  // Reset form state whenever the selected office changes
  React.useEffect(() => {
    setReasonDialog(null); setReasonText('');
    setRejectDocId(null);  setDocRejectReason('');
    setNoteText('');
    setActivationOverride(null);
  }, [officeId]);

  // ── Data ──
  const { data: detail, isLoading: detailLoading } = useGetAdminApplication(
    officeId as number,
    { query: { enabled: officeId !== null, queryKey: getGetAdminApplicationQueryKey(officeId as number) } },
  );
  const { data: notes = [], isLoading: notesLoading } = useListAdminApplicationNotes(
    officeId as number,
    { query: { enabled: officeId !== null, queryKey: getListAdminApplicationNotesQueryKey(officeId as number) } },
  );

  // ── Invalidation helpers ──
  const invalidateDetail = () => {
    if (officeId !== null) {
      queryClient.invalidateQueries({ queryKey: getGetAdminApplicationQueryKey(officeId) });
    }
  };
  const invalidate = () => {
    invalidateDetail();
    onMutationSuccess();
  };
  const invalidateNotes = () => {
    if (officeId !== null) {
      queryClient.invalidateQueries({ queryKey: getListAdminApplicationNotesQueryKey(officeId) });
    }
  };

  // ── Error helpers ──
  const onErr = (err: any) =>
    toast({ title: language === 'ar' ? 'تعذّر تنفيذ الإجراء' : 'Action failed', description: safeApiError(err, language), variant: 'destructive' });

  const onActivationErr = (err: any) => {
    const blockers: string[] = err?.data?.blockers ?? [];
    if (blockers.length > 0) {
      toast({
        title: language === 'ar' ? 'تعذّر التفعيل' : 'Activation blocked',
        description: blockers.map(c => {
          const l = ACTIVATION_BLOCKER_LABELS[c];
          return `• ${l ? (language === 'ar' ? l.ar : l.en) : c}`;
        }).join('\n'),
        variant: 'destructive',
      });
      return;
    }
    onErr(err);
  };
  const onActivationOverrideErr = (err: any) => {
    if (err?.status === 409 || err?.data?.blockers) {
      setActivationOverride(null);
      invalidateDetail();
      toast({
        title: language === 'ar' ? 'تغيّرت موانع التفعيل' : 'Activation blockers changed',
        description: language === 'ar'
          ? 'راجع القائمة المحدّثة ثم أكّد مرة أخرى.'
          : 'Review the refreshed list before confirming again.',
        variant: 'destructive',
      });
      return;
    }
    onActivationErr(err);
  };

  // ── Mutations ──
  const approveMut     = useApproveAdminApplication({ mutation: { onSuccess: invalidate, onError: onErr } });
  const rejectMut      = useRejectAdminApplication({ mutation: {
    onSuccess: () => { invalidate(); setReasonDialog(null); setReasonText(''); },
    onError: onErr,
  }});
  const changesMut     = useRequestChangesAdminApplication({ mutation: {
    onSuccess: () => { invalidate(); setReasonDialog(null); setReasonText(''); },
    onError: onErr,
  }});
  const activateMut    = useActivateAdminApplication({ mutation: { onSuccess: invalidate, onError: onActivationErr } });
  const activateOverrideMut = useActivateAdminApplicationOverride({ mutation: {
    onSuccess: () => { invalidate(); setActivationOverride(null); },
    onError: onActivationOverrideErr,
  }});
  const suspendMut     = useSuspendAdminApplication({ mutation: { onSuccess: invalidate, onError: onErr } });
  const reactivateMut  = useReactivateAdminApplication({ mutation: { onSuccess: invalidate, onError: onActivationErr } });
  const reviewDocMut   = useReviewAdminApplicationDocument({ mutation: {
    onSuccess: () => { invalidate(); setRejectDocId(null); setDocRejectReason(''); },
    onError: onErr,
  }});
  const approvePendMut = useApproveAdminApplicationPendingChanges({ mutation: { onSuccess: invalidate, onError: onErr } });
  const rejectPendMut  = useRejectAdminApplicationPendingChanges({ mutation: {
    onSuccess: () => { invalidate(); setReasonDialog(null); setReasonText(''); },
    onError: onErr,
  }});
  const addNoteMut     = useAddAdminApplicationNote({ mutation: {
    onSuccess: () => { setNoteText(''); invalidateNotes(); },
    onError: onErr,
  }});

  // ── Helpers ──
  const statusLabel   = (s: string) => { const m = STATUS_META[s]; return m ? (language === 'ar' ? m.labelAr : m.labelEn) : s; };
  const categoryLabel = (c: string) => { const m = categoriesMap[c]; return m ? (language === 'ar' ? m.ar : m.en) : c; };

  const handleApprove = (id: number, docs: any[]) => {
    const unreviewed = docs.filter(d => d.status === 'pending').length;
    if (unreviewed > 0) { setApproveUnreviewed({ officeId: id, count: unreviewed }); return; }
    approveMut.mutate({ officeId: id });
  };

  const confirmReason = () => {
    if (!detail) return;
    if (reasonDialog === 'reject')                 rejectMut.mutate({ officeId: detail.id, data: { reason: reasonText } });
    else if (reasonDialog === 'reject-pending-changes') rejectPendMut.mutate({ officeId: detail.id, data: { reason: reasonText } });
    else                                           changesMut.mutate({ officeId: detail.id, data: { reason: reasonText } });
  };

  const handleActivate = () => {
    if (!detail) return;
    const blockers = detail.activationBlockers ?? [];
    if (blockers.length > 0) {
      setActivationOverride({ officeId: detail.id, blockers: [...blockers] });
      return;
    }
    activateMut.mutate({ officeId: detail.id });
  };

  // ── Render ──
  return (
    <>
      {/* ── Main detail dialog ── */}
      <Dialog open={officeId !== null} onOpenChange={open => { if (!open) onClose(); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{detail?.name || (language === 'ar' ? 'تفاصيل المكتب' : 'Office Details')}</DialogTitle>
            <DialogDescription>
              {detail && `${language === 'ar' ? 'الحالة: ' : 'Status: '}${statusLabel(detail.status)}`}
            </DialogDescription>
          </DialogHeader>

          {detailLoading || !detail ? (
            <div className="py-8 text-center text-muted-foreground">{language === 'ar' ? 'جاري التحميل...' : 'Loading...'}</div>
          ) : (
            <div className="space-y-5">

              {/* Company info */}
              <section>
                <h3 className="font-semibold text-sm mb-3 flex items-center gap-1.5">
                  <Building2 size={14} />{language === 'ar' ? 'بيانات الشركة' : 'Company Information'}
                </h3>
                <div className="grid grid-cols-2 gap-2 text-sm bg-muted/20 rounded-lg p-3">
                  <div><span className="text-muted-foreground">{language === 'ar' ? 'التصنيف: ' : 'Category: '}</span>{categoryLabel(detail.category)}</div>
                  <div><span className="text-muted-foreground">{language === 'ar' ? 'المدينة: ' : 'City: '}</span>{localizedCity(detail.city || '', language)}</div>
                  <div><span className="text-muted-foreground">{language === 'ar' ? 'الدولة: ' : 'Country: '}</span>{detail.country || '—'}</div>
                  <div><span className="text-muted-foreground">{language === 'ar' ? 'التخصص: ' : 'Specialization: '}</span>{detail.specialization || '—'}</div>
                  <div className="col-span-2"><span className="text-muted-foreground">{language === 'ar' ? 'البريد: ' : 'Email: '}</span>{detail.email}</div>
                  <div><span className="text-muted-foreground">WhatsApp: </span><span dir="ltr">{detail.whatsapp || '—'}</span></div>
                  <div><span className="text-muted-foreground">{language === 'ar' ? 'مكالمات: ' : 'Phone calls: '}</span>{detail.acceptsPhoneCalls ? (language === 'ar' ? 'نعم' : 'Yes') : (language === 'ar' ? 'لا' : 'No')}</div>
                  {(detail.spokenLanguages?.length || detail.customLanguages?.length) ? (
                    <div className="col-span-2">
                      <span className="text-muted-foreground">{language === 'ar' ? 'اللغات: ' : 'Languages: '}</span>
                      {[...(detail.spokenLanguages ?? []), ...(detail.customLanguages ?? [])].join('، ')}
                    </div>
                  ) : null}
                  {detail.shortDescription && (
                    <div className="col-span-2">
                      <span className="text-muted-foreground">{language === 'ar' ? 'الوصف المختصر: ' : 'Short desc: '}</span>{detail.shortDescription}
                    </div>
                  )}
                  {detail.description && (
                    <div className="col-span-2">
                      <span className="text-muted-foreground">{language === 'ar' ? 'الوصف: ' : 'Description: '}</span>
                      <span className="text-xs">{detail.description.slice(0, 200)}{detail.description.length > 200 ? '…' : ''}</span>
                    </div>
                  )}
                </div>
              </section>

              {/* Timeline */}
              <section>
                <h3 className="font-semibold text-sm mb-2">{language === 'ar' ? 'الجدول الزمني' : 'Timeline'}</h3>
                <div className="space-y-1.5 text-xs text-muted-foreground ps-3 border-s-2 border-border/50">
                  {detail.submittedAt && <p>📋 {language === 'ar' ? 'تم إرسال الطلب: ' : 'Submitted: '}{format(new Date(detail.submittedAt), 'yyyy-MM-dd HH:mm')}</p>}
                  {detail.reviewedAt  && <p>✅ {language === 'ar' ? 'تمت المراجعة: ' : 'Reviewed: '}{format(new Date(detail.reviewedAt), 'yyyy-MM-dd HH:mm')}</p>}
                  {detail.activatedAt && <p>🟢 {language === 'ar' ? 'تم التفعيل: ' : 'Activated: '}{format(new Date(detail.activatedAt), 'yyyy-MM-dd HH:mm')}</p>}
                  {(detail as any).changeRequestReason && (
                    <p className="text-amber-700">⚠️ {language === 'ar' ? 'سبب طلب التعديلات: ' : 'Changes requested: '}{(detail as any).changeRequestReason}</p>
                  )}
                  {(detail as any).rejectionReason && (
                    <p className="text-red-700">❌ {language === 'ar' ? 'سبب الرفض: ' : 'Rejection reason: '}{(detail as any).rejectionReason}</p>
                  )}
                </div>
              </section>

              {/* Missing documents warning (intake queue only) */}
              {showMissingDocs && detail.documents !== undefined && (() => {
                const hasId    = detail.documents.some(d => d.documentType === 'identity');
                const hasTrade = detail.documents.some(d => d.documentType === 'trade_license');
                if (hasId && hasTrade) return null;
                return (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    <p className="font-semibold mb-1">{language === 'ar' ? 'مستندات مفقودة' : 'Missing Documents'}</p>
                    {!hasId    && <p>• {language === 'ar' ? 'مستند الهوية غير مرفوع' : 'Identity document not uploaded'}</p>}
                    {!hasTrade && <p>• {language === 'ar' ? 'السجل التجاري غير مرفوع' : 'Trade license not uploaded'}</p>}
                  </div>
                );
              })()}

              {/* Documents */}
              <section>
                <Label className="mb-2 flex items-center gap-1.5 text-sm">
                  <FileText size={13} />{language === 'ar' ? 'مستندات التوثيق' : 'Verification Documents'}
                </Label>
                {(!detail.documents || detail.documents.length === 0) ? (
                  <p className="text-sm text-muted-foreground italic">{language === 'ar' ? 'لا توجد مستندات' : 'No documents'}</p>
                ) : (
                  <div className="space-y-2">
                    {detail.documents.map(doc => (
                      <div key={doc.id} className="rounded-md bg-muted/20 border px-3 py-2 text-sm flex items-center justify-between flex-wrap gap-2" data-testid={`row-document-${doc.id}`}>
                        <button type="button" className="flex items-center gap-2 hover:underline"
                          onClick={() => setPreviewDoc({ objectPath: doc.objectPath, documentType: doc.documentType })}>
                          <FileText size={13} />{doc.documentType}
                        </button>
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline" className={`text-xs ${
                            doc.status === 'approved' ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                            : doc.status === 'rejected' ? 'bg-red-100 text-red-700 border-red-200' : ''
                          }`}>
                            {doc.status === 'approved'
                              ? (language === 'ar' ? 'مقبول' : 'Approved')
                              : doc.status === 'rejected'
                                ? (language === 'ar' ? 'مرفوض' : 'Rejected')
                                : (language === 'ar' ? 'قيد المراجعة' : 'Pending')}
                          </Badge>
                          <Button size="icon" variant="ghost" className="h-6 w-6"
                            onClick={() => setPreviewDoc({ objectPath: doc.objectPath, documentType: doc.documentType })}
                            data-testid={`button-view-document-${doc.id}`}>
                            <Eye size={13} />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-6 w-6" asChild>
                            <a href={`/api/storage${doc.objectPath}`} download={doc.documentType} target="_blank" rel="noreferrer">
                              <ExternalLink size={13} />
                            </a>
                          </Button>
                          {doc.status !== 'approved' && (
                            <Button size="icon" variant="ghost" className="h-6 w-6 text-emerald-600"
                              title={language === 'ar' ? 'قبول' : 'Approve'}
                              onClick={() => reviewDocMut.mutate({ officeId: detail.id, documentId: doc.id, data: { status: 'approved' } })}
                              data-testid={`button-approve-document-${doc.id}`}>
                              <CheckCircle2 size={13} />
                            </Button>
                          )}
                          {doc.status !== 'rejected' && (
                            <Button size="icon" variant="ghost" className="h-6 w-6 text-red-600"
                              title={language === 'ar' ? 'رفض' : 'Reject'}
                              onClick={() => { setRejectDocId(doc.id); setDocRejectReason(''); }}
                              data-testid={`button-reject-document-${doc.id}`}>
                              <XCircle size={13} />
                            </Button>
                          )}
                        </div>
                        {rejectDocId === doc.id && (
                          <div className="w-full space-y-2 border rounded p-2 bg-background" data-testid={`panel-reject-document-${doc.id}`}>
                            <Textarea
                              value={docRejectReason}
                              onChange={e => setDocRejectReason(e.target.value)}
                              className="min-h-[60px] text-sm"
                              placeholder={language === 'ar' ? 'سبب الرفض (مطلوب)' : 'Rejection reason (required)'}
                              data-testid={`input-reject-document-reason-${doc.id}`}
                            />
                            <div className="flex gap-2 justify-end">
                              <Button variant="ghost" size="sm" onClick={() => setRejectDocId(null)}>
                                {language === 'ar' ? 'إلغاء' : 'Cancel'}
                              </Button>
                              <Button size="sm" variant="destructive"
                                disabled={!docRejectReason.trim() || reviewDocMut.isPending}
                                onClick={() => reviewDocMut.mutate({ officeId: detail.id, documentId: doc.id, data: { status: 'rejected', reviewNote: docRejectReason } })}
                                data-testid={`button-confirm-reject-document-${doc.id}`}>
                                {language === 'ar' ? 'تأكيد الرفض' : 'Confirm Reject'}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Pending changes */}
              {detail.pendingChanges && (
                <section className="border rounded-lg p-3 bg-amber-50 border-amber-200" data-testid="panel-pending-changes">
                  <Label className="flex items-center gap-1.5 text-amber-800 mb-2 text-sm">
                    <FileEdit size={13} />{language === 'ar' ? 'تعديل مقترح بانتظار المراجعة' : 'Proposed edit awaiting review'}
                  </Label>
                  <div className="grid grid-cols-2 gap-2 text-xs bg-white/60 rounded p-2 mb-2">
                    <div>{language === 'ar' ? 'الاسم المعتمد' : 'Approved name'}: <strong>{detail.name}</strong>{detail.nameAr ? ` / ${detail.nameAr}` : ''}</div>
                    <div>{language === 'ar' ? 'الاسم المقترح' : 'Proposed name'}: <strong>{String((detail.pendingChanges as any).name ?? '—')}</strong></div>
                    <div>{language === 'ar' ? 'الاسم العربي المقترح' : 'Proposed Arabic name'}: <strong>{String((detail.pendingChanges as any).nameAr ?? '—')}</strong></div>
                    <div>{language === 'ar' ? 'التصنيف المعتمد' : 'Approved category'}: <strong>{categoryLabel(detail.category)}</strong></div>
                    <div>{language === 'ar' ? 'التصنيف المقترح' : 'Proposed category'}: <strong>{(detail.pendingChanges as any).category ? categoryLabel(String((detail.pendingChanges as any).category)) : '—'}</strong></div>
                  </div>
                  <pre className="text-xs bg-white/60 rounded p-2 overflow-x-auto whitespace-pre-wrap" data-testid="text-pending-changes-json">
                    {JSON.stringify(detail.pendingChanges, null, 2)}
                  </pre>
                  <div className="flex gap-2 justify-end mt-2">
                    <Button size="sm" variant="destructive" onClick={() => setReasonDialog('reject-pending-changes')} data-testid="button-reject-pending-changes">
                      {language === 'ar' ? 'رفض التعديل' : 'Reject Edit'}
                    </Button>
                    <Button size="sm" onClick={() => approvePendMut.mutate({ officeId: detail.id })} disabled={approvePendMut.isPending} data-testid="button-approve-pending-changes">
                      {language === 'ar' ? 'قبول التعديل' : 'Approve Edit'}
                    </Button>
                  </div>
                </section>
              )}
              {detail.nameChangeHistory && detail.nameChangeHistory.length > 0 && (
                <section className="border rounded-lg p-3" data-testid="office-name-history">
                  <Label className="mb-2 block">{language === 'ar' ? 'سجل أسماء المكتب المعتمدة' : 'Approved office-name history'}</Label>
                  <div className="space-y-2 text-xs">
                    {detail.nameChangeHistory.map((item, index) => (
                      <div key={`${item.approvedAt}-${index}`} className="rounded bg-muted/30 p-2">
                        <strong>{item.previousName}</strong> → <strong>{item.newName}</strong>
                        <div className="text-muted-foreground">
                          {language === 'ar' ? 'طُلب:' : 'Requested:'} {format(new Date(item.requestedAt), 'yyyy-MM-dd HH:mm')}
                          {' · '}{language === 'ar' ? 'اعتمد:' : 'Approved:'} {format(new Date(item.approvedAt), 'yyyy-MM-dd HH:mm')}
                          {' · '}Admin #{item.approvingAdminId ?? '—'}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Pending media review (intake queue only) */}
              {showPendingMedia && (() => {
                const pendingQC: string | null         = (detail as any).pendingQuickCardCoverUrl ?? null;
                const pendingQCReason: string | null   = (detail as any).pendingMediaRejectionReason ?? null;
                const pendingGallery: Array<{ id: number; url: string; type: string }>    = (detail as any).pendingGalleryItems  ?? [];
                const pendingDCCovers: Array<{ id: number; url: string; type: string }>   = (detail as any).pendingDecisionCardCovers ?? [];
                const pendingWorks: Array<{ id: number; url: string; type: string }>      = (detail as any).pendingWorksItems ?? [];
                const hasPendingMedia = pendingQC || pendingGallery.length > 0 || pendingDCCovers.length > 0 || pendingWorks.length > 0;
                if (!hasPendingMedia) return null;

                return (
                  <section className="border rounded-lg p-3 bg-sky-50 border-sky-200 space-y-4" data-testid="panel-pending-media">
                    <Label className="flex items-center gap-1.5 text-sky-800 text-sm">
                      {language === 'ar' ? 'وسائط معلقة بانتظار المراجعة' : 'Pending media awaiting review'}
                    </Label>

                    {/* Quick Card Cover */}
                    {pendingQC && (
                      <div className="space-y-2" data-testid="panel-pending-quick-card-cover">
                        <p className="text-xs font-medium text-muted-foreground">{language === 'ar' ? 'صورة البطاقة السريعة' : 'Quick Card Cover'}</p>
                        <div className="flex flex-wrap items-start gap-4">
                          <img src={`/api/storage${pendingQC}`} alt="Pending quick card cover" className="h-24 w-40 object-cover rounded-lg border shadow-sm" />
                          <div className="flex flex-col gap-2">
                            {pendingQCReason && <p className="text-xs text-red-700">{language === 'ar' ? 'سبب الرفض السابق: ' : 'Previous rejection: '}{pendingQCReason}</p>}
                            <div className="flex gap-2">
                              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                                data-testid="button-approve-quick-card-cover"
                                onClick={async () => {
                                  const res = await (await import('@/lib/sessionToken')).authFetch(`/api/admin/applications/${detail.id}/media/quick-card-cover/approve`, { method: 'POST' });
                                  if (res.ok) { invalidate(); }
                                }}>
                                {language === 'ar' ? 'قبول' : 'Approve'}
                              </Button>
                              <AdminMediaRejectButton
                                label={language === 'ar' ? 'رفض' : 'Reject'}
                                onReject={async (reason) => {
                                  const res = await (await import('@/lib/sessionToken')).authFetch(
                                    `/api/admin/applications/${detail.id}/media/quick-card-cover/reject`,
                                    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) },
                                  );
                                  if (res.ok) { invalidate(); }
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Decision Card Covers */}
                    {pendingDCCovers.length > 0 && (
                      <div className="space-y-2" data-testid="panel-pending-dc-covers">
                        <p className="text-xs font-medium text-muted-foreground">{language === 'ar' ? 'صور غلاف بطاقة القرار' : 'Decision Card Hero Images'}</p>
                        <div className="flex flex-wrap gap-3">
                          {pendingDCCovers.map(item => (
                            <div key={item.id} className="space-y-1.5" data-testid={`panel-pending-dc-cover-${item.id}`}>
                              <img src={`/api/storage${item.url}`} alt="Pending DC cover" className="h-20 w-32 object-cover rounded-lg border shadow-sm" />
                              <div className="flex gap-1">
                                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-2 py-1 h-auto"
                                  data-testid={`button-approve-dc-cover-${item.id}`}
                                  onClick={async () => {
                                    const res = await (await import('@/lib/sessionToken')).authFetch(`/api/admin/applications/${detail.id}/media/${item.id}/approve`, { method: 'POST' });
                                    if (res.ok) { invalidate(); }
                                  }}>
                                  {language === 'ar' ? 'قبول' : 'Approve'}
                                </Button>
                                <AdminMediaRejectButton
                                  label={language === 'ar' ? 'رفض' : 'Reject'}
                                  onReject={async (reason) => {
                                    const res = await (await import('@/lib/sessionToken')).authFetch(
                                      `/api/admin/applications/${detail.id}/media/${item.id}/reject`,
                                      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) },
                                    );
                                    if (res.ok) { invalidate(); }
                                  }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Works portfolio images */}
                    {pendingWorks.length > 0 && (
                      <div className="space-y-2" data-testid="panel-pending-works">
                        <p className="text-xs font-medium text-muted-foreground">
                          {language === 'ar' ? 'صور الأعمال' : 'Works / Portfolio Images'}
                        </p>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {pendingWorks.map(item => (
                            <div key={item.id} className="space-y-2 rounded-lg border bg-background p-2" data-testid={`panel-pending-works-${item.id}`}>
                              <img src={`/api/storage${item.url}`} alt={language === 'ar' ? 'عمل بانتظار المراجعة' : 'Pending work'} className="aspect-[4/3] w-full rounded-md border object-cover shadow-sm" />
                              <div className="flex flex-wrap gap-1.5">
                                <Button size="sm" className="h-auto bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-700"
                                  data-testid={`button-approve-works-${item.id}`}
                                  onClick={async () => {
                                    const res = await (await import('@/lib/sessionToken')).authFetch(`/api/admin/applications/${detail.id}/media/${item.id}/approve`, { method: 'POST' });
                                    if (res.ok) { invalidate(); }
                                  }}>
                                  {language === 'ar' ? 'قبول' : 'Approve'}
                                </Button>
                                <AdminMediaRejectButton
                                  label={language === 'ar' ? 'رفض' : 'Reject'}
                                  onReject={async (reason) => {
                                    const res = await (await import('@/lib/sessionToken')).authFetch(
                                      `/api/admin/applications/${detail.id}/media/${item.id}/reject`,
                                      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) },
                                    );
                                    if (res.ok) { invalidate(); }
                                  }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Gallery items */}
                    {pendingGallery.length > 0 && (
                      <div className="space-y-2" data-testid="panel-pending-gallery">
                        <p className="text-xs font-medium text-muted-foreground">{language === 'ar' ? 'صور معرض الأعمال' : 'Gallery Images'}</p>
                        <div className="flex flex-wrap gap-3">
                          {pendingGallery.map(item => (
                            <div key={item.id} className="space-y-1.5" data-testid={`panel-pending-gallery-${item.id}`}>
                              <img src={`/api/storage${item.url}`} alt="Pending gallery" className="h-20 w-32 object-cover rounded-lg border shadow-sm" />
                              <div className="flex gap-1">
                                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-2 py-1 h-auto"
                                  data-testid={`button-approve-gallery-${item.id}`}
                                  onClick={async () => {
                                    const res = await (await import('@/lib/sessionToken')).authFetch(`/api/admin/applications/${detail.id}/media/${item.id}/approve`, { method: 'POST' });
                                    if (res.ok) { invalidate(); }
                                  }}>
                                  {language === 'ar' ? 'قبول' : 'Approve'}
                                </Button>
                                <AdminMediaRejectButton
                                  label={language === 'ar' ? 'رفض' : 'Reject'}
                                  onReject={async (reason) => {
                                    const res = await (await import('@/lib/sessionToken')).authFetch(
                                      `/api/admin/applications/${detail.id}/media/${item.id}/reject`,
                                      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) },
                                    );
                                    if (res.ok) { invalidate(); }
                                  }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </section>
                );
              })()}

              {/* Activation blockers */}
              {(detail.status === 'approved' || detail.status === 'suspended' || detail.status === 'active') && (detail.activationBlockers?.length ?? 0) > 0 && (
                <section className="border rounded-lg p-3 bg-red-50 border-red-200" data-testid="banner-activation-blockers">
                  <p className="font-semibold text-red-800 text-sm flex items-center gap-1.5 mb-2">
                    <AlertTriangle size={14} />
                    {detail.status === 'suspended'
                      ? (language === 'ar' ? 'موانع إعادة التفعيل' : 'Reactivation blockers')
                      : detail.status === 'active'
                        ? (language === 'ar' ? 'متطلبات تفعيل غير محلولة' : 'Unresolved activation requirements')
                      : (language === 'ar' ? 'موانع التفعيل' : 'Activation blockers')}
                  </p>
                  <ul className="list-disc list-inside text-sm text-red-700 space-y-1">
                    {detail.activationBlockers?.map(c => {
                      const l = ACTIVATION_BLOCKER_LABELS[c];
                      return <li key={c} data-testid={`activation-blocker-${c}`}>{l ? (language === 'ar' ? l.ar : l.en) : c}</li>;
                    })}
                  </ul>
                </section>
              )}

              {/* Inline reason/rejection text input */}
              {reasonDialog && (
                <section className="border rounded-lg p-3 bg-muted/20 space-y-2">
                  <Label>
                    {reasonDialog === 'reject'
                      ? (language === 'ar' ? 'سبب الرفض' : 'Rejection reason')
                      : reasonDialog === 'reject-pending-changes'
                        ? (language === 'ar' ? 'سبب رفض التعديل' : 'Reason for rejecting edit')
                        : (language === 'ar' ? 'التعديلات المطلوبة' : 'Changes required')}
                  </Label>
                  <Textarea
                    value={reasonText}
                    onChange={e => setReasonText(e.target.value)}
                    className="min-h-[80px]"
                    data-testid="input-reason"
                  />
                  <div className="flex gap-2 justify-end">
                    <Button variant="ghost" size="sm" onClick={() => { setReasonDialog(null); setReasonText(''); }}>
                      {language === 'ar' ? 'إلغاء' : 'Cancel'}
                    </Button>
                    <Button size="sm" variant="destructive" disabled={!reasonText.trim()} onClick={confirmReason} data-testid="button-confirm-reason">
                      {language === 'ar' ? 'تأكيد' : 'Confirm'}
                    </Button>
                  </div>
                </section>
              )}

              {/* Admin notes */}
              <section>
                <Label className="mb-2 flex items-center gap-1.5 text-sm">
                  <StickyNote size={13} />{language === 'ar' ? 'ملاحظات إدارية داخلية' : 'Internal Admin Notes'}
                </Label>
                <p className="text-xs text-muted-foreground mb-2">{language === 'ar' ? 'مرئية لفريق الإدارة فقط.' : 'Only visible to admin team.'}</p>
                {notesLoading
                  ? <p className="text-sm text-muted-foreground">{language === 'ar' ? 'جاري التحميل...' : 'Loading...'}</p>
                  : notes.length > 0
                    ? (
                      <div className="space-y-1.5 mb-3">
                        {notes.map(n => (
                          <div key={n.id} className="bg-muted/30 rounded px-3 py-2 text-sm" data-testid={`row-admin-note-${n.id}`}>
                            <p>{n.note}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {format(new Date(n.createdAt), 'yyyy-MM-dd HH:mm')}{n.createdByName ? ` · ${n.createdByName}` : ''}
                            </p>
                          </div>
                        ))}
                      </div>
                    )
                    : <p className="text-sm text-muted-foreground italic mb-3">{language === 'ar' ? 'لا توجد ملاحظات بعد.' : 'No notes yet.'}</p>
                }
                <div className="flex gap-2">
                  <Textarea
                    value={noteText}
                    onChange={e => setNoteText(e.target.value)}
                    placeholder={language === 'ar' ? 'أضف ملاحظة داخلية...' : 'Add internal note...'}
                    className="min-h-[40px] text-sm flex-1"
                    data-testid="input-admin-note"
                  />
                  <Button size="sm" disabled={!noteText.trim() || addNoteMut.isPending}
                    onClick={() => addNoteMut.mutate({ officeId: detail.id, data: { note: noteText } })}
                    data-testid="button-add-admin-note">
                    {language === 'ar' ? 'إضافة' : 'Add'}
                  </Button>
                </div>
              </section>

              {/* Action buttons */}
              <div className="flex flex-wrap gap-2 justify-end border-t pt-4">
                {detail.slug && (
                  <Button size="sm" variant="outline" asChild className="gap-1">
                    <a href={getOfficePublicUrl(detail.slug, language)} target="_blank" rel="noreferrer">
                      <ExternalLink size={13} />{language === 'ar' ? 'معاينة الملف العام' : 'View Public Preview'}
                    </a>
                  </Button>
                )}
                {detail.status === 'under_review' && (
                  <>
                    <Button size="sm" onClick={() => handleApprove(detail.id, detail.documents ?? [])} className="gap-1" data-testid="button-approve">
                      <CheckCircle2 size={13} />{language === 'ar' ? 'موافقة' : 'Approve'}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setReasonDialog('request-changes')} className="gap-1" data-testid="button-request-changes">
                      <AlertTriangle size={13} />{language === 'ar' ? 'طلب تعديلات' : 'Request Changes'}
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => setReasonDialog('reject')} className="gap-1" data-testid="button-reject">
                      <XCircle size={13} />{language === 'ar' ? 'رفض' : 'Reject'}
                    </Button>
                  </>
                )}
                {detail.status === 'approved' && (
                  (detail.activationBlockers?.length ?? 0) > 0
                    ? <Button size="sm" variant="destructive"
                        onClick={handleActivate}
                        disabled={activateOverrideMut.isPending}
                        className="gap-1" data-testid="button-activate-override">
                        <PlayCircle size={13} />{language === 'ar' ? 'تفعيل استثنائي' : 'Activate with Override'}
                      </Button>
                    : <Button size="sm"
                        onClick={handleActivate}
                        disabled={activateMut.isPending}
                        className="gap-1" data-testid="button-activate">
                        <PlayCircle size={13} />{language === 'ar' ? 'تفعيل المكتب' : 'Activate Office'}
                      </Button>
                )}
                {detail.status === 'active' && (
                  <Button size="sm" variant="destructive"
                    onClick={() => suspendMut.mutate({ officeId: detail.id })}
                    className="gap-1" data-testid="button-suspend">
                    <PauseCircle size={13} />{language === 'ar' ? 'تعليق المكتب' : 'Suspend'}
                  </Button>
                )}
                {detail.status === 'suspended' && (
                  <Button size="sm"
                    onClick={() => reactivateMut.mutate({ officeId: detail.id })}
                    disabled={reactivateMut.isPending || (detail.activationBlockers?.length ?? 0) > 0}
                    className="gap-1" data-testid="button-reactivate">
                    <RotateCcw size={13} />{language === 'ar' ? 'إعادة التفعيل' : 'Reactivate'}
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Document preview dialog */}
      <Dialog open={previewDoc !== null} onOpenChange={open => { if (!open) setPreviewDoc(null); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto" data-testid="dialog-document-preview">
          <DialogHeader><DialogTitle>{previewDoc?.documentType}</DialogTitle></DialogHeader>
          {previewDoc && (
            /\.pdf$/i.test(previewDoc.objectPath)
              ? <iframe src={`/api/storage${previewDoc.objectPath}`} className="w-full h-[70vh] rounded border" title={previewDoc.documentType} data-testid="preview-document-pdf" />
              : <img src={`/api/storage${previewDoc.objectPath}`} alt={previewDoc.documentType} className="w-full max-h-[70vh] object-contain rounded border" data-testid="preview-document-image" />
          )}
          <div className="flex justify-end">
            <Button asChild variant="outline" size="sm">
              <a href={`/api/storage${previewDoc?.objectPath}`} target="_blank" rel="noreferrer">
                {language === 'ar' ? 'فتح في تبويب جديد' : 'Open in new tab'}
              </a>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* AlertDialog — approve with unreviewed documents */}
      <AlertDialog open={approveUnreviewed !== null} onOpenChange={open => { if (!open) setApproveUnreviewed(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {language === 'ar' ? 'الموافقة مع وجود مستندات غير مراجَعة' : 'Approve with Unreviewed Documents'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {language === 'ar'
                ? `يوجد ${approveUnreviewed?.count ?? 0} مستند لم تتم مراجعته. هل تريد الموافقة على الطلب رغم ذلك؟`
                : `${approveUnreviewed?.count ?? 0} document(s) are still under review. Approve the application anyway?`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setApproveUnreviewed(null)}>
              {language === 'ar' ? 'إلغاء' : 'Cancel'}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (approveUnreviewed) {
                  approveMut.mutate({ officeId: approveUnreviewed.officeId });
                  setApproveUnreviewed(null);
                }
              }}
            >
              {language === 'ar' ? 'موافقة رغم ذلك' : 'Approve Anyway'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* AlertDialog — explicit admin confirmation for activation override */}
      <AlertDialog open={activationOverride !== null} onOpenChange={open => { if (!open) setActivationOverride(null); }}>
        <AlertDialogContent data-testid="dialog-activation-override">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {language === 'ar' ? 'تأكيد التفعيل الاستثنائي' : 'Confirm activation override'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {language === 'ar'
                ? 'سيتم تفعيل المكتب مع إبقاء المتطلبات غير المحلولة كما هي. راجع الموانع التالية قبل التأكيد:'
                : 'The office will be activated while these requirements remain unresolved. Review every blocker before confirming:'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="list-disc list-inside rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 space-y-1" data-testid="activation-override-blockers">
            {activationOverride?.blockers.map(code => {
              const label = ACTIVATION_BLOCKER_LABELS[code];
              return (
                <li key={code} data-testid={`activation-override-blocker-${code}`}>
                  {label ? (language === 'ar' ? label.ar : label.en) : code}{' '}
                  <code className="text-xs">({code})</code>
                </li>
              );
            })}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setActivationOverride(null)}>
              {language === 'ar' ? 'إلغاء' : 'Cancel'}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={activateOverrideMut.isPending}
              onClick={() => {
                if (activationOverride) {
                  activateOverrideMut.mutate({
                    officeId: activationOverride.officeId,
                    data: {
                      confirm: true,
                      expectedBlockers: activationOverride.blockers,
                    },
                  });
                }
              }}
              data-testid="button-confirm-activation-override">
              {activateOverrideMut.isPending
                ? '...'
                : (language === 'ar' ? 'تأكيد التفعيل الاستثنائي' : 'Confirm Override Activation')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
