/**
 * SkayOffice Admin — Market Intelligence Dashboard
 *
 * Seven sections:
 *   1. Executive Overview — global KPI cards + derived rates
 *   2. Market Demand & Supply — by country/city/category
 *   3. Search Intelligence — top queries + zero-result rate
 *   4. Office Performance — per-office table
 *   5. Traffic Sources — source breakdown
 *   6. Rule-Based Insights — auto-computed observations
 *   7. Aggregation Health — job history
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useI18n } from '@/lib/i18n';
import { safeApiError } from '@/lib/apiError';

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');

function apiFetch<T>(path: string): Promise<T> {
  return fetch(`${BASE}${path}`, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw Object.assign(new Error('request_failed'), { status: r.status });
    return r.json() as Promise<T>;
  });
}

function fmt(n: number | null | undefined, decimals = 0): string {
  if (n == null) return '—';
  return n.toLocaleString('en', { maximumFractionDigits: decimals });
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${n.toFixed(1)}%`;
}

function defaultFrom() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function defaultTo() {
  return new Date().toISOString().slice(0, 10);
}

function buildQuery(params: Record<string, string | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) q.set(k, v);
  }
  return q.toString() ? `?${q.toString()}` : '';
}

// City/country/source label maps
const CITY_LABELS: Record<string, string> = {
  riyadh: 'Riyadh', dubai: 'Dubai', jeddah: 'Jeddah', abu_dhabi: 'Abu Dhabi',
  dammam: 'Dammam', khobar: 'Al Khobar', sharjah: 'Sharjah', mecca: 'Mecca',
  medina: 'Medina', tabuk: 'Tabuk', abha: 'Abha', hail: 'Hail',
  najran: 'Najran', jizan: 'Jizan', qassim: 'Qassim', taif: 'Taif',
  ajman: 'Ajman', fujairah: 'Fujairah', ras_al_khaimah: 'Ras Al Khaimah',
  umm_al_quwain: 'Umm Al Quwain',
};

const COUNTRY_LABELS: Record<string, string> = { SA: 'Saudi Arabia', AE: 'UAE' };
const SOURCE_LABELS: Record<string, string> = {
  direct: 'Direct', internal_search: 'Site Search', qr: 'QR Code',
  social: 'Social Media', referral: 'Referral', paid_campaign: 'Paid Campaign',
  organic_search: 'Organic Search', whatsapp_share: 'WhatsApp Share', unknown: 'Unknown',
};

const CATEGORY_LABELS: Record<string, string> = {
  translation: 'Translation', legal: 'Legal', marketing: 'Marketing',
  development: 'Development', design: 'Design', real_estate: 'Real Estate',
  company_formation: 'Company Formation', business_consulting: 'Business Consulting',
  accounting: 'Accounting', social_media_management: 'Social Media', other: 'Other',
};

function labelCity(id: string | null | undefined): string {
  if (!id || id === '__ALL__') return '—';
  return CITY_LABELS[id] ?? id.replace(/_/g, ' ');
}
function labelCountry(code: string | null | undefined): string {
  if (!code || code === '__ALL__') return '—';
  return COUNTRY_LABELS[code] ?? code;
}
function labelCategory(key: string | null | undefined): string {
  if (!key || key === '__ALL__') return '—';
  return CATEGORY_LABELS[key] ?? key;
}
function labelSource(s: string | null | undefined): string {
  if (!s) return '—';
  return SOURCE_LABELS[s] ?? s;
}

// ── Type definitions ──────────────────────────────────────────────────────────

interface OverviewData {
  totals: Record<string, number>;
  rates: {
    clickThroughRate: number | null;
    profileToContactRate: number | null;
    videoCompletionRate: number | null;
    zeroResultRate: number | null;
    voiceSearchRate: number | null;
  };
  snapshots: { activeOffices: number | null; approvedOffices: number | null };
}

interface MarketRow {
  countryCode: string; cityId: string; categoryId: string;
  searches: number; zeroResultSearches: number; profileViews: number;
  whatsappClicks: number; qrVisits: number; activeOfficesSnapshot: number | null;
  mapClicks?: number;
}

interface SearchRow {
  query: string; totalSearches: number; zeroResults: number; clicks: number;
  voiceCount: number; typedCount: number;
  dominantCategory: string | null; dominantLanguage: string | null;
}

interface OfficeRow {
  officeId: number; countryCode: string | null; cityId: string | null;
  categoryId: string | null; statusSnapshot: string | null;
  profileViews: number; cardClicks: number; cardImpressions: number;
  whatsappClicks: number; mapClicks: number; videoCallRequests: number;
  qrVisits: number; favouritesAdded: number;
  clickThroughRate: number | null; contactRate: number | null;
}

interface SourceRow {
  source: string; utmCampaign: string; sessions: number;
  profileViews: number; uniqueVisitors: number;
  whatsappClicks: number; qrVisits: number;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="bg-card">
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground mb-1 truncate">{label}</p>
        <p className="text-2xl font-bold tracking-tight">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function KpiSkeleton() {
  return (
    <Card>
      <CardContent className="p-4">
        <Skeleton className="h-3 w-24 mb-2" />
        <Skeleton className="h-8 w-20" />
      </CardContent>
    </Card>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-semibold mb-4 mt-8">{children}</h2>;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
    running: 'bg-blue-100 text-blue-800',
    skipped: 'bg-gray-100 text-gray-700',
  };
  return (
    <span className={`inline-block px-2 py-0.5 text-xs rounded-full font-medium ${map[status] ?? 'bg-gray-100 text-gray-700'}`}>
      {status}
    </span>
  );
}

function InsightCard({
  title, description, tone,
}: {
  title: string; description: string; tone: 'green' | 'amber' | 'red' | 'blue';
}) {
  const border = { green: 'border-s-green-500', amber: 'border-s-amber-500', red: 'border-s-red-500', blue: 'border-s-blue-500' }[tone];
  return (
    <Card className={`border-s-4 ${border}`}>
      <CardContent className="p-4">
        <p className="font-medium text-sm">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </CardContent>
    </Card>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

// Admin-panel only: English-only; use literal fallbacks rather than i18n dict.
// t(key, fallback?) returns fallback when provided, otherwise key as-is.
const t = (_key: string, fallback?: string): string => fallback ?? _key;

export default function IntelligenceSection() {
  const { language } = useI18n();

  // Filters
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [country, setCountry] = useState('');
  const [category, setCategory] = useState('');

  // Data state
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [market, setMarket] = useState<MarketRow[]>([]);
  const [search, setSearch] = useState<SearchRow[]>([]);
  const [offices, setOffices] = useState<OfficeRow[]>([]);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const q = buildQuery({ from, to, country: country || undefined, category: category || undefined });
    setLoading(true);
    setError(null);

    Promise.all([
      apiFetch<OverviewData>(`/api/analytics/admin/overview${q}`),
      apiFetch<{ rows: MarketRow[] }>(`/api/analytics/admin/market${q}`),
      apiFetch<{ rows: SearchRow[] }>(`/api/analytics/admin/search${q}`),
      apiFetch<{ rows: OfficeRow[] }>(`/api/analytics/admin/offices${q}`),
      apiFetch<{ rows: SourceRow[] }>(`/api/analytics/admin/sources${q}`),
    ])
      .then(([ov, mk, sr, of, so]) => {
        setOverview(ov);
        setMarket(mk.rows ?? []);
        setSearch(sr.rows ?? []);
        setOffices(of.rows ?? []);
        setSources(so.rows ?? []);
      })
      .catch((err: Error) => setError(safeApiError(err, language)))
      .finally(() => setLoading(false));
  }, [from, to, country, category, language]);

  useEffect(() => {
    load();
  }, [load]);

  // ── Filter bar ─────────────────────────────────────────────────────────────
  const filterBar = (
    <div className="sticky top-0 z-10 bg-background border-b pb-3 pt-1 mb-6 flex flex-wrap gap-3 items-end">
      <label className="flex flex-col gap-1 text-xs font-medium">
        {t('intelligence.dateFrom', 'From')}
        <input
          type="date" value={from} onChange={(e) => setFrom(e.target.value)}
          className="border rounded px-2 py-1 text-sm bg-background"
          max={to}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium">
        {t('intelligence.dateTo', 'To')}
        <input
          type="date" value={to} onChange={(e) => setTo(e.target.value)}
          className="border rounded px-2 py-1 text-sm bg-background"
          min={from}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium">
        {t('intelligence.country', 'Country')}
        <select
          value={country} onChange={(e) => setCountry(e.target.value)}
          className="border rounded px-2 py-1 text-sm bg-background"
        >
          <option value="">{t('intelligence.all', 'All')}</option>
          <option value="SA">Saudi Arabia</option>
          <option value="AE">UAE</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium">
        {t('intelligence.category', 'Category')}
        <select
          value={category} onChange={(e) => setCategory(e.target.value)}
          className="border rounded px-2 py-1 text-sm bg-background"
        >
          <option value="">{t('intelligence.all', 'All')}</option>
          {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </label>
    </div>
  );

  if (error) {
    return (
      <div className="p-6">
        {filterBar}
        <Card className="border-red-300">
          <CardContent className="p-6 text-red-600 text-sm">{error}</CardContent>
        </Card>
      </div>
    );
  }

  const tot: Record<string, number> = overview?.totals ?? {};
  const rates: OverviewData['rates'] = overview?.rates ?? {
    clickThroughRate: null,
    profileToContactRate: null,
    videoCompletionRate: null,
    zeroResultRate: null,
    voiceSearchRate: null,
  };
  const snaps: OverviewData['snapshots'] = overview?.snapshots ?? { activeOffices: null, approvedOffices: null };

  // Computed
  const contactActions =
    (tot.whatsappClicks ?? 0) + (tot.mapClicks ?? 0) +
    (tot.shareClicks ?? 0) + (tot.videoCallRequests ?? 0);

  // ── Section 1: Executive Overview ─────────────────────────────────────────
  const overviewSection = (
    <>
      <SectionHeading>{t('intelligence.executive', 'Executive Overview')}</SectionHeading>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {loading ? Array.from({ length: 8 }).map((_, i) => <KpiSkeleton key={i} />) : (
          <>
            <KpiCard label={t('intelligence.searches', 'Searches')} value={fmt(tot.searches)} />
            <KpiCard label={t('intelligence.profileViews', 'Profile Views')} value={fmt(tot.profileViews)} />
            <KpiCard label="Contact Actions / Enquiries" value={fmt(contactActions)} />
            <KpiCard label={t('intelligence.qrVisits', 'QR Visits')} value={fmt(tot.qrVisits)} />
            <KpiCard label={t('intelligence.cardImpressions', 'Card Impressions')} value={fmt(tot.cardImpressions)} />
            <KpiCard label={t('intelligence.cardClicks', 'Card Clicks')} value={fmt(tot.cardClicks)} sub={`CTR: ${fmtPct(rates.clickThroughRate)}`} />
            <KpiCard label={t('intelligence.uniqueVisitors', 'Unique Visitors')} value={fmt(tot.uniqueVisitorsApprox)} />
            <KpiCard label="Video Starts" value={fmt(tot.videoStarts)} sub={`Completion: ${fmtPct(rates.videoCompletionRate)}`} />
          </>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {loading ? Array.from({ length: 4 }).map((_, i) => <KpiSkeleton key={i} />) : (
          <>
            <KpiCard label="Profile → Contact Rate" value={fmtPct(rates.profileToContactRate)} />
            <KpiCard label="Zero-Result Rate" value={fmtPct(rates.zeroResultRate)} />
            <KpiCard label="Voice Search Rate" value={fmtPct(rates.voiceSearchRate)} />
            <KpiCard label="Active Offices" value={fmt(snaps.activeOffices)} />
          </>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {loading ? Array.from({ length: 4 }).map((_, i) => <KpiSkeleton key={i} />) : (
          <>
            <KpiCard label="Registrations Started" value={fmt(tot.registrationStarts)} />
            <KpiCard label="Registrations Completed" value={fmt(tot.registrationsCompleted)} />
            <KpiCard label="Offices Approved" value={fmt(tot.profilesApproved)} />
            <KpiCard label="Reviews Submitted" value={fmt(tot.reviewsSubmitted)} />
          </>
        )}
      </div>
    </>
  );

  // ── Section 2: Market Demand & Supply ─────────────────────────────────────
  const filteredMarket = market
    .filter((r) => r.countryCode !== '__ALL__' && r.cityId !== '__ALL__' && r.categoryId !== '__ALL__')
    .slice(0, 50);

  const marketSection = (
    <>
      <SectionHeading>{t('intelligence.market', 'Market Demand & Supply')}</SectionHeading>
      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : filteredMarket.length === 0 ? (
        <Card><CardContent className="p-6 text-muted-foreground text-sm text-center">{t('intelligence.noData', 'No data for this period')}</CardContent></Card>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {['Country', 'City', 'Category', 'Searches', 'Zero %', 'Profile Views', 'Contact Actions', 'Active Offices'].map((h) => (
                  <th key={h} className="px-3 py-2 text-start text-xs font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredMarket.map((r, i) => (
                <tr key={i} className="border-t hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2 whitespace-nowrap">{labelCountry(r.countryCode)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{labelCity(r.cityId)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{labelCategory(r.categoryId)}</td>
                  <td className="px-3 py-2 text-end font-mono">{fmt(r.searches)}</td>
                  <td className="px-3 py-2 text-end">
                    {r.searches > 0 ? (
                      <span className={(r.zeroResultSearches / r.searches) > 0.5 ? 'text-red-600 font-medium' : ''}>
                        {fmtPct((r.zeroResultSearches / r.searches) * 100)}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2 text-end font-mono">{fmt(r.profileViews)}</td>
                  <td className="px-3 py-2 text-end font-mono">{fmt((r.whatsappClicks ?? 0) + (r.mapClicks ?? 0))}</td>
                  <td className="px-3 py-2 text-end font-mono">{r.activeOfficesSnapshot != null ? fmt(r.activeOfficesSnapshot) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );

  // ── Section 3: Search Intelligence ────────────────────────────────────────
  const searchSection = (
    <>
      <SectionHeading>{t('intelligence.search', 'Search Intelligence')}</SectionHeading>
      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : search.length === 0 ? (
        <Card><CardContent className="p-6 text-muted-foreground text-sm text-center">No searches yet</CardContent></Card>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {['Query', 'Searches', 'Zero %', 'Clicks', 'Voice %', 'Category', 'Language'].map((h) => (
                  <th key={h} className="px-3 py-2 text-start text-xs font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {search.slice(0, 50).map((r, i) => {
                const zeroRate = r.totalSearches > 0 ? (r.zeroResults / r.totalSearches) * 100 : null;
                const voiceRate = r.totalSearches > 0 ? (r.voiceCount / r.totalSearches) * 100 : null;
                return (
                  <tr key={i} className="border-t hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2 max-w-[200px] truncate font-medium" dir="auto">{r.query}</td>
                    <td className="px-3 py-2 text-end font-mono">{fmt(r.totalSearches)}</td>
                    <td className="px-3 py-2 text-end">
                      {zeroRate != null ? (
                        zeroRate > 50
                          ? <Badge variant="destructive">{fmtPct(zeroRate)}</Badge>
                          : zeroRate > 20
                            ? <span className="text-amber-600 font-medium">{fmtPct(zeroRate)}</span>
                            : fmtPct(zeroRate)
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2 text-end font-mono">{fmt(r.clicks)}</td>
                    <td className="px-3 py-2 text-end">{fmtPct(voiceRate)}</td>
                    <td className="px-3 py-2">{labelCategory(r.dominantCategory)}</td>
                    <td className="px-3 py-2">{r.dominantLanguage === 'ar' ? 'عربي' : r.dominantLanguage === 'en' ? 'English' : r.dominantLanguage ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );

  // ── Section 4: Office Performance ─────────────────────────────────────────
  const officesSection = (
    <>
      <SectionHeading>{t('intelligence.offices', 'Office Performance')}</SectionHeading>
      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : offices.length === 0 ? (
        <Card><CardContent className="p-6 text-muted-foreground text-sm text-center">{t('intelligence.noData', 'No data for this period')}</CardContent></Card>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {['ID', 'Country', 'City', 'Category', 'Status', 'Profile Views', 'Impr.', 'CTR', 'Contact', 'Contact Rate', 'QR', 'Favs'].map((h) => (
                  <th key={h} className="px-3 py-2 text-start text-xs font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {offices.slice(0, 50).map((r, i) => {
                const contactAct = (r.whatsappClicks ?? 0) + (r.mapClicks ?? 0) + (r.videoCallRequests ?? 0);
                return (
                  <tr key={i} className="border-t hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2 font-mono text-xs">{r.officeId}</td>
                    <td className="px-3 py-2">{labelCountry(r.countryCode)}</td>
                    <td className="px-3 py-2">{labelCity(r.cityId)}</td>
                    <td className="px-3 py-2">{labelCategory(r.categoryId)}</td>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${r.statusSnapshot === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}>
                        {r.statusSnapshot ?? '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-end font-mono">{fmt(r.profileViews)}</td>
                    <td className="px-3 py-2 text-end font-mono">{fmt(r.cardImpressions)}</td>
                    <td className="px-3 py-2 text-end">{fmtPct(r.clickThroughRate)}</td>
                    <td className="px-3 py-2 text-end font-mono">{fmt(contactAct)}</td>
                    <td className="px-3 py-2 text-end">{fmtPct(r.contactRate)}</td>
                    <td className="px-3 py-2 text-end font-mono">{fmt(r.qrVisits)}</td>
                    <td className="px-3 py-2 text-end font-mono">{fmt(r.favouritesAdded)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );

  // ── Section 5: Traffic Sources ─────────────────────────────────────────────
  const sourcesSection = (
    <>
      <SectionHeading>{t('intelligence.sources', 'Traffic Sources')}</SectionHeading>
      {loading ? (
        <Skeleton className="h-32 w-full" />
      ) : sources.length === 0 ? (
        <Card><CardContent className="p-6 text-muted-foreground text-sm text-center">{t('intelligence.noData', 'No data for this period')}</CardContent></Card>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {['Source', 'Campaign', 'Sessions', 'Profile Views', 'Unique Visitors', 'Contact Actions', 'QR Visits'].map((h) => (
                  <th key={h} className="px-3 py-2 text-start text-xs font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sources.map((r, i) => (
                <tr key={i} className="border-t hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2 font-medium">{labelSource(r.source)}</td>
                  <td className="px-3 py-2 text-muted-foreground text-xs">{r.utmCampaign === '__NONE__' ? '—' : r.utmCampaign}</td>
                  <td className="px-3 py-2 text-end font-mono">{fmt(r.sessions)}</td>
                  <td className="px-3 py-2 text-end font-mono">{fmt(r.profileViews)}</td>
                  <td className="px-3 py-2 text-end font-mono">{fmt(r.uniqueVisitors)}</td>
                  <td className="px-3 py-2 text-end font-mono">{fmt(r.whatsappClicks)}</td>
                  <td className="px-3 py-2 text-end font-mono">{fmt(r.qrVisits)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );

  // ── Section 6: Rule-Based Insights ────────────────────────────────────────
  const insights: Array<{ title: string; description: string; tone: 'green' | 'amber' | 'red' | 'blue' }> = [];

  if (!loading && overview) {
    // Top market
    const topMarket = filteredMarket[0];
    if (topMarket && topMarket.searches > 0) {
      insights.push({
        title: `Top market: ${labelCity(topMarket.cityId)}, ${labelCountry(topMarket.countryCode)}`,
        description: `${fmt(topMarket.searches)} searches this period — ${labelCategory(topMarket.categoryId)}`,
        tone: 'blue',
      });
    }

    // Top query
    const topQuery = search[0];
    if (topQuery) {
      insights.push({
        title: `Most searched: "${topQuery.query}"`,
        description: `${fmt(topQuery.totalSearches)} searches — ${topQuery.dominantCategory ? labelCategory(topQuery.dominantCategory) : 'No category detected'}`,
        tone: 'blue',
      });
    }

    // Zero-result rate insight
    const zeroRate = rates.zeroResultRate;
    if (zeroRate != null) {
      if (zeroRate > 20) {
        insights.push({
          title: `High zero-result rate: ${fmtPct(zeroRate)}`,
          description: 'More than 1 in 5 searches find nothing — review category coverage and city availability',
          tone: 'red',
        });
      } else if (zeroRate < 5) {
        insights.push({
          title: `Healthy search coverage: ${fmtPct(zeroRate)} zero results`,
          description: 'Almost all searches return results — product-market fit is strong',
          tone: 'green',
        });
      } else {
        insights.push({
          title: `Zero-result rate: ${fmtPct(zeroRate)}`,
          description: 'Within acceptable range — monitor for increases',
          tone: 'amber',
        });
      }
    }

    // QR insight
    const qrVisits = tot.qrVisits ?? 0;
    const profileViews = tot.profileViews ?? 0;
    if (profileViews > 0) {
      const qrPct = (qrVisits / profileViews) * 100;
      insights.push({
        title: `QR traffic: ${fmt(qrVisits)} visits (${fmtPct(qrPct)} of profile views)`,
        description: qrPct > 10 ? 'Strong QR usage — offices are using printed materials effectively' : 'Low QR adoption — consider promoting QR code usage',
        tone: qrPct > 10 ? 'green' : 'amber',
      });
    }

    // Voice search
    const voiceRate = rates.voiceSearchRate;
    if (voiceRate != null && (tot.searches ?? 0) >= 30) {
      insights.push({
        title: `Voice search: ${fmtPct(voiceRate)} of searches`,
        description: voiceRate > 20 ? 'High voice usage — ensure Arabic voice search normalization is running well' : 'Primarily text search — voice adoption is growing in GCC',
        tone: voiceRate > 20 ? 'amber' : 'blue',
      });
    }
  }

  const insightsSection = (
    <>
      <SectionHeading>{t('intelligence.insights', 'Insights')}</SectionHeading>
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
        </div>
      ) : insights.length === 0 ? (
        <Card><CardContent className="p-6 text-muted-foreground text-sm text-center">No insights available yet — data will appear after the first full day of activity.</CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {insights.map((ins, i) => (
            <InsightCard key={i} title={ins.title} description={ins.description} tone={ins.tone} />
          ))}
        </div>
      )}
    </>
  );

  // ── Layout ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-6 max-w-screen-xl">
      <h1 className="text-2xl font-bold mb-2">{t('intelligence.title', 'Market Intelligence')}</h1>
      <p className="text-sm text-muted-foreground mb-6">Analytics for the SkayOffice platform — KSA &amp; UAE markets.</p>

      {filterBar}

      {overviewSection}
      {marketSection}
      {searchSection}
      {officesSection}
      {sourcesSection}
      {insightsSection}
    </div>
  );
}
