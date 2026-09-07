/**
 * CommercialGrowth — Commercial Growth & Subscription Intelligence panel.
 *
 * Fetches GET /api/admin/subscriptions/commercial and renders:
 *   • Period selector (4 options)
 *   • KPI rows (Active Paid, New, Renewals, Reactivations, Churn, Net, MRR /
 *               Renewal Rate, Churn Rate, Growth %, Revenue)
 *   • Current vs Previous comparison table
 *   • Office vs Freelancer side-by-side cards
 *   • Lifecycle movement table
 *   • Growth alert banners
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp, TrendingDown, Minus, AlertCircle, AlertTriangle, Info,
} from 'lucide-react';
import { safeApiError } from '@/lib/apiError';

// ── Types ─────────────────────────────────────────────────────────────────────

type CommercialPeriod = 'current_month' | 'previous_month' | 'last_30d' | 'prev_30d';

interface SnapshotCounts {
  free: number; trial: number; activePaid: number; expiring: number;
  expired: number; hiddenDueToNonPayment: number; cancelled: number; totalEligible: number;
}

interface SnapshotByProvider {
  office:     SnapshotCounts;
  freelancer: SnapshotCounts;
  total:      SnapshotCounts;
}

interface PeriodActivity {
  newTrial: number; newPaid: number; renewals: number;
  reactivations: number; churn: number; netGrowth: number;
}

interface PeriodActivityByProvider {
  office: PeriodActivity; freelancer: PeriodActivity; total: PeriodActivity;
}

interface MrrSnapshot {
  officeMrr: number; freelancerMrr: number; totalMrr: number;
}

interface RevenueMetrics {
  officeRevenue: number; freelancerRevenue: number; totalRevenue: number;
}

interface Rates {
  renewalRate: number | null; churnRate: number | null;
  retentionRate: number | null; growthPct: number | null;
}

interface GrowthAlert {
  severity: 'critical' | 'warning' | 'info';
  code:     string;
  message:  string;
}

interface CommercialReport {
  period:          { start: string; end: string };
  previousPeriod:  { start: string; end: string };
  snapshot:        SnapshotByProvider;
  current:         PeriodActivityByProvider;
  previous:        PeriodActivityByProvider;
  mrr:             MrrSnapshot;
  currentRevenue:  RevenueMetrics;
  previousRevenue: RevenueMetrics;
  rates:           Rates;
  alerts:          GrowthAlert[];
  cohortFoundationReady: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function apiBase() { return '/api'; }

async function apiFetch(path: string) {
  const token = localStorage.getItem('skay_session_token');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${apiBase()}${path}`, { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error('request_failed'), { data: body, status: res.status });
  }
  return res.json();
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('en');
}

function fmtSAR(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${n.toLocaleString('en', { minimumFractionDigits: 0 })} SAR`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${n > 0 ? '+' : ''}${n}%`;
}

function diffColor(diff: number): string {
  if (diff > 0) return 'text-green-600';
  if (diff < 0) return 'text-red-600';
  return 'text-muted-foreground';
}

function fmtDiff(a: number | null, b: number | null, invert = false): React.ReactNode {
  if (a == null || b == null) return <span className="text-muted-foreground">—</span>;
  const diff = a - b;
  const color = invert ? diffColor(-diff) : diffColor(diff);
  const sign  = diff > 0 ? '+' : '';
  return <span className={color}>{sign}{diff}</span>;
}

function fmtPctDiff(a: number | null, b: number | null, invert = false): React.ReactNode {
  if (a == null || b == null || b === 0) return <span className="text-muted-foreground">—</span>;
  const pct   = Math.round(((a - b) / Math.abs(b)) * 1000) / 10;
  const color = invert ? diffColor(-pct) : diffColor(pct);
  const sign  = pct > 0 ? '+' : '';
  return <span className={color}>{sign}{pct}%</span>;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Kpi({ label, value, sub, color }: {
  label: string; value: string; sub?: string; color?: string;
}) {
  return (
    <div className="bg-white border rounded-lg p-3 flex flex-col gap-0.5 min-w-0">
      <span className="text-xs text-muted-foreground truncate">{label}</span>
      <span className={`text-xl font-bold ${color ?? 'text-foreground'}`}>{value}</span>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </div>
  );
}

function AlertBanner({ alert }: { alert: GrowthAlert }) {
  const colorMap: Record<GrowthAlert['severity'], string> = {
    critical: 'bg-red-50 border-red-200 text-red-700',
    warning:  'bg-amber-50 border-amber-200 text-amber-700',
    info:     'bg-blue-50 border-blue-200 text-blue-700',
  };
  const IconMap: Record<GrowthAlert['severity'], React.ElementType> = {
    critical: AlertCircle,
    warning:  AlertTriangle,
    info:     Info,
  };
  const Icon = IconMap[alert.severity];
  return (
    <div className={`flex items-start gap-2 border rounded-lg px-3 py-2.5 text-xs ${colorMap[alert.severity]}`}>
      <Icon size={14} className="mt-0.5 shrink-0" />
      <span>{alert.message}</span>
    </div>
  );
}

function ComparisonTable({ current, previous, lang }: {
  current:  PeriodActivity;
  previous: PeriodActivity;
  lang:     'ar' | 'en';
}) {
  const rows: { label: string; curr: number; prev: number; invertDiff?: boolean }[] = [
    { label: lang === 'ar' ? 'مدفوع جديد'   : 'New Paid',      curr: current.newPaid,       prev: previous.newPaid       },
    { label: lang === 'ar' ? 'تجديدات'       : 'Renewals',      curr: current.renewals,      prev: previous.renewals      },
    { label: lang === 'ar' ? 'إعادة تفعيل'   : 'Reactivations', curr: current.reactivations, prev: previous.reactivations },
    { label: lang === 'ar' ? 'انسحاب'        : 'Churn',         curr: current.churn,         prev: previous.churn,        invertDiff: true },
    { label: lang === 'ar' ? 'النمو الصافي'  : 'Net Growth',    curr: current.netGrowth,     prev: previous.netGrowth     },
  ];

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b bg-muted/30">
          <th className="text-start px-3 py-2 font-medium text-muted-foreground">{lang === 'ar' ? 'المقياس' : 'Metric'}</th>
          <th className="text-end px-3 py-2 font-medium text-muted-foreground">{lang === 'ar' ? 'الحالي' : 'Current'}</th>
          <th className="text-end px-3 py-2 font-medium text-muted-foreground">{lang === 'ar' ? 'السابق' : 'Previous'}</th>
          <th className="text-end px-3 py-2 font-medium text-muted-foreground">{lang === 'ar' ? 'الفرق' : 'Diff'}</th>
          <th className="text-end px-3 py-2 font-medium text-muted-foreground">%</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(row => (
          <tr key={row.label} className="border-b last:border-0 hover:bg-muted/10">
            <td className="px-3 py-2">{row.label}</td>
            <td className="px-3 py-2 text-end font-medium">{fmt(row.curr)}</td>
            <td className="px-3 py-2 text-end text-muted-foreground">{fmt(row.prev)}</td>
            <td className="px-3 py-2 text-end">{fmtDiff(row.curr, row.prev, row.invertDiff)}</td>
            <td className="px-3 py-2 text-end">{fmtPctDiff(row.curr, row.prev, row.invertDiff)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ProviderCard({ title, activity, snapshot, mrr, revenue, lang }: {
  title:    string;
  activity: PeriodActivity;
  snapshot: SnapshotCounts;
  mrr:      number;
  revenue:  number;
  lang:     'ar' | 'en';
}) {
  return (
    <div className="border rounded-lg p-4 space-y-3 flex-1 min-w-0">
      <h4 className="text-sm font-semibold">{title}</h4>
      <div className="grid grid-cols-2 gap-2">
        <Kpi label={lang === 'ar' ? 'مدفوع نشط' : 'Active Paid'} value={fmt(snapshot.activePaid + snapshot.expiring)} color="text-green-600" />
        <Kpi label={lang === 'ar' ? 'تجديدات'   : 'Renewals'}    value={fmt(activity.renewals)}                       color="text-blue-600"  />
        <Kpi label={lang === 'ar' ? 'انسحاب'    : 'Churn'}       value={fmt(activity.churn)}                          color="text-red-600"   />
        <Kpi label="MRR"                                           value={fmtSAR(mrr)}                                 color="text-purple-600"/>
      </div>
      <div className="text-xs text-muted-foreground flex justify-between border-t pt-2">
        <span>{lang === 'ar' ? 'الإيرادات' : 'Revenue'}</span>
        <span className="font-medium text-foreground">{fmtSAR(revenue)}</span>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

interface CommercialGrowthProps {
  lang: 'ar' | 'en';
}

export function CommercialGrowth({ lang }: CommercialGrowthProps) {
  const [period,  setPeriod]  = useState<CommercialPeriod>('last_30d');
  const [report,  setReport]  = useState<CommercialReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState<string | null>(null);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await apiFetch(`/admin/subscriptions/commercial?period=${period}`);
      setReport(data);
    } catch (e: unknown) {
      setErr(safeApiError(e, lang));
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  const periodOptions: { value: CommercialPeriod; labelAr: string; labelEn: string }[] = [
    { value: 'current_month',  labelAr: 'الشهر الحالي',    labelEn: 'Current Month'  },
    { value: 'previous_month', labelAr: 'الشهر الماضي',    labelEn: 'Previous Month' },
    { value: 'last_30d',       labelAr: 'آخر 30 يوم',      labelEn: 'Last 30 Days'   },
    { value: 'prev_30d',       labelAr: 'الـ 30 السابقة',  labelEn: 'Prev 30 Days'   },
  ];

  return (
    <div className="border rounded-lg p-4 space-y-5 bg-gradient-to-br from-slate-50 to-white">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold">
            {lang === 'ar' ? 'النمو التجاري والاشتراكات' : 'Commercial Growth & Subscriptions'}
          </h3>
          {report && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {new Date(report.period.start).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
              {' — '}
              {new Date(report.period.end).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
            </p>
          )}
        </div>
        <select
          value={period}
          onChange={e => setPeriod(e.target.value as CommercialPeriod)}
          className="text-xs border rounded px-2 py-1 bg-white"
        >
          {periodOptions.map(o => (
            <option key={o.value} value={o.value}>{lang === 'ar' ? o.labelAr : o.labelEn}</option>
          ))}
        </select>
      </div>

      {/* Loading */}
      {loading && (
        <p className="text-sm text-muted-foreground py-6 text-center">
          {lang === 'ar' ? 'جاري التحميل...' : 'Loading…'}
        </p>
      )}

      {/* Error */}
      {!loading && err && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
          <AlertCircle size={14} />
          {err}
        </div>
      )}

      {/* Report */}
      {!loading && !err && report && (() => {
        const c    = report.current.total;
        const prev = report.previous.total;
        const snap = report.snapshot.total;
        const r    = report.rates;
        const net  = c.netGrowth;

        return (
          <div className="space-y-5">

            {/* Growth alerts */}
            {report.alerts.length > 0 && (
              <div className="space-y-2">
                {report.alerts.map((a, i) => (
                  <AlertBanner key={i} alert={a} />
                ))}
              </div>
            )}

            {/* Row 1: Volume KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-2">
              <Kpi
                label={lang === 'ar' ? 'مدفوع نشط' : 'Active Paid'}
                value={fmt(snap.activePaid + snap.expiring)}
                color="text-green-600"
              />
              <Kpi
                label={lang === 'ar' ? 'جديد' : 'New Paid'}
                value={fmt(c.newPaid)}
                color="text-emerald-600"
              />
              <Kpi
                label={lang === 'ar' ? 'تجديدات' : 'Renewals'}
                value={fmt(c.renewals)}
                color="text-blue-600"
              />
              <Kpi
                label={lang === 'ar' ? 'إعادة تفعيل' : 'Reactivations'}
                value={fmt(c.reactivations)}
                color="text-indigo-600"
              />
              <Kpi
                label={lang === 'ar' ? 'انسحاب' : 'Churn'}
                value={fmt(c.churn)}
                color="text-red-600"
              />
              <div className="bg-white border rounded-lg p-3 flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">{lang === 'ar' ? 'النمو الصافي' : 'Net Growth'}</span>
                <span className={`text-xl font-bold flex items-center gap-1 ${net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {net === 0 ? <Minus size={16}/> : net > 0 ? <TrendingUp size={16}/> : <TrendingDown size={16}/>}
                  {net > 0 ? '+' : ''}{net}
                </span>
              </div>
              <Kpi
                label="MRR"
                value={fmtSAR(report.mrr.totalMrr)}
                color="text-purple-600"
              />
            </div>

            {/* Row 2: Rate KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Kpi
                label={lang === 'ar' ? 'معدل التجديد' : 'Renewal Rate'}
                value={r.renewalRate != null ? `${r.renewalRate}%` : '—'}
                color={r.renewalRate != null
                  ? (r.renewalRate >= 70 ? 'text-green-600' : r.renewalRate >= 40 ? 'text-amber-600' : 'text-red-600')
                  : undefined}
              />
              <Kpi
                label={lang === 'ar' ? 'معدل الانسحاب' : 'Churn Rate'}
                value={r.churnRate != null ? `${r.churnRate}%` : '—'}
                color={r.churnRate != null
                  ? (r.churnRate <= 20 ? 'text-green-600' : r.churnRate <= 40 ? 'text-amber-600' : 'text-red-600')
                  : undefined}
              />
              <div className="bg-white border rounded-lg p-3 flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">{lang === 'ar' ? 'نسبة النمو' : 'Growth %'}</span>
                <span className={`text-xl font-bold ${r.growthPct != null && r.growthPct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {fmtPct(r.growthPct)}
                </span>
                <span className="text-xs text-muted-foreground">{lang === 'ar' ? 'مقارنة بالسابق' : 'vs previous'}</span>
              </div>
              <Kpi
                label={lang === 'ar' ? 'الإيرادات (مؤكدة)' : 'Revenue (verified)'}
                value={fmtSAR(report.currentRevenue.totalRevenue)}
                color="text-purple-600"
                sub={lang === 'ar' ? 'مدفوعات ناجحة فقط' : 'succeeded only'}
              />
            </div>

            {/* Comparison table */}
            <div className="border rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 bg-muted/20 border-b">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {lang === 'ar' ? 'مقارنة الفترتين' : 'Period Comparison'}
                </h4>
              </div>
              <ComparisonTable current={c} previous={prev} lang={lang} />
            </div>

            {/* Office vs Freelancer */}
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                {lang === 'ar' ? 'مكاتب مقابل مستقلون' : 'Office vs Freelancer'}
              </h4>
              <div className="flex flex-col sm:flex-row gap-3">
                <ProviderCard
                  title={lang === 'ar' ? 'مكاتب' : 'Offices'}
                  activity={report.current.office}
                  snapshot={report.snapshot.office}
                  mrr={report.mrr.officeMrr}
                  revenue={report.currentRevenue.officeRevenue}
                  lang={lang}
                />
                <ProviderCard
                  title={lang === 'ar' ? 'مستقلون' : 'Freelancers'}
                  activity={report.current.freelancer}
                  snapshot={report.snapshot.freelancer}
                  mrr={report.mrr.freelancerMrr}
                  revenue={report.currentRevenue.freelancerRevenue}
                  lang={lang}
                />
              </div>
            </div>

            {/* Lifecycle movement table */}
            <div className="border rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 bg-muted/20 border-b">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {lang === 'ar' ? 'حركة دورة الحياة' : 'Lifecycle Movement'}
                </h4>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/10">
                    <th className="text-start px-3 py-2 font-medium text-muted-foreground">{lang === 'ar' ? 'نوع الحركة' : 'Movement'}</th>
                    <th className="text-end px-3 py-2 font-medium text-muted-foreground">{lang === 'ar' ? 'مكاتب' : 'Offices'}</th>
                    <th className="text-end px-3 py-2 font-medium text-muted-foreground">{lang === 'ar' ? 'مستقلون' : 'Freelancers'}</th>
                    <th className="text-end px-3 py-2 font-medium text-muted-foreground">{lang === 'ar' ? 'الإجمالي' : 'Total'}</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      { key: 'newTrial',      labelAr: 'تجربة جديدة',  labelEn: 'New Trial',   color: 'text-blue-600'    },
                      { key: 'newPaid',       labelAr: 'مدفوع جديد',   labelEn: 'New Paid',    color: 'text-emerald-600' },
                      { key: 'renewals',      labelAr: 'تجديدات',      labelEn: 'Renewed',     color: 'text-blue-600'    },
                      { key: 'reactivations', labelAr: 'إعادة تفعيل', labelEn: 'Reactivated', color: 'text-indigo-600'  },
                      { key: 'churn',         labelAr: 'انسحاب',       labelEn: 'Churned',     color: 'text-red-600'     },
                    ] as const
                  ).map(row => (
                    <tr key={row.key} className="border-b last:border-0 hover:bg-muted/10">
                      <td className={`px-3 py-2 font-medium ${row.color}`}>
                        {lang === 'ar' ? row.labelAr : row.labelEn}
                      </td>
                      <td className="px-3 py-2 text-end">{fmt(report.current.office[row.key])}</td>
                      <td className="px-3 py-2 text-end">{fmt(report.current.freelancer[row.key])}</td>
                      <td className="px-3 py-2 text-end font-medium">{fmt(report.current.total[row.key])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          </div>
        );
      })()}
    </div>
  );
}
