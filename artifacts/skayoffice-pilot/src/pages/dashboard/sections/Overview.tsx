import React from 'react';
import { useI18n } from '@/lib/i18n';
import { getOfficePublicUrl } from '@/lib/publicUrl';
import { useGetMyOffice, useListMyOfficeDocuments, useListMyOfficeVideoCallRequests, useGetOfficeServiceRequests, useVerificationStatus } from '@workspace/api-client-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import {
  AlertTriangle, CheckCircle2, Clock, XCircle, ExternalLink,
  ImagePlus, MessageSquare, Globe, FileText, Video, FilePenLine,
  ChevronRight, ShieldCheck, Send, Hourglass, ClipboardList,
} from 'lucide-react';
import { EmailVerificationBanner } from '@/components/account/EmailVerificationBanner';
import { PhoneVerificationBanner } from '@/components/account/PhoneVerificationBanner';

const STATUS_META: Record<string, { tone: string; bar: string; icon: React.ReactNode; labelKey: string }> = {
  draft:             { labelKey: 'dashboard.status.draft',             tone: 'bg-slate-100 text-slate-700 border-slate-200',    bar: 'bg-slate-400',    icon: <FileText size={13} /> },
  under_review:      { labelKey: 'dashboard.status.under_review',      tone: 'bg-blue-100 text-blue-700 border-blue-200',       bar: 'bg-blue-500',     icon: <Clock size={13} /> },
  changes_requested: { labelKey: 'dashboard.status.changes_requested', tone: 'bg-amber-100 text-amber-800 border-amber-200',    bar: 'bg-amber-500',    icon: <AlertTriangle size={13} /> },
  approved:          { labelKey: 'dashboard.status.approved',          tone: 'bg-emerald-100 text-emerald-700 border-emerald-200', bar: 'bg-emerald-500', icon: <CheckCircle2 size={13} /> },
  active:            { labelKey: 'dashboard.status.active',            tone: 'bg-emerald-100 text-emerald-700 border-emerald-200', bar: 'bg-emerald-500', icon: <CheckCircle2 size={13} /> },
  rejected:          { labelKey: 'dashboard.status.rejected',          tone: 'bg-red-100 text-red-700 border-red-200',          bar: 'bg-red-500',      icon: <XCircle size={13} /> },
  suspended:         { labelKey: 'dashboard.status.suspended',         tone: 'bg-red-100 text-red-700 border-red-200',          bar: 'bg-red-500',      icon: <XCircle size={13} /> },
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
  const { data: serviceRequests } = useGetOfficeServiceRequests();
  const { data: verificationStatus, refetch: refetchVerification } = useVerificationStatus();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-36 w-full rounded-2xl" />
        <div className="grid grid-cols-3 gap-3">
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
        </div>
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    );
  }

  if (!office) return null;

  // Compute profile completion
  const completionItems = [
    { key: 'name',            done: !!office.name,                                                   label: language === 'ar' ? 'الاسم' : 'Name' },
    { key: 'city',            done: !!office.city,                                                   label: language === 'ar' ? 'المدينة' : 'City' },
    { key: 'shortDescription',done: !!office.shortDescription,                                       label: language === 'ar' ? 'وصف مختصر' : 'Short description' },
    { key: 'whatsapp',        done: !!office.whatsapp,                                               label: 'WhatsApp' },
    { key: 'gallery',         done: !!(office.gallery && office.gallery.length > 0),                 label: language === 'ar' ? 'صور المعرض' : 'Gallery photos' },
    { key: 'spokenLanguages', done: !!(office.spokenLanguages && office.spokenLanguages.length > 0), label: language === 'ar' ? 'اللغات' : 'Spoken languages' },
    { key: 'services',        done: !!(office.services && office.services.length > 0),               label: language === 'ar' ? 'الخدمات' : 'Services' },
    { key: 'description',     done: !!office.description,                                            label: language === 'ar' ? 'وصف كامل' : 'Full description' },
    { key: 'googleMapsUrl',   done: !!office.googleMapsUrl,                                          label: language === 'ar' ? 'خرائط جوجل' : 'Google Maps' },
  ];
  const completedCount = completionItems.filter(i => i.done).length;
  const completionPct = Math.round((completedCount / completionItems.length) * 100);

  const statusMeta = STATUS_META[office.status] || STATUS_META.draft;
  const hasPendingChanges = !!office.pendingChanges;
  const newVideoRequests = videoRequests?.filter(r => r.status === 'new') || [];
  const pendingSrCount = serviceRequests?.filter(r => r.status === 'submitted').length ?? 0;
  const rejectedDocs = documents?.filter(d => d.status === 'rejected') || [];

  // Build action items
  const actions: ActionItem[] = [];

  if (office.status === 'draft' || office.status === 'changes_requested') {
    if (completionPct >= 60) {
      actions.push({ id: 'submit', priority: 'high', titleKey: 'dash.action.submit_application', descKey: 'dash.action.submit_application_desc', section: 'profile', icon: <Send size={16} className="text-emerald-600" /> });
    }
  }
  if (rejectedDocs.length > 0) {
    actions.push({ id: 'rejected_docs', priority: 'high', titleKey: 'dash.action.rejected_document', descKey: 'dash.action.rejected_document_desc', section: 'documents', icon: <AlertTriangle size={16} className="text-red-500" /> });
  }
  if (newVideoRequests.length > 0) {
    actions.push({ id: 'video_requests', priority: 'medium', titleKey: 'dash.action.new_video_requests', descKey: 'dash.action.new_video_requests_desc', section: 'requests', icon: <Video size={16} className="text-blue-500" /> });
  }
  if (hasPendingChanges) {
    actions.push({ id: 'pending_changes', priority: 'medium', titleKey: 'dash.action.pending_changes', descKey: 'dash.action.pending_changes_desc', section: 'profile', icon: <FilePenLine size={16} className="text-amber-500" /> });
  }
  if (!office.whatsapp) {
    actions.push({ id: 'missing_whatsapp', priority: 'medium', titleKey: 'dash.action.missing_whatsapp', descKey: 'dash.action.missing_whatsapp_desc', section: 'profile', icon: <MessageSquare size={16} className="text-slate-400" /> });
  }
  if (!office.spokenLanguages || office.spokenLanguages.length === 0) {
    actions.push({ id: 'missing_languages', priority: 'low', titleKey: 'dash.action.missing_languages', descKey: 'dash.action.missing_languages_desc', section: 'profile', icon: <Globe size={16} className="text-slate-400" /> });
  }
  if (!office.gallery || office.gallery.length === 0) {
    actions.push({ id: 'missing_images', priority: 'low', titleKey: 'dash.action.missing_images', descKey: 'dash.action.missing_images_desc', section: 'media', icon: <ImagePlus size={16} className="text-slate-400" /> });
  }

  const priorityOrder = { high: 0, medium: 1, low: 2 };
  actions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  const publicUrl = office.slug ? getOfficePublicUrl(office.slug, language) : null;

  const isSlotWaiting = office.isSubscriptionHidden === true
    && (office.status === 'approved' || office.status === 'active')
    && office.slotStatus === 'waiting';

  const isSlotReserved = office.slotStatus === 'reserved' && office.reservationExpiresAt != null;
  const reservationExpiresAt = office.reservationExpiresAt ? new Date(office.reservationExpiresAt) : null;

  const priorityBorder: Record<string, string> = {
    high:   'border-l-red-400',
    medium: 'border-l-amber-400',
    low:    'border-l-slate-300',
  };

  return (
    <div className="space-y-4">

      {/* Verification banners */}
      {verificationStatus && !verificationStatus.emailVerified && (
        <EmailVerificationBanner onVerified={refetchVerification} />
      )}
      {verificationStatus && !verificationStatus.phoneVerified && (
        <PhoneVerificationBanner onVerified={refetchVerification} />
      )}

      {/* Slot waiting banner */}
      {isSlotWaiting && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex gap-3">
          <Hourglass size={18} className="text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="text-sm font-semibold text-amber-900">
              {language === 'ar' ? 'ملفك في قائمة الانتظار' : 'Your listing is in the waiting queue'}
            </p>
            <p className="text-xs text-amber-800 leading-relaxed">
              {language === 'ar'
                ? 'السوق في مدينتك ممتلئ حالياً. ستُشعر تلقائياً عند توفر مقعد — ثم يكون لديك 3 ساعات لإتمام التفعيل.'
                : 'The market in your city is currently at capacity. You will be notified when a slot opens — you will then have 3 hours to complete activation.'}
            </p>
          </div>
        </div>
      )}

      {/* Slot reserved banner */}
      {isSlotReserved && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 flex gap-3">
          <Clock size={18} className="text-blue-600 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="text-sm font-semibold text-blue-900">
              {language === 'ar' ? 'مقعدك محجوز — أكمل الدفع الآن' : 'Your slot is reserved — complete payment now'}
            </p>
            <p className="text-xs text-blue-800 leading-relaxed">
              {language === 'ar'
                ? `لديك مقعد محجوز حتى ${reservationExpiresAt?.toLocaleString('ar-SA', { hour: '2-digit', minute: '2-digit' }) ?? ''}. أكمل الدفع لتفعيل ملفك.`
                : `A slot is reserved for you until ${reservationExpiresAt?.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) ?? ''}. Complete payment before the window closes.`}
            </p>
          </div>
        </div>
      )}

      {/* ── Office Hero Card ── */}
      <div className="rounded-2xl overflow-hidden bg-white border border-border/50 shadow-sm">
        <div className={`h-1 w-full ${statusMeta.bar}`} />
        <div className="px-5 py-4 flex items-center gap-4 flex-wrap">
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 text-white text-base font-bold shadow"
            style={{ background: 'hsl(215,25%,22%)' }}
          >
            {office.name?.charAt(0)?.toUpperCase() || '?'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-[15px] font-bold text-foreground leading-tight truncate">{office.name}</h2>
              {office.isVerified && (
                <Badge className="bg-emerald-600 text-white gap-1 text-[10px] shrink-0 h-5 px-2">
                  <ShieldCheck size={9} /> {t('dashboard.verified_badge')}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <Badge variant="outline" className={`gap-1 text-[11px] h-5 px-2 ${statusMeta.tone}`}>
                {statusMeta.icon} {t(statusMeta.labelKey as any)}
              </Badge>
              {office.city && <span className="text-xs text-muted-foreground">{office.city}</span>}
            </div>
          </div>
          {publicUrl && (office.status === 'active' || office.status === 'approved') && (
            <Button variant="outline" size="sm" className="cursor-pointer shrink-0 gap-1.5 text-xs h-8"
              onClick={() => window.open(publicUrl, '_blank')}>
              <ExternalLink size={13} /> {t('dash.overview.view_public')}
            </Button>
          )}
        </div>
      </div>

      {/* ── Quick stats strip ── */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          value={newVideoRequests.length}
          label={language === 'ar' ? 'طلبات فيديو' : 'Video Requests'}
          icon={<Video size={15} className="text-blue-500" />}
          accent="bg-blue-50 border-blue-100"
          onClick={() => navigate('requests')}
        />
        <StatCard
          value={pendingSrCount}
          label={language === 'ar' ? 'طلبات خدمة' : 'Service Reqs'}
          icon={<ClipboardList size={15} className="text-violet-500" />}
          accent="bg-violet-50 border-violet-100"
          onClick={() => navigate('service_requests')}
        />
        <StatCard
          value={rejectedDocs.length}
          label={language === 'ar' ? 'مستندات' : 'Documents'}
          icon={<FileText size={15} className={rejectedDocs.length > 0 ? 'text-red-500' : 'text-slate-400'} />}
          accent={rejectedDocs.length > 0 ? 'bg-red-50 border-red-100' : 'bg-slate-50 border-slate-100'}
          onClick={() => navigate('documents')}
        />
      </div>

      {/* ── Profile Completion ── */}
      <div className="rounded-2xl bg-white border border-border/60 shadow-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-semibold text-foreground">{t('dash.overview.profile_complete')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{completedCount} / {completionItems.length} {language === 'ar' ? 'مكتمل' : 'completed'}</p>
          </div>
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
            style={{
              background: `conic-gradient(hsl(var(--primary)) ${completionPct * 3.6}deg, hsl(var(--muted)) 0deg)`,
            }}
          >
            <div className="w-9 h-9 rounded-full bg-white flex items-center justify-center text-xs font-bold text-primary">
              {completionPct}%
            </div>
          </div>
        </div>
        <Progress value={completionPct} className="h-1.5 mb-3" />
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {completionItems.map(item => (
            <div key={item.key} className="flex items-center gap-1.5">
              {item.done
                ? <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />
                : <div className="w-3 h-3 rounded-full border-2 border-muted-foreground/20 shrink-0" />
              }
              <span className={`text-[11px] truncate ${item.done ? 'text-foreground' : 'text-muted-foreground'}`}>
                {item.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Needs Action ── */}
      <div className="rounded-2xl bg-white border border-border/60 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-border/50 flex items-center gap-2.5">
          {actions.length > 0 && (
            <span className="w-5 h-5 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
              {actions.length}
            </span>
          )}
          <h3 className="text-sm font-semibold text-foreground">{t('dash.overview.needs_action')}</h3>
        </div>
        <div className="p-3">
          {actions.length === 0 ? (
            <div className="flex items-center gap-3 py-5 px-2 text-emerald-700">
              <div className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center shrink-0">
                <CheckCircle2 size={18} className="text-emerald-500" />
              </div>
              <p className="text-sm font-medium">{t('dash.overview.all_good')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {actions.map(action => (
                <button
                  key={action.id}
                  onClick={() => navigate(action.section)}
                  className={`cursor-pointer w-full flex items-center gap-3 p-3 rounded-xl border border-l-4 border-border/50 ${priorityBorder[action.priority]} hover:bg-muted/20 transition-colors text-start group`}
                >
                  <div className="w-8 h-8 rounded-lg bg-muted/50 flex items-center justify-center shrink-0">
                    {action.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground leading-snug">{t(action.titleKey as any)}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{t(action.descKey as any)}</p>
                  </div>
                  <ChevronRight size={15} className="text-muted-foreground/40 shrink-0 group-hover:text-muted-foreground transition-colors rtl:rotate-180" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}

function StatCard({
  value, label, icon, accent, onClick,
}: {
  value: number;
  label: string;
  icon: React.ReactNode;
  accent: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`cursor-pointer w-full rounded-2xl border p-3 flex flex-col items-start gap-2 transition-shadow hover:shadow-sm text-start ${accent} bg-white`}
    >
      <div className={`w-7 h-7 rounded-lg border flex items-center justify-center ${accent}`}>
        {icon}
      </div>
      <div>
        <p className="text-xl font-bold leading-none text-foreground">{value}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{label}</p>
      </div>
    </button>
  );
}
