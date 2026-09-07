import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '@/lib/i18n';
import { getSessionToken } from '@/lib/sessionToken';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  CheckCircle2, AlertTriangle, XCircle, RefreshCw, Server,
  Database, Mail, CreditCard, Clock, Zap, ChevronRight,
  Activity, AlertCircle,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

// ── Types ────────────────────────────────────────────────────────────────────

type Status = 'healthy' | 'warning' | 'critical' | 'not_configured';

interface RecentError {
  timestamp: string;
  method: string;
  path: string;
  statusCode: number;
  errorSummary: string;
}

interface RecentJob {
  id: number;
  dateStart: string;
  trigger: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  rowsProcessed: number | null;
  errorMessage: string | null;
}

interface HealthResponse {
  overallStatus: Status;
  checkedAt: string;
  uptimeSeconds: number;
  application: {
    status: Status;
    errors5xxTotal: number;
    errors5xxLastHour: number;
    last5xxAt: string | null;
    recentErrors: RecentError[];
  };
  backgroundJobs: {
    status: Status;
    lastSuccessAt: string | null;
    consecutiveFailures: number;
    totalCompleted: number;
    totalFailed: number;
    totalSkipped: number;
    recentJobs: RecentJob[];
  };
  database: {
    status: Status;
    responseMs: number | null;
    message: string | null;
    apiHealthy: boolean;
  };
  notifications: {
    status: Status;
    providerConfigured: boolean;
    attempted: number;
    delivered: number;
    failed: number;
    failureRate: number | null;
    lastFailureAt: string | null;
    lastFailureSummary: string | null;
  };
  payments: {
    status: 'not_configured';
    note: string;
  };
}

// ── Fetch ────────────────────────────────────────────────────────────────────

async function fetchHealth(): Promise<HealthResponse> {
  const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
  const token = getSessionToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${base}/api/admin/health`, {
    credentials: 'include',
    headers,
  });
  if (!res.ok) throw new Error(`Health check returned ${res.status}`);
  return res.json();
}

// ── Status helpers ───────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  healthy: {
    icon: <CheckCircle2 size={14} className="text-emerald-600" />,
    dot:  'bg-emerald-500',
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    label: { ar: 'سليم', en: 'Healthy' },
  },
  warning: {
    icon: <AlertTriangle size={14} className="text-amber-600" />,
    dot:  'bg-amber-500',
    badge: 'bg-amber-50 text-amber-700 border-amber-200',
    label: { ar: 'تحذير', en: 'Warning' },
  },
  critical: {
    icon: <XCircle size={14} className="text-red-600" />,
    dot:  'bg-red-500 animate-pulse',
    badge: 'bg-red-50 text-red-700 border-red-200',
    label: { ar: 'حرج', en: 'Critical' },
  },
  not_configured: {
    icon: <AlertCircle size={14} className="text-muted-foreground" />,
    dot:  'bg-muted-foreground',
    badge: 'bg-muted text-muted-foreground border-border',
    label: { ar: 'غير مُفعَّل', en: 'Not configured' },
  },
};

function StatusBadge({ status, language }: { status: Status; language: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.not_configured;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${cfg.badge}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
      {cfg.label[language as 'ar' | 'en'] ?? cfg.label.en}
    </span>
  );
}

function StatusIcon({ status }: { status: Status }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.not_configured;
  return cfg.icon;
}

// ── Uptime formatter ─────────────────────────────────────────────────────────

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ── Job status pill ──────────────────────────────────────────────────────────

const JOB_STATUS_STYLE: Record<string, string> = {
  completed: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  failed:    'text-red-700 bg-red-50 border-red-200',
  skipped:   'text-muted-foreground bg-muted border-border',
  running:   'text-blue-700 bg-blue-50 border-blue-200',
};

// ── Section card ─────────────────────────────────────────────────────────────

interface SectionCardProps {
  icon: React.ReactNode;
  title: string;
  status: Status;
  language: string;
  rows: { label: string; value: React.ReactNode }[];
  onDetail?: () => void;
  detailLabel?: string;
}

function SectionCard({ icon, title, status, language, rows, onDetail, detailLabel }: SectionCardProps) {
  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">{icon}</span>
            <CardTitle className="text-sm font-semibold">{title}</CardTitle>
          </div>
          <StatusBadge status={status} language={language} />
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-2">
        {rows.map(({ label, value }) => (
          <div key={label} className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground text-xs">{label}</span>
            <span className="font-medium text-xs text-end">{value}</span>
          </div>
        ))}
        {onDetail && (
          <button
            onClick={onDetail}
            className="w-full flex items-center justify-between text-xs text-primary hover:underline pt-1"
          >
            <span>{detailLabel}</span>
            <ChevronRight size={12} />
          </button>
        )}
      </CardContent>
    </Card>
  );
}

// ── Detail dialog ─────────────────────────────────────────────────────────────

type DetailView = 'errors' | 'jobs' | null;

function ErrorsDetail({ errors, t, language }: {
  errors: RecentError[];
  t: (k: any) => string;
  language: string;
}) {
  if (errors.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-6">{t('health.no_errors')}</p>;
  }
  return (
    <div className="space-y-2 max-h-96 overflow-y-auto">
      {errors.map((e, i) => (
        <div key={i} className="border border-border/60 rounded-lg p-3 text-xs space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono font-semibold text-red-600">
              {e.statusCode} {e.method}
            </span>
            <span className="text-muted-foreground">
              {formatDistanceToNow(new Date(e.timestamp), { addSuffix: true })}
            </span>
          </div>
          <div className="font-mono text-muted-foreground truncate">{e.path}</div>
          {e.errorSummary && (
            <div className="text-muted-foreground italic">{e.errorSummary}</div>
          )}
        </div>
      ))}
    </div>
  );
}

function JobsDetail({ jobs, t, language }: {
  jobs: RecentJob[];
  t: (k: any) => string;
  language: string;
}) {
  if (jobs.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-6">{t('health.no_jobs')}</p>;
  }
  return (
    <div className="space-y-2 max-h-96 overflow-y-auto">
      {jobs.map((j) => (
        <div key={j.id} className={`border rounded-lg p-3 text-xs space-y-1 ${JOB_STATUS_STYLE[j.status] ?? ''}`}>
          <div className="flex items-center justify-between gap-2">
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${JOB_STATUS_STYLE[j.status]}`}>
              {j.status.toUpperCase()}
            </span>
            <span className="text-muted-foreground font-mono">
              {format(new Date(j.startedAt), 'MMM d, HH:mm')}
            </span>
          </div>
          <div className="flex gap-3 text-muted-foreground">
            <span className="capitalize">{j.trigger}</span>
            <span>{j.dateStart}</span>
            {j.durationMs != null && <span>{(j.durationMs / 1000).toFixed(1)}s</span>}
            {j.rowsProcessed != null && <span>{j.rowsProcessed} rows</span>}
          </div>
          {j.errorMessage && (
            <div className="text-red-600 italic">{j.errorMessage}</div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function PlatformHealthSection() {
  const { t, language } = useI18n();
  const [detail, setDetail] = useState<DetailView>(null);

  const { data, isLoading, isError, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ['admin-platform-health'],
    queryFn: fetchHealth,
    refetchInterval: 60_000, // auto-refresh every 60 s
    staleTime: 30_000,
  });

  // ── Loading / error state ──────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-20 bg-muted/40 animate-pulse rounded-xl" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-36 bg-muted/40 animate-pulse rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
        <XCircle size={32} className="text-red-500" />
        <p className="text-sm">Could not load health data.</p>
        <Button size="sm" variant="outline" onClick={() => refetch()}>
          <RefreshCw size={14} className="me-1.5" /> {t('health.refresh')}
        </Button>
      </div>
    );
  }

  const overall = data.overallStatus;
  const criticalSections = [data.application, data.backgroundJobs, data.database, data.notifications]
    .filter((s) => s.status === 'critical').length;
  const warningSections = [data.application, data.backgroundJobs, data.database, data.notifications]
    .filter((s) => s.status === 'warning').length;

  const lastChecked = dataUpdatedAt
    ? formatDistanceToNow(dataUpdatedAt, { addSuffix: true })
    : '—';

  // ── Application rows ───────────────────────────────────────────────────────
  const appRows = [
    {
      label: t('health.errors_last_hour'),
      value: (
        <span className={data.application.errors5xxLastHour > 0 ? 'text-red-600 font-bold' : ''}>
          {data.application.errors5xxLastHour}
        </span>
      ),
    },
    {
      label: t('health.errors_total'),
      value: data.application.errors5xxTotal,
    },
    {
      label: t('health.last_error'),
      value: data.application.last5xxAt
        ? formatDistanceToNow(new Date(data.application.last5xxAt), { addSuffix: true })
        : '—',
    },
  ];

  // ── Background jobs rows ───────────────────────────────────────────────────
  const jobRows = [
    {
      label: t('health.last_successful_run'),
      value: data.backgroundJobs.lastSuccessAt
        ? formatDistanceToNow(new Date(data.backgroundJobs.lastSuccessAt), { addSuffix: true })
        : '—',
    },
    {
      label: t('health.consecutive_failures'),
      value: (
        <span className={data.backgroundJobs.consecutiveFailures > 0 ? 'text-red-600 font-bold' : ''}>
          {data.backgroundJobs.consecutiveFailures}
        </span>
      ),
    },
    {
      label: t('health.jobs_completed'),
      value: data.backgroundJobs.totalCompleted,
    },
  ];

  // ── Database rows ──────────────────────────────────────────────────────────
  const dbRows = [
    {
      label: t('health.db_ping'),
      value: data.database.responseMs != null
        ? <span className="text-emerald-700">{data.database.responseMs} {t('health.ms')}</span>
        : <span className="text-red-600">—</span>,
    },
    {
      label: t('health.api_status'),
      value: data.database.apiHealthy
        ? <span className="text-emerald-700">OK</span>
        : <span className="text-red-600">Error</span>,
    },
    ...(data.database.message
      ? [{ label: 'Message', value: <span className="text-red-600 text-[11px]">{data.database.message}</span> }]
      : []),
  ];

  // ── Notifications rows ─────────────────────────────────────────────────────
  const notifRows = data.notifications.providerConfigured
    ? [
        { label: t('health.sent'),      value: data.notifications.attempted  },
        { label: t('health.delivered'), value: data.notifications.delivered  },
        {
          label: t('health.failed'),
          value: (
            <span className={data.notifications.failed > 0 ? 'text-red-600' : ''}>
              {data.notifications.failed}
            </span>
          ),
        },
        ...(data.notifications.failureRate != null
          ? [{ label: t('health.failure_rate'), value: `${data.notifications.failureRate}%` }]
          : []),
      ]
    : [
        {
          label: t('health.email_provider'),
          value: <span className="text-muted-foreground italic text-[11px]">Not configured (RESEND_API_KEY)</span>,
        },
      ];

  // ── Payments rows ──────────────────────────────────────────────────────────
  const paymentRows = [
    { label: '', value: <span className="text-muted-foreground italic text-[11px]">{t('health.payments_note')}</span> },
  ];

  return (
    <div className="space-y-5">
      {/* ── Overall status banner ── */}
      <div className={`rounded-xl border p-4 flex flex-col sm:flex-row sm:items-center gap-4 ${
        overall === 'critical' ? 'border-red-200 bg-red-50' :
        overall === 'warning'  ? 'border-amber-200 bg-amber-50' :
                                 'border-emerald-200 bg-emerald-50'
      }`}>
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
            overall === 'critical' ? 'bg-red-100' :
            overall === 'warning'  ? 'bg-amber-100' :
                                     'bg-emerald-100'
          }`}>
            {overall === 'critical' ? <XCircle size={22} className="text-red-600" /> :
             overall === 'warning'  ? <AlertTriangle size={22} className="text-amber-600" /> :
                                      <CheckCircle2 size={22} className="text-emerald-600" />}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-sm">{t(`health.status.${overall}`)}</p>
            <p className="text-xs text-muted-foreground">
              {t('health.last_checked')}: {lastChecked}
              {data.uptimeSeconds > 0 && (
                <> · {t('health.uptime')}: {formatUptime(data.uptimeSeconds)}</>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {criticalSections > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-red-100 text-red-700 text-xs font-medium">
              <XCircle size={11} /> {criticalSections} {t('health.critical_issues')}
            </span>
          )}
          {warningSections > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-100 text-amber-700 text-xs font-medium">
              <AlertTriangle size={11} /> {warningSections} {t('health.warnings')}
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => refetch()}
            disabled={isFetching}
            className="h-8 text-xs bg-background"
          >
            <RefreshCw size={13} className={`me-1.5 ${isFetching ? 'animate-spin' : ''}`} />
            {t('health.refresh')}
          </Button>
        </div>
      </div>

      {/* ── Section grid ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Application */}
        <SectionCard
          icon={<Server size={16} />}
          title={t('health.section.application')}
          status={data.application.status}
          language={language}
          rows={appRows}
          onDetail={() => setDetail('errors')}
          detailLabel={t('health.view_errors')}
        />

        {/* Background Jobs */}
        <SectionCard
          icon={<Activity size={16} />}
          title={t('health.section.jobs')}
          status={data.backgroundJobs.status}
          language={language}
          rows={jobRows}
          onDetail={() => setDetail('jobs')}
          detailLabel={t('health.view_jobs')}
        />

        {/* Database & Core Services */}
        <SectionCard
          icon={<Database size={16} />}
          title={t('health.section.database')}
          status={data.database.status}
          language={language}
          rows={dbRows}
        />

        {/* Notifications */}
        <SectionCard
          icon={<Mail size={16} />}
          title={t('health.section.notifications')}
          status={data.notifications.status}
          language={language}
          rows={notifRows}
        />

        {/* Payments */}
        <SectionCard
          icon={<CreditCard size={16} />}
          title={t('health.section.payments')}
          status="not_configured"
          language={language}
          rows={paymentRows}
        />
      </div>

      {/* ── Detail dialog ── */}
      <Dialog open={detail !== null} onOpenChange={() => setDetail(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {detail === 'errors' ? t('health.detail.recent_errors') : t('health.detail.recent_jobs')}
            </DialogTitle>
          </DialogHeader>
          {detail === 'errors' && (
            <ErrorsDetail errors={data.application.recentErrors} t={t} language={language} />
          )}
          {detail === 'jobs' && (
            <JobsDetail jobs={data.backgroundJobs.recentJobs} t={t} language={language} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
