/**
 * SubscriptionSection — Admin subscription lifecycle & growth intelligence panel.
 *
 * Shows:
 *   • KPI snapshot cards (trial, paid, expiring, expired, hidden, cancelled)
 *   • Growth metrics (new subs, renewals, churn, net growth, retention, MoM change)
 *   • Paginated office subscription list with state filter
 *   • Per-office detail drawer (history, notifications, admin actions)
 *   • System config panel (trial duration, grace period, warning window)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useI18n } from '@/lib/i18n';
import {
  RefreshCw, ChevronLeft, ChevronRight, Calendar,
  TrendingUp, TrendingDown, Minus, Settings, AlertCircle, Clock, Shield, BarChart2,
} from 'lucide-react';
import { CommercialGrowth } from './CommercialGrowth';

// ── Types ─────────────────────────────────────────────────────────────────────

type SubState =
  | 'free' | 'trial' | 'active_paid' | 'expiring'
  | 'expired' | 'hidden_due_to_nonpayment' | 'cancelled';

interface SubRow {
  sub_id:            number;
  office_id:         number;
  state:             SubState;
  name:              string;
  name_ar:           string | null;
  email:             string;
  category:          string;
  city:              string;
  country:           string | null;
  trial_started_at:  string | null;
  trial_ends_at:     string | null;
  paid_through_date: string | null;
  expires_at:        string | null;
  cancelled_at:      string | null;
  cancel_reason:     string | null;
  hidden_at:         string | null;
  created_at:        string;
}

interface HistoryRow {
  id:               number;
  from_state:       string | null;
  to_state:         string;
  reason:           string | null;
  changed_by_name:  string | null;
  created_at:       string;
}

interface PaymentTxRow {
  id:            number;
  status:        string;
  amountSar:     number;
  currency:      string;
  planName:      string | null;
  paidAt:        string | null;
  failedAt:      string | null;
  failureReason: string | null;
  createdAt:     string;
  gatewayRef:    string;
  renewalPath:   boolean;
}

interface SubDetail {
  subscription:  SubRow | null;
  history:       HistoryRow[];
  notifications: { notification_type: string; sent_at: string; period_expires_at: string }[];
}

interface GrowthMetrics {
  currentCounts: {
    free: number; trial: number; activePaid: number; expiring: number;
    expired: number; hiddenDueToNonPayment: number; cancelled: number; total: number;
  };
  eligibleOffices:  number;
  newSubscriptions: number;
  renewals:         number;
  churn:            number;
  netGrowth:        number;
  growthPct:        number | null;
  retentionRate:    number | null;
  momChange:        number;
  periodDays:       number;
}

interface SysConfig { key: string; value: string; }

// ── Helpers ───────────────────────────────────────────────────────────────────

function apiBase() { return '/api'; }

async function apiFetch(path: string, opts?: RequestInit) {
  const token = localStorage.getItem('skay_session_token');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${apiBase()}${path}`, { ...opts, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

function stateColor(state: SubState) {
  switch (state) {
    case 'free':                    return 'bg-gray-100 text-gray-600';
    case 'trial':                   return 'bg-blue-100 text-blue-700';
    case 'active_paid':             return 'bg-green-100 text-green-700';
    case 'expiring':                return 'bg-amber-100 text-amber-700';
    case 'expired':                 return 'bg-orange-100 text-orange-700';
    case 'hidden_due_to_nonpayment':return 'bg-red-100 text-red-700';
    case 'cancelled':               return 'bg-slate-100 text-slate-600';
    default:                        return 'bg-gray-100 text-gray-600';
  }
}

function stateLabel(state: SubState, lang: 'ar' | 'en'): string {
  const labels: Record<SubState, { ar: string; en: string }> = {
    free:                    { ar: 'مجاني', en: 'Free' },
    trial:                   { ar: 'تجريبي', en: 'Trial' },
    active_paid:             { ar: 'مدفوع نشط', en: 'Active Paid' },
    expiring:                { ar: 'ينتهي قريباً', en: 'Expiring' },
    expired:                 { ar: 'منتهٍ', en: 'Expired' },
    hidden_due_to_nonpayment:{ ar: 'مخفي', en: 'Hidden' },
    cancelled:               { ar: 'ملغى', en: 'Cancelled' },
  };
  return labels[state]?.[lang] ?? state;
}

function fmtDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function daysLeft(d: string | null): number | null {
  if (!d) return null;
  const diff = new Date(d).getTime() - Date.now();
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color }: {
  label: string; value: number; sub?: string; color?: string;
}) {
  return (
    <div className="bg-white border rounded-lg p-4 flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-2xl font-bold ${color ?? 'text-foreground'}`}>{value.toLocaleString()}</span>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </div>
  );
}

// ── Detail Drawer ─────────────────────────────────────────────────────────────

function DetailDrawer({
  officeId, onClose, language, onActionDone,
}: {
  officeId: number;
  onClose: () => void;
  language: 'ar' | 'en';
  onActionDone: () => void;
}) {
  const [detail, setDetail]     = useState<SubDetail | null>(null);
  const [loading, setLoading]   = useState(true);
  const [action, setAction]     = useState<string | null>(null);
  const [paidDate, setPaidDate] = useState('');
  const [reason, setReason]     = useState('');
  const [err, setErr]           = useState<string | null>(null);
  const [working, setWorking]   = useState(false);
  const [payments, setPayments] = useState<PaymentTxRow[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(true);

  useEffect(() => {
    apiFetch(`/admin/subscriptions/${officeId}`)
      .then(d => { setDetail(d); setLoading(false); })
      .catch(() => setLoading(false));
    apiFetch(`/admin/payments/${officeId}?limit=10`)
      .then((d: any) => { setPayments(d.items ?? []); setPaymentsLoading(false); })
      .catch(() => setPaymentsLoading(false));
  }, [officeId]);

  const doAction = async () => {
    if (!action) return;
    setWorking(true); setErr(null);
    try {
      if (action === 'trial') {
        await apiFetch(`/admin/subscriptions/${officeId}/trial`, { method: 'POST', body: JSON.stringify({}) });
      } else if (action === 'activate' || action === 'reactivate') {
        await apiFetch(`/admin/subscriptions/${officeId}/${action}`, {
          method: 'POST',
          body: JSON.stringify({ paidThroughDate: paidDate }),
        });
      } else if (action === 'expire') {
        await apiFetch(`/admin/subscriptions/${officeId}/expire`, { method: 'POST', body: JSON.stringify({}) });
      } else if (action === 'cancel') {
        await apiFetch(`/admin/subscriptions/${officeId}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
      }
      onActionDone();
      onClose();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Action failed');
      setWorking(false);
    }
  };

  const sub = detail?.subscription;
  const state = sub?.state as SubState | undefined;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg bg-white shadow-xl flex flex-col h-full overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b sticky top-0 bg-white z-10">
          <button onClick={onClose} className="p-1 hover:bg-muted rounded"><ChevronLeft size={18}/></button>
          <h2 className="font-semibold text-sm">
            {language === 'ar' ? 'تفاصيل الاشتراك' : 'Subscription Detail'}
          </h2>
          <div className="w-6"/>
        </div>

        {loading && <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Loading…</div>}

        {!loading && detail && (
          <div className="p-4 space-y-6">
            {/* Current state */}
            {state && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${stateColor(state)}`}>
                    {stateLabel(state, language)}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {sub?.trial_ends_at   && <div><span className="text-muted-foreground">{language === 'ar' ? 'انتهاء التجربة:' : 'Trial ends:'}</span><br/>{fmtDate(sub.trial_ends_at)}</div>}
                  {sub?.paid_through_date && <div><span className="text-muted-foreground">{language === 'ar' ? 'مدفوع حتى:' : 'Paid through:'}</span><br/>{fmtDate(sub.paid_through_date)}</div>}
                  {sub?.expires_at      && <div><span className="text-muted-foreground">{language === 'ar' ? 'ينتهي:' : 'Expires:'}</span><br/>{fmtDate(sub.expires_at)} {daysLeft(sub.expires_at) !== null && <span className="text-amber-600">({daysLeft(sub.expires_at)}d)</span>}</div>}
                  {sub?.cancelled_at    && <div><span className="text-muted-foreground">{language === 'ar' ? 'تاريخ الإلغاء:' : 'Cancelled:'}</span><br/>{fmtDate(sub.cancelled_at)}</div>}
                  {sub?.cancel_reason   && <div className="col-span-2"><span className="text-muted-foreground">{language === 'ar' ? 'سبب الإلغاء:' : 'Reason:'}</span><br/><span className="text-red-600">{sub.cancel_reason}</span></div>}
                </div>
              </div>
            )}

            {/* Admin actions */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {language === 'ar' ? 'إجراءات' : 'Admin Actions'}
              </p>
              <div className="flex flex-wrap gap-2">
                {(state === 'free') && (
                  <button onClick={() => setAction('trial')} className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">
                    {language === 'ar' ? 'بدء تجربة' : 'Start Trial'}
                  </button>
                )}
                {(state === 'free' || state === 'trial' || state === 'expiring') && (
                  <button onClick={() => setAction('activate')} className="px-3 py-1.5 text-xs bg-green-600 text-white rounded hover:bg-green-700">
                    {language === 'ar' ? 'تفعيل مدفوع' : 'Activate Paid'}
                  </button>
                )}
                {(state === 'expired' || state === 'hidden_due_to_nonpayment' || state === 'cancelled') && (
                  <button onClick={() => setAction('reactivate')} className="px-3 py-1.5 text-xs bg-green-600 text-white rounded hover:bg-green-700">
                    {language === 'ar' ? 'إعادة تفعيل' : 'Reactivate'}
                  </button>
                )}
                {(state === 'trial' || state === 'active_paid' || state === 'expiring') && (
                  <button onClick={() => setAction('expire')} className="px-3 py-1.5 text-xs bg-orange-600 text-white rounded hover:bg-orange-700">
                    {language === 'ar' ? 'إنهاء يدوي' : 'Expire Now'}
                  </button>
                )}
                {state !== 'cancelled' && state !== undefined && (
                  <button onClick={() => setAction('cancel')} className="px-3 py-1.5 text-xs bg-red-600 text-white rounded hover:bg-red-700">
                    {language === 'ar' ? 'إلغاء' : 'Cancel'}
                  </button>
                )}
              </div>

              {/* Action form */}
              {action && (
                <div className="border rounded-lg p-3 space-y-2 bg-muted/30 text-xs">
                  {(action === 'activate' || action === 'reactivate') && (
                    <div>
                      <label className="block text-muted-foreground mb-1">
                        {language === 'ar' ? 'مدفوع حتى تاريخ:' : 'Paid through date:'}
                      </label>
                      <input
                        type="date"
                        value={paidDate}
                        onChange={e => setPaidDate(e.target.value)}
                        className="border rounded px-2 py-1 w-full text-xs"
                      />
                    </div>
                  )}
                  {action === 'cancel' && (
                    <div>
                      <label className="block text-muted-foreground mb-1">
                        {language === 'ar' ? 'سبب الإلغاء:' : 'Cancellation reason:'}
                      </label>
                      <input
                        type="text"
                        value={reason}
                        onChange={e => setReason(e.target.value)}
                        placeholder={language === 'ar' ? 'اختياري...' : 'Optional…'}
                        className="border rounded px-2 py-1 w-full text-xs"
                      />
                    </div>
                  )}
                  {err && <p className="text-red-500">{err}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={doAction}
                      disabled={working || ((action === 'activate' || action === 'reactivate') && !paidDate)}
                      className="px-3 py-1 bg-primary text-primary-foreground rounded text-xs disabled:opacity-50"
                    >
                      {working ? '…' : (language === 'ar' ? 'تأكيد' : 'Confirm')}
                    </button>
                    <button onClick={() => setAction(null)} className="px-3 py-1 border rounded text-xs">
                      {language === 'ar' ? 'إلغاء' : 'Cancel'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* History */}
            {detail.history.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {language === 'ar' ? 'سجل التغييرات' : 'History'}
                </p>
                <div className="space-y-2">
                  {detail.history.map(h => (
                    <div key={h.id} className="border rounded px-3 py-2 text-xs space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        {h.from_state && <span className={`px-1.5 py-0.5 rounded-full ${stateColor(h.from_state as SubState)}`}>{stateLabel(h.from_state as SubState, language)}</span>}
                        {h.from_state && <span className="text-muted-foreground">→</span>}
                        <span className={`px-1.5 py-0.5 rounded-full ${stateColor(h.to_state as SubState)}`}>{stateLabel(h.to_state as SubState, language)}</span>
                      </div>
                      {h.reason && <p className="text-muted-foreground">{h.reason}</p>}
                      <p className="text-muted-foreground">{fmtDate(h.created_at)} {h.changed_by_name ? `— ${h.changed_by_name}` : '— system'}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Payment History */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {language === 'ar' ? 'سجل المدفوعات' : 'Payment History'}
              </p>
              {paymentsLoading ? (
                <p className="text-xs text-muted-foreground">{language === 'ar' ? 'جاري التحميل...' : 'Loading…'}</p>
              ) : payments.length === 0 ? (
                <p className="text-xs text-muted-foreground">{language === 'ar' ? 'لا توجد مدفوعات' : 'No payments recorded'}</p>
              ) : (
                <div className="space-y-2">
                  {payments.map(p => {
                    const statusColor =
                      p.status === 'succeeded'     ? 'bg-green-100 text-green-700' :
                      p.status === 'failed'        ? 'bg-red-100 text-red-700' :
                      p.status === 'failed_no_slot'? 'bg-orange-100 text-orange-700' :
                      p.status === 'cancelled'     ? 'bg-slate-100 text-slate-600' :
                                                     'bg-amber-100 text-amber-700';
                    const statusLabel = {
                      succeeded:     { ar: 'ناجح', en: 'Succeeded' },
                      failed:        { ar: 'فاشل', en: 'Failed' },
                      failed_no_slot:{ ar: 'فاشل (لا مقعد)', en: 'Failed (no slot)' },
                      cancelled:     { ar: 'ملغى', en: 'Cancelled' },
                      pending:       { ar: 'معلّق', en: 'Pending' },
                    }[p.status] ?? { ar: p.status, en: p.status };

                    return (
                      <div key={p.id} className="border rounded-lg px-3 py-2 text-xs space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className={`px-1.5 py-0.5 rounded-full font-medium ${statusColor}`}>
                            {language === 'ar' ? statusLabel.ar : statusLabel.en}
                          </span>
                          <span className="font-medium">{p.amountSar} {p.currency === 'SAR' ? (language === 'ar' ? 'ر.س' : 'SAR') : p.currency}</span>
                        </div>
                        <div className="text-muted-foreground space-y-0.5">
                          {p.paidAt   && <p>{language === 'ar' ? 'دُفع:' : 'Paid:'} {fmtDate(p.paidAt)}</p>}
                          {p.failedAt && <p className="text-red-500">{language === 'ar' ? 'فشل:' : 'Failed:'} {fmtDate(p.failedAt)}{p.failureReason ? ` — ${p.failureReason}` : ''}</p>}
                          {!p.paidAt && !p.failedAt && <p>{fmtDate(p.createdAt)}</p>}
                          <p>Ref: {p.gatewayRef}{p.renewalPath ? (language === 'ar' ? ' · تجديد' : ' · renewal') : ''}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Notifications */}
            {detail.notifications.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {language === 'ar' ? 'الإشعارات المُرسلة' : 'Sent Notifications'}
                </p>
                <div className="space-y-1">
                  {detail.notifications.map((n, i) => (
                    <div key={i} className="flex justify-between text-xs border rounded px-2 py-1">
                      <span className="text-muted-foreground">{n.notification_type}</span>
                      <span>{fmtDate(n.sent_at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Config Panel ──────────────────────────────────────────────────────────────

function ConfigPanel({ language }: { language: 'ar' | 'en' }) {
  const [configs, setConfigs]   = useState<SysConfig[]>([]);
  const [editing, setEditing]   = useState<Record<string, string>>({});
  const [saving, setSaving]     = useState<Record<string, boolean>>({});
  const [saved, setSaved]       = useState<Record<string, boolean>>({});
  const [err, setErr]           = useState<string | null>(null);

  useEffect(() => {
    apiFetch('/admin/system-config/subscription')
      .then(d => setConfigs(d.items))
      .catch(() => {});
  }, []);

  const save = async (key: string, value: string) => {
    setSaving(s => ({ ...s, [key]: true }));
    setErr(null);
    try {
      await apiFetch(`/admin/system-config/subscription/${key}`, {
        method: 'PUT',
        body: JSON.stringify({ value }),
      });
      setConfigs(c => c.map(cfg => cfg.key === key ? { ...cfg, value } : cfg));
      setSaved(s => ({ ...s, [key]: true }));
      setEditing(e => { const ne = { ...e }; delete ne[key]; return ne; });
      setTimeout(() => setSaved(s => ({ ...s, [key]: false })), 2000);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(s => ({ ...s, [key]: false }));
    }
  };

  const configMeta: Record<string, { ar: string; en: string; unit: string }> = {
    trial_duration_days:              { ar: 'مدة الفترة التجريبية',           en: 'Trial Duration',             unit: language === 'ar' ? 'يوم' : 'days' },
    subscription_grace_period_days:   { ar: 'فترة السماح بعد انتهاء الاشتراك', en: 'Grace Period After Expiry',  unit: language === 'ar' ? 'يوم' : 'days' },
    subscription_expiry_warning_days: { ar: 'نافذة تحذير انتهاء الاشتراك',    en: 'Expiry Warning Window',      unit: language === 'ar' ? 'يوم' : 'days' },
  };

  return (
    <div className="space-y-3">
      {err && <p className="text-xs text-red-500">{err}</p>}
      {configs.map(cfg => {
        const meta = configMeta[cfg.key];
        const isDirty = editing[cfg.key] !== undefined;
        return (
          <div key={cfg.key} className="border rounded-lg p-3 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">{meta ? (language === 'ar' ? meta.ar : meta.en) : cfg.key}</p>
              <p className="text-xs text-muted-foreground">{cfg.key}</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                value={editing[cfg.key] ?? cfg.value}
                onChange={e => setEditing(d => ({ ...d, [cfg.key]: e.target.value }))}
                className="w-16 border rounded px-2 py-1 text-sm text-center"
              />
              <span className="text-xs text-muted-foreground">{meta?.unit ?? ''}</span>
              {isDirty && (
                <button
                  onClick={() => save(cfg.key, editing[cfg.key]!)}
                  disabled={saving[cfg.key]}
                  className="px-2 py-1 bg-primary text-primary-foreground rounded text-xs disabled:opacity-50"
                >
                  {saving[cfg.key] ? '…' : (language === 'ar' ? 'حفظ' : 'Save')}
                </button>
              )}
              {saved[cfg.key] && <span className="text-xs text-green-600">✓</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function SubscriptionSection() {
  const { language } = useI18n();
  const lang = language as 'ar' | 'en';

  const [metrics,    setMetrics]    = useState<GrowthMetrics | null>(null);
  const [items,      setItems]      = useState<SubRow[]>([]);
  const [total,      setTotal]      = useState(0);
  const [page,       setPage]       = useState(1);
  const [stateFilter, setStateFilter] = useState('');
  const [period,     setPeriod]     = useState<'30d' | '60d' | '90d' | '12m'>('30d');
  const [loading,    setLoading]    = useState(true);
  const [loadingMet, setLoadingMet] = useState(true);
  const [detailId,             setDetailId]             = useState<number | null>(null);
  const [showConfig,           setShowConfig]           = useState(false);
  const [showCommercialGrowth, setShowCommercialGrowth] = useState(false);
  const limit = 20;

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (stateFilter) qs.set('state', stateFilter);
      const d = await apiFetch(`/admin/subscriptions?${qs}`);
      setItems(d.items);
      setTotal(d.total);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [page, stateFilter]);

  const fetchMetrics = useCallback(async () => {
    setLoadingMet(true);
    try {
      const d = await apiFetch(`/admin/subscriptions/metrics?period=${period}`);
      setMetrics(d);
    } catch {
      // ignore
    } finally {
      setLoadingMet(false);
    }
  }, [period]);

  useEffect(() => { fetchList(); },   [fetchList]);
  useEffect(() => { fetchMetrics(); }, [fetchMetrics]);

  const totalPages = Math.ceil(total / limit);
  const c = metrics?.currentCounts;

  const stateOptions: { value: string; labelAr: string; labelEn: string }[] = [
    { value: '',                     labelAr: 'الكل', labelEn: 'All' },
    { value: 'free',                 labelAr: 'مجاني', labelEn: 'Free' },
    { value: 'trial',                labelAr: 'تجريبي', labelEn: 'Trial' },
    { value: 'active_paid',          labelAr: 'مدفوع نشط', labelEn: 'Active Paid' },
    { value: 'expiring',             labelAr: 'ينتهي قريباً', labelEn: 'Expiring' },
    { value: 'expired',              labelAr: 'منتهٍ', labelEn: 'Expired' },
    { value: 'hidden_due_to_nonpayment', labelAr: 'مخفي', labelEn: 'Hidden' },
    { value: 'cancelled',            labelAr: 'ملغى', labelEn: 'Cancelled' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          {lang === 'ar' ? 'إدارة الاشتراكات' : 'Subscription Management'}
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShowCommercialGrowth(s => !s)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded border text-sm ${showCommercialGrowth ? 'bg-muted font-medium' : 'hover:bg-muted'}`}
          >
            <BarChart2 size={14} />
            {lang === 'ar' ? 'النمو التجاري' : 'Commercial Growth'}
          </button>
          <button
            onClick={() => setShowConfig(s => !s)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded border text-sm ${showConfig ? 'bg-muted' : 'hover:bg-muted'}`}
          >
            <Settings size={14} />
            {lang === 'ar' ? 'الإعدادات' : 'Config'}
          </button>
          <button
            onClick={() => { fetchList(); fetchMetrics(); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border text-sm hover:bg-muted"
          >
            <RefreshCw size={14} />
            {lang === 'ar' ? 'تحديث' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Config panel */}
      {showConfig && (
        <div className="border rounded-lg p-4 bg-muted/20 space-y-3">
          <h3 className="text-sm font-medium">{lang === 'ar' ? 'إعدادات الاشتراك' : 'Subscription Config'}</h3>
          <ConfigPanel language={lang} />
        </div>
      )}

      {/* Commercial Growth panel */}
      {showCommercialGrowth && <CommercialGrowth lang={lang} />}

      {/* KPI snapshot */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3">
        <KpiCard label={lang === 'ar' ? 'تجريبي' : 'Trial'}         value={c?.trial ?? 0} color="text-blue-600" />
        <KpiCard label={lang === 'ar' ? 'مدفوع نشط' : 'Active Paid'} value={c?.activePaid ?? 0} color="text-green-600" />
        <KpiCard label={lang === 'ar' ? 'ينتهي قريباً' : 'Expiring'} value={c?.expiring ?? 0} color="text-amber-600" />
        <KpiCard label={lang === 'ar' ? 'منتهٍ' : 'Expired'}         value={c?.expired ?? 0} color="text-orange-600" />
        <KpiCard label={lang === 'ar' ? 'مخفي' : 'Hidden'}           value={c?.hiddenDueToNonPayment ?? 0} color="text-red-600" />
        <KpiCard label={lang === 'ar' ? 'ملغى' : 'Cancelled'}        value={c?.cancelled ?? 0} />
        <KpiCard label={lang === 'ar' ? 'مجاني' : 'Free'}            value={c?.free ?? 0} />
      </div>

      {/* Growth metrics */}
      <div className="border rounded-lg p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            {lang === 'ar' ? 'مقاييس النمو' : 'Growth Metrics'}
          </h3>
          <select
            value={period}
            onChange={e => setPeriod(e.target.value as typeof period)}
            className="text-xs border rounded px-2 py-1"
          >
            <option value="30d">{lang === 'ar' ? 'آخر 30 يوم' : 'Last 30 days'}</option>
            <option value="60d">{lang === 'ar' ? 'آخر 60 يوم' : 'Last 60 days'}</option>
            <option value="90d">{lang === 'ar' ? 'آخر 90 يوم' : 'Last 90 days'}</option>
            <option value="12m">{lang === 'ar' ? 'آخر 12 شهر' : 'Last 12 months'}</option>
          </select>
        </div>
        {loadingMet ? (
          <p className="text-sm text-muted-foreground">{lang === 'ar' ? 'جاري التحميل...' : 'Loading…'}</p>
        ) : metrics ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard
              label={lang === 'ar' ? 'اشتراكات جديدة' : 'New Subscriptions'}
              value={metrics.newSubscriptions}
              color="text-green-600"
            />
            <KpiCard
              label={lang === 'ar' ? 'تجديدات' : 'Renewals'}
              value={metrics.renewals}
              color="text-blue-600"
            />
            <KpiCard
              label={lang === 'ar' ? 'انسحاب' : 'Churn'}
              value={metrics.churn}
              color="text-red-600"
            />
            <div className="bg-white border rounded-lg p-4 flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{lang === 'ar' ? 'النمو الصافي' : 'Net Growth'}</span>
              <span className={`text-2xl font-bold flex items-center gap-1 ${metrics.netGrowth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {metrics.netGrowth >= 0 ? <TrendingUp size={18}/> : <TrendingDown size={18}/>}
                {metrics.netGrowth > 0 ? '+' : ''}{metrics.netGrowth}
              </span>
            </div>
            <div className="bg-white border rounded-lg p-4 flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{lang === 'ar' ? 'نسبة النمو' : 'Growth %'}</span>
              <span className={`text-2xl font-bold ${metrics.growthPct !== null && metrics.growthPct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {metrics.growthPct !== null ? `${metrics.growthPct > 0 ? '+' : ''}${metrics.growthPct}%` : '—'}
              </span>
              <span className="text-xs text-muted-foreground">{lang === 'ar' ? 'مقارنة بالفترة السابقة' : 'vs previous period'}</span>
            </div>
            <div className="bg-white border rounded-lg p-4 flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{lang === 'ar' ? 'معدل الاحتفاظ' : 'Retention Rate'}</span>
              <span className={`text-2xl font-bold ${(metrics.retentionRate ?? 0) >= 70 ? 'text-green-600' : (metrics.retentionRate ?? 0) >= 40 ? 'text-amber-600' : 'text-red-600'}`}>
                {metrics.retentionRate !== null ? `${metrics.retentionRate}%` : '—'}
              </span>
            </div>
            <div className="bg-white border rounded-lg p-4 flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{lang === 'ar' ? 'التغيير الشهري' : 'MoM Change'}</span>
              <span className={`text-2xl font-bold flex items-center gap-1 ${metrics.momChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {metrics.momChange === 0 ? <Minus size={18}/> : metrics.momChange > 0 ? <TrendingUp size={18}/> : <TrendingDown size={18}/>}
                {metrics.momChange > 0 ? '+' : ''}{metrics.momChange}
              </span>
            </div>
            <KpiCard
              label={lang === 'ar' ? 'مكاتب مؤهلة' : 'Eligible Offices'}
              value={metrics.eligibleOffices}
            />
          </div>
        ) : null}
      </div>

      {/* List */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <select
            value={stateFilter}
            onChange={e => { setStateFilter(e.target.value); setPage(1); }}
            className="text-sm border rounded px-3 py-1.5"
          >
            {stateOptions.map(o => (
              <option key={o.value} value={o.value}>{lang === 'ar' ? o.labelAr : o.labelEn}</option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">
            {total} {lang === 'ar' ? 'مكتب' : 'offices'}
          </span>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            {lang === 'ar' ? 'جاري التحميل...' : 'Loading…'}
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-start px-4 py-2.5 font-medium text-muted-foreground text-xs">
                    {lang === 'ar' ? 'المكتب' : 'Office'}
                  </th>
                  <th className="text-start px-4 py-2.5 font-medium text-muted-foreground text-xs">
                    {lang === 'ar' ? 'الحالة' : 'State'}
                  </th>
                  <th className="text-start px-4 py-2.5 font-medium text-muted-foreground text-xs hidden sm:table-cell">
                    {lang === 'ar' ? 'تاريخ الانتهاء' : 'Expires'}
                  </th>
                  <th className="text-start px-4 py-2.5 font-medium text-muted-foreground text-xs hidden md:table-cell">
                    {lang === 'ar' ? 'المدينة' : 'City'}
                  </th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-10 text-muted-foreground text-sm">
                    {lang === 'ar' ? 'لا توجد نتائج' : 'No results'}
                  </td></tr>
                )}
                {items.map(row => (
                  <tr key={row.sub_id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-sm leading-tight">{lang === 'ar' && row.name_ar ? row.name_ar : row.name}</p>
                      <p className="text-xs text-muted-foreground">{row.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${stateColor(row.state)}`}>
                        {stateLabel(row.state, lang)}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell text-xs">
                      {row.expires_at ? (
                        <span className={daysLeft(row.expires_at) !== null && daysLeft(row.expires_at)! < 7 ? 'text-amber-600 font-medium' : ''}>
                          {fmtDate(row.expires_at)}
                          {daysLeft(row.expires_at) !== null && daysLeft(row.expires_at)! >= 0 && ` (${daysLeft(row.expires_at)}d)`}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-xs text-muted-foreground">
                      {row.city}{row.country ? `, ${row.country}` : ''}
                    </td>
                    <td className="px-4 py-3 text-end">
                      <button
                        onClick={() => setDetailId(row.office_id)}
                        className="text-xs text-primary hover:underline"
                      >
                        {lang === 'ar' ? 'تفاصيل' : 'Details'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex items-center gap-1 px-3 py-1.5 border rounded disabled:opacity-40"
            >
              <ChevronLeft size={14} />
              {lang === 'ar' ? 'السابق' : 'Prev'}
            </button>
            <span className="text-xs text-muted-foreground">
              {lang === 'ar' ? `صفحة ${page} من ${totalPages}` : `Page ${page} of ${totalPages}`}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="flex items-center gap-1 px-3 py-1.5 border rounded disabled:opacity-40"
            >
              {lang === 'ar' ? 'التالي' : 'Next'}
              <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Detail drawer */}
      {detailId !== null && (
        <DetailDrawer
          officeId={detailId}
          onClose={() => setDetailId(null)}
          language={lang}
          onActionDone={() => { fetchList(); fetchMetrics(); }}
        />
      )}
    </div>
  );
}
