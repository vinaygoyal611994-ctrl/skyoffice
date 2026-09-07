import React, { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { safeApiError } from '@/lib/apiError';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { authFetch } from '@/lib/sessionToken';
import { clearSessionToken } from '@/lib/sessionToken';
import { KeyRound, Eye, EyeOff, ShieldCheck } from 'lucide-react';

/** Minimum password strength matching the server-side Zod schema. */
function isStrongEnough(pw: string): string | null {
  if (pw.length < 8)      return 'auth.passwordRequirements';
  if (!/[a-zA-Z]/.test(pw)) return 'auth.passwordRequirements';
  if (!/[0-9]/.test(pw))    return 'auth.passwordRequirements';
  return null;
}

function PasswordInput({
  id,
  label,
  value,
  onChange,
  autoComplete,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  error?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          autoComplete={autoComplete}
          dir="ltr"
          className={`text-start pe-10 ${error ? 'border-destructive focus-visible:ring-destructive' : ''}`}
        />
        <button
          type="button"
          onClick={() => setShow(s => !s)}
          className="absolute inset-y-0 end-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
          tabIndex={-1}
          aria-label={show ? 'Hide password' : 'Show password'}
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function AccountSettingsSection() {
  const { t, language } = useI18n();
  const { toast } = useToast();

  const [currentPassword, setCurrentPassword]   = useState('');
  const [newPassword,     setNewPassword]        = useState('');
  const [confirmPassword, setConfirmPassword]    = useState('');
  const [fieldErrors, setFieldErrors]            = useState<Record<string, string>>({});
  const [isPending,   setIsPending]              = useState(false);

  const validate = (): boolean => {
    const errs: Record<string, string> = {};

    if (!currentPassword) errs.currentPassword = t('admin.settings.field_required');

    const strengthKey = isStrongEnough(newPassword);
    if (!newPassword)        errs.newPassword = t('admin.settings.field_required');
    else if (strengthKey)    errs.newPassword = t(strengthKey as any);

    if (!confirmPassword)                   errs.confirmPassword = t('admin.settings.field_required');
    else if (confirmPassword !== newPassword) errs.confirmPassword = t('auth.passwordsDoNotMatch');

    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setIsPending(true);
    setFieldErrors({});

    try {
      const res = await authFetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });

      if (res.status === 204) {
        toast({
          title: t('admin.settings.success_title'),
          description: t('admin.settings.success_desc'),
        });
        // Sessions are invalidated server-side. Clear the client token and
        // redirect to the admin login so the admin re-authenticates with the new password.
        clearSessionToken();
        try { localStorage.removeItem('skayoffice-admin-section'); } catch {}
        window.location.replace('/admin/login');
        return;
      }

      // Parse error body for structured codes.
      let body: { error?: string; code?: string } = {};
      try { body = await res.json(); } catch {}

      if (res.status === 401 && body.code === 'WRONG_CURRENT_PASSWORD') {
        setFieldErrors({ currentPassword: t('admin.settings.wrong_current') });
      } else if (res.status === 400 && body.code === 'PASSWORD_MISMATCH') {
        setFieldErrors({ confirmPassword: t('auth.passwordsDoNotMatch') });
      } else if (res.status === 400 && body.code === 'VALIDATION_ERROR') {
        setFieldErrors({ newPassword: t('auth.passwordRequirements') });
      } else if (res.status === 429) {
        toast({
          title: t('common.error'),
          description: t('admin.settings.rate_limited'),
          variant: 'destructive',
        });
      } else {
        toast({
          title: t('common.error'),
          description: safeApiError({ data: body, status: res.status }, language),
          variant: 'destructive',
        });
      }
    } catch {
      toast({ title: t('common.error'), description: t('common.error'), variant: 'destructive' });
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="space-y-5 max-w-lg">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck size={18} className="text-primary" />
            {t('admin.settings.title')}
          </CardTitle>
          <CardDescription>{t('admin.settings.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <PasswordInput
              id="current-password"
              label={t('admin.settings.current_password')}
              value={currentPassword}
              onChange={setCurrentPassword}
              autoComplete="current-password"
              error={fieldErrors.currentPassword}
            />

            <div className="border-t pt-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                <KeyRound size={13} />
                {t('auth.passwordRequirements')}
              </div>
              <div className="space-y-4">
                <PasswordInput
                  id="new-password"
                  label={t('admin.settings.new_password')}
                  value={newPassword}
                  onChange={setNewPassword}
                  autoComplete="new-password"
                  error={fieldErrors.newPassword}
                />
                <PasswordInput
                  id="confirm-password"
                  label={t('admin.settings.confirm_password')}
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  autoComplete="new-password"
                  error={fieldErrors.confirmPassword}
                />
              </div>
            </div>

            <div className="pt-2">
              <Button type="submit" disabled={isPending} className="w-full sm:w-auto">
                {isPending ? t('admin.settings.submitting') : t('admin.settings.submit')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
