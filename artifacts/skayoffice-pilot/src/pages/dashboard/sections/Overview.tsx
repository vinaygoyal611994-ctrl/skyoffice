import React from 'react';
import { useI18n } from '@/lib/i18n';
import { getOfficePublicUrl } from '@/lib/publicUrl';
import { useGetMyOffice, useListMyOfficeDocuments, useListMyOfficeVideoCallRequests, useVerificationStatus } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import {
  AlertTriangle, CheckCircle2, Clock, XCircle, ExternalLink,
  ImagePlus, MessageSquare, Globe, FileText, Video, FilePenLine,
  ChevronRight, ShieldCheck, Send, Hourglass,
} from 'lucide-react';
import { EmailVerificationBanner } from '@/components/account/EmailVerificationBanner';
import { PhoneVerificationBanner } from '@/components/account/PhoneVerificationBanner';

const STATUS_META: Record<string, { tone: string; icon: React.ReactNode; labelKey: string }> = {
  draft: { labelKey: 'dashboard.status.draft', tone: 'bg-slate-100 text-slate-700 border-slate-200', icon: <FileText size={14} /> },
  under_review: { labelKey: 'dashboard.status.under_review', tone: 'bg-blue-100 text-blue-700 border-blue-200', icon: <Clock size={14} /> },
  changes_requested: { labelKey: 'dashboard.status.changes_requested', tone: 'bg-amber-100 text-amber-800 border-amber-200', icon: <AlertTriangle size={14} /> },
  approved: { labelKey: 'dashboard.status.approved', tone: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: <CheckCircle2 size={14} /> },
  active: { labelKey: 'dashboard.status.active', tone: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: <CheckCircle2 size={14} /> },
  rejected: { labelKey: 'dashboard.status.rejected', tone: 'bg-red-100 text-red-700 border-red-200', icon: <XCircle size={14} /> },
  suspended: { labelKey: 'dashboard.status.suspended', tone: 'bg-red-100 text-red-700 border-red-200', icon: <XCircle size={14} /> },
};

interface ActionItem {
  id: string;
  priority: 'high' | 'medium' | 'low';
  titleKey: string;
  descKey: string;
  section: string;
  icon: React.ReactNode;
}

interface OverviewProps {
  navigate: (section: string) => void;
}

export function OverviewSection({ navigate }: OverviewProps) {
  const { t, language } = useI18n();
  const { data: office, isLoading } = useGetMyOffice();
  const { data: documents, isLoading: docsLoading } = useListMyOfficeDocuments();
  const { data: videoRequests } = useListMyOfficeVideoCallRequests();
  const { data: verificationStatus, refetch: refetchVerification } = useVerificationStatus();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    );
  }

  if (!office) return null;

  // Compute profile completion (10 fields × 10%)
  const completionItems = [
    { key: 'name', done: !!office.name },
    { key: 'city', done: !!office.city },
    { key: 'shortDescription', done: !!office.shortDescription },
    { key: 'whatsapp', done: !!office.whatsapp },
    { key: 'gallery', done: !!(office.gallery && office.gallery.length > 0) },
    { key: 'spokenLanguages', done: !!(office.spokenLanguages && office.spokenLanguages.length > 0) },
    { key: 'services', done: !!(office.services && office.services.length > 0) },
    { key: 'description', done: !!office.description },
    { key: 'googleMapsUrl', done: !!office.googleMapsUrl },
  ];
  const completedCount = completionItems.filter(i => i.done).length;
  const completionPct = Math.round((completedCount / completionItems.length) * 100);

  const statusMeta = STATUS_META[office.status] || STATUS_META.draft;
  const hasPendingChanges = !!office.pendingChanges;
  const newVideoRequests = videoRequests?.filter(r => r.status === 'new') || [];
  const rejectedDocs = documents?.filter(d => d.status === 'rejected') || [];

  // Build action items
  const actions: ActionItem[] = [];

  if (office.status === 'draft' || office.status === 'changes_requested') {
    if (completionPct >= 60) {
      actions.push({
        id: 'submit',
        priority: 'high',
        titleKey: 'dash.action.submit_application',
        descKey: 'dash.action.submit_application_desc',
        section: 'profile',
        icon: <Send size={18} className="text-emerald-600" />,
      });
    }
  }

  if (rejectedDocs.length > 0) {
    actions.push({
      id: 'rejected_docs',
      priority: 'high',
      titleKey: 'dash.action.rejected_document',
      descKey: 'dash.action.rejected_document_desc',
      section: 'documents',
      icon: <AlertTriangle size={18} className="text-red-500" />,
    });
  }

  if (newVideoRequests.length > 0) {
    actions.push({
      id: 'video_requests',
      priority: 'medium',
      titleKey: 'dash.action.new_video_requests',
      descKey: 'dash.action.new_video_requests_desc',
      section: 'requests',
      icon: <Video size={18} className="text-blue-500" />,
    });
  }

  if (hasPendingChanges) {
    actions.push({
      id: 'pending_changes',
      priority: 'medium',
      titleKey: 'dash.action.pending_changes',
      descKey: 'dash.action.pending_changes_desc',
      section: 'profile',
      icon: <FilePenLine size={18} className="text-amber-500" />,
    });
  }

  if (!office.whatsapp) {
    actions.push({
      id: 'missing_whatsapp',
      priority: 'medium',
      titleKey: 'dash.action.missing_whatsapp',
      descKey: 'dash.action.missing_whatsapp_desc',
      section: 'profile',
      icon: <MessageSquare size={18} className="text-slate-400" />,
    });
  }

  if (!office.spokenLanguages || office.spokenLanguages.length === 0) {
    actions.push({
      id: 'missing_languages',
      priority: 'low',
      titleKey: 'dash.action.missing_languages',
      descKey: 'dash.action.missing_languages_desc',
      section: 'profile',
      icon: <Globe size={18} className="text-slate-400" />,
    });
  }

  if (!office.gallery || office.gallery.length === 0) {
    actions.push({
      id: 'missing_images',
      priority: 'low',
      titleKey: 'dash.action.missing_images',
      descKey: 'dash.action.missing_images_desc',
      section: 'media',
      icon: <ImagePlus size={18} className="text-slate-400" />,
    });
  }

  const priorityOrder = { high: 0, medium: 1, low: 2 };
  actions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  const publicUrl = office.slug ? getOfficePublicUrl(office.slug, language) : null;

  // Slot state — derived from typed fields (isSubscriptionHidden, slotStatus,
  // reservationExpiresAt) added by the office serializer. No `as any` needed.
  const isSlotWaiting = office.isSubscriptionHidden === true
    && (office.status === 'approved' || office.status === 'active')
    && office.slotStatus === 'waiting';

  const isSlotReserved = office.slotStatus === 'reserved'
    && office.reservationExpiresAt != null;

  const reservationExpiresAt = office.reservationExpiresAt
    ? new Date(office.reservationExpiresAt)
    : null;

  return (
    <div className="space-y-5">

      {/* Contact verification remains mandatory until each channel is confirmed. */}
      {verificationStatus && !verificationStatus.emailVerified && (
        <EmailVerificationBanner onVerified={refetchVerification} />
      )}
      {verificationStatus && !verificationStatus.phoneVerified && (
        <PhoneVerificationBanner onVerified={refetchVerification} />
      )}

      {/* Waiting-for-slot banner — market is at capacity, provider is on the waitlist */}
      {isSlotWaiting && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex gap-3">
          <Hourglass size={20} className="text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-amber-900">
              {language === 'ar'
                ? 'ملفك في قائمة الانتظار'
                : 'Your listing is in the waiting queue'}
            </p>
            <p className="text-xs text-amber-800 leading-relaxed">
              {language === 'ar'
                ? 'السوق في مدينتك ممتلئ حالياً. ستُشعر تلقائياً عند توفر مقعد — ثم يكون لديك 3 ساعات لإتمام التفعيل. حسابك وسمعتك وتاريخك محفوظة.'
                : 'The market in your city is currently at capacity. You will be notified when a slot becomes available — you will then have 3 hours to complete activation. Your account, reputation, and history are fully preserved.'}
            </p>
          </div>
        </div>
      )}

      {/* Reservation banner — slot is reserved for 3 hours, action required */}
      {isSlotReserved && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 flex gap-3">
          <Clock size={20} className="text-blue-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-blue-900">
              {language === 'ar'
                ? 'مقعدك محجوز — أكمل الدفع الآن'
                : 'Your slot is reserved — complete payment now'}
            </p>
            <p className="text-xs text-blue-800 leading-relaxed">
              {language === 'ar'
                ? `لديك مقعد محجوز حتى ${reservationExpiresAt?.toLocaleString('ar-SA', { hour: '2-digit', minute: '2-digit' }) ?? ''}. أكمل الدفع لتفعيل ملفك قبل انتهاء المهلة.`
                : `A slot has been reserved for you until ${reservationExpiresAt?.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) ?? ''}. Complete payment before the window closes to activate your listing.`}
            </p>
          </div>
        </div>
      )}

      {/* Office identity card */}
      <Card className="overflow-hidden">
        <div className="h-1.5 w-full bg-gradient-to-r from-primary/60 to-primary rounded-t-xl" style={{ width: `${completionPct}%`, transition: 'width 0.6s ease' }} />
        <CardContent className="pt-5 pb-4">
          <div className="flex items-start gap-4 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-semibold leading-tight truncate">{office.name}</h2>
                {office.isVerified && (
                  <Badge className="bg-emerald-600 gap-1 text-[11px] shrink-0"><ShieldCheck size={11} /> {t('dashboard.verified_badge')}</Badge>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <Badge variant="outline" className={`gap-1 text-xs ${statusMeta.tone}`}>
                  {statusMeta.icon} {t(statusMeta.labelKey as any)}
                </Badge>
                {office.city && <span className="text-sm text-muted-foreground">{office.city}</span>}
              </div>
            </div>
            {publicUrl && (office.status === 'active' || office.status === 'approved') && (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 gap-1.5"
                onClick={() => window.open(publicUrl, '_blank')}
              >
                <ExternalLink size={14} />
                {t('dash.overview.view_public')}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Profile completion */}
      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">{t('dash.overview.profile_complete')}</span>
            <span className="text-sm font-semibold tabular-nums">{completionPct}%</span>
          </div>
          <Progress value={completionPct} className="h-2" />
          <p className="text-xs text-muted-foreground mt-2">
            {completedCount} / {completionItems.length}
          </p>
        </CardContent>
      </Card>

      {/* Needs action */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            {actions.length > 0 && (
              <span className="w-5 h-5 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                {actions.length}
              </span>
            )}
            {t('dash.overview.needs_action')}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {actions.length === 0 ? (
            <div className="flex items-center gap-3 py-4 text-emerald-700">
              <CheckCircle2 size={20} className="shrink-0" />
              <p className="text-sm">{t('dash.overview.all_good')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {actions.map(action => (
                <button
                  key={action.id}
                  onClick={() => navigate(action.section)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border border-border/60 hover:bg-muted/30 transition-colors text-start group"
                >
                  <div className="shrink-0">{action.icon}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium leading-snug">{t(action.titleKey as any)}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed line-clamp-1">{t(action.descKey as any)}</p>
                  </div>
                  <ChevronRight size={16} className="text-muted-foreground/40 shrink-0 group-hover:text-muted-foreground transition-colors rtl:rotate-180" />
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
