/**
 * Supply Control — Market Decision Intelligence tab
 *
 * Admin-only view for managing provider acceptance by city × category market.
 * Shows live-computed or persisted signals and allows admin to approve /
 * reject / monitor recommendations.
 *
 * Safeguard: Approving a decision only writes to market_supply_control.
 * No office records, subscriptions, or provider visibility are affected.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useI18n, categoriesMap, citiesMap } from '@/lib/i18n';
import { safeApiError } from '@/lib/apiError';
import {
  RefreshCw,
  ChevronRight,
  ChevronDown,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Eye,
  Shield,
  History,
  Users,
  Clock,
  ArrowUpCircle,
} from 'lucide-react';
import {
  SlotReservationPanel,
  type SlotSummary    as PanelSlotSummary,
  type ReservationEntry as PanelReservationEntry,
  type WaitlistEntry    as PanelWaitlistEntry,
  type OutboxEntry      as PanelOutboxEntry,
} from './SlotReservationPanel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';

// ── Slot types ────────────────────────────────────────────────────────────────

interface SlotSummary {
  marketKey:        string;
  supplyCap:        number | null;
  allocatedSlots:   number;
  reservedSlots:    number;
  activeSlots:      number;        // allocated + reserved
  remainingSlots:   number | null;
  waitingCount:     number;
  returningWaiting: number;
  isClosed:         boolean;
}

// ReservationEntry and WaitlistEntry are defined in SlotReservationPanel.tsx (re-exported here for local use)
type ReservationEntry = PanelReservationEntry;
type WaitlistEntry    = PanelWaitlistEntry;

// ── Types ─────────────────────────────────────────────────────────────────────

type MarketStatus =
  | 'insufficient_data'
  | 'need_more_supply'
  | 'weak_demand'
  | 'oversupplied'
  | 'near_saturation'
  | 'balanced';

type AcceptanceStatus = 'recruit' | 'open' | 'limited' | 'closed';

interface DerivedSignals {
  zeroResultRate:       number;
  demandPerProvider:    number;
  contactRate:          number;
  providerActivityRate: number;
  demandTrend:          number;
  supplyTrend:          number;
}

interface RawSignals {
  searches:             number;
  zeroResultSearches:   number;
  profileViews:         number;
  whatsappContacts:     number;
  mapContacts:          number;
  daysOfData:           number;
  activeProv:           number;
  activeProv60dAgo:     number;
  searchesPrior30d:     number;
  activeProvWithContacts: number;
}

interface SignalItem {
  countryCode:          string;
  cityId:               string;
  categoryId:           string;
  marketStatus:         MarketStatus;
  recommendedAction:    string;
  confidenceScore:      number;
  confidenceBand:       string;
  recommendationReason: string;
  derivedSignals:       DerivedSignals;
  signals:              RawSignals;
  lastSignalDate:       string | null;
}

type CapStatus = 'available' | 'near_cap' | 'full' | 'over_cap' | 'paused';

interface ControlRecord {
  id:                   number;
  countryCode:          string;
  cityId:               string;
  categoryId:           string;
  acceptanceStatus:     AcceptanceStatus;
  marketStatus:         string | null;
  pendingRecommendation: string | null;
  recommendedAction:    string | null;
  confidenceScore:      number | null;
  recommendationReason: string | null;
  lastComputedAt:       string | null;
  lastReviewedAt:       string | null;
  adminReviewDecision:  string | null;
  adminReviewNote:      string | null;
  signalsSnapshot:      (RawSignals & DerivedSignals) | null;
  // Supply cap fields (migration 0027)
  supplyCap:                      number | null;
  capStatus:                      CapStatus;
  capSource:                      string | null;
  capUpdatedAt:                   string | null;
  recommendedSupplyCap:           number | null;
  recommendedCapChange:           number | null;
  capRecommendationReason:        string | null;
  capRecommendationConfidence:    number | null;
  capRecommendationComputedAt:    string | null;
}

interface CapHistoryRow {
  id:                       number;
  previous_cap:             number | null;
  new_cap:                  number | null;
  action_type:              string;
  changed_by_name:          string | null;
  reason:                   string | null;
  recommended_cap:          number | null;
  recommendation_confidence: number | null;
  current_active_supply:    number | null;
  created_at:               string;
}

const CAP_STATUS_COLOR: Record<CapStatus, string> = {
  available: 'text-green-700',
  near_cap:  'text-amber-700',
  full:      'text-red-700',
  over_cap:  'text-red-800 font-semibold',
  paused:    'text-gray-600',
};

const CAP_STATUS_LABEL_EN: Record<CapStatus, string> = {
  available: 'Available', near_cap: 'Near Cap', full: 'Full', over_cap: 'Over Cap', paused: 'Paused',
};
const CAP_STATUS_LABEL_AR: Record<CapStatus, string> = {
  available: 'متاح', near_cap: 'قريب', full: 'ممتلئ', over_cap: 'فائض', paused: 'موقوف',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE = `${import.meta.env.BASE_URL}api`;

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw Object.assign(new Error('request_failed'), { data, status: res.status });
  }
  return res.json();
}

const STATUS_COLOR: Record<MarketStatus, string> = {
  need_more_supply:  'bg-red-100 text-red-800 border-red-200',
  insufficient_data: 'bg-gray-100 text-gray-600 border-gray-200',
  weak_demand:       'bg-yellow-100 text-yellow-800 border-yellow-200',
  oversupplied:      'bg-orange-100 text-orange-800 border-orange-200',
  near_saturation:   'bg-amber-100 text-amber-800 border-amber-200',
  balanced:          'bg-green-100 text-green-800 border-green-200',
};

const ACCEPTANCE_COLOR: Record<AcceptanceStatus, string> = {
  recruit: 'bg-blue-100 text-blue-800',
  open:    'bg-green-100 text-green-800',
  limited: 'bg-amber-100 text-amber-800',
  closed:  'bg-red-100 text-red-800',
};

const STATUS_LABELS_EN: Record<MarketStatus, string> = {
  need_more_supply:  'Needs Supply',
  insufficient_data: 'Insufficient Data',
  weak_demand:       'Weak Demand',
  oversupplied:      'Oversupplied',
  near_saturation:   'Near Saturation',
  balanced:          'Balanced',
};

const STATUS_LABELS_AR: Record<MarketStatus, string> = {
  need_more_supply:  'يحتاج مزيداً',
  insufficient_data: 'بيانات غير كافية',
  weak_demand:       'طلب ضعيف',
  oversupplied:      'عرض زائد',
  near_saturation:   'قريب من التشبع',
  balanced:          'متوازن',
};

const ACCEPTANCE_LABELS_EN: Record<AcceptanceStatus, string> = {
  recruit: 'Recruiting',
  open:    'Open',
  limited: 'Limited',
  closed:  'Closed',
};

const ACCEPTANCE_LABELS_AR: Record<AcceptanceStatus, string> = {
  recruit: 'توظيف',
  open:    'مفتوح',
  limited: 'محدود',
  closed:  'مغلق',
};

function pct(n: number) { return `${(n * 100).toFixed(1)}%`; }
function num(n: number | null | undefined, dp = 1) {
  if (n == null) return '—';
  return typeof n === 'number' ? n.toFixed(dp) : '—';
}

function TrendIcon({ value }: { value: number }) {
  if (value > 0.05) return <TrendingUp size={14} className="text-green-600 inline" />;
  if (value < -0.05) return <TrendingDown size={14} className="text-red-500 inline" />;
  return <Minus size={14} className="text-gray-400 inline" />;
}

function ConfidenceBar({ score }: { score: number }) {
  const pctVal = Math.round(score * 100);
  const color = score >= 0.75 ? 'bg-green-500' : score >= 0.5 ? 'bg-yellow-500' : score >= 0.25 ? 'bg-orange-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pctVal}%` }} />
      </div>
      <span className="text-xs text-muted-foreground">{pctVal}%</span>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function SupplyControlSection() {
  const { language } = useI18n();
  const isAr = language === 'ar';

  const [loading, setLoading] = useState(false);
  const [computing, setComputing] = useState(false);
  const [signals, setSignals] = useState<SignalItem[]>([]);
  const [controls, setControls] = useState<ControlRecord[]>([]);
  const [lastComputedAt, setLastComputedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [selectedCountry, setSelectedCountry] = useState<string>('');
  const [selectedCity, setSelectedCity] = useState<string>('');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  // Review panel state
  const [reviewTarget, setReviewTarget] = useState<{ id: number; key: string } | null>(null);
  const [reviewDecision, setReviewDecision] = useState<string>('');
  const [reviewNote, setReviewNote] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);

  // Supply cap management state
  const [capTarget, setCapTarget] = useState<number | null>(null);   // controlId being edited
  const [capInput, setCapInput] = useState<string>('');
  const [capReason, setCapReason] = useState('');
  const [capSubmitting, setCapSubmitting] = useState(false);
  const [capHistoryMap, setCapHistoryMap] = useState<Record<number, CapHistoryRow[]>>({});
  const [loadingCapHistory, setLoadingCapHistory] = useState<Record<number, boolean>>({});

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [sigData, ctrlData] = await Promise.all([
        apiFetch('/admin/market-supply/signals'),
        apiFetch('/admin/market-supply/controls'),
      ]);
      setSignals(sigData.items ?? []);
      setControls(ctrlData.items ?? []);
      if (sigData.computedAt) setLastComputedAt(sigData.computedAt);
    } catch (e) {
      setError(safeApiError(e, language));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleRecompute = async () => {
    setComputing(true);
    try {
      const res = await apiFetch('/admin/market-supply/controls/compute', { method: 'POST' });
      setLastComputedAt(res.computedAt ?? new Date().toISOString());
      await fetchData();
    } catch (e) {
      setError(safeApiError(e, language));
    } finally {
      setComputing(false);
    }
  };

  const handleSetCap = async (controlId: number, supplyCap: number | null, reason: string) => {
    setCapSubmitting(true);
    try {
      await apiFetch(`/admin/market-supply/controls/${controlId}/cap`, {
        method: 'PUT',
        body: JSON.stringify({ supplyCap, reason }),
      });
      setCapTarget(null);
      setCapInput('');
      setCapReason('');
      await fetchData();
    } catch (e) {
      setError(safeApiError(e, language));
    } finally {
      setCapSubmitting(false);
    }
  };

  const handleCapDecision = async (controlId: number, decision: 'approved' | 'rejected', reason?: string) => {
    setCapSubmitting(true);
    try {
      await apiFetch(`/admin/market-supply/controls/${controlId}/cap-decision`, {
        method: 'POST',
        body: JSON.stringify({ decision, reason }),
      });
      await fetchData();
    } catch (e) {
      setError(safeApiError(e, language));
    } finally {
      setCapSubmitting(false);
    }
  };

  const fetchCapHistory = async (controlId: number) => {
    setLoadingCapHistory(prev => ({ ...prev, [controlId]: true }));
    try {
      const data = await apiFetch(`/admin/market-supply/controls/${controlId}/cap-history`);
      setCapHistoryMap(prev => ({ ...prev, [controlId]: data.items ?? [] }));
    } catch {
      // silently ignore history load failures
    } finally {
      setLoadingCapHistory(prev => ({ ...prev, [controlId]: false }));
    }
  };

  const handleDecision = async () => {
    if (!reviewTarget || !reviewDecision) return;
    setSubmittingReview(true);
    try {
      await apiFetch(`/admin/market-supply/controls/${reviewTarget.id}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision: reviewDecision, note: reviewNote || undefined }),
      });
      setReviewTarget(null);
      setReviewDecision('');
      setReviewNote('');
      await fetchData();
    } catch (e) {
      setError(safeApiError(e, language));
    } finally {
      setSubmittingReview(false);
    }
  };

  // Build merged view: signals enriched with persisted control data
  type MergedRow = SignalItem & { control?: ControlRecord };
  const mergedSignals = useMemo<MergedRow[]>(() => {
    const ctrlMap = new Map<string, ControlRecord>();
    for (const c of controls) ctrlMap.set(`${c.countryCode}|${c.cityId}|${c.categoryId}`, c);
    return signals.map(s => ({
      ...s,
      control: ctrlMap.get(`${s.countryCode}|${s.cityId}|${s.categoryId}`),
    }));
  }, [signals, controls]);

  // Unique countries and cities
  const countries = useMemo(() => [...new Set(mergedSignals.map(s => s.countryCode))].sort(), [mergedSignals]);
  const cities = useMemo(() => {
    const base = mergedSignals
      .filter(s => !selectedCountry || s.countryCode === selectedCountry)
      .map(s => s.cityId);
    return [...new Set(base)].sort();
  }, [mergedSignals, selectedCountry]);

  // Filtered rows for table
  const tableRows = useMemo<MergedRow[]>(() => {
    return mergedSignals.filter(s => {
      if (selectedCountry && s.countryCode !== selectedCountry) return false;
      if (selectedCity    && s.cityId      !== selectedCity)    return false;
      return true;
    }).sort((a, b) => {
      // Sort: need_more_supply first, insufficient_data last
      const order: Record<MarketStatus, number> = {
        need_more_supply: 0, near_saturation: 1, oversupplied: 2,
        weak_demand: 3, balanced: 4, insufficient_data: 5,
      };
      return (order[a.marketStatus] ?? 9) - (order[b.marketStatus] ?? 9);
    });
  }, [mergedSignals, selectedCountry, selectedCity]);

  // KPI summary
  const kpi = useMemo(() => {
    const filtered = selectedCity
      ? mergedSignals.filter(s => (!selectedCountry || s.countryCode === selectedCountry) && s.cityId === selectedCity)
      : mergedSignals.filter(s => !selectedCountry || s.countryCode === selectedCountry);
    return {
      needSupply:    filtered.filter(s => s.marketStatus === 'need_more_supply').length,
      balanced:      filtered.filter(s => s.marketStatus === 'balanced').length,
      saturated:     filtered.filter(s => s.marketStatus === 'near_saturation' || s.marketStatus === 'oversupplied').length,
      insufficient:  filtered.filter(s => s.marketStatus === 'insufficient_data').length,
    };
  }, [mergedSignals, selectedCountry, selectedCity]);

  const cityLabel = (cityId: string) => {
    const entry = Object.entries(citiesMap).find(([k]) => k.toLowerCase() === cityId.toLowerCase());
    return entry ? (isAr ? entry[1].ar : entry[1].en) : cityId;
  };

  const categoryLabel = (catId: string) => {
    return isAr ? (categoriesMap[catId]?.ar ?? catId) : (categoriesMap[catId]?.en ?? catId);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* Controls bar */}
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={selectedCountry}
          onValueChange={(v) => { setSelectedCountry(v === '__all__' ? '' : v); setSelectedCity(''); }}
        >
          <SelectTrigger className="w-40 h-8 text-sm">
            <SelectValue placeholder={isAr ? 'الدولة' : 'Country'} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{isAr ? 'جميع الدول' : 'All Countries'}</SelectItem>
            {countries.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select
          value={selectedCity}
          onValueChange={(v) => setSelectedCity(v === '__all__' ? '' : v)}
        >
          <SelectTrigger className="w-44 h-8 text-sm">
            <SelectValue placeholder={isAr ? 'المدينة' : 'City'} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{isAr ? 'جميع المدن' : 'All Cities'}</SelectItem>
            {cities.map(c => <SelectItem key={c} value={c}>{cityLabel(c)}</SelectItem>)}
          </SelectContent>
        </Select>

        <Button
          size="sm"
          variant="outline"
          onClick={handleRecompute}
          disabled={computing}
          className="gap-1.5"
        >
          <RefreshCw size={13} className={computing ? 'animate-spin' : ''} />
          {computing
            ? (isAr ? 'جاري الحساب...' : 'Computing...')
            : (isAr ? 'إعادة الحساب' : 'Recompute Signals')}
        </Button>

        {lastComputedAt && (
          <span className="text-xs text-muted-foreground">
            {isAr ? 'آخر تحديث:' : 'Last computed:'}{' '}
            {new Date(lastComputedAt).toLocaleString(isAr ? 'ar-SA' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' })}
          </span>
        )}

        {loading && (
          <span className="text-xs text-muted-foreground animate-pulse">
            {isAr ? 'جاري التحميل...' : 'Loading...'}
          </span>
        )}
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </div>
      )}

      {/* KPI chips */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="bg-red-50 border-red-100">
          <CardContent className="p-3 flex flex-col gap-0.5">
            <p className="text-2xl font-bold text-red-700">{kpi.needSupply}</p>
            <p className="text-xs text-red-600">{isAr ? 'يحتاج مزيداً من المزودين' : 'Markets Need Supply'}</p>
          </CardContent>
        </Card>
        <Card className="bg-green-50 border-green-100">
          <CardContent className="p-3 flex flex-col gap-0.5">
            <p className="text-2xl font-bold text-green-700">{kpi.balanced}</p>
            <p className="text-xs text-green-600">{isAr ? 'أسواق متوازنة' : 'Balanced Markets'}</p>
          </CardContent>
        </Card>
        <Card className="bg-amber-50 border-amber-100">
          <CardContent className="p-3 flex flex-col gap-0.5">
            <p className="text-2xl font-bold text-amber-700">{kpi.saturated}</p>
            <p className="text-xs text-amber-600">{isAr ? 'قريب من التشبع / زائد' : 'Near Saturation / Over'}</p>
          </CardContent>
        </Card>
        <Card className="bg-gray-50 border-gray-100">
          <CardContent className="p-3 flex flex-col gap-0.5">
            <p className="text-2xl font-bold text-gray-600">{kpi.insufficient}</p>
            <p className="text-xs text-gray-500">{isAr ? 'بيانات غير كافية' : 'Insufficient Data'}</p>
          </CardContent>
        </Card>
      </div>

      {/* No data */}
      {!loading && tableRows.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground text-sm">
            {isAr
              ? 'لا توجد بيانات سوق بعد. اضغط "إعادة الحساب" لمعالجة الإشارات المتاحة.'
              : 'No market data yet. Click "Recompute Signals" to process available signals.'}
          </CardContent>
        </Card>
      )}

      {/* Category table */}
      {tableRows.length > 0 && (
        <div className="rounded-md border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                {!selectedCity && (
                  <th className="px-3 py-2 text-start font-medium">{isAr ? 'المدينة' : 'City'}</th>
                )}
                <th className="px-3 py-2 text-start font-medium">{isAr ? 'التخصص' : 'Category'}</th>
                <th className="px-3 py-2 text-end font-medium">{isAr ? 'المزودون' : 'Supply'}</th>
                <th className="px-3 py-2 text-center font-medium" title={isAr ? 'الحد الأقصى / المتبقي' : 'Cap / Remaining'}>
                  {isAr ? 'الحد / المتبقي' : 'Cap / Left'}
                </th>
                <th className="px-3 py-2 text-start font-medium hidden sm:table-cell" title={isAr ? 'توصية رفع الحد' : 'Recommended cap change'}>
                  {isAr ? 'التوصية' : 'Rec. Cap'}
                </th>
                <th className="px-3 py-2 text-end font-medium hidden md:table-cell">{isAr ? 'الطلب (30 يوم)' : 'Demand (30d)'}</th>
                <th className="px-3 py-2 text-center font-medium hidden md:table-cell">{isAr ? 'الاتجاه' : 'Trend'}</th>
                <th className="px-3 py-2 text-start font-medium">{isAr ? 'حالة السوق' : 'Market Status'}</th>
                <th className="px-3 py-2 text-start font-medium hidden lg:table-cell">{isAr ? 'الثقة' : 'Confidence'}</th>
                <th className="px-3 py-2 text-start font-medium">{isAr ? 'القبول' : 'Acceptance'}</th>
                <th className="px-3 py-2 text-center font-medium">{isAr ? 'إجراء' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row) => {
                const rowKey = `${row.countryCode}|${row.cityId}|${row.categoryId}`;
                const isExpanded = expandedRow === rowKey;
                const ctrl = row.control;
                const acceptanceStatus = (ctrl?.acceptanceStatus ?? 'open') as AcceptanceStatus;

                return (
                  <React.Fragment key={rowKey}>
                    <tr
                      className="border-t hover:bg-muted/30 cursor-pointer"
                      onClick={() => setExpandedRow(isExpanded ? null : rowKey)}
                    >
                      {!selectedCity && (
                        <td className="px-3 py-2.5 font-medium">{cityLabel(row.cityId)}</td>
                      )}
                      <td className="px-3 py-2.5">{categoryLabel(row.categoryId)}</td>
                      <td className="px-3 py-2.5 text-end tabular-nums">{row.signals.activeProv}</td>

                      {/* Cap / Remaining */}
                      <td className="px-3 py-2.5 text-center">
                        {ctrl?.supplyCap != null ? (
                          <span className={`tabular-nums text-xs font-medium ${CAP_STATUS_COLOR[ctrl.capStatus as CapStatus] ?? ''}`}>
                            {row.signals.activeProv}/{ctrl.supplyCap}
                            {ctrl.capStatus === 'near_cap' && (
                              <AlertTriangle size={10} className="inline ms-0.5 text-amber-500" />
                            )}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">∞</span>
                        )}
                      </td>

                      {/* Recommended cap */}
                      <td className="px-3 py-2.5 hidden sm:table-cell">
                        {ctrl?.recommendedCapChange && ctrl.recommendedCapChange !== 0 ? (
                          <span className={`text-xs font-medium ${ctrl.recommendedCapChange > 0 ? 'text-green-700' : 'text-red-700'}`}>
                            {ctrl.recommendedCapChange > 0 ? '+' : ''}{ctrl.recommendedCapChange} → {ctrl.recommendedSupplyCap}
                          </span>
                        ) : ctrl?.recommendedCapChange === 0 ? (
                          <span className="text-xs text-muted-foreground">{isAr ? 'احتفظ' : 'Hold'}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>

                      <td className="px-3 py-2.5 text-end tabular-nums hidden md:table-cell">{row.signals.searches}</td>
                      <td className="px-3 py-2.5 text-center hidden md:table-cell">
                        <TrendIcon value={row.derivedSignals.demandTrend} />
                        <span className="ms-1 text-xs text-muted-foreground">
                          {row.derivedSignals.demandTrend >= 0 ? '+' : ''}{pct(row.derivedSignals.demandTrend)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge
                          variant="outline"
                          className={`text-xs ${STATUS_COLOR[row.marketStatus] ?? ''}`}
                        >
                          {isAr ? STATUS_LABELS_AR[row.marketStatus] : STATUS_LABELS_EN[row.marketStatus]}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5 hidden lg:table-cell">
                        <ConfidenceBar score={row.confidenceScore} />
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge
                          variant="secondary"
                          className={`text-xs ${ACCEPTANCE_COLOR[acceptanceStatus] ?? ''}`}
                        >
                          {isAr ? ACCEPTANCE_LABELS_AR[acceptanceStatus] : ACCEPTANCE_LABELS_EN[acceptanceStatus]}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <button
                          onClick={(e) => { e.stopPropagation(); setExpandedRow(isExpanded ? null : rowKey); }}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          {isExpanded
                            ? <ChevronDown size={15} />
                            : <ChevronRight size={15} />}
                        </button>
                      </td>
                    </tr>

                    {/* Expanded drill-down */}
                    {isExpanded && (
                      <tr className="border-t bg-muted/10">
                        <td colSpan={selectedCity ? 9 : 10} className="px-4 py-4">
                          <DrillDown
                            row={row}
                            ctrl={ctrl}
                            isAr={isAr}
                            onReview={() => setReviewTarget({ id: ctrl!.id, key: rowKey })}
                            reviewTarget={reviewTarget}
                            reviewDecision={reviewDecision}
                            reviewNote={reviewNote}
                            submittingReview={submittingReview}
                            onDecisionChange={setReviewDecision}
                            onNoteChange={setReviewNote}
                            onSubmitDecision={handleDecision}
                            onCancelReview={() => { setReviewTarget(null); setReviewDecision(''); setReviewNote(''); }}
                            // Cap management
                            capTarget={capTarget}
                            capInput={capInput}
                            capReason={capReason}
                            capSubmitting={capSubmitting}
                            capHistory={capHistoryMap[ctrl?.id ?? -1] ?? null}
                            loadingCapHistory={loadingCapHistory[ctrl?.id ?? -1] ?? false}
                            onCapTargetOpen={() => {
                              setCapTarget(ctrl!.id);
                              setCapInput(ctrl?.supplyCap != null ? String(ctrl.supplyCap) : '');
                              setCapReason('');
                            }}
                            onCapTargetClose={() => { setCapTarget(null); setCapInput(''); setCapReason(''); }}
                            onCapInputChange={setCapInput}
                            onCapReasonChange={setCapReason}
                            onSetCap={() => {
                              if (!ctrl) return;
                              const v = capInput.trim();
                              const n = v === '' ? null : parseInt(v, 10);
                              if (v !== '' && (!Number.isFinite(n) || n! < 1)) {
                                setError(isAr ? 'الحد يجب أن يكون رقماً موجباً' : 'Cap must be a positive number');
                                return;
                              }
                              if (!capReason.trim()) {
                                setError(isAr ? 'الرجاء إدخال سبب التغيير' : 'Please enter a reason for the change');
                                return;
                              }
                              setError(null);
                              handleSetCap(ctrl.id, n, capReason.trim());
                            }}
                            onCapDecision={(decision) => {
                              if (!ctrl) return;
                              handleCapDecision(ctrl.id, decision);
                            }}
                            onLoadCapHistory={() => { if (ctrl) fetchCapHistory(ctrl.id); }}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Drill-down panel ──────────────────────────────────────────────────────────

interface DrillDownProps {
  row:              SignalItem & { control?: ControlRecord };
  ctrl?:            ControlRecord;
  isAr:             boolean;
  onReview:         () => void;
  reviewTarget:     { id: number; key: string } | null;
  reviewDecision:   string;
  reviewNote:       string;
  submittingReview: boolean;
  onDecisionChange: (v: string) => void;
  onNoteChange:     (v: string) => void;
  onSubmitDecision: () => void;
  onCancelReview:   () => void;
  // Cap management
  capTarget:          number | null;
  capInput:           string;
  capReason:          string;
  capSubmitting:      boolean;
  capHistory:         CapHistoryRow[] | null;
  loadingCapHistory:  boolean;
  onCapTargetOpen:    () => void;
  onCapTargetClose:   () => void;
  onCapInputChange:   (v: string) => void;
  onCapReasonChange:  (v: string) => void;
  onSetCap:           () => void;
  onCapDecision:      (decision: 'approved' | 'rejected') => void;
  onLoadCapHistory:   () => void;
}

function DrillDown({
  row, ctrl, isAr, onReview,
  reviewTarget, reviewDecision, reviewNote, submittingReview,
  onDecisionChange, onNoteChange, onSubmitDecision, onCancelReview,
  capTarget, capInput, capReason, capSubmitting,
  capHistory, loadingCapHistory,
  onCapTargetOpen, onCapTargetClose, onCapInputChange, onCapReasonChange,
  onSetCap, onCapDecision, onLoadCapHistory,
}: DrillDownProps) {
  const s = row.signals;
  const d = row.derivedSignals;
  const isReviewing    = reviewTarget?.id === ctrl?.id;
  const isEditingCap   = capTarget      === ctrl?.id;

  // ── Slot stats (always fetched on mount) ─────────────────────────────────
  const marketKey    = `${row.countryCode}|${row.cityId}|${row.categoryId}`;
  const BASE_API     = `${import.meta.env.BASE_URL}api`;
  const [slotSummary,   setSlotSummary]   = useState<SlotSummary | null>(null);
  const [reservations,  setReservations]  = useState<ReservationEntry[]>([]);
  const [waitlist,      setWaitlist]      = useState<WaitlistEntry[]>([]);
  const [outboxEntries, setOutboxEntries] = useState<PanelOutboxEntry[]>([]);
  const [slotLoading,   setSlotLoading]   = useState(false);

  const loadSlotData = useCallback(async () => {
    setSlotLoading(true);
    try {
      const enc = encodeURIComponent(marketKey);
      const [summaryRes, reservRes, waitRes, outboxRes] = await Promise.all([
        fetch(`${BASE_API}/admin/supply-slots/market/${enc}`,                 { credentials: 'include' }),
        fetch(`${BASE_API}/admin/supply-slots/reserved/${enc}`,               { credentials: 'include' }),
        fetch(`${BASE_API}/admin/supply-slots/waitlist/${enc}`,               { credentials: 'include' }),
        fetch(`${BASE_API}/admin/supply-slots/notification-outbox/${enc}`,    { credentials: 'include' }),
      ]);
      if (summaryRes.ok)  setSlotSummary(await summaryRes.json());
      if (reservRes.ok)   setReservations((await reservRes.json()).reservations ?? []);
      if (waitRes.ok)     setWaitlist((await waitRes.json()).waitlist ?? []);
      if (outboxRes.ok)   setOutboxEntries((await outboxRes.json()).outbox ?? []);
    } catch {
      // silently ignore — slot section is informational
    } finally {
      setSlotLoading(false);
    }
  }, [marketKey, BASE_API]);

  useEffect(() => { loadSlotData(); }, [loadSlotData]);

  const rawSignalRows = [
    { label: isAr ? 'البحث (30 يوم)' : 'Searches (30d)',          value: s.searches },
    { label: isAr ? 'البحث بدون نتيجة' : 'Zero Result Searches',  value: s.zeroResultSearches },
    { label: isAr ? 'مشاهدات الملف'    : 'Profile Views',          value: s.profileViews },
    { label: isAr ? 'واتساب'           : 'WhatsApp Contacts',      value: s.whatsappContacts },
    { label: isAr ? 'خرائط'            : 'Map Contacts',           value: s.mapContacts },
    { label: isAr ? 'أيام البيانات'    : 'Days of Data',           value: s.daysOfData },
    { label: isAr ? 'مزودون نشطون'     : 'Active Providers',       value: s.activeProv },
    { label: isAr ? 'مزودون قبل 60 يوم': 'Active Prov. (60d ago)', value: s.activeProv60dAgo },
    { label: isAr ? 'مزودون مع تواصل'  : 'Prov. with Contacts',   value: s.activeProvWithContacts },
  ];

  const derivedRows = [
    { label: isAr ? 'معدل البحث بدون نتيجة' : 'Zero-Result Rate',      value: `${(d.zeroResultRate * 100).toFixed(1)}%` },
    { label: isAr ? 'طلب لكل مزود'          : 'Demand / Provider',      value: d.demandPerProvider.toFixed(2) },
    { label: isAr ? 'معدل التواصل'          : 'Contact Rate',           value: `${(d.contactRate * 100).toFixed(2)}%` },
    { label: isAr ? 'نشاط المزودين'         : 'Provider Activity Rate', value: `${(d.providerActivityRate * 100).toFixed(1)}%` },
    { label: isAr ? 'اتجاه الطلب (30 يوم)'  : 'Demand Trend',          value: `${d.demandTrend >= 0 ? '+' : ''}${(d.demandTrend * 100).toFixed(1)}%` },
    { label: isAr ? 'اتجاه العرض (60 يوم)'  : 'Supply Trend',          value: `${d.supplyTrend >= 0 ? '+' : ''}${(d.supplyTrend * 100).toFixed(1)}%` },
  ];

  const ACTION_TYPE_LABEL: Record<string, { en: string; ar: string }> = {
    set_initial:                   { en: 'Cap Set',             ar: 'تحديد الحد' },
    admin_adjustment:              { en: 'Admin Adjustment',    ar: 'تعديل إداري' },
    removed:                       { en: 'Cap Removed',         ar: 'إزالة الحد' },
    approved_recommendation:       { en: 'Rec. Approved',       ar: 'توصية مقبولة' },
    rejected_recommendation:       { en: 'Rec. Rejected',       ar: 'توصية مرفوضة' },
  };

  return (
    <div className="space-y-5">
      <div className="grid md:grid-cols-2 gap-6">

        {/* Left: raw signals + derived */}
        <div className="space-y-4">
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              {isAr ? 'الإشارات الخام' : 'Raw Signals'}
            </h4>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {rawSignalRows.map(r => (
                <div key={r.label} className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{r.label}</span>
                  <span className="tabular-nums font-medium">{r.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              {isAr ? 'الإشارات المشتقة' : 'Derived Signals'}
            </h4>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {derivedRows.map(r => (
                <div key={r.label} className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{r.label}</span>
                  <span className="tabular-nums font-medium">{r.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: classification + review */}
        <div className="space-y-4">
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              {isAr ? 'أساس التصنيف' : 'Classification Basis'}
            </h4>
            <p className="text-xs text-foreground leading-relaxed bg-muted/40 rounded p-2.5">
              {row.recommendationReason}
            </p>
            <p className="text-xs text-muted-foreground mt-1.5">
              {isAr ? 'التوصية: ' : 'Recommended action: '}
              <span className="font-medium text-foreground">{row.recommendedAction}</span>
            </p>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-xs text-muted-foreground">{isAr ? 'الثقة: ' : 'Confidence: '}</span>
              <ConfidenceBar score={row.confidenceScore} />
              <span className="text-xs font-medium">{row.confidenceBand}</span>
            </div>
          </div>

          {/* Last admin review history */}
          {ctrl?.lastReviewedAt && (
            <div className="border rounded p-2.5 bg-muted/20 text-xs space-y-0.5">
              <p className="font-medium text-muted-foreground uppercase tracking-wide text-[10px]">
                {isAr ? 'آخر قرار إداري' : 'Last Admin Decision'}
              </p>
              <p>
                <span className="font-medium capitalize">{ctrl.adminReviewDecision}</span>
                {' — '}
                {new Date(ctrl.lastReviewedAt).toLocaleDateString(isAr ? 'ar-SA' : 'en-GB')}
              </p>
              {ctrl.adminReviewNote && (
                <p className="text-muted-foreground">{ctrl.adminReviewNote}</p>
              )}
            </div>
          )}

          {/* Pending recommendation + review panel */}
          {ctrl ? (
            isReviewing ? (
              <div className="border rounded p-3 space-y-3 bg-background">
                <p className="text-xs font-medium">
                  {isAr ? 'القرار على التوصية: ' : 'Decision on recommendation: '}
                  <span className="font-semibold">{row.recommendedAction}</span>
                </p>

                <div className="flex gap-2 flex-wrap">
                  {['approved', 'rejected', 'monitoring'].map(d => (
                    <button
                      key={d}
                      onClick={() => onDecisionChange(d)}
                      className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                        reviewDecision === d
                          ? d === 'approved'  ? 'bg-green-600 text-white border-green-600'
                          : d === 'rejected'  ? 'bg-red-600 text-white border-red-600'
                          :                    'bg-blue-600 text-white border-blue-600'
                          : 'border-border text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      {d === 'approved'  ? (isAr ? 'موافقة' : 'Approve')
                     : d === 'rejected'  ? (isAr ? 'رفض'    : 'Reject')
                     :                    (isAr ? 'مراقبة'  : 'Monitor')}
                    </button>
                  ))}
                </div>

                <Textarea
                  placeholder={isAr ? 'ملاحظة إدارية (اختياري)' : 'Admin note (optional)'}
                  value={reviewNote}
                  onChange={e => onNoteChange(e.target.value)}
                  rows={2}
                  className="text-xs"
                />

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={onSubmitDecision}
                    disabled={!reviewDecision || submittingReview}
                    className="text-xs h-7"
                  >
                    {submittingReview
                      ? (isAr ? 'جاري الحفظ...' : 'Saving...')
                      : (isAr ? 'تأكيد القرار' : 'Confirm Decision')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={onCancelReview} className="text-xs h-7">
                    {isAr ? 'إلغاء' : 'Cancel'}
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={onReview}
                className="gap-1.5 text-xs h-7"
              >
                <Eye size={12} />
                {isAr ? 'مراجعة التوصية' : 'Review Recommendation'}
              </Button>
            )
          ) : (
            <p className="text-xs text-muted-foreground italic">
              {isAr
                ? 'لا يوجد سجل محفوظ بعد. اضغط "إعادة الحساب" أولاً.'
                : 'No persisted record yet. Click "Recompute Signals" first.'}
            </p>
          )}
        </div>
      </div>

      {/* ── Supply Cap Management ─────────────────────────────────────────── */}
      {ctrl && (
        <div className="border-t pt-4 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <Shield size={12} />
              {isAr ? 'الحد الأقصى للعرض' : 'Supply Cap'}
            </h4>
            {!isEditingCap && (
              <Button size="sm" variant="ghost" onClick={onCapTargetOpen} className="text-xs h-6 px-2">
                {ctrl.supplyCap != null
                  ? (isAr ? 'تعديل الحد' : 'Edit Cap')
                  : (isAr ? 'تحديد حد' : 'Set Cap')}
              </Button>
            )}
          </div>

          {/* Current cap status summary */}
          <div className="flex items-center gap-4 text-xs">
            {ctrl.supplyCap != null ? (
              <>
                <div>
                  <span className="text-muted-foreground">{isAr ? 'الحد: ' : 'Cap: '}</span>
                  <span className="font-semibold tabular-nums">{ctrl.supplyCap}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{isAr ? 'المزودون النشطون: ' : 'Active: '}</span>
                  <span className="font-semibold tabular-nums">{row.signals.activeProv}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{isAr ? 'الحالة: ' : 'Status: '}</span>
                  <span className={`font-medium ${CAP_STATUS_COLOR[ctrl.capStatus as CapStatus] ?? ''}`}>
                    {isAr
                      ? CAP_STATUS_LABEL_AR[ctrl.capStatus as CapStatus]
                      : CAP_STATUS_LABEL_EN[ctrl.capStatus as CapStatus]}
                  </span>
                </div>
                {ctrl.capSource && (
                  <div className="text-muted-foreground hidden sm:block">
                    {isAr ? 'المصدر: ' : 'Source: '}
                    <span>{ctrl.capSource.replace(/_/g, ' ')}</span>
                  </div>
                )}
              </>
            ) : (
              <p className="text-muted-foreground italic">
                {isAr ? 'السوق غير محدد الحد — قبول مفتوح' : 'Uncapped market — no admission limit active'}
              </p>
            )}
          </div>

          {/* Set / edit cap form */}
          {isEditingCap && (
            <div className="border rounded p-3 space-y-3 bg-background">
              <p className="text-xs font-medium">
                {ctrl.supplyCap != null
                  ? (isAr ? 'تعديل الحد الأقصى' : 'Adjust Supply Cap')
                  : (isAr ? 'تحديد الحد الأقصى' : 'Set Supply Cap')}
              </p>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  step={1}
                  placeholder={isAr ? 'الحد الأقصى (عدد صحيح)' : 'Cap (positive integer)'}
                  value={capInput}
                  onChange={e => onCapInputChange(e.target.value)}
                  className="h-7 text-xs w-28 tabular-nums"
                />
                <span className="text-xs text-muted-foreground">
                  {isAr ? 'أو اتركه فارغاً لإزالة الحد' : 'Leave blank to remove cap'}
                </span>
              </div>
              <Textarea
                placeholder={isAr ? 'سبب التغيير (مطلوب)' : 'Reason for change (required)'}
                value={capReason}
                onChange={e => onCapReasonChange(e.target.value)}
                rows={2}
                className="text-xs"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={onSetCap}
                  disabled={capSubmitting || !capReason.trim()}
                  className="text-xs h-7"
                >
                  {capSubmitting
                    ? (isAr ? 'جاري الحفظ...' : 'Saving...')
                    : (isAr ? 'تأكيد الحد' : 'Confirm Cap')}
                </Button>
                <Button size="sm" variant="ghost" onClick={onCapTargetClose} className="text-xs h-7">
                  {isAr ? 'إلغاء' : 'Cancel'}
                </Button>
              </div>
            </div>
          )}

          {/* Intelligence cap recommendation */}
          {ctrl.recommendedCapChange !== null && ctrl.recommendedCapChange !== undefined && ctrl.recommendedSupplyCap !== null && (
            <div className={`border rounded p-3 space-y-2 text-xs ${ctrl.recommendedCapChange > 0 ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-muted/20'}`}>
              <div className="flex items-center justify-between">
                <p className="font-medium">
                  {isAr ? 'توصية الذكاء الاصطناعي:' : 'Intelligence Recommendation:'}
                  {' '}
                  {ctrl.recommendedCapChange === 0 ? (
                    <span className="text-muted-foreground">{isAr ? 'احتفظ بالحد الحالي' : 'Hold current cap'}</span>
                  ) : (
                    <span className={ctrl.recommendedCapChange > 0 ? 'text-green-700' : 'text-red-700'}>
                      {ctrl.recommendedCapChange > 0 ? '+' : ''}{ctrl.recommendedCapChange} → {ctrl.recommendedSupplyCap}
                    </span>
                  )}
                </p>
                {ctrl.capRecommendationConfidence !== null && (
                  <span className="text-muted-foreground">
                    {Math.round((ctrl.capRecommendationConfidence ?? 0) * 100)}% {isAr ? 'ثقة' : 'confidence'}
                  </span>
                )}
              </div>
              {ctrl.capRecommendationReason && (
                <p className="text-muted-foreground leading-relaxed">{ctrl.capRecommendationReason}</p>
              )}
              {ctrl.recommendedCapChange !== 0 && (
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    onClick={() => onCapDecision('approved')}
                    disabled={capSubmitting}
                    className="text-xs h-7 bg-green-600 hover:bg-green-700 text-white"
                  >
                    <CheckCircle2 size={12} className="me-1" />
                    {isAr ? 'قبول التوصية' : 'Approve'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onCapDecision('rejected')}
                    disabled={capSubmitting}
                    className="text-xs h-7 text-red-700 border-red-200 hover:bg-red-50"
                  >
                    <XCircle size={12} className="me-1" />
                    {isAr ? 'رفض التوصية' : 'Reject'}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Cap history panel */}
          <div>
            <button
              onClick={() => { if (!capHistory) onLoadCapHistory(); }}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <History size={12} />
              {isAr ? 'سجل تغييرات الحد' : 'Cap Change History'}
            </button>

            {loadingCapHistory && (
              <p className="text-xs text-muted-foreground mt-2 animate-pulse">
                {isAr ? 'جاري التحميل...' : 'Loading...'}
              </p>
            )}

            {capHistory && capHistory.length > 0 && (
              <div className="mt-2 space-y-1.5 max-h-48 overflow-y-auto">
                {capHistory.slice(0, 10).map(h => (
                  <div key={h.id} className="border rounded px-2.5 py-1.5 text-xs bg-background">
                    <div className="flex items-center justify-between">
                      <span className={`font-medium ${
                        h.action_type === 'approved_recommendation' ? 'text-green-700' :
                        h.action_type === 'rejected_recommendation' ? 'text-red-600'  : 'text-foreground'
                      }`}>
                        {(ACTION_TYPE_LABEL[h.action_type] ?? { en: h.action_type, ar: h.action_type })[isAr ? 'ar' : 'en']}
                      </span>
                      <span className="text-muted-foreground">
                        {new Date(h.created_at).toLocaleDateString(isAr ? 'ar-SA' : 'en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}
                      </span>
                    </div>
                    <div className="text-muted-foreground mt-0.5">
                      {h.previous_cap ?? '∞'} → {h.new_cap ?? '∞'}
                      {h.current_active_supply !== null && (
                        <span className="ms-2">({isAr ? 'نشط:' : 'active:'} {h.current_active_supply})</span>
                      )}
                      {h.changed_by_name && <span className="ms-2 opacity-70">{h.changed_by_name}</span>}
                    </div>
                    {h.reason && <p className="text-muted-foreground mt-0.5 opacity-80">{h.reason}</p>}
                  </div>
                ))}
              </div>
            )}

            {capHistory && capHistory.length === 0 && (
              <p className="text-xs text-muted-foreground mt-2 italic">
                {isAr ? 'لا يوجد سجل بعد.' : 'No history yet.'}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Slot Reservations & Waitlist Panel ───────────────────────────── */}
      <SlotReservationPanel
        marketKey={marketKey}
        isAr={isAr}
        baseUrl={BASE_API}
        slotSummary={slotSummary}
        reservations={reservations}
        waitlist={waitlist}
        outbox={outboxEntries}
        loading={slotLoading}
        onRefresh={loadSlotData}
      />
    </div>
  );
}
