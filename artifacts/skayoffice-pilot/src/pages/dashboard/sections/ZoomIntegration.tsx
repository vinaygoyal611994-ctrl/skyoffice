import React, { useState, useEffect, useCallback } from 'react';
import { useI18n } from '@/lib/i18n';
import { authFetch } from '@/lib/sessionToken';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Video, CheckCircle2, AlertTriangle, XCircle,
  RefreshCw, Link2, Link2Off, Loader2,
} from 'lucide-react';

type ZoomStatus =
  | 'not_connected'
  | 'connected'
  | 'token_refreshing'
  | 'reauth_required'
  | 'disconnected'
  | 'error'
  | 'loading';

interface ZoomStatusData {
  status: ZoomStatus;
  zoomUserEmail: string | null;
  lastValidatedAt: string | null;
}

const STATUS_CONFIG: Record<
  Exclude<ZoomStatus, 'loading'>,
  { label: { en: string; ar: string }; color: string; icon: React.ReactNode }
> = {
  not_connected: {
    label: { en: 'Not Connected', ar: 'غير متصل' },
    color: 'bg-slate-100 text-slate-600 border-slate-200',
    icon: <Link2Off size={13} />,
  },
  connected: {
    label: { en: 'Connected', ar: 'متصل' },
    color: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    icon: <CheckCircle2 size={13} />,
  },
  token_refreshing: {
    label: { en: 'Refreshing...', ar: 'جارٍ التحديث...' },
    color: 'bg-blue-100 text-blue-700 border-blue-200',
    icon: <RefreshCw size={13} className="animate-spin" />,
  },
  reauth_required: {
    label: { en: 'Re-auth Required', ar: 'يلزم إعادة التفويض' },
    color: 'bg-amber-100 text-amber-800 border-amber-200',
    icon: <AlertTriangle size={13} />,
  },
  disconnected: {
    label: { en: 'Disconnected', ar: 'مفصول' },
    color: 'bg-slate-100 text-slate-600 border-slate-200',
    icon: <Link2Off size={13} />,
  },
  error: {
    label: { en: 'Error', ar: 'خطأ' },
    color: 'bg-red-100 text-red-700 border-red-200',
    icon: <XCircle size={13} />,
  },
};

export function ZoomIntegrationSection() {
  const { language } = useI18n();
  const { toast } = useToast();
  const isAr = language === 'ar';

  const [statusData, setStatusData] = useState<ZoomStatusData>({
    status: 'loading',
    zoomUserEmail: null,
    lastValidatedAt: null,
  });
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await authFetch('/api/zoom/status');
      if (res.ok) {
        const data = await res.json();
        setStatusData(data);
      } else {
        setStatusData(prev => ({ ...prev, status: 'error' }));
      }
    } catch {
      setStatusData(prev => ({ ...prev, status: 'error' }));
    }
  }, []);

  useEffect(() => {
    fetchStatus();

    // Check if user just came back from Zoom OAuth
    const params = new URLSearchParams(window.location.search);
    if (params.get('zoom') === 'connected') {
      toast({ title: isAr ? 'تم الاتصال بـ Zoom بنجاح' : 'Zoom connected successfully' });
      window.history.replaceState({}, '', window.location.pathname);
      fetchStatus();
    } else if (params.get('zoom') === 'denied') {
      toast({ title: isAr ? 'تم رفض الاتصال' : 'Zoom connection denied', variant: 'destructive' });
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('zoom') === 'error') {
      toast({ title: isAr ? 'فشل الاتصال بـ Zoom' : 'Failed to connect Zoom', variant: 'destructive' });
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [fetchStatus, isAr, toast]);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const res = await authFetch('/api/zoom/oauth/start');
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({
          title: isAr ? 'خطأ' : 'Error',
          description: err.error || (isAr ? 'تعذّر بدء الاتصال' : 'Could not start Zoom connection'),
          variant: 'destructive',
        });
        return;
      }
      const { url } = await res.json();
      window.location.href = url;
    } catch {
      toast({
        title: isAr ? 'خطأ في الاتصال' : 'Connection error',
        variant: 'destructive',
      });
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const res = await authFetch('/api/zoom/disconnect', { method: 'DELETE' });
      if (res.ok) {
        toast({ title: isAr ? 'تم فصل Zoom' : 'Zoom disconnected' });
        await fetchStatus();
      }
    } catch {
      toast({ title: isAr ? 'فشل الفصل' : 'Disconnect failed', variant: 'destructive' });
    } finally {
      setDisconnecting(false);
    }
  };

  const status = statusData.status as ZoomStatus;
  const cfg = status !== 'loading' ? STATUS_CONFIG[status] : null;
  const isConnected = status === 'connected';
  const needsReauth = status === 'reauth_required';
  const isDisconnected = status === 'not_connected' || status === 'disconnected' || status === 'error';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Video size={20} />
          {isAr ? 'تكامل Zoom' : 'Zoom Integration'}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          {isAr
            ? 'ربط حساب Zoom الخاص بمكتبك لتفعيل حجوزات مكالمات الفيديو التلقائية'
            : 'Connect your office Zoom account to enable automatic video call booking'}
        </p>
      </div>

      {/* Main card */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Video size={17} className="text-primary" />
                {isAr ? 'حساب Zoom الخاص بالمكتب' : 'Office Zoom Account'}
              </CardTitle>
              <CardDescription className="mt-1">
                {isAr
                  ? 'اربط حساب Zoom الخاص بك — كل مكتب يستخدم حسابه الخاص بشكل مستقل'
                  : 'Connect your own Zoom account — each office operates independently'}
              </CardDescription>
            </div>

            {/* Status badge */}
            {status === 'loading' ? (
              <Loader2 size={16} className="animate-spin text-muted-foreground mt-1" />
            ) : cfg ? (
              <Badge variant="outline" className={`gap-1.5 ${cfg.color}`}>
                {cfg.icon}
                {isAr ? cfg.label.ar : cfg.label.en}
              </Badge>
            ) : null}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">

          {/* Re-auth warning */}
          {needsReauth && (
            <Alert variant="destructive">
              <AlertTriangle size={15} />
              <AlertDescription>
                {isAr
                  ? 'انتهت صلاحية اتصال Zoom أو تم إلغاؤه. يرجى إعادة الربط لاستمرار إنشاء الاجتماعات.'
                  : 'Your Zoom connection expired or was revoked. Reconnect to continue creating meetings.'}
              </AlertDescription>
            </Alert>
          )}

          {/* Connected state — show account info */}
          {isConnected && statusData.zoomUserEmail && (
            <div className="rounded-lg border bg-emerald-50/50 p-4 space-y-1">
              <p className="text-sm font-medium text-emerald-800">
                {isAr ? 'متصل كـ:' : 'Connected as:'}
              </p>
              <p className="text-sm text-emerald-700 font-mono">{statusData.zoomUserEmail}</p>
            </div>
          )}

          {/* How it works */}
          <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {isAr ? 'كيف يعمل' : 'How it works'}
            </p>
            <ul className="text-sm text-muted-foreground space-y-1.5 list-none">
              <li className="flex gap-2">
                <span className="text-primary font-bold shrink-0">1.</span>
                {isAr
                  ? 'اربط حساب Zoom الخاص بمكتبك بنقرة واحدة'
                  : 'Connect your office Zoom account with one click'}
              </li>
              <li className="flex gap-2">
                <span className="text-primary font-bold shrink-0">2.</span>
                {isAr
                  ? 'عند قبولك لطلب حجز مكالمة فيديو، يُنشأ اجتماع Zoom تلقائياً'
                  : 'When you accept a video call request, a Zoom meeting is automatically created'}
              </li>
              <li className="flex gap-2">
                <span className="text-primary font-bold shrink-0">3.</span>
                {isAr
                  ? 'يتلقى العميل رابط الانضمام ويتلقى مكتبك رابط المضيف'
                  : 'Customer receives the join link, your office receives the host link'}
              </li>
              <li className="flex gap-2">
                <span className="text-primary font-bold shrink-0">4.</span>
                {isAr
                  ? 'يمكنك العمل بدون Zoom — الربط مطلوب فقط لحجوزات مكالمات الفيديو'
                  : 'You can operate without Zoom — it is only required for video call bookings'}
              </li>
            </ul>
          </div>

          {/* Action buttons */}
          <div className="flex gap-3 flex-wrap pt-1">
            {(isDisconnected || needsReauth) && (
              <Button
                onClick={handleConnect}
                disabled={connecting}
                className="gap-2"
              >
                {connecting ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Link2 size={15} />
                )}
                {needsReauth
                  ? (isAr ? 'إعادة ربط Zoom' : 'Reconnect Zoom')
                  : (isAr ? 'ربط Zoom' : 'Connect Zoom')}
              </Button>
            )}

            {isConnected && (
              <>
                <Button
                  variant="outline"
                  onClick={handleConnect}
                  disabled={connecting}
                  className="gap-2"
                >
                  <RefreshCw size={15} />
                  {isAr ? 'إعادة الربط' : 'Reconnect'}
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="gap-2"
                >
                  {disconnecting ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <Link2Off size={15} />
                  )}
                  {isAr ? 'فصل Zoom' : 'Disconnect Zoom'}
                </Button>
              </>
            )}
          </div>

          {/* Disconnect warning */}
          {isConnected && (
            <p className="text-xs text-muted-foreground">
              {isAr
                ? 'تحذير: عند الفصل، لن يتم إنشاء اجتماعات Zoom جديدة. سجلات الحجز السابقة تبقى سليمة.'
                : 'Warning: After disconnecting, no new Zoom meetings will be created. Existing booking records are preserved.'}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Scope info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            {isAr ? 'الصلاحيات المطلوبة' : 'Requested Permissions'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { en: 'View your profile', ar: 'عرض ملفك الشخصي' },
              { en: 'Create meetings', ar: 'إنشاء الاجتماعات' },
              { en: 'View meetings', ar: 'عرض الاجتماعات' },
              { en: 'Delete meetings', ar: 'حذف الاجتماعات' },
            ].map((p, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                {isAr ? p.ar : p.en}
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            {isAr
              ? 'لن يتم طلب صلاحيات التسجيل أو الندوات أو الدردشة.'
              : 'Recording, webinar, or chat permissions are never requested.'}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
