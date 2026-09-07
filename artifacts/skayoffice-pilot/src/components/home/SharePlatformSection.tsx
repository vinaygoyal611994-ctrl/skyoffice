import React from 'react';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { getPlatformShareUrl } from '@/lib/publicUrl';
import { copyTextRobust } from '@/lib/clipboard';
import { Share2, Check, AlertTriangle } from 'lucide-react';

type MessageState = 'idle' | 'success' | 'share_opened_copy_failed' | 'copy_failed';

export function SharePlatformSection() {
  const { t, language } = useI18n();
  // The bare production root URL from VITE_PUBLIC_APP_URL — see
  // publicUrl.ts. Never derived from window.location, and never a
  // *.replit.dev preview/development URL. No query string, hash, or other
  // parameter is ever appended: the homepage itself always starts in a
  // clean default state (empty search, "All" category) on every load.
  const platformUrl = getPlatformShareUrl();
  const [messageState, setMessageState] = React.useState<MessageState>('idle');
  const resetTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  const showMessage = (state: MessageState) => {
    setMessageState(state);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setMessageState('idle'), 4000);
  };

  // Single combined action, triggered directly by the click (no setTimeout
  // before copying, so the user-gesture context needed by both the
  // Clipboard API and the execCommand('copy') fallback is preserved):
  // 1. Copy the platform link first, using the robust helper (Clipboard API
  //    -> hidden-textarea/execCommand fallback), and record whether it
  //    actually succeeded.
  // 2. Then open the native share sheet, if supported.
  // 3. Only ever claim "copied" when the copy genuinely succeeded.
  const handleShareAndCopy = async () => {
    const copied = await copyTextRobust(platformUrl);

    const canNativeShare = typeof navigator !== 'undefined' && !!(navigator as any).share;

    if (canNativeShare) {
      try {
        await (navigator as any).share({
          title: t('share_platform.title'),
          text: `${t('share_platform.shared_text')}\n${platformUrl}`,
          url: platformUrl,
        });
      } catch {
        // user cancelled the native share sheet, or it failed — the message
        // below still reflects the real copy outcome either way.
      }
      showMessage(copied ? 'success' : 'share_opened_copy_failed');
      return;
    }

    showMessage(copied ? 'success' : 'copy_failed');
  };

  const messageText =
    messageState === 'success'
      ? t('share_platform.copied_ready')
      : messageState === 'share_opened_copy_failed'
        ? t('share_platform.share_opened_copy_failed')
        : messageState === 'copy_failed'
          ? t('share_platform.copy_failed')
          : t('share_platform.description');

  const isError = messageState === 'share_opened_copy_failed' || messageState === 'copy_failed';

  return (
    <section
      dir={language === 'ar' ? 'rtl' : 'ltr'}
      className="mt-4 rounded-3xl border border-border/60 bg-gradient-to-br from-primary/5 via-card to-card p-6 text-center shadow-sm sm:p-8"
      data-testid="section-share-platform"
    >
      <div className="mx-auto flex max-w-md flex-col items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Share2 className="h-6 w-6" />
        </div>
        <h2 className="text-xl font-bold text-foreground sm:text-2xl">
          {t('share_platform.title')}
        </h2>

        <Button
          type="button"
          onClick={handleShareAndCopy}
          className="mt-2 h-11 w-full gap-2 rounded-xl font-semibold sm:w-auto"
          data-testid="button-share-copy-platform"
        >
          {messageState === 'success' ? (
            <Check className="h-4 w-4 shrink-0" />
          ) : isError ? (
            <AlertTriangle className="h-4 w-4 shrink-0" />
          ) : (
            <Share2 className="h-4 w-4 shrink-0" />
          )}
          {t('share_platform.action_button')}
        </Button>

        <p
          className={`text-sm leading-relaxed ${isError ? 'text-destructive' : 'text-muted-foreground'}`}
          data-testid="text-share-platform-message"
        >
          {messageText}
        </p>
      </div>
    </section>
  );
}
