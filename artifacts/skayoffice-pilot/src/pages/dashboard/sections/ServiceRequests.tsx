import React, { useState } from 'react';
import { useI18n, type TranslationKey } from '@/lib/i18n';
import {
  useGetOfficeServiceRequests,
  useSendServiceOffer,
  useRejectServiceRequest,
  useMarkServiceComplete,
  getGetOfficeServiceRequestsQueryKey,
  type ServiceRequestItem,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ClipboardList, CheckCircle2, XCircle, Clock, Send } from 'lucide-react';
import { format } from 'date-fns';
import { ServiceRequestAttachments } from '@/components/service-requests/ServiceRequestAttachments';
import { safeApiError } from '@/lib/apiError';

type SrStatusFilter =
  | 'all'
  | 'submitted'
  | 'offer_sent'
  | 'agreed'
  | 'awaiting_customer_confirmation'
  | 'completed'
  | 'rejected'
  | 'not_completed';

const STATUS_BADGE: Record<string, string> = {
  submitted:                      'bg-blue-50 text-blue-700 border-blue-200',
  offer_sent:                     'bg-amber-50 text-amber-700 border-amber-200',
  agreed:                         'bg-emerald-50 text-emerald-700 border-emerald-200',
  awaiting_customer_confirmation: 'bg-purple-50 text-purple-700 border-purple-200',
  completed:                      'bg-slate-100 text-slate-600 border-slate-200',
  rejected:                       'bg-red-50 text-red-600 border-red-200',
  not_completed:                  'bg-rose-50 text-rose-700 border-rose-200',
};

const FILTERS: { key: SrStatusFilter; labelKey: TranslationKey }[] = [
  { key: 'all',                           labelKey: 'sr.filter_all' },
  { key: 'submitted',                     labelKey: 'sr.filter_submitted' },
  { key: 'offer_sent',                    labelKey: 'sr.filter_offer_sent' },
  { key: 'agreed',                        labelKey: 'sr.filter_agreed' },
  { key: 'awaiting_customer_confirmation',labelKey: 'sr.filter_awaiting' },
  { key: 'completed',                     labelKey: 'sr.filter_completed' },
  { key: 'rejected',                      labelKey: 'sr.filter_rejected' },
];

interface OfferDialogState {
  requestId: number;
  price: string;
  executionDuration: string;
}

export function ServiceRequestsSection() {
  const { t, language } = useI18n();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<SrStatusFilter>('all');
  const [offerDialog, setOfferDialog] = useState<OfferDialogState | null>(null);
  const [offerError, setOfferError] = useState('');

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getGetOfficeServiceRequestsQueryKey() });

  const { data: requests, isLoading } = useGetOfficeServiceRequests();

  const sendOfferMut = useSendServiceOffer({
    mutation: {
      onSuccess: () => { invalidate(); setOfferDialog(null); setOfferError(''); },
      onError: (err: any) => setOfferError(safeApiError(err, language)),
    },
  });

  const rejectMut = useRejectServiceRequest({ mutation: { onSuccess: invalidate } });
  const completeMut = useMarkServiceComplete({ mutation: { onSuccess: invalidate } });

  const newCount = (requests || []).filter(r => r.status === 'submitted').length;
  const filtered = (requests || []).filter(r => filter === 'all' || r.status === filter);

  const openOfferDialog = (req: ServiceRequestItem) => {
    setOfferDialog({ requestId: req.id, price: req.price ?? '', executionDuration: req.executionDuration ?? '' });
    setOfferError('');
  };

  const submitOffer = () => {
    if (!offerDialog) return;
    if (!offerDialog.price.trim()) { setOfferError(t('sr.error_price_required')); return; }
    if (!offerDialog.executionDuration.trim()) { setOfferError(t('sr.error_duration_required')); return; }
    sendOfferMut.mutate({
      requestId: offerDialog.requestId,
      price: offerDialog.price.trim(),
      executionDuration: offerDialog.executionDuration.trim(),
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ClipboardList size={18} className="text-primary" />
                {t('sr.section_heading')}
                {newCount > 0 && (
                  <span className="w-5 h-5 rounded-full bg-blue-500 text-white text-[10px] font-bold flex items-center justify-center">
                    {newCount > 9 ? '9+' : newCount}
                  </span>
                )}
              </CardTitle>
              <CardDescription className="mt-1">{t('sr.section_desc')}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Filter chips */}
          <div className="flex flex-wrap gap-2 mb-4">
            {FILTERS.map(f => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${
                  filter === f.key
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-transparent text-muted-foreground border-border hover:border-foreground/30'
                }`}
              >
                {t(f.labelKey)}
                {f.key === 'submitted' && newCount > 0 && (
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
              <ClipboardList size={36} className="text-muted-foreground/20 mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">{t('sr.empty_office_requests')}</p>
              <p className="text-muted-foreground/60 text-xs mt-1">{t('sr.empty_office_requests_desc')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map(req => (
                <div
                  key={req.id}
                  className={`border rounded-xl p-4 flex flex-col gap-3 ${
                    req.status === 'submitted'
                      ? 'border-blue-200 bg-blue-50/30 dark:bg-blue-950/10'
                      : 'bg-card'
                  }`}
                  data-testid={`row-sr-office-${req.id}`}
                >
                  {/* Header row: customer name + status */}
                  <div className="flex items-start justify-between flex-wrap gap-2">
                    <div>
                      <p className="font-semibold">{req.customerName}</p>
                      <p dir="auto" className="text-xs text-muted-foreground mt-0.5 break-words">
                        <bdi>{req.serviceName}</bdi>
                      </p>
                    </div>
                    <Badge variant="outline" className={STATUS_BADGE[req.status] ?? STATUS_BADGE.submitted}>
                      {t(`sr.status_${req.status}` as TranslationKey)}
                    </Badge>
                  </div>

                  {/* Description */}
                  <p dir="auto" className="text-sm text-muted-foreground leading-relaxed break-words line-clamp-3">
                    <bdi>{req.description}</bdi>
                  </p>

                  {/* Offer details (when sent) */}
                  {(req.status === 'offer_sent' || req.status === 'agreed' ||
                    req.status === 'awaiting_customer_confirmation' || req.status === 'completed') &&
                    req.price && (
                    <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/30 p-3 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground mb-0.5">{t('sr.price')}</p>
                        <p dir="auto" className="font-semibold break-words"><bdi>{req.price}</bdi></p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-0.5">{t('sr.execution_duration')}</p>
                        <p dir="auto" className="font-semibold break-words"><bdi>{req.executionDuration}</bdi></p>
                      </div>
                    </div>
                  )}

                  {/* Timestamp */}
                  <p className="text-[11px] text-muted-foreground/60" dir="ltr">
                    {format(new Date(req.createdAt), 'yyyy-MM-dd HH:mm')}
                  </p>

                  {/* Actions */}
                  <div className="flex gap-2 flex-wrap">
                     <ServiceRequestAttachments
                       requestId={req.id}
                       canUpload={false}
                       testIdPrefix="office-sr"
                     />
                    {req.status === 'submitted' && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => openOfferDialog(req)}
                          data-testid={`button-send-offer-${req.id}`}
                        >
                          <Send size={14} className="me-1.5" />
                          {t('sr.send_offer')}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => rejectMut.mutate({ requestId: req.id })}
                          disabled={rejectMut.isPending}
                          data-testid={`button-reject-request-${req.id}`}
                        >
                          <XCircle size={14} className="me-1.5" />
                          {t('sr.reject_request')}
                        </Button>
                      </>
                    )}
                    {req.status === 'offer_sent' && (
                      <div className="flex items-center gap-1.5 text-xs text-amber-600">
                        <Clock size={13} className="shrink-0" />
                        {t('sr.waiting_customer_response')}
                      </div>
                    )}
                    {req.status === 'agreed' && (
                      <Button
                        size="sm"
                        onClick={() => completeMut.mutate({ requestId: req.id })}
                        disabled={completeMut.isPending}
                        data-testid={`button-mark-complete-${req.id}`}
                      >
                        <CheckCircle2 size={14} className="me-1.5" />
                        {t('sr.mark_completed')}
                      </Button>
                    )}
                    {req.status === 'awaiting_customer_confirmation' && (
                      <div className="flex items-center gap-1.5 text-xs text-purple-600">
                        <Clock size={13} className="shrink-0" />
                        {t('sr.waiting_customer_confirm')}
                      </div>
                    )}
                    {req.status === 'completed' && (
                      <div className="flex items-center gap-1.5 text-xs text-emerald-600">
                        <CheckCircle2 size={13} className="shrink-0" />
                        {t('sr.status_completed')}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Send Offer dialog */}
      <Dialog open={!!offerDialog} onOpenChange={open => { if (!open) { setOfferDialog(null); setOfferError(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('sr.send_offer')}</DialogTitle>
            <DialogDescription>{t('sr.offer_dialog_desc')}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">{t('sr.price')}</Label>
              <Input
                dir="auto"
                value={offerDialog?.price ?? ''}
                onChange={e => setOfferDialog(prev => prev ? { ...prev, price: e.target.value } : null)}
                placeholder={`500 SAR`}
                data-testid="input-offer-price"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('sr.execution_duration')}</Label>
              <Input
                dir="auto"
                value={offerDialog?.executionDuration ?? ''}
                onChange={e => setOfferDialog(prev => prev ? { ...prev, executionDuration: e.target.value } : null)}
                placeholder={`3-5 ${t('sr.days')}`}
                data-testid="input-offer-duration"
              />
            </div>
             {offerDialog && (
               <ServiceRequestAttachments
                 requestId={offerDialog.requestId}
                 canUpload
                 testIdPrefix="office-offer"
               />
             )}
            {offerError && (
              <p className="text-xs text-red-600">{offerError}</p>
            )}
            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={submitOffer}
                disabled={sendOfferMut.isPending}
                data-testid="button-submit-offer"
              >
                {sendOfferMut.isPending ? t('sr.submitting') : t('sr.send_offer')}
              </Button>
              <Button
                variant="outline"
                onClick={() => { setOfferDialog(null); setOfferError(''); }}
              >
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
