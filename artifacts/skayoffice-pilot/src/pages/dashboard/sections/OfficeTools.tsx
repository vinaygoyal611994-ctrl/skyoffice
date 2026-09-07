import React from 'react';
import { useI18n } from '@/lib/i18n';
import { getOfficePublicUrl } from '@/lib/publicUrl';
import { trackCopyLink } from '@/lib/analytics';
import { useGetMyOffice } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { QRCodeSVG, QRCodeCanvas } from 'qrcode.react';
import { Download, Link2, Share2, Check, Info } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export function OfficeToolsSection() {
  const { t, language } = useI18n();
  const { data: office, isLoading } = useGetMyOffice();
  const { toast } = useToast();

  const [linkCopied, setLinkCopied] = React.useState(false);
  // Hidden high-res canvas container — queried for the <canvas> element on download
  const hiddenCanvasRef = React.useRef<HTMLDivElement>(null);

  // Always use the canonical public URL for this office.
  // getOfficePublicUrl builds: ${VITE_PUBLIC_APP_URL}/${language}/office/${slug}
  const profileUrl = office ? getOfficePublicUrl(office.slug, language) : '';

  const canNativeShare =
    typeof navigator !== 'undefined' && !!(navigator as Navigator & { share?: unknown }).share;

  // Show a notice when the office isn't live yet so the owner understands
  // the QR/link won't resolve for customers until activation.
  const isActive = office?.status === 'active';

  const handleCopyLink = async () => {
    if (!profileUrl) return;
    try {
      await navigator.clipboard.writeText(profileUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
      // Reuse the existing copy-link analytics event
      if (office?.id) try { trackCopyLink(office.id); } catch { /* ignore */ }
    } catch {
      // Clipboard API unavailable — show a toast with the raw URL as fallback
      toast({ title: t('dash.tools.copy_link'), description: profileUrl });
    }
  };

  const handleDownloadQr = () => {
    // The hidden <QRCodeCanvas> renders at 512 px for a crisp downloadable PNG
    const canvas = hiddenCanvasRef.current?.querySelector('canvas');
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    const anchor = document.createElement('a');
    anchor.href = dataUrl;
    anchor.download = `${office?.slug ?? 'office'}-qr.png`;
    anchor.click();
  };

  const handleShare = async () => {
    if (!profileUrl) return;
    if (canNativeShare) {
      try {
        await (navigator as Navigator & { share: (d: { title?: string; url: string }) => Promise<void> })
          .share({ title: office?.name, url: profileUrl });
        if (office?.id) try { trackCopyLink(office.id); } catch { /* ignore */ }
        return; // native share handled — nothing more to do
      } catch (err) {
        // AbortError = user explicitly dismissed the share sheet; skip clipboard fallback.
        if (err instanceof DOMException && err.name === 'AbortError') return;
        // Any other failure (e.g. env doesn't support it despite navigator.share existing):
        // fall through to clipboard copy so the user always gets observable feedback.
      }
    }
    // Clipboard fallback — also shows "Copied!" state and fires analytics
    handleCopyLink();
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full rounded-2xl" />
        <Skeleton className="h-[420px] w-full rounded-2xl" />
      </div>
    );
  }

  if (!office) return null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t('dash.tools.title')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t('dash.tools.subtitle')}</p>
        </CardHeader>

        <CardContent className="space-y-5">
          {/* ── QR code (display) ─────────────────────────────────────── */}
          <div className="flex justify-center">
            <div className="overflow-hidden rounded-2xl bg-white p-4 shadow-md ring-1 ring-border/30">
              {profileUrl ? (
                <QRCodeSVG
                  value={profileUrl}
                  size={180}
                  className="block"
                  // Quiet zone (margin) is baked into the SVG — no extra padding needed
                />
              ) : (
                <Skeleton className="h-[180px] w-[180px] rounded-lg" />
              )}
            </div>
          </div>

          {/* ── Inactive notice ───────────────────────────────────────── */}
          {!isActive && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-800/30 dark:bg-amber-950/20 dark:text-amber-400">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span dir="auto">{t('dash.tools.inactive_notice')}</span>
            </div>
          )}

          {/* ── URL display row ───────────────────────────────────────── */}
          <div className="flex w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-lg border bg-muted/40 px-3 py-2">
            {/* dir="ltr" keeps the URL readable in both Arabic and English layouts */}
            <span
              className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
              dir="ltr"
              title={profileUrl}
            >
              {profileUrl || '—'}
            </span>
            <button
              type="button"
              onClick={handleCopyLink}
              className="shrink-0 rounded px-2 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
              aria-label={t('dash.tools.copy_link')}
            >
              {linkCopied ? '✓' : t('dash.tools.copy_link')}
            </button>
          </div>

          {/* ── Action buttons ────────────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full flex-col gap-1 py-3 h-auto"
              onClick={handleDownloadQr}
              disabled={!profileUrl}
              data-testid="button-download-qr"
            >
              <Download className="h-4 w-4 shrink-0" />
              <span className="truncate text-[11px] leading-tight">{t('dash.tools.download_qr')}</span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="w-full flex-col gap-1 py-3 h-auto"
              onClick={handleCopyLink}
              disabled={!profileUrl}
              data-testid="button-copy-link"
            >
              {linkCopied ? (
                <Check className="h-4 w-4 shrink-0 text-emerald-600" />
              ) : (
                <Link2 className="h-4 w-4 shrink-0" />
              )}
              <span className="truncate text-[11px] leading-tight">
                {linkCopied ? t('dash.tools.link_copied') : t('dash.tools.copy_link')}
              </span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="w-full flex-col gap-1 py-3 h-auto"
              onClick={handleShare}
              disabled={!profileUrl}
              data-testid="button-share-office-tools"
            >
              <Share2 className="h-4 w-4 shrink-0" />
              <span className="truncate text-[11px] leading-tight">{t('dash.tools.share')}</span>
            </Button>
          </div>

          {/* ── Hidden high-res canvas for PNG download ───────────────── */}
          {/* Rendered off-screen at 512 px so the download is crisp at any print size. */}
          <div ref={hiddenCanvasRef} className="hidden" aria-hidden="true">
            {profileUrl && <QRCodeCanvas value={profileUrl} size={512} />}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
