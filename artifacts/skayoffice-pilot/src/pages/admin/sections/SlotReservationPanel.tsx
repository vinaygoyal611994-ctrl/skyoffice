/**
 * SlotReservationPanel — Market Reservation & Waitlist Admin View
 *
 * Renders inside the Supply Control DrillDown for a single market
 * (country + city + category). Shows:
 *   • Market summary (allocated / reserved / available / waiting)
 *   • Active 3-hour reservations with live countdown + notification status
 *   • Ordered waitlist matching backend priority
 *   • Persistent notification outbox status (with failure alerts)
 *   • Admin actions (refresh, sweep, exceptional override)
 *   • Per-office slot audit history (on demand)
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  RefreshCw, Clock, Users, AlertTriangle, CheckCircle2, XCircle,
  ChevronDown, ChevronRight, ArrowUpCircle, Zap, History,
  AlertCircle, RotateCcw, Shield,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SlotSummary {
  marketKey:        string;
  supplyCap:        number | null;
  allocatedSlots:   number;
  reservedSlots:    number;
  activeSlots:      number;
  remainingSlots:   number | null;
  waitingCount:     number;
  returningWaiting: number;
  isClosed:         boolean;
}

export interface ReservationEntry {
  officeId:             number;
  name:                 string;
  nameAr:               string | null;
  providerType:         string;
  priorityTier:         number;
  reservationStartedAt: string;
  reservationExpiresAt: string;
  minutesRemaining:     number;
}

export interface WaitlistEntry {
  officeId:     number;
  name:         string;
  nameAr:       string | null;
  providerType: string;
  priorityTier: number;
  allocatedAt:  string | null;
  createdAt:    string;
}

export interface OutboxEntry {
  id:        number;
  officeId:  number;
  status:    'pending' | 'sent' | 'failed' | 'skipped';
  attempts:  number;
  lastError: string | null;
  sentAt:    string | null;
}

interface AuditEntry {
  id:               number;
  marketKey:        string;
  action:           string;
  slotStatusBefore: string | null;
  slotStatusAfter:  string | null;
  priorityTier:     number | null;
  reason:           string;
  performedByName:  string | null;
  createdAt:        string;
}

interface SweepResult {
  expiredCount:   number;
  reservedCount:  number;
  allocatedCount: number;
  errors:         string[];
  durationMs:     number;
}

interface Props {
  marketKey:    string;
  isAr:         boolean;
  baseUrl:      string; // import.meta.env.BASE_URL + 'api'
  slotSummary:  SlotSummary | null;
  reservations: ReservationEntry[];
  waitlist:     WaitlistEntry[];
  outbox:       OutboxEntry[];
  loading:      boolean;
  onRefresh:    () => void;
}

// ── Live countdown hook ────────────────────────────────────────────────────────

function useNow(tickMs = 1000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(t);
  }, [tickMs]);
  return now;
}

function formatCountdown(
  expiresAtStr: string,
  nowMs: number,
  isAr: boolean,
): { label: string; colorClass: string; urgent: boolean } {
  const msLeft = new Date(expiresAtStr).getTime() - nowMs;
  if (msLeft <= 0) {
    return {
      label: isAr ? 'انتهت' : 'Expired',
      colorClass: 'text-red-600 font-semibold',
      urgent: true,
    };
  }
  const h  = Math.floor(msLeft / 3600000);
  const m  = Math.floor((msLeft % 3600000) / 60000);
  const s  = Math.floor((msLeft % 60000) / 1000);
  const urgent   = msLeft < 30 * 60 * 1000;
  const expiring = msLeft < 60 * 60 * 1000;
  const colorClass = urgent
    ? 'text-red-600 font-semibold'
    : expiring
      ? 'text-amber-600 font-medium'
      : 'text-emerald-700 font-medium';
  let label: string;
  if (h > 0) {
    label = isAr ? `${h}س ${m}د` : `${h}h ${m}m`;
  } else if (m > 0) {
    label = isAr ? `${m}د ${s}ث` : `${m}m ${s}s`;
  } else {
    label = isAr ? `${s}ث` : `${s}s`;
  }
  return { label, colorClass, urgent };
}

// ── Tier badge ─────────────────────────────────────────────────────────────────

function TierBadge({ tier, isAr }: { tier: number; isAr: boolean }) {
  if (tier === 1) {
    return (
      <Badge className="text-[10px] px-1.5 py-0 h-4 bg-blue-100 text-blue-800 border-0 gap-0.5 shrink-0">
        <ArrowUpCircle size={8} />
        {isAr ? 'عائد' : 'Returning'}
      </Badge>
    );
  }
  if (tier === 2) {
    return (
      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 shrink-0">
        {isAr ? 'قائم' : 'Existing'}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-muted-foreground shrink-0">
      {isAr ? 'جديد' : 'New'}
    </Badge>
  );
}

// ── Provider type badge ────────────────────────────────────────────────────────

function ProviderTypeBadge({ type, isAr }: { type: string; isAr: boolean }) {
  const isFreelancer = type === 'freelancer';
  return (
    <Badge
      variant="outline"
      className={`text-[10px] px-1.5 py-0 h-4 shrink-0 ${
        isFreelancer ? 'border-purple-200 text-purple-700' : 'border-slate-200 text-slate-600'
      }`}
    >
      {isFreelancer
        ? (isAr ? 'مستقل' : 'Freelancer')
        : (isAr ? 'مكتب' : 'Office')}
    </Badge>
  );
}

// ── Notification status badge ──────────────────────────────────────────────────

function NotifBadge({ entry, isAr }: { entry: OutboxEntry | undefined; isAr: boolean }) {
  if (!entry) {
    return (
      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-muted-foreground shrink-0">
        {isAr ? 'لا يوجد' : '—'}
      </Badge>
    );
  }
  const cfg: Record<string, { cls: string; labelAr: string; labelEn: string }> = {
    pending: { cls: 'bg-amber-100 text-amber-800 border-0', labelAr: 'في الانتظار', labelEn: 'Pending' },
    sent:    { cls: 'bg-emerald-100 text-emerald-800 border-0', labelAr: 'أُرسل', labelEn: 'Sent' },
    failed:  { cls: 'bg-red-100 text-red-800 border-0', labelAr: 'فشل ✗', labelEn: 'Failed ✗' },
    skipped: { cls: 'bg-slate-100 text-slate-600 border-0', labelAr: 'تخطي', labelEn: 'Skipped' },
  };
  const c = cfg[entry.status] ?? cfg.pending;
  return (
    <Badge className={`text-[10px] px-1.5 py-0 h-4 shrink-0 ${c.cls}`}>
      {isAr ? c.labelAr : c.labelEn}
    </Badge>
  );
}

// ── Audit row labels ───────────────────────────────────────────────────────────

const AUDIT_ACTION_LABELS: Record<string, { ar: string; en: string }> = {
  waitlist_entered:             { ar: 'دخل قائمة الانتظار',   en: 'Entered waitlist' },
  reservation_created:          { ar: 'حجز أُنشئ',            en: 'Reservation created' },
  notification_queued:          { ar: 'إشعار في الطابور',     en: 'Notification queued' },
  notification_sent:            { ar: 'إشعار أُرسل',          en: 'Notification sent' },
  notification_failed:          { ar: 'إشعار فشل',            en: 'Notification failed' },
  notification_skipped_stale:   { ar: 'إشعار تجاوز (انتهى)',  en: 'Notification skipped (stale)' },
  reservation_expired:          { ar: 'انتهى الحجز',          en: 'Reservation expired' },
  reservation_released:         { ar: 'أُطلق الحجز',          en: 'Reservation released' },
  reservation_converted:        { ar: 'تحوّل لتخصيص',         en: 'Converted to allocation' },
  allocated:                    { ar: 'خُصص',                 en: 'Allocated' },
  admin_override:               { ar: 'تجاوز إداري',          en: 'Admin override' },
  released:                     { ar: 'أُطلق',                 en: 'Released' },
};

function auditActionLabel(action: string, isAr: boolean) {
  const entry = AUDIT_ACTION_LABELS[action];
  if (entry) return isAr ? entry.ar : entry.en;
  return action.replace(/_/g, ' ');
}

// ── Main component ─────────────────────────────────────────────────────────────

export function SlotReservationPanel({
  marketKey,
  isAr,
  baseUrl,
  slotSummary,
  reservations,
  waitlist,
  outbox,
  loading,
  onRefresh,
}: Props) {
  const nowMs = useNow();

  // Section visibility
  const [showReservations, setShowReservations] = useState(true);
  const [showWaitlist,     setShowWaitlist]     = useState(true);
  const [showAdminActions, setShowAdminActions] = useState(false);

  // Per-office audit history (loaded on demand)
  const [auditOfficeId, setAuditOfficeId] = useState<number | null>(null);
  const [auditLog,      setAuditLog]      = useState<AuditEntry[] | null>(null);
  const [auditLoading,  setAuditLoading]  = useState(false);

  // Sweep
  const [sweeping,       setSweeping]       = useState(false);
  const [sweepResult,    setSweepResult]    = useState<SweepResult | null>(null);
  const [sweepError,     setSweepError]     = useState<string | null>(null);

  // Override (exceptional)
  const [showOverride,    setShowOverride]   = useState(false);
  const [overrideId,      setOverrideId]     = useState('');
  const [overrideReason,  setOverrideReason] = useState('');
  const [overrideRunning, setOverrideRunning]= useState(false);
  const [overrideResult,  setOverrideResult] = useState<string | null>(null);

  // Outbox by officeId (most recent entry per office)
  const outboxByOffice = new Map<number, OutboxEntry>();
  for (const entry of outbox) {
    const existing = outboxByOffice.get(entry.officeId);
    if (!existing || new Date(entry.sentAt ?? entry.officeId) > new Date(existing.sentAt ?? existing.officeId)) {
      outboxByOffice.set(entry.officeId, entry);
    }
  }
  // Use most-recent by id
  const outboxById = new Map<number, OutboxEntry>();
  for (const entry of outbox) {
    const existing = outboxById.get(entry.officeId);
    if (!existing || entry.id > existing.id) {
      outboxById.set(entry.officeId, entry);
    }
  }

  const failedNotifs = outbox.filter(e => e.status === 'failed');

  // Load audit log for an office
  const loadAudit = useCallback(async (officeId: number) => {
    if (auditOfficeId === officeId) {
      setAuditOfficeId(null);
      setAuditLog(null);
      return;
    }
    setAuditOfficeId(officeId);
    setAuditLog(null);
    setAuditLoading(true);
    try {
      const res = await fetch(
        `${baseUrl}/admin/supply-slots/audit/${officeId}`,
        { credentials: 'include' },
      );
      if (res.ok) {
        const data = await res.json();
        setAuditLog(data.log ?? []);
      }
    } finally {
      setAuditLoading(false);
    }
  }, [auditOfficeId, baseUrl]);

  // Run sweep
  const runSweep = async () => {
    setSweeping(true);
    setSweepResult(null);
    setSweepError(null);
    try {
      const res = await fetch(`${baseUrl}/admin/supply-slots/sweep`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        const data: SweepResult = await res.json();
        setSweepResult(data);
        onRefresh(); // reload slot data after sweep
      } else {
        setSweepError(isAr ? 'فشل تشغيل المسح' : 'Sweep failed');
      }
    } catch {
      setSweepError(isAr ? 'خطأ في الشبكة' : 'Network error');
    } finally {
      setSweeping(false);
    }
  };

  // Run override
  const runOverride = async () => {
    const id = parseInt(overrideId.trim(), 10);
    if (!Number.isFinite(id) || !overrideReason.trim()) return;
    setOverrideRunning(true);
    setOverrideResult(null);
    try {
      const res = await fetch(`${baseUrl}/admin/supply-slots/allocate/${id}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: overrideReason.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setOverrideResult(
          isAr
            ? `تم التنفيذ — حالة المقعد: ${data.slotStatus}`
            : `Done — slot status: ${data.slotStatus}`,
        );
        setOverrideId('');
        setOverrideReason('');
        onRefresh();
      } else {
        const err = await res.json().catch(() => ({}));
        setOverrideResult(
          isAr
            ? `فشل: ${err.error ?? 'خطأ غير معروف'}`
            : `Failed: ${err.error ?? 'unknown error'}`,
        );
      }
    } catch {
      setOverrideResult(isAr ? 'خطأ في الشبكة' : 'Network error');
    } finally {
      setOverrideRunning(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="border-t pt-4 space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <Users size={12} />
          {isAr ? 'الحجوزات وقائمة الانتظار' : 'Reservations & Waitlist'}
        </h4>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          title={isAr ? 'تحديث' : 'Refresh'}
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* ── Market Summary Grid ─────────────────────────────────────────────── */}
      {slotSummary && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {/* Allocated */}
            <div className="rounded border bg-emerald-50 border-emerald-100 px-2.5 py-2 text-center">
              <p className="text-[10px] text-emerald-700 font-medium uppercase tracking-wide">
                {isAr ? 'مخصص' : 'Allocated'}
              </p>
              <p className="text-lg font-bold tabular-nums text-emerald-800 leading-tight">
                {slotSummary.allocatedSlots}
              </p>
              {slotSummary.supplyCap !== null && (
                <p className="text-[10px] text-emerald-600">/ {slotSummary.supplyCap}</p>
              )}
            </div>

            {/* Reserved */}
            <div className="rounded border bg-amber-50 border-amber-100 px-2.5 py-2 text-center">
              <p className="text-[10px] text-amber-700 font-medium uppercase tracking-wide">
                {isAr ? 'محجوز (3س)' : 'Reserved (3h)'}
              </p>
              <p className="text-lg font-bold tabular-nums text-amber-800 leading-tight">
                {slotSummary.reservedSlots}
              </p>
              <p className="text-[10px] text-amber-600">
                {isAr ? 'نافذة الدفع' : 'payment window'}
              </p>
            </div>

            {/* Available */}
            <div className={`rounded border px-2.5 py-2 text-center ${
              slotSummary.remainingSlots === null
                ? 'bg-sky-50 border-sky-100'
                : slotSummary.remainingSlots === 0
                  ? 'bg-red-50 border-red-100'
                  : 'bg-sky-50 border-sky-100'
            }`}>
              <p className={`text-[10px] font-medium uppercase tracking-wide ${
                slotSummary.remainingSlots === 0 ? 'text-red-700' : 'text-sky-700'
              }`}>
                {isAr ? 'متاح' : 'Available'}
              </p>
              <p className={`text-lg font-bold tabular-nums leading-tight ${
                slotSummary.remainingSlots === 0 ? 'text-red-800' : 'text-sky-800'
              }`}>
                {slotSummary.remainingSlots !== null ? slotSummary.remainingSlots : '∞'}
              </p>
              <p className={`text-[10px] ${slotSummary.remainingSlots === 0 ? 'text-red-600' : 'text-sky-600'}`}>
                {slotSummary.isClosed
                  ? (isAr ? 'مغلق' : 'closed')
                  : slotSummary.remainingSlots === 0
                    ? (isAr ? 'ممتلئ' : 'full')
                    : (isAr ? 'متاح' : 'open')}
              </p>
            </div>

            {/* Waiting */}
            <div className="rounded border bg-purple-50 border-purple-100 px-2.5 py-2 text-center">
              <p className="text-[10px] text-purple-700 font-medium uppercase tracking-wide">
                {isAr ? 'في الانتظار' : 'Waiting'}
              </p>
              <p className="text-lg font-bold tabular-nums text-purple-800 leading-tight">
                {slotSummary.waitingCount}
              </p>
              {slotSummary.returningWaiting > 0 && (
                <p className="text-[10px] text-purple-600">
                  {slotSummary.returningWaiting} {isAr ? 'عائد' : 'returning'}
                </p>
              )}
            </div>
          </div>

          {/* Acceptance & cap row */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <span>{isAr ? 'القبول:' : 'Acceptance:'}</span>
              <span className={`font-medium ${
                slotSummary.isClosed ? 'text-red-600' : 'text-emerald-700'
              }`}>
                {slotSummary.isClosed
                  ? (isAr ? 'مغلق' : 'Closed')
                  : (isAr ? 'مفتوح' : 'Open')}
              </span>
            </div>
            {slotSummary.supplyCap !== null && (
              <div className="flex items-center gap-1">
                <Shield size={10} />
                <span>{isAr ? 'الحد:' : 'Cap:'}</span>
                <span className="font-medium tabular-nums">{slotSummary.supplyCap}</span>
              </div>
            )}
            {slotSummary.supplyCap === null && (
              <span className="italic">{isAr ? 'سوق مفتوح — بدون حد' : 'Uncapped market'}</span>
            )}
          </div>
        </div>
      )}

      {loading && !slotSummary && (
        <p className="text-xs text-muted-foreground animate-pulse">
          {isAr ? 'جاري التحميل...' : 'Loading...'}
        </p>
      )}

      {/* ── Failed Notification Alert ───────────────────────────────────────── */}
      {failedNotifs.length > 0 && (
        <div className="flex items-start gap-2 rounded border border-red-200 bg-red-50 px-3 py-2.5">
          <AlertTriangle size={13} className="text-red-600 mt-0.5 shrink-0" />
          <div className="text-xs">
            <p className="font-medium text-red-800">
              {isAr
                ? `${failedNotifs.length} إشعار(ات) فشل نهائياً — المزود لم يُبلَّغ`
                : `${failedNotifs.length} notification(s) permanently failed — provider was not notified`}
            </p>
            <p className="text-red-600 mt-0.5">
              {isAr
                ? 'يجب التدخل اليدوي. تحقق من سجل التدقيق للمكتب المعني.'
                : 'Manual action required. Check the audit log for the affected office.'}
            </p>
          </div>
        </div>
      )}

      {/* ── Active Reservations ─────────────────────────────────────────────── */}
      <div>
        <button
          onClick={() => setShowReservations(v => !v)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
        >
          {showReservations ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          <Clock size={11} />
          <span className="font-medium">
            {isAr
              ? `الحجوزات النشطة (${reservations.length})`
              : `Active Reservations (${reservations.length})`}
          </span>
        </button>

        {showReservations && (
          <div className="mt-2 space-y-1.5">
            {reservations.length === 0 ? (
              <p className="text-xs text-muted-foreground italic ps-4">
                {isAr ? 'لا توجد حجوزات نشطة' : 'No active reservations'}
              </p>
            ) : (
              reservations.map(r => {
                const countdown = formatCountdown(r.reservationExpiresAt, nowMs, isAr);
                const notif     = outboxById.get(r.officeId);
                const isExpanded = auditOfficeId === r.officeId;

                return (
                  <div key={r.officeId} className="border rounded text-xs bg-background">
                    <div className="flex items-start justify-between gap-2 px-2.5 py-2">
                      {/* Left: office info */}
                      <div className="flex items-start gap-2 min-w-0">
                        <div className="min-w-0">
                          <p className="font-medium truncate">
                            {isAr && r.nameAr ? r.nameAr : r.name}
                          </p>
                          <div className="flex flex-wrap items-center gap-1 mt-0.5">
                            <ProviderTypeBadge type={r.providerType} isAr={isAr} />
                            <TierBadge tier={r.priorityTier} isAr={isAr} />
                            <NotifBadge entry={notif} isAr={isAr} />
                          </div>
                        </div>
                      </div>

                      {/* Right: countdown + history */}
                      <div className="shrink-0 flex flex-col items-end gap-1">
                        <span className={`tabular-nums text-[11px] ${countdown.colorClass}`}>
                          {countdown.label}
                          {!countdown.urgent && (
                            <span className="text-muted-foreground font-normal ms-1">
                              {isAr ? 'متبقي' : 'left'}
                            </span>
                          )}
                        </span>
                        <button
                          onClick={() => loadAudit(r.officeId)}
                          className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <History size={9} />
                          {isAr ? 'السجل' : 'History'}
                        </button>
                      </div>
                    </div>

                    {/* Reservation time row */}
                    <div className="px-2.5 pb-1.5 flex flex-wrap gap-x-4 text-[10px] text-muted-foreground border-t pt-1">
                      <span>
                        {isAr ? 'بدأ: ' : 'Started: '}
                        {new Date(r.reservationStartedAt).toLocaleTimeString(
                          isAr ? 'ar-SA' : 'en-GB',
                          { hour: '2-digit', minute: '2-digit' },
                        )}
                      </span>
                      <span>
                        {isAr ? 'ينتهي: ' : 'Expires: '}
                        {new Date(r.reservationExpiresAt).toLocaleTimeString(
                          isAr ? 'ar-SA' : 'en-GB',
                          { hour: '2-digit', minute: '2-digit' },
                        )}
                      </span>
                      {notif?.lastError && notif.status === 'failed' && (
                        <span className="text-red-500 flex items-center gap-0.5">
                          <AlertCircle size={9} />
                          {isAr ? 'إشعار فشل نهائياً' : 'Notification permanently failed'}
                        </span>
                      )}
                    </div>

                    {/* Inline audit history */}
                    {isExpanded && (
                      <AuditHistoryPanel
                        officeId={r.officeId}
                        log={auditLog}
                        loading={auditLoading}
                        isAr={isAr}
                        marketKey={marketKey}
                      />
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* ── Waitlist ────────────────────────────────────────────────────────── */}
      {(slotSummary?.waitingCount ?? 0) > 0 && (
        <div>
          <button
            onClick={() => setShowWaitlist(v => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
          >
            {showWaitlist ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            <Users size={11} />
            <span className="font-medium">
              {isAr
                ? `قائمة الانتظار (${waitlist.length})`
                : `Waitlist (${waitlist.length})`}
            </span>
            {(slotSummary?.returningWaiting ?? 0) > 0 && (
              <Badge className="text-[10px] px-1.5 py-0 h-4 bg-blue-100 text-blue-800 border-0 ms-1">
                {slotSummary!.returningWaiting} {isAr ? 'عائد' : 'returning'}
              </Badge>
            )}
          </button>

          {showWaitlist && (
            <div className="mt-2 space-y-1.5 max-h-72 overflow-y-auto">
              {waitlist.length === 0 ? (
                <p className="text-xs text-muted-foreground italic ps-4">
                  {isAr ? 'قائمة الانتظار فارغة' : 'Waitlist is empty'}
                </p>
              ) : (
                waitlist.map((entry, idx) => {
                  const isExpanded = auditOfficeId === entry.officeId;
                  return (
                    <div key={entry.officeId} className="border rounded text-xs bg-background">
                      <div className="flex items-start justify-between gap-2 px-2.5 py-2">
                        {/* Position + name */}
                        <div className="flex items-start gap-2 min-w-0">
                          <span className="text-muted-foreground tabular-nums w-5 shrink-0 pt-0.5">
                            #{idx + 1}
                          </span>
                          <div className="min-w-0">
                            <p className="font-medium truncate">
                              {isAr && entry.nameAr ? entry.nameAr : entry.name}
                            </p>
                            <div className="flex flex-wrap items-center gap-1 mt-0.5">
                              <ProviderTypeBadge type={entry.providerType} isAr={isAr} />
                              <TierBadge tier={entry.priorityTier} isAr={isAr} />
                            </div>
                          </div>
                        </div>

                        {/* Meta + history */}
                        <div className="shrink-0 flex flex-col items-end gap-1 text-[10px] text-muted-foreground">
                          <span>
                            {isAr ? 'منذ ' : ''}
                            {new Date(entry.createdAt).toLocaleDateString(
                              isAr ? 'ar-SA' : 'en-GB',
                              { day: 'numeric', month: 'short' },
                            )}
                            {!isAr ? ' ago' : ''}
                          </span>
                          {entry.allocatedAt && (
                            <span className="text-blue-600">
                              {isAr ? 'آخر تخصيص: ' : 'Last alloc: '}
                              {new Date(entry.allocatedAt).toLocaleDateString(
                                isAr ? 'ar-SA' : 'en-GB',
                                { month: 'short', year: '2-digit' },
                              )}
                            </span>
                          )}
                          <button
                            onClick={() => loadAudit(entry.officeId)}
                            className="flex items-center gap-0.5 hover:text-foreground transition-colors"
                          >
                            <History size={9} />
                            {isAr ? 'السجل' : 'History'}
                          </button>
                        </div>
                      </div>

                      {/* Inline audit history */}
                      {isExpanded && (
                        <AuditHistoryPanel
                          officeId={entry.officeId}
                          log={auditLog}
                          loading={auditLoading}
                          isAr={isAr}
                          marketKey={marketKey}
                        />
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Admin Actions ───────────────────────────────────────────────────── */}
      <div className="border-t pt-3 space-y-3">
        <button
          onClick={() => setShowAdminActions(v => !v)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {showAdminActions ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          <Zap size={11} />
          <span>{isAr ? 'إجراءات إدارية' : 'Admin Actions'}</span>
        </button>

        {showAdminActions && (
          <div className="ps-3 space-y-3">

            {/* Sweep */}
            <div className="space-y-1.5">
              <p className="text-[10px] text-muted-foreground">
                {isAr
                  ? 'مسح الانتظار: ينهي الحجوزات المنتهية ويرقّي القائمة'
                  : 'Run sweep: expire overdue reservations and promote waitlist'}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={runSweep}
                disabled={sweeping}
                className="text-xs h-7 gap-1.5"
              >
                <RotateCcw size={11} className={sweeping ? 'animate-spin' : ''} />
                {sweeping
                  ? (isAr ? 'جاري المسح...' : 'Running sweep...')
                  : (isAr ? 'تشغيل مسح الانتظار' : 'Run Reservation Sweep')}
              </Button>
              {sweepResult && (
                <div className="text-[10px] text-muted-foreground border rounded px-2 py-1.5 bg-muted/30 space-y-0.5">
                  <p className="font-medium text-foreground">
                    {isAr ? 'نتيجة المسح:' : 'Sweep result:'}
                  </p>
                  <p>
                    {isAr ? 'منتهية: ' : 'Expired: '}<span className="font-medium">{sweepResult.expiredCount}</span>
                    {' · '}
                    {isAr ? 'محجوزة: ' : 'Reserved: '}<span className="font-medium">{sweepResult.reservedCount}</span>
                    {' · '}
                    {isAr ? 'مخصصة: ' : 'Allocated: '}<span className="font-medium">{sweepResult.allocatedCount}</span>
                    {' · '}
                    {sweepResult.durationMs}ms
                  </p>
                  {sweepResult.errors.length > 0 && (
                    <p className="text-amber-600">{sweepResult.errors.join(', ')}</p>
                  )}
                </div>
              )}
              {sweepError && (
                <p className="text-[10px] text-red-600">{sweepError}</p>
              )}
            </div>

            {/* Exceptional Override */}
            <div className="border border-red-200 rounded p-2.5 space-y-2 bg-red-50/50">
              <div className="flex items-center gap-1.5">
                <AlertTriangle size={11} className="text-red-600" />
                <p className="text-[10px] font-semibold text-red-700 uppercase tracking-wide">
                  {isAr ? 'تجاوز استثنائي' : 'Exceptional Override'}
                </p>
              </div>
              <p className="text-[10px] text-red-600">
                {isAr
                  ? 'يتجاوز الحد والأولوية. يُسجَّل نهائياً في سجل التدقيق. استخدم فقط عند الضرورة القصوى.'
                  : 'Bypasses cap and priority. Permanently recorded in audit log. Use only in exceptional circumstances.'}
              </p>
              {!showOverride ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowOverride(true)}
                  className="text-xs h-6 px-2 border-red-200 text-red-700 hover:bg-red-100"
                >
                  {isAr ? 'تنفيذ تجاوز استثنائي...' : 'Perform exceptional override...'}
                </Button>
              ) : (
                <div className="space-y-1.5">
                  <Input
                    type="number"
                    placeholder={isAr ? 'رقم المكتب (ID)' : 'Office ID'}
                    value={overrideId}
                    onChange={e => setOverrideId(e.target.value)}
                    className="h-7 text-xs w-32 tabular-nums"
                  />
                  <Textarea
                    placeholder={isAr ? 'سبب التجاوز (مطلوب، 5 أحرف على الأقل)' : 'Override reason (required, min 5 chars)'}
                    value={overrideReason}
                    onChange={e => setOverrideReason(e.target.value)}
                    rows={2}
                    className="text-xs"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={runOverride}
                      disabled={overrideRunning || !overrideId.trim() || overrideReason.trim().length < 5}
                      className="text-xs h-7 bg-red-600 hover:bg-red-700 text-white"
                    >
                      {overrideRunning
                        ? (isAr ? 'جاري التنفيذ...' : 'Running...')
                        : (isAr ? 'تنفيذ التجاوز' : 'Execute Override')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { setShowOverride(false); setOverrideResult(null); }}
                      className="text-xs h-7"
                    >
                      {isAr ? 'إلغاء' : 'Cancel'}
                    </Button>
                  </div>
                  {overrideResult && (
                    <p className={`text-[10px] ${overrideResult.startsWith('Failed') || overrideResult.startsWith('فشل') ? 'text-red-600' : 'text-emerald-700'}`}>
                      {overrideResult}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── AuditHistoryPanel (inline per-office) ──────────────────────────────────────

function AuditHistoryPanel({
  officeId,
  log,
  loading,
  isAr,
  marketKey,
}: {
  officeId: number;
  log: AuditEntry[] | null;
  loading: boolean;
  isAr: boolean;
  marketKey: string;
}) {
  // Filter to this market only for relevance
  const entries = log ? log.filter(e => e.marketKey === marketKey).slice(0, 20) : [];

  const RELEVANT_ACTIONS = new Set([
    'waitlist_entered', 'reservation_created', 'notification_queued',
    'notification_sent', 'notification_failed', 'notification_skipped_stale',
    'reservation_expired', 'reservation_released', 'reservation_converted',
    'allocated', 'admin_override', 'released',
  ]);

  const filtered = entries.filter(e => RELEVANT_ACTIONS.has(e.action));

  return (
    <div className="border-t px-2.5 py-2 bg-muted/20 space-y-1">
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
        <History size={9} />
        {isAr ? 'سجل الأحداث' : 'Event History'}
      </p>

      {loading && (
        <p className="text-[10px] text-muted-foreground animate-pulse">
          {isAr ? 'جاري التحميل...' : 'Loading...'}
        </p>
      )}

      {!loading && filtered.length === 0 && log !== null && (
        <p className="text-[10px] text-muted-foreground italic">
          {isAr ? 'لا توجد أحداث لهذا السوق' : 'No events for this market'}
        </p>
      )}

      {filtered.map(e => {
        const isNotif = e.action.startsWith('notification_');
        const isFail  = e.action === 'notification_failed';
        const isAdmin = e.action === 'admin_override';
        return (
          <div
            key={e.id}
            className={`flex items-start justify-between gap-2 text-[10px] py-0.5 ${
              isFail  ? 'text-red-600'    :
              isAdmin ? 'text-amber-700'  :
              isNotif ? 'text-blue-700'   : 'text-foreground'
            }`}
          >
            <div className="flex items-start gap-1 min-w-0">
              {isFail  && <XCircle size={9} className="mt-0.5 shrink-0" />}
              {isAdmin && <AlertTriangle size={9} className="mt-0.5 shrink-0" />}
              {!isFail && !isAdmin && <span className="w-2.5 shrink-0" />}
              <span className="truncate">
                {auditActionLabel(e.action, isAr)}
                {e.reason && e.reason !== e.action && (
                  <span className="text-muted-foreground ms-1">— {e.reason}</span>
                )}
              </span>
            </div>
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {new Date(e.createdAt).toLocaleString(isAr ? 'ar-SA' : 'en-GB', {
                day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
              })}
            </span>
          </div>
        );
      })}
    </div>
  );
}
