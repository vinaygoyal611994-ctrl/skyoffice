import React, { useEffect, useState, useCallback } from 'react';
import { useI18n } from '@/lib/i18n';
import { useGetMyOffice } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CreditCard, CheckCircle2, Clock, AlertTriangle, RefreshCw, Loader2, MessageCircle } from 'lucide-react';
import { safeApiError } from '@/lib/apiError';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SlotInfo {
  slotStatus: string | null;
  reservationExpiresAt: string | null;
  minutesRemaining: number | null;
}

interface SubInfo {
  state: string;
  paidThroughDate: string | null;
  expiresAt: string | null;
}

interface PaymentInfo {
  id: number;
  status: string;
  amountSar: number;
  currency: string;
  planName: string | null;
  paidAt: string | null;
  failedAt: string | null;
  failureReason: string | null;
  createdAt: string;
  renewalPath: boolean;
  reservationExpiresAt: string | null;
  gatewayRef: string;
}

interface CheckoutResult {
  sessionUrl: string;
  plan: {
    name: string;
    nameAr: string;
    amountSar: number;
    currency: string;
  };
  paymentPath: string;
  reservationExpiresAt: string | null;
}

// ── API helpers ───────────────────────────────────────────────────────────────

function apiBase() { return '/api'; }

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = localStorage.getItem('skay_session_token');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${apiBase()}${path}`, { ...opts, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error((body as any).messageAr ?? (body as any).messageEn ?? `HTTP ${res.status}`), { data: body });
  }
  return res.json() as Promise<T>;
}

// ── Countdown hook ────────────────────────────────────────────────────────────

function useCountdown(expiresAt: string | null): { minutes: number; seconds: number; expired: boolean } {
  const calc = () => {
    if (!expiresAt) return { minutes: 0, seconds: 0, expired: true };
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (ms <= 0) return { minutes: 0, seconds: 0, expired: true };
    return {
      minutes: Math.floor(ms / 60000),
      seconds: Math.floor((ms % 60000) / 1000),
      expired: false,
    };
  };
  const [state, setState] = useState(calc);
  useEffect(() => {
    if (!expiresAt) return;
    const id = setInterval(() => setState(calc()), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return state;
}

// ── Reservation countdown banner ──────────────────────────────────────────────

function ReservationCountdown({
  expiresAt, language,
}: { expiresAt: string; language: 'ar' | 'en' }) {
  const { minutes, seconds, expired } = useCountdown(expiresAt);
  if (expired) return null;
  const label = language === 'ar'
    ? `ينتهي حجزك خلال ${minutes}:${String(seconds).padStart(2, '0')} دقيقة`
    : `Reservation expires in ${minutes}:${String(seconds).padStart(2, '0')}`;
  const isUrgent = minutes < 10;
  return (
    <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${
      isUrgent ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-amber-50 text-amber-700 border border-amber-200'
    }`}>
      <Clock size={15} className="shrink-0" />
      {label}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function SubscriptionSection() {
  const { language } = useI18n();
  const lang = language as 'ar' | 'en';
  const { data: office, isLoading: officeLoading } = useGetMyOffice();

  const [slotInfo,     setSlotInfo]     = useState<SlotInfo | null>(null);
  const [subInfo,      setSubInfo]      = useState<SubInfo | null>(null);
  const [payment,      setPayment]      = useState<PaymentInfo | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [checkoutErr,  setCheckoutErr]  = useState<string | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  const officeId = (office as any)?.id;

  const fetchStatus = useCallback(async () => {
    if (!officeId) return;
    setLoading(true);
    try {
      const [slotRes, subRes, payRes] = await Promise.allSettled([
        apiFetch<{ slotStatus: string | null; reservationExpiresAt: string | null; minutesRemaining: number | null }>(`/supply-slots/status`),
        apiFetch<{ subscription: SubInfo | null }>(`/subscriptions/my`),
        apiFetch<{ payment: PaymentInfo | null }>(`/payments/status`),
      ]);
      if (slotRes.status === 'fulfilled') setSlotInfo(slotRes.value);
      if (subRes.status  === 'fulfilled') setSubInfo(subRes.value.subscription);
      if (payRes.status  === 'fulfilled') setPayment(payRes.value.payment);
    } finally {
      setLoading(false);
    }
  }, [officeId]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const handleCheckout = async () => {
    setCheckoutErr(null);
    setCheckoutLoading(true);
    try {
      const result = await apiFetch<CheckoutResult>('/payments/checkout', { method: 'POST' });
      // Redirect to Stripe Checkout
      window.location.href = result.sessionUrl;
    } catch (err: any) {
      setCheckoutErr(safeApiError(err, language));
      setCheckoutLoading(false);
    }
  };

  // ── Features list ──────────────────────────────────────────────────────────

  const features: { ar: string; en: string }[] = [
    { ar: 'إدراج مكتبك في القائمة العامة', en: 'Public office listing' },
    { ar: 'ملف تعريفي كامل للمكتب', en: 'Complete office profile' },
    { ar: 'تواصل مباشر عبر واتساب', en: 'Direct WhatsApp contact' },
    { ar: 'رفع الصور والفيديو', en: 'Photo & video uploads' },
    { ar: 'تحليلات المشاهدات والزيارات', en: 'View & visit analytics' },
  ];

  // ── Loading state ──────────────────────────────────────────────────────────

  if (officeLoading || loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-36 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  if (!office) return null;

  // ── Derive UI state from slot + subscription data ──────────────────────────

  const slotStatus = slotInfo?.slotStatus ?? null;
  const subState   = subInfo?.state ?? 'free';
  const isActivePaid = subState === 'active_paid';
  const isExpiring   = subState === 'expiring';
  const isWaiting    = slotStatus === 'waiting';
  const isReserved   = slotStatus === 'reserved';
  const isAllocated  = slotStatus === 'allocated';
  const providerType = (office as any)?.providerType ?? 'office';
  const price        = providerType === 'freelancer' ? 120 : 200;
  const currency     = lang === 'ar' ? 'ر.س' : 'SAR';

  // Show pay button: reserved slot or renewal (allocated + not active_paid)
  const canPay = isReserved || (isAllocated && !isActivePaid);
  // Show renew button: active/expiring sub with allocated slot
  const canRenew = (isActivePaid || isExpiring) && isAllocated;

  const paidThrough = subInfo?.paidThroughDate ?? null;
  const paidThroughFormatted = paidThrough
    ? new Date(paidThrough).toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : null;

  // ── Payment result banner (after redirect back from Stripe) ──────────────
  const urlParams = new URLSearchParams(window.location.search);
  const paymentResult = urlParams.get('payment'); // 'success' | 'cancel'

  return (
    <div className="space-y-5">
      {/* Post-redirect banners */}
      {paymentResult === 'success' && (
        <div className="flex items-center gap-3 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 size={16} className="shrink-0" />
          <span>
            {lang === 'ar'
              ? 'تم الدفع بنجاح! جاري تفعيل اشتراكك…'
              : 'Payment successful! Your subscription is being activated…'}
          </span>
          <Button size="sm" variant="ghost" className="ms-auto" onClick={fetchStatus}>
            <RefreshCw size={14} />
          </Button>
        </div>
      )}
      {paymentResult === 'cancel' && (
        <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle size={16} className="shrink-0" />
          {lang === 'ar' ? 'تم إلغاء الدفع. يمكنك المحاولة مرة أخرى.' : 'Payment cancelled. You can try again.'}
        </div>
      )}

      {/* Slot reservation countdown */}
      {isReserved && slotInfo?.reservationExpiresAt && (
        <ReservationCountdown expiresAt={slotInfo.reservationExpiresAt} language={lang} />
      )}

      {/* Waitlist message */}
      {isWaiting && (
        <div className="flex items-start gap-3 rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800">
          <Clock size={16} className="shrink-0 mt-0.5" />
          <p>
            {lang === 'ar'
              ? 'أنت حالياً في قائمة الانتظار. سيتم إشعارك فور توفر مقعد ولديك 3 ساعات للتفعيل والدفع.'
              : "You're on the waitlist. You'll be notified when a slot opens — you'll have 3 hours to activate and pay."}
          </p>
        </div>
      )}

      {/* Checkout error */}
      {checkoutErr && (
        <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span>{checkoutErr}</span>
        </div>
      )}

      {/* Current plan card */}
      <Card className="overflow-hidden">
        <div className={`h-1 bg-gradient-to-r ${
          isActivePaid ? 'from-emerald-500 to-emerald-400' :
          isReserved   ? 'from-amber-500 to-amber-400' :
          'from-primary to-primary/60'
        }`} />
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <CreditCard size={18} className="text-primary" />
                <CardTitle className="text-base">
                  {lang === 'ar' ? 'الاشتراك الشهري' : 'Monthly Subscription'}
                </CardTitle>
              </div>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="text-2xl font-bold">{price}</span>
                <span className="text-sm text-muted-foreground">{currency} / {lang === 'ar' ? 'شهر' : 'mo'}</span>
              </div>
            </div>
            <Badge
              variant="outline"
              className={
                isActivePaid ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                isExpiring   ? 'bg-amber-50 text-amber-700 border-amber-200' :
                isReserved   ? 'bg-amber-50 text-amber-700 border-amber-200' :
                isWaiting    ? 'bg-blue-50 text-blue-700 border-blue-200' :
                'bg-slate-100 text-slate-600 border-slate-200'
              }
            >
              {isActivePaid ? (lang === 'ar' ? 'نشط' : 'Active') :
               isExpiring   ? (lang === 'ar' ? 'ينتهي قريباً' : 'Expiring') :
               isReserved   ? (lang === 'ar' ? 'محجوز — يُرجى الدفع' : 'Reserved — Pay now') :
               isWaiting    ? (lang === 'ar' ? 'قائمة انتظار' : 'Waitlist') :
               isAllocated  ? (lang === 'ar' ? 'مفعّل' : 'Allocated') :
               (lang === 'ar' ? 'غير مفعّل' : 'Inactive')}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-4">
          {/* Paid through */}
          {paidThroughFormatted && (
            <p className="text-sm text-muted-foreground">
              {lang === 'ar' ? `مدفوع حتى: ${paidThroughFormatted}` : `Paid through: ${paidThroughFormatted}`}
            </p>
          )}

          {/* Pay / Renew button */}
          {(canPay || canRenew) && (
            <Button
              onClick={handleCheckout}
              disabled={checkoutLoading}
              className="w-full sm:w-auto gap-2"
            >
              {checkoutLoading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <CreditCard size={16} />
              )}
              {checkoutLoading
                ? (lang === 'ar' ? 'جاري التوجيه…' : 'Redirecting…')
                : canRenew
                  ? (lang === 'ar' ? `تجديد الاشتراك — ${price} ${currency}` : `Renew Subscription — ${price} ${currency}`)
                  : (lang === 'ar' ? `ادفع الآن — ${price} ${currency}` : `Pay Now — ${price} ${currency}`)}
            </Button>
          )}

          {/* Support link when no slot action available */}
          {!canPay && !canRenew && !isWaiting && (
            <div>
              <p className="text-sm text-muted-foreground mb-3">
                {lang === 'ar'
                  ? 'للاستفسار عن الاشتراك أو دعم التفعيل، تواصل معنا.'
                  : 'For subscription inquiries or activation support, contact us.'}
              </p>
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => window.open('https://wa.me/96560000000', '_blank')}
              >
                <MessageCircle size={16} />
                {lang === 'ar' ? 'تواصل معنا' : 'Contact Support'}
              </Button>
            </div>
          )}

          {/* Last payment info */}
          {payment && payment.status === 'succeeded' && payment.paidAt && (
            <p className="text-xs text-muted-foreground">
              {lang === 'ar'
                ? `آخر دفعة: ${new Date(payment.paidAt).toLocaleDateString('ar-SA')} — Ref: ${payment.gatewayRef}`
                : `Last payment: ${new Date(payment.paidAt).toLocaleDateString('en-GB')} — Ref: ${payment.gatewayRef}`}
            </p>
          )}
          {payment && payment.status === 'failed' && (
            <div className="flex items-center gap-2 text-xs text-red-600">
              <AlertTriangle size={13} />
              {lang === 'ar' ? 'فشل آخر دفع' : 'Last payment failed'}
              {payment.failureReason && <span className="text-muted-foreground">— {payment.failureReason}</span>}
            </div>
          )}
          {payment && payment.status === 'failed_no_slot' && (
            <div className="flex items-start gap-2 text-xs text-red-600">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              <span>
                {lang === 'ar'
                  ? 'تمّ الدفع لكن انتهى الحجز قبل التفعيل. سيتم استرداد المبلغ. يرجى التواصل مع الدعم.'
                  : 'Payment was received but the slot had expired before activation. A refund will be processed. Please contact support.'}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* What's included */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {lang === 'ar' ? 'ما يشمله الاشتراك' : "What's Included"}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          {features.map((f, i) => (
            <div key={i} className="flex items-center gap-3">
              <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
              <span className="text-sm">{lang === 'ar' ? f.ar : f.en}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
