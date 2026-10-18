import z from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useLogin, getGetCurrentUserQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
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
import { useToast } from '@/hooks/use-toast';

function translateServerError(code: string | undefined, t: (k: string) => string): string {
  switch (code) {
    case 'INVALID_CREDENTIALS': return t('auth.error_invalid_credentials');
    case 'ACCOUNT_LOCKED':      return t('auth.error_account_locked');
    case 'ACCOUNT_DEACTIVATED': return t('auth.error_account_deactivated');
    default:                    return t('common.error');
  }
}

function makeLoginSchema(t: (k: string) => string) {
  return z.object({
    email: z.string()
      .min(1, t('validation.email_required'))
      .email(t('validation.email_invalid')),
    password: z.string().min(1, t('validation.password_required')),
  });
}

export function LoginCustomer() {
  const { t, language } = useI18n();
  const [, setLocation] = useLocation();
  const [showPassword, setShowPassword] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const loginMutation = useLogin({
    mutation: {
      onSuccess: (data) => {
        captureSessionToken(data);
        queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
        toast({
          title: t('auth.login_customer_success_title'),
          description: t('auth.login_customer_success_desc'),
        });
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
                {translateServerError(loginMutation.error.data?.error, t)}
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
                    <FormLabel>
                      {t('auth.email')} <span className="text-destructive" aria-hidden="true">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="name@example.com" dir="ltr" className="text-left" autoComplete="email" autoFocus {...field} />
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
                      <FormLabel>
                        {t('auth.password')} <span className="text-destructive" aria-hidden="true">*</span>
                      </FormLabel>
                      <Link
                        href="/forgot-password"
                        className="text-xs text-primary hover:underline"
                      >
                        {t('auth.forgotPasswordLink')}
                      </Link>
                    </div>
                    <FormControl>
                      <div className="relative">
                        <Input type={showPassword ? 'text' : 'password'} dir="ltr" className="text-left pr-12" autoComplete="current-password" {...field} />
                        <button
                          type="button"
                          tabIndex={-1}
                          className="absolute inset-y-0 right-0 h-11 w-11 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors cursor-pointer xl:h-9 xl:w-9"
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

              <Button type="submit" className="w-full mt-2" size="lg" disabled={loginMutation.isPending}>
                {loginMutation.isPending ? t('common.loading') : t('common.login')}
              </Button>
            </form>
          </Form>

          <p className="mt-3 text-center text-xs text-muted-foreground">
            <span className="text-destructive">*</span> {t('auth.required_fields')}
          </p>

          <div className="mt-6 text-center text-sm">
            <p className="text-muted-foreground mb-2">
              {t('auth.no_account')}{' '}
              <Link href="/register/customer" className="text-primary font-medium hover:underline">
                {t('auth.register_customer')}
              </Link>
            </p>
            <p className="text-muted-foreground mt-4 text-xs">
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
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const loginMutation = useLogin({
    mutation: {
      onSuccess: (data) => {
        captureSessionToken(data);
        queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
        toast({
          title: t('auth.login_office_success_title'),
          description: t('auth.login_office_success_desc'),
        });
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
                {translateServerError(loginMutation.error.data?.error, t)}
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
                    <FormLabel>
                      {t('auth.email')} <span className="text-destructive" aria-hidden="true">*</span>
                    </FormLabel>
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
                      <FormLabel>
                        {t('auth.password')} <span className="text-destructive" aria-hidden="true">*</span>
                      </FormLabel>
                      <Link
                        href="/forgot-password"
                        className="text-xs text-primary hover:underline"
                      >
                        {t('auth.forgotPasswordLink')}
                      </Link>
                    </div>
                    <FormControl>
                      <div className="relative">
                        <Input type={showPassword ? 'text' : 'password'} dir="ltr" className="text-left pr-12" autoComplete="current-password" {...field} />
                        <button
                          type="button"
                          tabIndex={-1}
                          className="absolute inset-y-0 right-0 h-11 w-11 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors cursor-pointer xl:h-9 xl:w-9"
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

              <Button type="submit" className="w-full mt-2" size="lg" disabled={loginMutation.isPending}>
                {loginMutation.isPending ? t('common.loading') : t('common.login')}
              </Button>
            </form>
          </Form>

          <p className="mt-3 text-center text-xs text-muted-foreground">
            <span className="text-destructive">*</span> {t('auth.required_fields')}
          </p>

          <div className="mt-6 text-center text-sm">
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
