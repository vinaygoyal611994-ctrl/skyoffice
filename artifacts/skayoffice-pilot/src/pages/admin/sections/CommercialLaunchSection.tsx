/**
 * CommercialLaunchSection — Admin control panel for commercial subscription activation.
 *
 * Shows:
 *   • Global commercial state (disabled / scheduled / active)
 *   • Plans list with edit capability
 *   • Campaign creation and management
 *   • Pre-activation notification dispatch
 *   • Final activation confirmation dialog
 *
 * No payment gateway integration. Admin confirmation required to activate.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useI18n } from '@/lib/i18n';
import { safeApiError } from '@/lib/apiError';
import {
  Rocket, AlertTriangle, CheckCircle2, Clock, RefreshCw,
  CreditCard, Bell, Shield, Users, XCircle, ChevronDown, ChevronUp,
  Plus, Edit2, Send, Zap,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type CommercialState = 'disabled' | 'scheduled' | 'active';
type CampaignStatus  = 'draft' | 'scheduled' | 'active' | 'cancelled';

interface Plan {
  id:              number;
  name:            string;
  name_ar:         string;
  description:     string | null;
  description_ar:  string | null;
  monthly_price:   number;  // smallest unit
  currency:        string;
  billing_interval: string;
  is_active:       boolean;
  country_code:    string | null;
  provider_type:   string | null;
  sort_order:      number;
}

interface Campaign {
  id:                    number;
  status:                CampaignStatus;
  plan_id:               number | null;
  target_country:        string | null;
  target_city:           string | null;
  target_provider_type:  string | null;
  scheduled_at:          string | null;
  notification_lead_days: number;
  activated_at:          string | null;
  eligible_count:        number;
  notified_count:        number;
  failed_count:          number;
  excluded_count:        number;
  activated_offices:     number;
  notes:                 string | null;
  created_at:            string;
}

interface NotifSummary {
  queued:  number;
  sent:    number;
  failed:  number;
  total:   number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function apiBase() { return '/api'; }

function authHeaders(): HeadersInit {
  const raw = document.cookie.split(';').map(c => c.trim());
  const tk  = raw.find(c => c.startsWith('skay_bearer='))?.split('=')[1];
  return tk ? { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' }
            : { 'Content-Type': 'application/json' };
}

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${apiBase()}${path}`, {
    credentials: 'include',
    headers: { ...authHeaders(), ...(opts?.headers ?? {}) },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error('request_failed'), { data: body, status: res.status });
  }
  return res.json();
}

function formatPrice(halalas: number, currency: string) {
  const major = halalas / 100;
  return `${major.toLocaleString('ar-SA', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${currency}`;
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ── State badge ───────────────────────────────────────────────────────────────

function StateBadge({ state }: { state: CommercialState | CampaignStatus }) {
  const map: Record<string, { label: string; labelAr: string; cls: string }> = {
    disabled:  { label: 'Disabled',   labelAr: 'معطّل',      cls: 'bg-slate-100 text-slate-600' },
    scheduled: { label: 'Scheduled',  labelAr: 'مجدول',      cls: 'bg-amber-100  text-amber-700' },
    active:    { label: 'Active',     labelAr: 'مفعّل',      cls: 'bg-green-100  text-green-700' },
    draft:     { label: 'Draft',      labelAr: 'مسودة',      cls: 'bg-slate-100 text-slate-600' },
    cancelled: { label: 'Cancelled',  labelAr: 'ملغى',       cls: 'bg-red-100    text-red-700'   },
  };
  const { label, labelAr, cls } = map[state] ?? { label: state, labelAr: state, cls: 'bg-gray-100 text-gray-600' };
  const { language } = useI18n();
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {language === 'ar' ? labelAr : label}
    </span>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function CommercialLaunchSection() {
  const { language } = useI18n();
  const isAr = language === 'ar';

  const [state, setState]           = useState<CommercialState>('disabled');
  const [plans, setPlans]           = useState<Plan[]>([]);
  const [campaigns, setCampaigns]   = useState<Campaign[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);

  // Campaign creation form
  const [showCreateForm, setShowCreateForm]     = useState(false);
  const [selectedPlanId, setSelectedPlanId]     = useState<string>('');
  const [targetCountry, setTargetCountry]       = useState('');
  const [targetCity, setTargetCity]             = useState('');
  const [targetProviderType, setTargetProviderType] = useState('');
  const [scheduledAt, setScheduledAt]           = useState('');
  const [notifLeadDays, setNotifLeadDays]       = useState('7');
  const [notes, setNotes]                       = useState('');
  const [creating, setCreating]                 = useState(false);

  // Plan edit form
  const [showPlanForm, setShowPlanForm]         = useState(false);
  const [editingPlan, setEditingPlan]           = useState<Partial<Plan> | null>(null);
  const [savingPlan, setSavingPlan]             = useState(false);

  // Campaign detail drawer
  const [detailId, setDetailId]               = useState<number | null>(null);
  const [detail, setDetail]                   = useState<{ campaign: Campaign; notifications: NotifSummary } | null>(null);
  const [detailLoading, setDetailLoading]     = useState(false);
  const [notifying, setNotifying]             = useState(false);
  const [activating, setActivating]           = useState(false);
  const [activateConfirm, setActivateConfirm] = useState(false);
  const [actionMsg, setActionMsg]             = useState<string | null>(null);

  // Load initial data
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [stateRes, plansRes, campaignsRes] = await Promise.all([
        apiFetch('/admin/commercial/state'),
        apiFetch('/admin/commercial/plans'),
        apiFetch('/admin/commercial/campaigns'),
      ]);
      setState(stateRes.state);
      setPlans(plansRes);
      setCampaigns(campaignsRes);
    } catch (e: any) {
      setError(safeApiError(e, language));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Load campaign detail
  useEffect(() => {
    if (detailId == null) { setDetail(null); return; }
    setDetailLoading(true);
    apiFetch(`/admin/commercial/campaigns/${detailId}`)
      .then(d => setDetail(d))
      .catch(e => setActionMsg(safeApiError(e, language)))
      .finally(() => setDetailLoading(false));
  }, [detailId]);

  // ── Create campaign ─────────────────────────────────────────────────────────

  async function handleCreateCampaign(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      await apiFetch('/admin/commercial/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          planId:               selectedPlanId ? parseInt(selectedPlanId) : undefined,
          targetCountry:        targetCountry || null,
          targetCity:           targetCity    || null,
          targetProviderType:   targetProviderType || null,
          scheduledAt:          scheduledAt ? new Date(scheduledAt).toISOString() : null,
          notificationLeadDays: parseInt(notifLeadDays) || 7,
          notes:                notes || null,
        }),
      });
      setShowCreateForm(false);
      setSelectedPlanId(''); setTargetCountry(''); setTargetCity('');
      setTargetProviderType(''); setScheduledAt(''); setNotes('');
      await load();
    } catch (e: any) {
      setError(safeApiError(e, language));
    } finally {
      setCreating(false);
    }
  }

  // ── Save plan ───────────────────────────────────────────────────────────────

  async function handleSavePlan(e: React.FormEvent) {
    e.preventDefault();
    if (!editingPlan) return;
    setSavingPlan(true);
    try {
      const body = {
        name:         editingPlan.name,
        nameAr:       editingPlan.name_ar,
        description:  editingPlan.description ?? null,
        descriptionAr: editingPlan.description_ar ?? null,
        monthlyPrice: typeof editingPlan.monthly_price === 'string'
          ? Math.round(parseFloat(editingPlan.monthly_price as any) * 100)
          : editingPlan.monthly_price,
        currency:     editingPlan.currency ?? 'SAR',
        billingInterval: editingPlan.billing_interval ?? 'monthly',
        isActive:     editingPlan.is_active ?? true,
        countryCode:  editingPlan.country_code ?? null,
        providerType: editingPlan.provider_type ?? null,
        sortOrder:    editingPlan.sort_order ?? 0,
      };

      if (editingPlan.id) {
        await apiFetch(`/admin/commercial/plans/${editingPlan.id}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await apiFetch('/admin/commercial/plans', { method: 'POST', body: JSON.stringify(body) });
      }
      setShowPlanForm(false);
      setEditingPlan(null);
      await load();
    } catch (e: any) {
      setError(safeApiError(e, language));
    } finally {
      setSavingPlan(false);
    }
  }

  // ── Send notifications ──────────────────────────────────────────────────────

  async function handleNotify() {
    if (!detailId) return;
    setNotifying(true);
    setActionMsg(null);
    try {
      const r = await apiFetch(`/admin/commercial/campaigns/${detailId}/notify`, { method: 'POST' });
      setActionMsg(isAr
        ? `✅ تم الإرسال: ${r.sentCount} | فشل: ${r.failedCount} | مكرر: ${r.skippedCount}`
        : `✅ Sent: ${r.sentCount} | Failed: ${r.failedCount} | Skipped (dedup): ${r.skippedCount}`
      );
      const d = await apiFetch(`/admin/commercial/campaigns/${detailId}`);
      setDetail(d);
      await load();
    } catch (e: any) {
      setActionMsg(`❌ ${safeApiError(e, language)}`);
    } finally {
      setNotifying(false);
    }
  }

  // ── Activate campaign ───────────────────────────────────────────────────────

  async function handleActivate() {
    if (!detailId) return;
    setActivating(true);
    setActionMsg(null);
    try {
      const r = await apiFetch(`/admin/commercial/campaigns/${detailId}/activate`, {
        method: 'POST',
        body: JSON.stringify({ confirmed: true }),
      });
      setActionMsg(isAr
        ? `✅ تم التفعيل! مكاتب مفعّلة: ${r.activatedOffices} | تم التخطي: ${r.skipped} | أخطاء: ${r.errors}`
        : `✅ Activated! Offices started: ${r.activatedOffices} | Skipped: ${r.skipped} | Errors: ${r.errors}`
      );
      setActivateConfirm(false);
      await load();
      const d = await apiFetch(`/admin/commercial/campaigns/${detailId}`);
      setDetail(d);
    } catch (e: any) {
      setActionMsg(`❌ ${safeApiError(e, language)}`);
    } finally {
      setActivating(false);
    }
  }

  // ── Cancel campaign ─────────────────────────────────────────────────────────

  async function handleCancelCampaign(id: number) {
    if (!confirm(isAr ? 'تأكيد إلغاء الحملة؟' : 'Cancel this campaign?')) return;
    try {
      await apiFetch(`/admin/commercial/campaigns/${id}/cancel`, { method: 'POST' });
      if (detailId === id) setDetailId(null);
      await load();
    } catch (e: any) {
      setError(safeApiError(e, language));
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <RefreshCw className="animate-spin text-muted-foreground" size={24} />
      </div>
    );
  }

  const activeCampaign = campaigns.find(c => c.status === 'active');
  const latestCampaign = campaigns.find(c => c.status !== 'cancelled') ?? campaigns[0];

  return (
    <div className="space-y-6">

      {/* ── Global state banner ─────────────────────────────────────────────── */}
      <div className={`rounded-xl border p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4
        ${state === 'active'    ? 'border-green-200 bg-green-50'
        : state === 'scheduled' ? 'border-amber-200 bg-amber-50'
                                : 'border-slate-200 bg-slate-50'}`}>
        <div className="flex items-center gap-3">
          {state === 'active'    ? <CheckCircle2 size={24} className="text-green-600" />
          : state === 'scheduled' ? <Clock size={24} className="text-amber-600" />
                                  : <Shield size={24} className="text-slate-500" />}
          <div>
            <p className="font-semibold text-sm">
              {isAr ? 'الحالة التجارية' : 'Commercial State'}
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              <StateBadge state={state} />
              {latestCampaign?.scheduled_at && state !== 'active' && (
                <span className="text-xs text-muted-foreground">
                  {isAr ? 'تاريخ التفعيل:' : 'Activation:'} {formatDate(latestCampaign.scheduled_at)}
                </span>
              )}
            </div>
          </div>
        </div>
        <button
          onClick={load}
          className="text-muted-foreground hover:text-foreground transition-colors self-start sm:self-auto"
        >
          <RefreshCw size={15} />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle size={15} /> {error}
        </div>
      )}

      {/* ── KPI row from latest campaign ───────────────────────────────────── */}
      {latestCampaign && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { icon: <Users size={16} />,      val: latestCampaign.eligible_count,  labelAr: 'مكاتب مؤهلة',     labelEn: 'Eligible Offices'   },
            { icon: <Bell size={16} />,       val: latestCampaign.notified_count,  labelAr: 'تم الإشعار',      labelEn: 'Notified'           },
            { icon: <XCircle size={16} />,    val: latestCampaign.failed_count,    labelAr: 'فشل الإرسال',     labelEn: 'Failed Notif.'      },
            { icon: <Zap size={16} />,        val: latestCampaign.activated_offices, labelAr: 'مفعّلة',        labelEn: 'Activated'          },
          ].map((kpi, i) => (
            <div key={i} className="rounded-lg border bg-card p-4">
              <div className="flex items-center gap-1.5 text-muted-foreground text-xs mb-1">
                {kpi.icon} {isAr ? kpi.labelAr : kpi.labelEn}
              </div>
              <p className="text-2xl font-bold">{kpi.val.toLocaleString()}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Plans ──────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border bg-card">
        <div className="flex items-center justify-between px-5 py-3.5 border-b">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <CreditCard size={15} /> {isAr ? 'الخطط' : 'Plans'}
          </h3>
          <button
            onClick={() => { setEditingPlan({ is_active: true, currency: 'SAR', billing_interval: 'monthly', sort_order: 0 }); setShowPlanForm(true); }}
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <Plus size={13} /> {isAr ? 'خطة جديدة' : 'New Plan'}
          </button>
        </div>

        {plans.length === 0 ? (
          <p className="text-muted-foreground text-sm text-center py-8">
            {isAr ? 'لا توجد خطط بعد' : 'No plans yet'}
          </p>
        ) : (
          <div className="divide-y">
            {plans.map(plan => (
              <div key={plan.id} className="flex items-center justify-between px-5 py-3.5">
                <div>
                  <p className="font-medium text-sm">{isAr ? plan.name_ar : plan.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatPrice(plan.monthly_price, plan.currency)} / {plan.billing_interval}
                    {plan.country_code   && ` · ${plan.country_code}`}
                    {plan.provider_type  && ` · ${plan.provider_type}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${plan.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                    {isAr ? (plan.is_active ? 'نشط' : 'معطّل') : (plan.is_active ? 'Active' : 'Inactive')}
                  </span>
                  <button
                    onClick={() => { setEditingPlan(plan); setShowPlanForm(true); }}
                    className="p-1 text-muted-foreground hover:text-foreground"
                  >
                    <Edit2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Plan form modal ─────────────────────────────────────────────────── */}
      {showPlanForm && editingPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card rounded-2xl shadow-xl w-full max-w-md p-6">
            <h3 className="font-semibold mb-4">
              {isAr ? (editingPlan.id ? 'تعديل الخطة' : 'خطة جديدة') : (editingPlan.id ? 'Edit Plan' : 'New Plan')}
            </h3>
            <form onSubmit={handleSavePlan} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">{isAr ? 'الاسم بالإنجليزية' : 'Name (EN)'}</label>
                  <input className="input mt-1" value={editingPlan.name ?? ''} required
                    onChange={e => setEditingPlan(p => ({ ...p!, name: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">{isAr ? 'الاسم بالعربية' : 'Name (AR)'}</label>
                  <input className="input mt-1" value={editingPlan.name_ar ?? ''} required dir="rtl"
                    onChange={e => setEditingPlan(p => ({ ...p!, name_ar: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">{isAr ? 'السعر الشهري (ريال)' : 'Monthly Price (SAR)'}</label>
                  <input className="input mt-1" type="number" min="0" step="0.01"
                    value={editingPlan.monthly_price != null ? editingPlan.monthly_price / 100 : ''}
                    onChange={e => setEditingPlan(p => ({ ...p!, monthly_price: Math.round(parseFloat(e.target.value) * 100) || 0 }))} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">{isAr ? 'العملة' : 'Currency'}</label>
                  <input className="input mt-1" value={editingPlan.currency ?? 'SAR'}
                    onChange={e => setEditingPlan(p => ({ ...p!, currency: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">{isAr ? 'الدولة (اختياري)' : 'Country (optional)'}</label>
                  <input className="input mt-1" value={editingPlan.country_code ?? ''}
                    onChange={e => setEditingPlan(p => ({ ...p!, country_code: e.target.value || null }))} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">{isAr ? 'نوع المزود' : 'Provider Type'}</label>
                  <select className="input mt-1" value={editingPlan.provider_type ?? ''}
                    onChange={e => setEditingPlan(p => ({ ...p!, provider_type: e.target.value || null }))}>
                    <option value="">{isAr ? 'الكل' : 'All'}</option>
                    <option value="office">{isAr ? 'مكاتب' : 'Office'}</option>
                    <option value="freelancer">{isAr ? 'مستقلون' : 'Freelancer'}</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="planActive" checked={editingPlan.is_active ?? true}
                  onChange={e => setEditingPlan(p => ({ ...p!, is_active: e.target.checked }))} />
                <label htmlFor="planActive" className="text-sm">
                  {isAr ? 'الخطة نشطة' : 'Plan is active'}
                </label>
              </div>
              <div className="flex gap-2 pt-2">
                <button type="submit" disabled={savingPlan}
                  className="btn-primary flex-1 flex items-center justify-center gap-1.5">
                  {savingPlan ? <RefreshCw size={14} className="animate-spin" /> : null}
                  {isAr ? 'حفظ' : 'Save'}
                </button>
                <button type="button" onClick={() => { setShowPlanForm(false); setEditingPlan(null); }}
                  className="btn-secondary flex-1">
                  {isAr ? 'إلغاء' : 'Cancel'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Campaigns ──────────────────────────────────────────────────────── */}
      <div className="rounded-xl border bg-card">
        <div className="flex items-center justify-between px-5 py-3.5 border-b">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Rocket size={15} /> {isAr ? 'حملات التفعيل' : 'Activation Campaigns'}
          </h3>
          {!activeCampaign && (
            <button
              onClick={() => setShowCreateForm(v => !v)}
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <Plus size={13} /> {isAr ? 'حملة جديدة' : 'New Campaign'}
            </button>
          )}
        </div>

        {/* Create form */}
        {showCreateForm && (
          <form onSubmit={handleCreateCampaign} className="px-5 py-4 border-b bg-muted/30 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">{isAr ? 'الخطة' : 'Plan'}</label>
                <select className="input mt-1" value={selectedPlanId}
                  onChange={e => setSelectedPlanId(e.target.value)}>
                  <option value="">{isAr ? 'بدون تحديد' : 'None'}</option>
                  {plans.filter(p => p.is_active).map(p => (
                    <option key={p.id} value={p.id}>{isAr ? p.name_ar : p.name} — {formatPrice(p.monthly_price, p.currency)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{isAr ? 'تاريخ التفعيل' : 'Scheduled Activation'}</label>
                <input type="datetime-local" className="input mt-1" value={scheduledAt}
                  onChange={e => setScheduledAt(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{isAr ? 'الدولة (اختياري)' : 'Country (optional)'}</label>
                <input className="input mt-1" placeholder={isAr ? 'مثال: Saudi Arabia' : 'e.g. Saudi Arabia'} value={targetCountry}
                  onChange={e => setTargetCountry(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{isAr ? 'المدينة (اختياري)' : 'City (optional)'}</label>
                <input className="input mt-1" placeholder={isAr ? 'مثال: الرياض' : 'e.g. Riyadh'} value={targetCity}
                  onChange={e => setTargetCity(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{isAr ? 'نوع المزود' : 'Provider Type'}</label>
                <select className="input mt-1" value={targetProviderType} onChange={e => setTargetProviderType(e.target.value)}>
                  <option value="">{isAr ? 'الكل' : 'All'}</option>
                  <option value="office">{isAr ? 'مكاتب' : 'Office'}</option>
                  <option value="freelancer">{isAr ? 'مستقلون' : 'Freelancer'}</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{isAr ? 'مدة الإشعار المسبق (أيام)' : 'Notification Lead (days)'}</label>
                <input type="number" min="1" max="90" className="input mt-1" value={notifLeadDays}
                  onChange={e => setNotifLeadDays(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{isAr ? 'ملاحظات' : 'Notes'}</label>
              <textarea className="input mt-1 w-full" rows={2} value={notes}
                onChange={e => setNotes(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={creating}
                className="btn-primary flex items-center gap-1.5 text-sm">
                {creating ? <RefreshCw size={13} className="animate-spin" /> : <Plus size={13} />}
                {isAr ? 'إنشاء الحملة' : 'Create Campaign'}
              </button>
              <button type="button" onClick={() => setShowCreateForm(false)} className="btn-secondary text-sm">
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
            </div>
          </form>
        )}

        {campaigns.length === 0 ? (
          <p className="text-muted-foreground text-sm text-center py-8">
            {isAr ? 'لا توجد حملات بعد' : 'No campaigns yet'}
          </p>
        ) : (
          <div className="divide-y">
            {campaigns.map(c => {
              const plan = plans.find(p => p.id === c.plan_id);
              return (
                <div key={c.id} className="px-5 py-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <StateBadge state={c.status} />
                        {plan && (
                          <span className="text-xs text-muted-foreground">
                            {isAr ? plan.name_ar : plan.name} · {formatPrice(plan.monthly_price, plan.currency)}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {c.scheduled_at
                          ? (isAr ? `التفعيل: ${formatDate(c.scheduled_at)}` : `Activation: ${formatDate(c.scheduled_at)}`)
                          : (isAr ? 'لا يوجد تاريخ مجدول' : 'No date scheduled')}
                        {c.target_country && ` · ${c.target_country}`}
                        {c.target_city    && ` · ${c.target_city}`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {isAr
                          ? `مؤهل: ${c.eligible_count} | مُشعَر: ${c.notified_count} | فشل: ${c.failed_count} | مُستبعَد: ${c.excluded_count}`
                          : `Eligible: ${c.eligible_count} | Notified: ${c.notified_count} | Failed: ${c.failed_count} | Excluded: ${c.excluded_count}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => setDetailId(detailId === c.id ? null : c.id)}
                        className="text-xs text-primary hover:underline flex items-center gap-0.5"
                      >
                        {detailId === c.id
                          ? <><ChevronUp size={12}/> {isAr ? 'إخفاء' : 'Hide'}</>
                          : <><ChevronDown size={12}/> {isAr ? 'تفاصيل' : 'Details'}</>}
                      </button>
                      {c.status !== 'active' && c.status !== 'cancelled' && (
                        <button
                          onClick={() => handleCancelCampaign(c.id)}
                          className="text-xs text-red-500 hover:underline ms-2"
                        >
                          {isAr ? 'إلغاء' : 'Cancel'}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Detail drawer */}
                  {detailId === c.id && (
                    <div className="mt-4 rounded-lg border bg-muted/20 p-4 space-y-4">
                      {detailLoading ? (
                        <div className="flex justify-center py-4">
                          <RefreshCw size={16} className="animate-spin text-muted-foreground" />
                        </div>
                      ) : detail ? (
                        <>
                          {/* Notification summary */}
                          <div>
                            <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                              {isAr ? 'الإشعارات' : 'Notifications'}
                            </p>
                            <div className="grid grid-cols-4 gap-2 text-center">
                              {[
                                { label: isAr ? 'انتظار' : 'Queued',  val: detail.notifications.queued  },
                                { label: isAr ? 'أُرسل'  : 'Sent',    val: detail.notifications.sent    },
                                { label: isAr ? 'فشل'    : 'Failed',  val: detail.notifications.failed  },
                                { label: isAr ? 'المجموع': 'Total',   val: detail.notifications.total   },
                              ].map((n, i) => (
                                <div key={i} className="rounded-md bg-card border py-2">
                                  <p className="text-lg font-bold">{n.val}</p>
                                  <p className="text-xs text-muted-foreground">{n.label}</p>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Action message */}
                          {actionMsg && (
                            <p className="text-sm rounded-md bg-card border px-3 py-2">{actionMsg}</p>
                          )}

                          {/* Actions */}
                          {detail.campaign.status !== 'active' && detail.campaign.status !== 'cancelled' && (
                            <div className="flex flex-col sm:flex-row gap-2">
                              {/* Notify button */}
                              <button
                                onClick={handleNotify}
                                disabled={notifying}
                                className="flex items-center justify-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 transition-colors disabled:opacity-60"
                              >
                                {notifying ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                                {isAr ? 'إرسال الإشعارات المسبقة' : 'Send Pre-activation Notices'}
                              </button>

                              {/* Final activate */}
                              {!activateConfirm ? (
                                <button
                                  onClick={() => setActivateConfirm(true)}
                                  className="flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                                >
                                  <Zap size={14} />
                                  {isAr ? 'تفعيل تجاري نهائي' : 'Final Commercial Activate'}
                                </button>
                              ) : (
                                <div className="rounded-lg border border-red-300 bg-red-50 p-3 space-y-2">
                                  <p className="text-sm font-semibold text-red-800 flex items-center gap-1.5">
                                    <AlertTriangle size={15} />
                                    {isAr
                                      ? 'تأكيد التفعيل التجاري — لا يمكن التراجع'
                                      : 'Confirm commercial activation — cannot be undone'}
                                  </p>
                                  <p className="text-xs text-red-700">
                                    {isAr
                                      ? `سيبدأ ${detail.campaign.eligible_count} مكتب مؤهل في فترة التجربة. سيتم تفعيل دورة الاشتراك بالكامل.`
                                      : `${detail.campaign.eligible_count} eligible offices will start their trial. Full subscription lifecycle will be enforced.`}
                                  </p>
                                  <div className="flex gap-2">
                                    <button
                                      onClick={handleActivate}
                                      disabled={activating}
                                      className="flex items-center gap-1.5 rounded-md bg-red-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                                    >
                                      {activating ? <RefreshCw size={13} className="animate-spin" /> : <Zap size={13} />}
                                      {isAr ? 'نعم، فعّل الآن' : 'Yes, Activate Now'}
                                    </button>
                                    <button
                                      onClick={() => setActivateConfirm(false)}
                                      className="rounded-md border px-4 py-1.5 text-sm hover:bg-muted"
                                    >
                                      {isAr ? 'إلغاء' : 'Cancel'}
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          {detail.campaign.status === 'active' && (
                            <div className="flex items-center gap-2 text-sm text-green-700">
                              <CheckCircle2 size={16} />
                              {isAr
                                ? `تم التفعيل في ${formatDate(detail.campaign.activated_at)} — ${detail.campaign.activated_offices} مكتب مفعّل`
                                : `Activated on ${formatDate(detail.campaign.activated_at)} — ${detail.campaign.activated_offices} offices started`}
                            </div>
                          )}
                        </>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
