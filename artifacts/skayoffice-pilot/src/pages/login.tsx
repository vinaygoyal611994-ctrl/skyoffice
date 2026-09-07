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
import { Building2, User, Eye, EyeOff } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { consumePostLoginRedirect } from '@/lib/postLoginRedirect';
import { captureSessionToken } from '@/lib/sessionToken';

function makeLoginSchema(t: (k: string) => string) {
  return z.object({
    email: z.string().email(t('validation.email_invalid')),
    password: z.string().min(1, t('validation.required')),
  });
}

export function LoginCustomer() {
  const { t, language } = useI18n();
  const [, setLocation] = useLocation();
  const [showPassword, setShowPassword] = useState(false);

  const loginMutation = useLogin({
    mutation: {
      onSuccess: (data) => {
        captureSessionToken(data);
        // Customer login — redirect to the customer portal only.
        // Admins have their own dedicated login at /admin/login.
        const redirectTo = consumePostLoginRedirect();
        setLocation(redirectTo || '/discover');
      }
    }
  });

  const form = useForm({
    resolver: (...args: Parameters<ReturnType<typeof zodResolver>>) =>
      zodResolver(makeLoginSchema(t))(...args),
    defaultValues: {
      email: '',
      password: '',
    }
  });

  // Clear stale-language validation errors immediately on language switch.
  // Server errors (from loginMutation.error) are already reactive via the Alert.
  useEffect(() => { form.clearErrors(); }, [language]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSubmit = (data: any) => {
    loginMutation.mutate({ data });
  };

  return (
    <div className="flex flex-1 items-center justify-center p-4 py-12 bg-muted/20">
      <Card className="w-full max-w-md shadow-xl border-border/50">
        <CardHeader className="space-y-3 text-center pt-8">
          <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-2">
            <User size={24} />
          </div>
          <CardTitle className="text-2xl font-serif">{t('auth.login_customer')}</CardTitle>
          <CardDescription>
            {t('auth.login_customer_tagline')}
          </CardDescription>
        </CardHeader>
        <CardContent className="pb-8">
          {loginMutation.error && (
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
                    <FormLabel>{t('auth.email')}</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="name@example.com" dir="ltr" className="text-left" autoComplete="email" {...field} />
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
                    <div className="flex items-center justify-between">
                      <FormLabel>{t('auth.password')}</FormLabel>
                      <Link
                        href="/forgot-password"
                        className="text-xs text-primary hover:underline"
                      >
                        {t('auth.forgotPasswordLink')}
                      </Link>
                    </div>
                    <FormControl>
                      <div className="relative">
                        <Input type={showPassword ? 'text' : 'password'} dir="ltr" className="text-left pe-10" autoComplete="current-password" {...field} />
                        <button
                          type="button"
                          tabIndex={-1}
                          className="absolute inset-y-0 end-0 h-11 w-11 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors xl:h-9 xl:w-9"
                          aria-label={showPassword ? t('auth.hidePasswordLabel') : t('auth.showPasswordLabel')}
                          onClick={() => setShowPassword(v => !v)}
                        >
                          {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button type="submit" className="w-full" size="lg" disabled={loginMutation.isPending}>
                {loginMutation.isPending ? t('common.loading') : t('common.login')}
              </Button>
            </form>
          </Form>

          <div className="mt-8 text-center text-sm">
            <p className="text-muted-foreground mb-2">
              {t('auth.no_account')}{' '}
              <Link href="/register/customer" className="text-primary font-medium hover:underline">
                {t('auth.register_customer')}
              </Link>
            </p>
            <p className="text-muted-foreground mt-6 text-xs">
              {t('auth.office_login_prompt')}{' '}
              <Link href="/login/office" className="text-primary font-medium hover:underline">
                {t('auth.login_office')}
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function LoginOffice() {
  const { t, language } = useI18n();
  const [, setLocation] = useLocation();
  const [showPassword, setShowPassword] = useState(false);

  const loginMutation = useLogin({
    mutation: {
      onSuccess: (data) => {
        captureSessionToken(data);
        setLocation('/office/dashboard');
      }
    }
  });

  const form = useForm({
    resolver: (...args: Parameters<ReturnType<typeof zodResolver>>) =>
      zodResolver(makeLoginSchema(t))(...args),
    defaultValues: {
      email: '',
      password: '',
    }
  });

  useEffect(() => { form.clearErrors(); }, [language]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSubmit = (data: any) => {
    loginMutation.mutate({ data });
  };

  return (
    <div className="flex flex-1 items-center justify-center p-4 py-12 bg-muted/20">
      <Card className="w-full max-w-md shadow-xl border-border/50">
        <CardHeader className="space-y-3 text-center pt-8">
          <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-2">
            <Building2 size={24} />
          </div>
          <CardTitle className="text-2xl font-serif">{t('auth.login_office')}</CardTitle>
          <CardDescription>
            {t('auth.login_office_tagline')}
          </CardDescription>
        </CardHeader>
        <CardContent className="pb-8">
          {loginMutation.error && (
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
                    <FormLabel>{t('auth.email')}</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="office@example.com" dir="ltr" className="text-left" autoComplete="email" {...field} />
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
                    <div className="flex items-center justify-between">
                      <FormLabel>{t('auth.password')}</FormLabel>
                      <Link
                        href="/forgot-password"
                        className="text-xs text-primary hover:underline"
                      >
                        {t('auth.forgotPasswordLink')}
                      </Link>
                    </div>
                    <FormControl>
                      <div className="relative">
                        <Input type={showPassword ? 'text' : 'password'} dir="ltr" className="text-left pe-10" autoComplete="current-password" {...field} />
                        <button
                          type="button"
                          tabIndex={-1}
                          className="absolute inset-y-0 end-0 h-11 w-11 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors xl:h-9 xl:w-9"
                          aria-label={showPassword ? t('auth.hidePasswordLabel') : t('auth.showPasswordLabel')}
                          onClick={() => setShowPassword(v => !v)}
                        >
                          {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button type="submit" className="w-full" size="lg" disabled={loginMutation.isPending}>
                {loginMutation.isPending ? t('common.loading') : t('common.login')}
              </Button>
            </form>
          </Form>

          <div className="mt-8 text-center text-sm">
            <p className="text-muted-foreground mb-2">
              {t('auth.no_account')}{' '}
              <Link href="/register/office" className="text-primary font-medium hover:underline">
                {t('auth.register_office')}
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
