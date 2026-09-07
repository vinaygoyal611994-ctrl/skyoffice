import React, { useState } from 'react';
import { useI18n, type TranslationKey } from '@/lib/i18n';
import {
  useGetMyServiceRequests,
  useAcceptServiceOffer,
  useRejectServiceOffer,
  useConfirmServiceCompletion,
  useMarkServiceNotCompleted,
  useSubmitServiceReview,
  getGetMyServiceRequestsQueryKey,
  getGetOfficeServiceMetricsQueryKey,
  type ServiceRequestItem,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ClipboardList, CheckCircle2, XCircle, ThumbsUp, ThumbsDown, Clock } from 'lucide-react';
import { Link } from 'wouter';
import { format } from 'date-fns';
import { ServiceRequestAttachments } from '@/components/service-requests/ServiceRequestAttachments';
import { safeApiError } from '@/lib/apiError';

const STATUS_BADGE: Record<string, string> = {
  submitted:                      'bg-blue-50 text-blue-700 border-blue-200',
  offer_sent:                     'bg-amber-50 text-amber-700 border-amber-200',
  agreed:                         'bg-emerald-50 text-emerald-700 border-emerald-200',
  awaiting_customer_confirmation: 'bg-purple-50 text-purple-700 border-purple-200',
  completed:                      'bg-slate-100 text-slate-600 border-slate-200',
  rejected:                       'bg-red-50 text-red-600 border-red-200',
  not_completed:                  'bg-rose-50 text-rose-700 border-rose-200',
};

// Review now only captures wasCompleted and wouldRecommend.
// Response speed is system-calculated from first_response_at timestamps.
interface ReviewFormState {
  wasCompleted: 'yes' | 'no';
  wouldRecommend: 'yes' | 'no';
}

const DEFAULT_REVIEW: ReviewFormState = {
  wasCompleted: 'yes',
  wouldRecommend: 'yes',
};

export function MyServiceRequests() {
  const { t, language } = useI18n();
  const queryClient = useQueryClient();
  const [reviewOpenId, setReviewOpenId] = useState<number | null>(null);
  const [reviewForm, setReviewForm] = useState<ReviewFormState>(DEFAULT_REVIEW);
  const [reviewError, setReviewError] = useState('');

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getGetMyServiceRequestsQueryKey() });

  const { data: requests, isLoading } = useGetMyServiceRequests();

  const acceptMut   = useAcceptServiceOffer({ mutation: { onSuccess: invalidate } });
  const rejectMut   = useRejectServiceOffer({ mutation: { onSuccess: invalidate } });
  const confirmMut  = useConfirmServiceCompletion({ mutation: { onSuccess: invalidate } });
  const notDoneMut  = useMarkServiceNotCompleted({ mutation: { onSuccess: invalidate } });

  const reviewMut = useSubmitServiceReview({
    mutation: {
      onSuccess: (_data, variables) => {
        // Invalidate the customer request list so hasReview flips to true immediately.
        invalidate();
        // Also invalidate the public metrics for the reviewed office so the Quick
        // Office Card shows the updated counts in the same session.
        const reviewed = requests?.find((r) => r.id === variables.requestId);
        if (reviewed?.officeSlug) {
          queryClient.invalidateQueries({
            queryKey: getGetOfficeServiceMetricsQueryKey(reviewed.officeSlug),
          });
        }
        setReviewOpenId(null);
        setReviewForm(DEFAULT_REVIEW);
        setReviewError('');
      },
      onError: (err: any) => setReviewError(safeApiError(err, language)),
    },
  });

  const openReview = (id: number) => {
    setReviewOpenId(id);
    setReviewForm(DEFAULT_REVIEW);
    setReviewError('');
  };

  const submitReview = (req: ServiceRequestItem) => {
    reviewMut.mutate({
      requestId: req.id,
      wasCompleted: reviewForm.wasCompleted,
      wouldRecommend: reviewForm.wouldRecommend,
      // responseSpeed intentionally omitted — system-calculated now.
    });
  };

  const officeName = (req: ServiceRequestItem) => {
    const isAr = language === 'ar';
    return (isAr && req.officeNameAr?.trim()) ? req.officeNameAr : (req.officeName ?? '—');
  };

  return (
    <Card data-testid="card-my-service-requests">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardList size={18} className="text-primary" />
          {t('sr.my_requests')}
        </CardTitle>
        <CardDescription>{t('sr.my_section_desc')}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full rounded-lg" />
        ) : !requests?.length ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground border rounded-xl border-dashed bg-muted/10">
            <ClipboardList size={32} className="opacity-30 mb-1" />
            <p className="text-sm">{t('sr.empty_requests')}</p>
            <p className="text-xs">{t('sr.empty_requests_desc')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {requests.map((req) => (
              <div
                key={req.id}
                className="border rounded-xl p-4 flex flex-col gap-3 bg-card"
                data-testid={`row-my-sr-${req.id}`}
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={req.officeSlug ? `/office/${req.officeSlug}` : '#'}
                      className="font-semibold text-sm hover:underline text-foreground"
                      dir="auto"
                    >
                      <bdi>{officeName(req)}</bdi>
                    </Link>
                    <p dir="auto" className="text-xs text-muted-foreground mt-0.5 break-words">
                      <bdi>{req.serviceName}</bdi>
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={`shrink-0 ${STATUS_BADGE[req.status] ?? STATUS_BADGE.submitted}`}
                  >
                    {t(`sr.status_${req.status}` as TranslationKey)}
                  </Badge>
                </div>

                {/* Description */}
                <p dir="auto" className="text-sm text-muted-foreground leading-relaxed break-words line-clamp-2">
                  <bdi>{req.description}</bdi>
                </p>

                {/* Offer details (when offer sent or after) */}
                {req.price && req.status !== 'submitted' && req.status !== 'rejected' && (
                  <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/30 p-3 text-sm border border-border/40">
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

                <ServiceRequestAttachments
                  requestId={req.id}
                  canUpload={req.status === 'agreed'}
                  testIdPrefix="customer-sr"
                />

                {/* ── Actions per status ── */}

                {/* offer_sent → accept or reject */}
                {req.status === 'offer_sent' && (
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      size="sm"
                      onClick={() => acceptMut.mutate({ requestId: req.id })}
                      disabled={acceptMut.isPending}
                      className="gap-1"
                      data-testid={`button-accept-offer-${req.id}`}
                    >
                      <ThumbsUp size={14} />
                      {t('sr.accept_offer')}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => rejectMut.mutate({ requestId: req.id })}
                      disabled={rejectMut.isPending}
                      className="gap-1"
                      data-testid={`button-reject-offer-${req.id}`}
                    >
                      <ThumbsDown size={14} />
                      {t('sr.reject_offer')}
                    </Button>
                  </div>
                )}

                {/* agreed → waiting for office to complete */}
                {req.status === 'agreed' && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock size={13} className="shrink-0" />
                    {t('sr.waiting_office_response')}
                  </div>
                )}

                {/* awaiting_customer_confirmation → confirm or not completed */}
                {req.status === 'awaiting_customer_confirmation' && (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm font-medium">{t('sr.confirm_question')}</p>
                    <div className="flex gap-2 flex-wrap">
                      <Button
                        size="sm"
                        onClick={() => confirmMut.mutate({ requestId: req.id })}
                        disabled={confirmMut.isPending}
                        className="gap-1"
                        data-testid={`button-confirm-complete-${req.id}`}
                      >
                        <CheckCircle2 size={14} />
                        {t('sr.confirm_completed')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => notDoneMut.mutate({ requestId: req.id })}
                        disabled={notDoneMut.isPending}
                        className="gap-1 text-rose-600 border-rose-200 hover:bg-rose-50"
                        data-testid={`button-not-completed-${req.id}`}
                      >
                        <XCircle size={14} />
                        {t('sr.not_completed_btn')}
                      </Button>
                    </div>
                  </div>
                )}

                {/* completed → recommendation form (if not yet reviewed) */}
                {req.status === 'completed' && !req.hasReview && reviewOpenId !== req.id && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openReview(req.id)}
                    data-testid={`button-open-review-${req.id}`}
                  >
                    <ThumbsUp size={14} className="me-1.5 text-emerald-600" />
                    {t('sr.review_title')}
                  </Button>
                )}

                {req.status === 'completed' && req.hasReview && (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-600">
                    <CheckCircle2 size={13} />
                    {t('sr.reviewed')}
                  </div>
                )}

                {/* Inline recommendation form — wasCompleted + wouldRecommend only */}
                {reviewOpenId === req.id && (
                  <div className="border rounded-xl p-4 bg-muted/20 space-y-4">
                    <p className="font-semibold text-sm">{t('sr.review_title')}</p>

                    <div className="space-y-1.5">
                      <p className="text-xs text-muted-foreground">{t('sr.review_q1')}</p>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant={reviewForm.wasCompleted === 'yes' ? 'default' : 'outline'}
                          onClick={() => setReviewForm(p => ({ ...p, wasCompleted: 'yes' }))}
                        >
                          {t('common.yes')}
                        </Button>
                        <Button
                          size="sm"
                          variant={reviewForm.wasCompleted === 'no' ? 'destructive' : 'outline'}
                          onClick={() => setReviewForm(p => ({ ...p, wasCompleted: 'no' }))}
                        >
                          {t('common.no')}
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <p className="text-xs text-muted-foreground">{t('sr.review_q2')}</p>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant={reviewForm.wouldRecommend === 'yes' ? 'default' : 'outline'}
                          onClick={() => setReviewForm(p => ({ ...p, wouldRecommend: 'yes' }))}
                        >
                          {t('common.yes')}
                        </Button>
                        <Button
                          size="sm"
                          variant={reviewForm.wouldRecommend === 'no' ? 'destructive' : 'outline'}
                          onClick={() => setReviewForm(p => ({ ...p, wouldRecommend: 'no' }))}
                        >
                          {t('common.no')}
                        </Button>
                      </div>
                    </div>

                    {reviewError && <p className="text-xs text-red-600">{reviewError}</p>}

                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => submitReview(req)}
                        disabled={reviewMut.isPending}
                        data-testid={`button-submit-review-${req.id}`}
                      >
                        {reviewMut.isPending ? t('sr.submitting') : t('sr.review_submit')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setReviewOpenId(null)}
                      >
                        {t('common.cancel')}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
