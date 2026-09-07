import React, { useState } from 'react';
import { useI18n, type TranslationKey } from '@/lib/i18n';
import {
  useListMyOfficeVideoCallRequests, useUpdateMyOfficeVideoCallRequestStatus,
  getListMyOfficeVideoCallRequestsQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Video, Eye, CheckCircle2, XCircle, Phone } from 'lucide-react';
import { format } from 'date-fns';

type StatusFilter = 'all' | 'new' | 'viewed' | 'accepted' | 'declined' | 'completed';

interface VideoRequestsProps {
  navigate?: (section: string) => void;
}

export function VideoRequestsSection({ navigate }: VideoRequestsProps) {
  const { t, language } = useI18n();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<StatusFilter>('all');

  const { data: requests, isLoading } = useListMyOfficeVideoCallRequests();
  const updateStatusMut = useUpdateMyOfficeVideoCallRequestStatus({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListMyOfficeVideoCallRequestsQueryKey() }),
    },
  });

  const filters: { key: StatusFilter; label: TranslationKey }[] = [
    { key: 'all', label: 'dash.video.filter_all' },
    { key: 'new', label: 'dash.video.filter_new' },
    { key: 'viewed', label: 'dash.video.filter_viewed' },
    { key: 'accepted', label: 'dash.video.filter_accepted' },
    { key: 'declined', label: 'dash.video.filter_declined' },
    { key: 'completed', label: 'dash.video.filter_completed' },
  ];

  const filtered = (requests || []).filter(r => filter === 'all' || r.status === filter);
  const newCount = (requests || []).filter(r => r.status === 'new').length;

  const statusBadgeClass = (status: string) => {
    switch (status) {
      case 'new': return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'viewed': return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'accepted': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'declined': return 'bg-red-50 text-red-700 border-red-200';
      case 'completed': return 'bg-slate-100 text-slate-600 border-slate-200';
      default: return 'bg-slate-100 text-slate-600 border-slate-200';
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Video size={18} className="text-primary" />
                {t('dash.video.title')}
                {newCount > 0 && (
                  <span className="w-5 h-5 rounded-full bg-blue-500 text-white text-[10px] font-bold flex items-center justify-center">
                    {newCount}
                  </span>
                )}
              </CardTitle>
              <CardDescription className="mt-1">{t('dash.video.subtitle')}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Filter chips */}
          <div className="flex flex-wrap gap-2 mb-4">
            {filters.map(f => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${
                  filter === f.key
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-transparent text-muted-foreground border-border hover:border-foreground/30'
                }`}
              >
                {t(f.label)}
                {f.key === 'new' && newCount > 0 && (
                  <span className="ms-1.5 inline-flex w-4 h-4 rounded-full bg-blue-500 text-white text-[9px] items-center justify-center">
                    {newCount}
                  </span>
                )}
              </button>
            ))}
          </div>

          {isLoading ? (
            <Skeleton className="h-32 w-full rounded-xl" />
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center">
              <Video size={36} className="text-muted-foreground/20 mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">{t('dash.video.empty')}</p>
              <p className="text-muted-foreground/60 text-xs mt-1">{t('dash.video.empty_desc')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map(req => (
                <div
                  key={req.id}
                  className={`border rounded-xl p-4 flex flex-col gap-3 ${req.status === 'new' ? 'border-blue-200 bg-blue-50/30 dark:bg-blue-950/10' : 'bg-card'}`}
                  data-testid={`row-video-call-request-${req.id}`}
                >
                  <div className="flex items-start justify-between flex-wrap gap-2">
                    <div>
                      <p className="font-semibold">{req.customerName}</p>
                      <div className="flex items-center gap-1.5 mt-0.5 text-sm text-muted-foreground">
                        <Phone size={12} />
                        <span dir="ltr">{req.contactNumber}</span>
                      </div>
                    </div>
                    <Badge variant="outline" className={statusBadgeClass(req.status)}>
                      {t(`videocall.status_${req.status}` as TranslationKey)}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">{t('dash.video.preferred_datetime')}</p>
                      <p dir="ltr" className="font-medium">{req.preferredDate} {req.preferredTime}</p>
                      {req.timezone && <p className="text-xs text-muted-foreground">{req.timezone}</p>}
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">{t('dash.video.received')}</p>
                      <p dir="ltr">{format(new Date(req.createdAt), 'yyyy-MM-dd HH:mm')}</p>
                    </div>
                  </div>

                  {req.note && (
                    <p className="text-sm text-muted-foreground border-t pt-2">{req.note}</p>
                  )}

                  <div className="flex gap-2 flex-wrap">
                    {req.status === 'new' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateStatusMut.mutate({ requestId: req.id, data: { status: 'viewed' } })}
                        data-testid={`button-mark-viewed-${req.id}`}
                      >
                        <Eye size={14} className="me-1" />{t('dashboard.mark_viewed')}
                      </Button>
                    )}
                    {(req.status === 'new' || req.status === 'viewed') && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => updateStatusMut.mutate({ requestId: req.id, data: { status: 'accepted' } })}
                          data-testid={`button-mark-accepted-${req.id}`}
                        >
                          <CheckCircle2 size={14} className="me-1" />{t('dashboard.mark_accepted')}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => updateStatusMut.mutate({ requestId: req.id, data: { status: 'declined' } })}
                          data-testid={`button-mark-declined-${req.id}`}
                        >
                          <XCircle size={14} className="me-1" />{t('dashboard.mark_declined')}
                        </Button>
                      </>
                    )}
                    {req.status === 'accepted' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => updateStatusMut.mutate({ requestId: req.id, data: { status: 'completed' } })}
                        data-testid={`button-mark-completed-${req.id}`}
                      >
                        <CheckCircle2 size={14} className="me-1" />{t('dashboard.mark_completed')}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
