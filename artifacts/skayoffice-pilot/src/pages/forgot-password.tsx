import { useState, useCallback } from 'react';
import { Link } from 'wouter';
import { useI18n } from '@/lib/i18n';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Mail, CheckCircle, ArrowLeft, ArrowRight } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type State = 'idle' | 'loading' | 'success' | 'error';

export function ForgotPassword() {
  const { t, language } = useI18n();
  const { toast } = useToast();
  const BackIcon = language === 'ar' ? ArrowRight : ArrowLeft;
  const [email, setEmail] = useState('');
  const [state, setState] = useState<State>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!email.trim()) return;

      setState('loading');
      setErrorMsg('');

      try {
        // Always show success — the backend returns a generic response
        // regardless of whether the email has an account (enum prevention).
        await fetch('/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim().toLowerCase() }),
        });
        // Regardless of the response code, show the generic success message.
        setState('success');
        toast({
          title: t('auth.forgot_password_toast_title'),
          description: t('auth.forgot_password_toast_desc'),
        });
      } catch {
        setState('error');
        setErrorMsg(t('common.error'));
      }
    },
    [email, t],
  );

  return (
    <div className="flex flex-1 items-center justify-center p-4 py-12 bg-muted/20">
      <Card className="w-full max-w-md shadow-xl border-border/50">
        <CardHeader className="space-y-3 text-center pt-8">
          <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-2">
            <Mail size={24} />
          </div>
          <CardTitle className="text-2xl font-serif">{t('auth.resetPassword')}</CardTitle>
          <CardDescription>{t('auth.resetPasswordTagline')}</CardDescription>
        </CardHeader>

        <CardContent className="pb-8">
          {state === 'success' ? (
            <SuccessState t={t} email={email} onReset={() => { setState('idle'); setEmail(''); }} />
          ) : (
            <>
              {state === 'error' && (
                <Alert variant="destructive" className="mb-6">
                  <AlertDescription>{errorMsg}</AlertDescription>
                </Alert>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="reset-email">
                    {t('auth.email')}
                    <span className="text-destructive ms-0.5" aria-hidden="true">*</span>
                  </Label>
                  <Input
                    id="reset-email"
                    type="email"
                    placeholder="name@example.com"
                    dir="ltr"
                    className="text-left"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={state === 'loading'}
                    required
                    autoComplete="email"
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  size="lg"
                  disabled={state === 'loading' || !email.trim()}
                >
                  {state === 'loading'
                    ? t('auth.sendingResetLink')
                    : t('auth.sendResetLink')}
                </Button>

                <p className="text-xs text-muted-foreground text-center mt-2">
                  <span className="text-destructive">*</span> {t('auth.required_fields')}
                </p>
              </form>

              <div className="mt-6 flex justify-center">
                <Link
                  href="/login/customer"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border/60 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                >
                  <BackIcon size={15} />
                  {t('auth.backToLogin')}
                </Link>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SuccessState({ t, email, onReset }: { t: (k: string) => string; email: string; onReset: () => void }) {
  return (
    <div className="text-center space-y-6 py-4">
      <div className="mx-auto w-14 h-14 rounded-full bg-green-100 text-green-600 flex items-center justify-center">
        <CheckCircle size={28} />
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold text-lg">{t('auth.resetEmailSent')}</h3>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {t('auth.resetEmailSentDetail')}
        </p>
        {email && (
          <p className="text-xs text-muted-foreground font-mono mt-2 break-all dir-ltr">
            {email}
          </p>
        )}
      </div>

      <div className="text-center text-sm space-y-2">
        <p className="text-muted-foreground">
          <button
            type="button"
            onClick={onReset}
            className="text-primary font-medium hover:underline cursor-pointer"
          >
            {t('auth.requestNewLink')}
          </button>
        </p>
        <p>
          <Link
            href="/login/customer"
            className="text-muted-foreground hover:underline text-xs"
          >
            {t('auth.backToLogin')}
          </Link>
        </p>
      </div>
    </div>
  );
}
