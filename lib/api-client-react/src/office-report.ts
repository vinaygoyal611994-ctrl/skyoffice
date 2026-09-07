/**
 * Hand-written React Query hook for the office-facing analytics report.
 *
 * Written manually (same pattern as service-requests.ts) to avoid orval
 * v3/v4 codegen compatibility issues documented in project memory.
 */
import { useQuery } from "@tanstack/react-query";
import type { UseQueryOptions } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

// ── Types (mirror the server's OfficeReportResponse) ─────────────────────────

export type ReportPeriod = "7d" | "30d" | "90d";

export interface PeriodMetricPair {
  current: number;
  previous: number;
  change: number | null;
}

export interface RatePair {
  current: number | null;
  previous: number | null;
  change: number | null;
}

export interface TopServiceSignal {
  serviceKey: string;
  nameEn: string;
  nameAr: string;
  count: number;
  share: number;
}

export interface TopCitySignal {
  cityId: string;
  nameEn?: string;
  nameAr?: string;
  count: number;
  share: number;
}

export type RecommendationActionTarget =
  | "profile"
  | "services"
  | "media"
  | "quick_card"
  | "contact"
  | "location"
  | "copy_link"
  | "public_profile";

export interface ReportRecommendation {
  priority: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
  actionLabelEn: string;
  actionLabelAr: string;
  actionTarget: RecommendationActionTarget;
}

export interface ReportOpportunity {
  currentRate: number;
  targetRate: number;
  estimatedAdditionalContacts: number;
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
}

export interface ReportDayTrend {
  date: string;
  profileViews: number;
  contactActions: number;
}

export interface OfficeReport {
  period: { from: string; to: string; days: number };
  comparisonPeriod: { from: string; to: string };
  dataAvailabilityNote: "full" | "partial" | "none";
  metrics: {
    cardImpressions: PeriodMetricPair;
    profileViews: PeriodMetricPair;
    uniqueVisitors: PeriodMetricPair;
    contactActions: PeriodMetricPair;
    whatsappClicks: PeriodMetricPair;
    phoneClicks: PeriodMetricPair | null;
    shareClicks: PeriodMetricPair;
    copyLinkClicks: PeriodMetricPair;
    qrVisits: PeriodMetricPair;
    visitToContactRate: RatePair;
  };
  topSignals: {
    topService: TopServiceSignal | null;
    topCity: TopCitySignal | null;
  };
  dailyTrend: ReportDayTrend[];
  recommendation: ReportRecommendation;
  opportunity: ReportOpportunity | null;
}

// ── Query key ─────────────────────────────────────────────────────────────────

export const getOfficeReportQueryKey = (period: ReportPeriod) =>
  ["office-report", period] as const;

// ── Hook ──────────────────────────────────────────────────────────────────────

export const useGetOfficeReport = (
  period: ReportPeriod = "30d",
  options?: { query?: Partial<UseQueryOptions<OfficeReport>> },
) => {
  return useQuery<OfficeReport>({
    queryKey: getOfficeReportQueryKey(period),
    queryFn: () =>
      customFetch<OfficeReport>(`/api/analytics/office/report?period=${period}`),
    staleTime: 5 * 60 * 1000, // 5 minutes — data only updates once per day
    ...options?.query,
  });
};
