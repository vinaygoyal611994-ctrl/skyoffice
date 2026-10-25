import z from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useLogin } from '@workspace/api-client-react';
import { useI18n } from '@/lib/i18n';
import { Link, useLocation } from 'wouter';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ShieldCheck, Eye, EyeOff } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { captureSessionToken } from '@/lib/sessionToken';

function makeAdminSchema(t: (k: string) => string) {
  return z.object({
    email: z.string().email(t('validation.email_invalid')),
    password: z.string().min(1, t('validation.required')),
  });
}

export function LoginAdmin() {
  const { t, language } = useI18n();
  const [, setLocation] = useLocation();
  const [showPassword, setShowPassword] = useState(false);
  const [wrongRoleError, setWrongRoleError] = useState(false);

  const loginMutation = useLogin({
    mutation: {
      onSuccess: (data) => {
        if (data.role !== 'admin') {
          // Don't capture the session token — this portal is admin-only.
          // Show a clear error so the user knows to use their correct login.
          setWrongRoleError(true);
          return;
        }
        setWrongRoleError(false);
        captureSessionToken(data);
        setLocation('/admin');
      },
    },
  });

  const form = useForm({
    resolver: (...args: Parameters<ReturnType<typeof zodResolver>>) =>
      zodResolver(makeAdminSchema(t))(...args),
    defaultValues: { email: '', password: '' },
  });

  // Clear stale-language validation errors immediately on language switch.
  useEffect(() => { form.clearErrors(); }, [language]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSubmit = (data: z.infer<ReturnType<typeof makeAdminSchema>>) => {
    setWrongRoleError(false);
    loginMutation.mutate({ data });
  };

  return (
    <div className="flex flex-1 items-center justify-center p-4 py-12 bg-muted/20">
      <Card className="w-full max-w-md shadow-xl border-border/50">
        <CardHeader className="space-y-3 text-center pt-8">
          <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-2">
            <ShieldCheck size={24} />
          </div>
          <CardTitle className="text-2xl font-serif">{t('auth.login_admin')}</CardTitle>
          <CardDescription>{t('auth.login_admin_tagline')}</CardDescription>
        </CardHeader>

        <CardContent className="pb-8">
          {/* Wrong-role error: non-admin credentials used on this form */}
          {wrongRoleError && (
            <Alert variant="destructive" className="mb-6">
              <AlertDescription>{t('auth.login_admin_wrong_role')}</AlertDescription>
            </Alert>
          )}

          {/* Generic API error */}
          {loginMutation.error && !wrongRoleError && (
            <Alert variant="destructive" className="mb-6">
              <AlertDescription>
                {loginMutation.error.data?.error || t('common.error')}
              </AlertDescription>
            </Alert>
          )}

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('auth.email')} <span className="text-red-500 ms-0.5">*</span></FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="admin@example.com"
                        dir="ltr"
                        className="text-left"
                        autoComplete="username"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('auth.password')} <span className="text-red-500 ms-0.5">*</span></FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          type={showPassword ? 'text' : 'password'}
                          dir="ltr"
                          className="text-left pr-10"
                          autoComplete="current-password"
                          {...field}
                        />
                        <button
                          type="button"
                          tabIndex={-1}
                          className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground transition-colors"
                          aria-label={
                            showPassword ? t('auth.hidePasswordLabel') : t('auth.showPasswordLabel')
                          }
                          onClick={() => setShowPassword((v) => !v)}
                        >
                          {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                className="w-full"
                size="lg"
                disabled={loginMutation.isPending}
              >
                {loginMutation.isPending ? t('common.loading') : t('common.login')}
              </Button>
            </form>
          </Form>

          <div className="mt-8 text-center text-sm">
            <p className="text-muted-foreground text-xs">
              {t('auth.not_admin_prompt')}{' '}
              <Link href="/login/office" className="text-primary font-medium hover:underline">
                {t('auth.login_office')}
              </Link>
              {' · '}
              <Link href="/login/customer" className="text-primary font-medium hover:underline">
                {t('auth.login_customer')}
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
