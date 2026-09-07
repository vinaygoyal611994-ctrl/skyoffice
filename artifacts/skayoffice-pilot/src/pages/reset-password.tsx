import { useState, useCallback } from 'react';
import { Link, useSearch, useLocation } from 'wouter';
import { useI18n } from '@/lib/i18n';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { KeyRound, Eye, EyeOff, CheckCircle, AlertCircle, Clock } from 'lucide-react';

type State = 'idle' | 'loading' | 'success' | 'expired' | 'invalid' | 'error';

export function ResetPassword() {
  const { t } = useI18n();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const token = new URLSearchParams(search).get('token') ?? '';

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [state, setState] = useState<State>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [validationError, setValidationError] = useState('');

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setValidationError('');
      setErrorMsg('');

      // Client-side validation
      if (newPassword !== confirmPassword) {
        setValidationError(t('auth.passwordsDoNotMatch'));
        return;
      }
      if (newPassword.length < 8) {
        setValidationError(t('auth.passwordRequirements'));
        return;
      }
      if (!/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
        setValidationError(t('auth.passwordRequirements'));
        return;
      }

      if (!token) {
        setState('invalid');
        return;
      }

      setState('loading');

      try {
        const res = await fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, newPassword }),
        });

        if (res.ok) {
          setState('success');
          // Redirect to login after 3 seconds
          setTimeout(() => setLocation('/login/customer'), 3000);
          return;
        }

        const json = await res.json().catch(() => ({}));
        const code: string = json.code ?? '';

        if (res.status === 410 || code === 'TOKEN_EXPIRED') {
          setState('expired');
        } else if (res.status === 400 && code === 'VALIDATION_ERROR') {
          setValidationError(json.error ?? t('auth.passwordTooWeak'));
          setState('idle');
        } else {
          setState('invalid');
          setErrorMsg(json.error ?? t('common.error'));
        }
      } catch {
        setState('error');
        setErrorMsg(t('common.error'));
      }
    },
    [token, newPassword, confirmPassword, t, setLocation],
  );

  // No token in URL at all
  if (!token) {
    return <ErrorCard state="invalid" t={t} />;
  }

  if (state === 'success') {
    return <SuccessCard t={t} />;
  }
  if (state === 'expired') {
    return <ErrorCard state="expired" t={t} />;
  }
  if (state === 'invalid') {
    return <ErrorCard state="invalid" t={t} />;
  }

  return (
    <div className="flex flex-1 items-center justify-center p-4 py-12 bg-muted/20">
      <Card className="w-full max-w-md shadow-xl border-border/50">
        <CardHeader className="space-y-3 text-center pt-8">
          <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-2">
            <KeyRound size={24} />
          </div>
          <CardTitle className="text-2xl font-serif">{t('auth.setNewPassword')}</CardTitle>
          <CardDescription>{t('auth.passwordRequirements')}</CardDescription>
        </CardHeader>

        <CardContent className="pb-8">
          {state === 'error' && (
            <Alert variant="destructive" className="mb-6">
              <AlertDescription>{errorMsg}</AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* New password */}
            <div className="space-y-2">
              <Label htmlFor="new-password">{t('auth.newPassword')}</Label>
              <div className="relative">
                <Input
                  id="new-password"
                  type={showNew ? 'text' : 'password'}
                  dir="ltr"
                  className="text-left pe-20"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={state === 'loading'}
                  required
                  autoComplete="new-password"
                  minLength={8}
                />
                <button
                  type="button"
                  onClick={() => setShowNew((v) => !v)}
                  className="absolute end-0 top-1/2 h-11 w-11 -translate-y-1/2 inline-flex items-center justify-center text-xs text-muted-foreground hover:text-foreground xl:h-9 xl:w-9"
                  aria-label={showNew ? t('auth.hidePassword') : t('auth.showPassword')}
                >
                  {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <PasswordStrengthHints password={newPassword} />
            </div>

            {/* Confirm password */}
            <div className="space-y-2">
              <Label htmlFor="confirm-password">{t('auth.confirmPassword')}</Label>
              <div className="relative">
                <Input
                  id="confirm-password"
                  type={showConfirm ? 'text' : 'password'}
                  dir="ltr"
                  className="text-left pe-20"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={state === 'loading'}
                  required
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((v) => !v)}
                  className="absolute end-0 top-1/2 h-11 w-11 -translate-y-1/2 inline-flex items-center justify-center text-xs text-muted-foreground hover:text-foreground xl:h-9 xl:w-9"
                  aria-label={showConfirm ? t('auth.hidePassword') : t('auth.showPassword')}
                >
                  {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {/* Mismatch indicator */}
              {confirmPassword.length > 0 && newPassword !== confirmPassword && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertCircle size={12} /> {t('auth.passwordsDoNotMatch')}
                </p>
              )}
            </div>

            {/* Validation error */}
            {validationError && (
              <Alert variant="destructive">
                <AlertDescription>{validationError}</AlertDescription>
              </Alert>
            )}

            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={
                state === 'loading' ||
                !newPassword ||
                !confirmPassword ||
                newPassword !== confirmPassword
              }
            >
              {state === 'loading'
                ? t('auth.savingPassword')
                : t('auth.saveNewPassword')}
            </Button>
          </form>

          <div className="mt-6 text-center text-sm">
            <Link href="/login/customer" className="text-muted-foreground hover:underline text-xs">
              {t('auth.backToLogin')}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Password strength hints — real-time, visible before submit
// ---------------------------------------------------------------------------
function PasswordStrengthHints({ password }: { password: string }) {
  const { t } = useI18n();

  if (!password) return null;

  const checks = [
    { label: t('auth.passwordRequirements').split(',')[0] ?? '8+ chars', pass: password.length >= 8 },
    { label: '1+ letter', pass: /[a-zA-Z]/.test(password) },
    { label: '1+ number', pass: /[0-9]/.test(password) },
  ];

  const allPass = checks.every((c) => c.pass);
  if (allPass) return null;

  return (
    <ul className="space-y-0.5 mt-1">
      {checks.map((c, i) => (
        <li key={i} className={`text-xs flex items-center gap-1 ${c.pass ? 'text-green-600' : 'text-muted-foreground'}`}>
          <span>{c.pass ? '✓' : '○'}</span>
          <span>{c.label}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Terminal state cards
// ---------------------------------------------------------------------------
function SuccessCard({ t }: { t: (k: string) => string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-4 py-12 bg-muted/20">
      <Card className="w-full max-w-md shadow-xl border-border/50">
        <CardContent className="py-10 text-center space-y-6">
          <div className="mx-auto w-14 h-14 rounded-full bg-green-100 text-green-600 flex items-center justify-center">
            <CheckCircle size={28} />
          </div>
          <div className="space-y-2">
            <h2 className="font-serif text-2xl font-semibold">{t('auth.resetSuccess')}</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              {t('auth.resetSuccessDetail')}
            </p>
          </div>
          <Link href="/login/customer">
            <Button className="w-full" size="lg">{t('common.login')}</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

function ErrorCard({ state, t }: { state: 'expired' | 'invalid'; t: (k: string) => string }) {
  const isExpired = state === 'expired';
  return (
    <div className="flex flex-1 items-center justify-center p-4 py-12 bg-muted/20">
      <Card className="w-full max-w-md shadow-xl border-border/50">
        <CardContent className="py-10 text-center space-y-6">
          <div className="mx-auto w-14 h-14 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center">
            {isExpired ? <Clock size={28} /> : <AlertCircle size={28} />}
          </div>
          <div className="space-y-2">
            <h2 className="font-serif text-2xl font-semibold">
              {isExpired ? t('auth.resetTokenExpired') : t('auth.resetTokenInvalid')}
            </h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              {isExpired
                ? t('auth.resetTokenExpiredDetail')
                : t('auth.resetTokenInvalidDetail')}
            </p>
          </div>
          <Link href="/forgot-password">
            <Button variant="outline" className="w-full">{t('auth.requestNewLink')}</Button>
          </Link>
          <Link href="/login/customer" className="block text-xs text-muted-foreground hover:underline">
            {t('auth.backToLogin')}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
