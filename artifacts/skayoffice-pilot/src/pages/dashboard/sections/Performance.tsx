/**
 * Office Reports — Phase 1
 *
 * Replaces the previous all-time contact-event summary with a
 * period-based office performance report.
 *
 * Layout order (per spec):
 *   A. Period selector + date labels
 *   B. Recommendation card ("Your Biggest Opportunity")
 *   C. Core metric cards (2-column grid)
 *   D. Daily trend sparkline (only when ≥7 complete days exist)
 *   E. Top service + top city signals
 *   F. Opportunity card (when sufficient data)
 */

import React, { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import {
  useGetOfficeReport,
  useGetMyOffice,
  type ReportPeriod,
  type PeriodMetricPair,
  type RatePair,
  type RecommendationActionTarget,
} from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  Eye, Users, Search, Phone, MessageCircle, Share2, Link2,
  QrCode, TrendingUp, TrendingDown, Minus, Lightbulb, Star,
  MapPin, Info, BarChart3, AlertCircle, CheckCircle2,
} from 'lucide-react';

// ── Period selector ───────────────────────────────────────────────────────────

const PERIODS: { key: ReportPeriod; labelKey: string }[] = [
  { key: '7d',  labelKey: 'report.period_7d'  },
  { key: '30d', labelKey: 'report.period_30d' },
  { key: '90d', labelKey: 'report.period_90d' },
];

// ── Metric definitions ────────────────────────────────────────────────────────

type MetricDef = {
  key: string;
  labelKey: string;
  icon: React.ReactNode;
  color: string;
  tooltipKey?: string;
};

// ── Mini sparkline (inline SVG, no dependency) ────────────────────────────────

interface SparklineProps {
  data: number[];
  color: string;
  height?: number;
}

function Sparkline({ data, color, height = 36 }: SparklineProps) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 120;
  const h = height;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="overflow-visible"
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ── Change badge ──────────────────────────────────────────────────────────────

interface ChangeBadgeProps {
  change: number | null;
  previous: number;
  current: number;
  isRate?: boolean;
}

function ChangeBadge({ change, previous, current, isRate }: ChangeBadgeProps) {
  const { t } = useI18n();
  // Both zero: no indicator
  if (current === 0 && previous === 0) return null;
  // "New" case: previous was 0 and now there's data
  if (previous === 0 && current > 0) {
    return (
      <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 px-1.5 py-0.5 rounded-full">
        {t('report.new')}
      </span>
    );
  }
  if (change === null) return null;
  const isPositive = change > 0;
  const isZero = change === 0;
  if (isZero) {
    return (
      <span className="text-[10px] font-medium text-muted-foreground flex items-center gap-0.5">
        <Minus size={10} />0%
      </span>
    );
  }
  return (
    <span
      className={`text-[10px] font-semibold flex items-center gap-0.5 px-1.5 py-0.5 rounded-full ${
        isPositive
          ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30'
          : 'text-amber-600 bg-amber-50 dark:bg-amber-950/30'
      }`}
    >
      {isPositive ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
      {isPositive ? '+' : ''}{change}%
    </span>
  );
}

// ── Metric card ───────────────────────────────────────────────────────────────

interface MetricCardProps {
  label: string;
  tooltip?: string;
  metric: PeriodMetricPair | RatePair;
  icon: React.ReactNode;
  iconBg: string;
  isRate?: boolean;
  formatValue?: (v: number | null) => string;
}

function MetricCard({ label, tooltip, metric, icon, iconBg, isRate, formatValue }: MetricCardProps) {
  const { t } = useI18n();
  const current = metric.current ?? 0;
  const previous = metric.previous ?? 0;
  const displayCurrent = formatValue
    ? formatValue(metric.current as number | null)
    : typeof current === 'number'
    ? current.toLocaleString()
    : '—';

  return (
    <div className="flex flex-col gap-2 p-4 rounded-2xl border bg-card">
      <div className="flex items-start justify-between gap-2">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${iconBg}`}>
          {icon}
        </div>
        <ChangeBadge
          change={metric.change}
          previous={previous}
          current={typeof current === 'number' ? current : 0}
          isRate={isRate}
        />
      </div>
      <div>
        <p className="text-xl font-bold tabular-nums leading-tight">{displayCurrent}</p>
        <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
          {label}
          {tooltip && (
            <span title={tooltip} className="cursor-help">
              <Info size={11} className="text-muted-foreground/50" />
            </span>
          )}
        </p>
      </div>
      {previous > 0 && (
        <p className="text-[10px] text-muted-foreground/60 tabular-nums">
          {t('report.vs_prev')}: {formatValue ? formatValue(previous) : previous.toLocaleString()}
        </p>
      )}
    </div>
  );
}

// ── Recommendation card ───────────────────────────────────────────────────────

const ACTION_TARGET_COLOR: Record<RecommendationActionTarget, string> = {
  profile:        'bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800',
  services:       'bg-violet-50 border-violet-200 dark:bg-violet-950/30 dark:border-violet-800',
  media:          'bg-orange-50 border-orange-200 dark:bg-orange-950/30 dark:border-orange-800',
  quick_card:     'bg-orange-50 border-orange-200 dark:bg-orange-950/30 dark:border-orange-800',
  contact:        'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800',
  location:       'bg-cyan-50 border-cyan-200 dark:bg-cyan-950/30 dark:border-cyan-800',
  copy_link:      'bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800',
  public_profile: 'bg-sky-50 border-sky-200 dark:bg-sky-950/30 dark:border-sky-800',
};

const ACTION_TARGET_ICON: Record<RecommendationActionTarget, React.ReactNode> = {
  profile:        <Star size={18} className="text-blue-600" />,
  services:       <Star size={18} className="text-violet-600" />,
  media:          <Star size={18} className="text-orange-600" />,
  quick_card:     <Star size={18} className="text-orange-600" />,
  contact:        <MessageCircle size={18} className="text-emerald-600" />,
  location:       <MapPin size={18} className="text-cyan-600" />,
  copy_link:      <Link2 size={18} className="text-amber-600" />,
  public_profile: <Eye size={18} className="text-sky-600" />,
};

// ── Date formatter ────────────────────────────────────────────────────────────

function formatDateRange(from: string, to: string, language: string): string {
  const f = new Date(from + 'T00:00:00Z');
  const t = new Date(to   + 'T00:00:00Z');
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const locale = language === 'ar' ? 'ar-SA' : 'en-US';
  return `${f.toLocaleDateString(locale, opts)} – ${t.toLocaleDateString(locale, opts)}`;
}

// ── Tiny full-width sparkline chart ──────────────────────────────────────────

interface TrendChartProps {
  trend: Array<{ date: string; profileViews: number; contactActions: number }>;
  language: string;
}

function TrendChart({ trend, language }: TrendChartProps) {
  const { t } = useI18n();
  if (trend.length < 7) return null;

  const profileData = trend.map(d => d.profileViews);
  const contactData = trend.map(d => d.contactActions);
  const maxV = Math.max(...profileData, ...contactData, 1);

  const w = 300;
  const h = 60;
  const pad = 4;

  function toPath(values: number[]) {
    return values
      .map((v, i) => {
        const x = pad + (i / (values.length - 1)) * (w - 2 * pad);
        const y = h - pad - ((v / maxV) * (h - 2 * pad));
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }

  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <BarChart3 size={15} className="text-muted-foreground" />
          {t('report.trend_title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <svg
          width="100%"
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
          className="overflow-visible"
          aria-label={t('report.trend_title')}
        >
          {/* Grid lines */}
          {[0, 0.5, 1].map(frac => (
            <line
              key={frac}
              x1={pad} y1={pad + frac * (h - 2 * pad)}
              x2={w - pad} y2={pad + frac * (h - 2 * pad)}
              stroke="currentColor"
              strokeOpacity="0.06"
              strokeWidth="1"
            />
          ))}
          {/* Contact actions line (secondary, thinner) */}
          <path d={toPath(contactData)} fill="none" stroke="#10b981" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity="0.7" />
          {/* Profile views line (primary) */}
          <path d={toPath(profileData)} fill="none" stroke="#6366f1" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
        <div className="flex items-center gap-4 mt-2">
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="w-3 h-0.5 bg-indigo-500 inline-block rounded-full" />
            {t('report.metric_profile_views')}
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="w-3 h-0.5 bg-emerald-500 inline-block rounded-full" />
            {t('report.metric_contact_actions')}
          </span>
        </div>
        <p className="text-[10px] text-muted-foreground/50 mt-1">{t('report.data_note')}</p>
      </CardContent>
    </Card>
  );
}

// ── Top signals card ──────────────────────────────────────────────────────────

interface TopSignalsProps {
  topService: { serviceKey: string; nameEn: string; nameAr: string; count: number; share: number } | null;
  topCity:    { cityId: string; nameEn?: string; nameAr?: string; count: number; share: number } | null;
  language: string;
}

function TopSignalsCard({ topService, topCity, language }: TopSignalsProps) {
  const { t } = useI18n();
  if (!topService && !topCity) return null;
  return (
    <Card>
      <CardContent className="py-3 px-4 space-y-3">
        {topService && (
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-violet-50 dark:bg-violet-950/30 flex items-center justify-center shrink-0">
              <Star size={14} className="text-violet-600" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-muted-foreground">{t('report.top_service_label')}</p>
              <p className="text-sm font-semibold truncate">
                {language === 'ar' ? topService.nameAr : topService.nameEn}
              </p>
            </div>
            <span className="text-[11px] text-muted-foreground shrink-0">
              {Math.round(topService.share * 100)}%
            </span>
          </div>
        )}
        {topCity && (
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-cyan-50 dark:bg-cyan-950/30 flex items-center justify-center shrink-0">
              <MapPin size={14} className="text-cyan-600" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-muted-foreground">{t('report.top_city_label')}</p>
              <p className="text-sm font-semibold truncate">
                {language === 'ar'
                  ? (topCity.nameAr ?? topCity.cityId)
                  : (topCity.nameEn ?? topCity.cityId)}
              </p>
            </div>
            <span className="text-[11px] text-muted-foreground shrink-0">
              {Math.round(topCity.share * 100)}%
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Opportunity card ──────────────────────────────────────────────────────────

interface OpportunityCardProps {
  opp: { titleEn: string; titleAr: string; bodyEn: string; bodyAr: string };
  language: string;
}

function OpportunityCard({ opp, language }: OpportunityCardProps) {
  return (
    <Card className="border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-800/50">
      <CardContent className="py-4 px-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center shrink-0 mt-0.5">
            <TrendingUp size={15} className="text-amber-700 dark:text-amber-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              {language === 'ar' ? opp.titleAr : opp.titleEn}
            </p>
            <p className="text-[12px] text-amber-800/80 dark:text-amber-300/70 mt-1 leading-relaxed">
              {language === 'ar' ? opp.bodyAr : opp.bodyEn}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function ReportSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {[0,1,2].map(i => <Skeleton key={i} className="h-9 flex-1 rounded-xl" />)}
      </div>
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-28 rounded-2xl" />
      <div className="grid grid-cols-2 gap-3">
        {[0,1,2,3,4,5].map(i => <Skeleton key={i} className="h-24 rounded-2xl" />)}
      </div>
    </div>
  );
}

// ── Zero state ────────────────────────────────────────────────────────────────

function ZeroState({ onNavigate }: { onNavigate: (s: string) => void }) {
  const { t } = useI18n();
  return (
    <Card>
      <CardContent className="py-14 text-center">
        <BarChart3 size={40} className="text-muted-foreground/20 mx-auto mb-3" />
        <p className="font-semibold text-muted-foreground">{t('report.zero_title')}</p>
        <p className="text-sm text-muted-foreground/70 mt-1 max-w-xs mx-auto leading-relaxed">
          {t('report.zero_desc')}
        </p>
      </CardContent>
    </Card>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function PerformanceSection({ onNavigate }: { onNavigate?: (section: string) => void }) {
  const { t, language } = useI18n();
  const isRtl = language === 'ar';

  const [period, setPeriod] = useState<ReportPeriod>('30d');
  const { data: report, isLoading, error } = useGetOfficeReport(period);
  const { data: office } = useGetMyOffice();

  // ── Build action handler ───────────────────────────────────────────────────
  function handleRecommendationAction(target: RecommendationActionTarget) {
    if (!onNavigate) return;
    const sectionMap: Record<RecommendationActionTarget, string> = {
      profile:        'profile',
      services:       'profile',
      media:          'media',
      quick_card:     'media',
      contact:        'contact',
      location:       'profile',
      copy_link:      'overview',
      public_profile: 'overview',
    };
    onNavigate(sectionMap[target] ?? 'profile');
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) return <ReportSkeleton />;

  if (error || !report) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <AlertCircle size={32} className="text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">{t('report.error')}</p>
        </CardContent>
      </Card>
    );
  }

  const { metrics, recommendation, opportunity, topSignals, dailyTrend, dataAvailabilityNote } = report;
  const lang = language as 'ar' | 'en';

  // ── Rate formatter ─────────────────────────────────────────────────────────
  const fmtRate = (v: number | null) =>
    v === null ? '—' : `${(Math.round(v * 10) / 10).toFixed(1)}%`;

  // ── Core metric definitions (dynamic based on office.acceptsPhoneCalls) ────
  type MetricEntry = {
    labelKey: string;
    icon: React.ReactNode;
    iconBg: string;
    metric: PeriodMetricPair | RatePair;
    isRate?: boolean;
    tooltipKey?: string;
    formatValue?: (v: number | null) => string;
  };

  const coreMetrics: MetricEntry[] = [
    {
      labelKey: 'report.metric_impressions',
      icon: <Search size={16} className="text-slate-600" />,
      iconBg: 'bg-slate-100 dark:bg-slate-800',
      metric: metrics.cardImpressions,
    },
    {
      labelKey: 'report.metric_profile_views',
      icon: <Eye size={16} className="text-indigo-600" />,
      iconBg: 'bg-indigo-50 dark:bg-indigo-950/30',
      metric: metrics.profileViews,
    },
    {
      labelKey: 'report.metric_unique_visitors',
      icon: <Users size={16} className="text-blue-600" />,
      iconBg: 'bg-blue-50 dark:bg-blue-950/30',
      metric: metrics.uniqueVisitors,
      tooltipKey: 'report.tooltip_unique_visitors',
    },
    {
      labelKey: 'report.metric_contact_actions',
      icon: <TrendingUp size={16} className="text-emerald-600" />,
      iconBg: 'bg-emerald-50 dark:bg-emerald-950/30',
      metric: metrics.contactActions,
    },
    {
      labelKey: 'report.metric_conversion_rate',
      icon: <CheckCircle2 size={16} className="text-teal-600" />,
      iconBg: 'bg-teal-50 dark:bg-teal-950/30',
      metric: metrics.visitToContactRate,
      isRate: true,
      formatValue: fmtRate,
    },
    {
      labelKey: 'report.metric_whatsapp',
      icon: <MessageCircle size={16} className="text-green-600" />,
      iconBg: 'bg-green-50 dark:bg-green-950/30',
      metric: metrics.whatsappClicks,
    },
    ...(metrics.phoneClicks !== null ? [{
      labelKey: 'report.metric_phone',
      icon: <Phone size={16} className="text-blue-600" />,
      iconBg: 'bg-blue-50 dark:bg-blue-950/30',
      metric: metrics.phoneClicks,
    }] : []),
    {
      labelKey: 'report.metric_share',
      icon: <Share2 size={16} className="text-purple-600" />,
      iconBg: 'bg-purple-50 dark:bg-purple-950/30',
      metric: metrics.shareClicks,
    },
    {
      labelKey: 'report.metric_copy_link',
      icon: <Link2 size={16} className="text-violet-600" />,
      iconBg: 'bg-violet-50 dark:bg-violet-950/30',
      metric: metrics.copyLinkClicks,
    },
    {
      labelKey: 'report.metric_qr_visits',
      icon: <QrCode size={16} className="text-rose-600" />,
      iconBg: 'bg-rose-50 dark:bg-rose-950/30',
      metric: metrics.qrVisits,
    },
  ];

  const recColorClass = ACTION_TARGET_COLOR[recommendation.actionTarget] ?? 'bg-primary/5 border-primary/20';
  const recIcon = ACTION_TARGET_ICON[recommendation.actionTarget] ?? <Lightbulb size={18} className="text-primary" />;

  return (
    <div className="space-y-5">

      {/* ── A. Period selector ──────────────────────────────────────────────── */}
      <div className="flex gap-2">
        {PERIODS.map(({ key, labelKey }) => (
          <button
            key={key}
            onClick={() => setPeriod(key)}
            className={`flex-1 py-2 px-3 text-sm font-medium rounded-xl border transition-colors ${
              period === key
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card text-muted-foreground border-border hover:border-foreground/30'
            }`}
          >
            {t(labelKey as any)}
          </button>
        ))}
      </div>

      {/* ── Date range labels ─────────────────────────────────────────────── */}
      <div className="space-y-0.5">
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground/70">
            {formatDateRange(report.period.from, report.period.to, language)}
          </span>
          {' '}<span className="text-muted-foreground/60">{t('report.vs_label')}</span>{' '}
          <span>{formatDateRange(report.comparisonPeriod.from, report.comparisonPeriod.to, language)}</span>
        </p>
        <p className="text-[10px] text-muted-foreground/50">{t('report.data_note')}</p>
      </div>

      {/* ── B. Recommendation card ────────────────────────────────────────── */}
      <div className={`rounded-2xl border p-4 space-y-3 ${recColorClass}`}>
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-background/60 flex items-center justify-center shrink-0 shadow-sm">
            {recIcon}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
              {t('report.rec_heading')}
            </p>
            <p className="text-base font-bold leading-snug mt-0.5">
              {lang === 'ar' ? recommendation.titleAr : recommendation.titleEn}
            </p>
          </div>
        </div>
        <p className="text-sm text-foreground/70 leading-relaxed">
          {lang === 'ar' ? recommendation.bodyAr : recommendation.bodyEn}
        </p>
        <Button
          size="sm"
          variant="secondary"
          className="w-full sm:w-auto"
          onClick={() => handleRecommendationAction(recommendation.actionTarget)}
        >
          {lang === 'ar' ? recommendation.actionLabelAr : recommendation.actionLabelEn}
        </Button>
      </div>

      {/* ── C. Core metric cards ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        {coreMetrics.map((m, i) => (
          <MetricCard
            key={i}
            label={t(m.labelKey as any)}
            tooltip={m.tooltipKey ? t(m.tooltipKey as any) : undefined}
            metric={m.metric}
            icon={m.icon}
            iconBg={m.iconBg}
            isRate={m.isRate}
            formatValue={m.formatValue}
          />
        ))}
      </div>

      {/* ── D. Daily trend ────────────────────────────────────────────────── */}
      {dailyTrend.length >= 7 && (
        <TrendChart trend={dailyTrend} language={language} />
      )}

      {/* ── E. Top signals ────────────────────────────────────────────────── */}
      {(topSignals.topService || topSignals.topCity) && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            {t('report.top_signals_heading')}
          </p>
          <TopSignalsCard
            topService={topSignals.topService}
            topCity={topSignals.topCity}
            language={language}
          />
        </div>
      )}

      {/* ── F. Opportunity card ───────────────────────────────────────────── */}
      {opportunity && (
        <OpportunityCard opp={opportunity} language={language} />
      )}

      {/* ── Zero-data notice ──────────────────────────────────────────────── */}
      {dataAvailabilityNote === 'none' && (
        <Card>
          <CardContent className="py-8 text-center">
            <BarChart3 size={32} className="text-muted-foreground/20 mx-auto mb-3" />
            <p className="text-sm font-medium text-muted-foreground">{t('report.zero_title')}</p>
            <p className="text-xs text-muted-foreground/60 mt-1 max-w-[260px] mx-auto">
              {t('report.zero_desc')}
            </p>
          </CardContent>
        </Card>
      )}

    </div>
  );
}
