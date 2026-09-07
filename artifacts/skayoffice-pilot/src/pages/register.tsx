import z from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useRegisterCustomer, useRegisterOffice } from '@workspace/api-client-react';
import { useI18n, categoriesMap } from '@/lib/i18n';
import { Link, useLocation } from 'wouter';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Building2, User, Eye, EyeOff } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { captureSessionToken } from '@/lib/sessionToken';
import { Checkbox } from '@/components/ui/checkbox';
import { trackFunnelRegistrationStarted, trackFunnelRegistrationCompleted } from '@/lib/analytics';

// ──────────────────────────────────────────────────────────
// Schema factories — called inside each component so the
// active language's t() is used for every validation message.
// react-hook-form reads the resolver from its internal ref
// on each validation call, so the latest t() is always used.
// ──────────────────────────────────────────────────────────
function makeCustomerSchema(t: (k: string) => string) {
  return z.object({
    name: z.string().min(2, t('validation.min_2')),
    email: z.string().email(t('validation.email_invalid')),
    password: z.string().min(6, t('validation.min_6')),
    phone: z.string().optional(),
    termsAccepted: z.boolean().refine((v) => v === true, {
      message: t('auth.terms_error'),
    }),
  });
}

function makeOfficeSchema(t: (k: string) => string) {
  return z.object({
    officeName: z.string().min(2, t('validation.min_2')),
    email: z.string().email(t('validation.email_invalid')),
    password: z.string().min(6, t('validation.min_6')),
    whatsapp: z.string().min(5, t('validation.min_5')),
    city: z.string().min(2, t('validation.min_2')),
    category: z.enum([
      'translation', 'legal', 'marketing', 'development', 'design',
      'real_estate', 'company_formation', 'business_consulting',
      'accounting', 'social_media_management',
    ] as const),
    providerType: z.enum(['office', 'freelancer'], {
      required_error: t('validation.provider_type_required'),
      invalid_type_error: t('validation.provider_type_required'),
    }),
    termsAccepted: z.boolean().refine((v) => v === true, {
      message: t('auth.terms_error'),
    }),
  });
}

// ──────────────────────────────────────────────────────────
// Customer registration
// ──────────────────────────────────────────────────────────
export function RegisterCustomer() {
  const { t, language } = useI18n();
  const [, setLocation] = useLocation();
  const [showPassword, setShowPassword] = useState(false);

  const registerMutation = useRegisterCustomer({
    mutation: {
      onSuccess: (data) => {
        captureSessionToken(data);
        setLocation('/discover');
      }
    }
  });

  // Resolver reads makeCustomerSchema(t) on every validation call,
  // so it always uses the current language without needing a memo.
  const form = useForm({
    resolver: (...args: Parameters<ReturnType<typeof zodResolver>>) =>
      zodResolver(makeCustomerSchema(t))(...args),
    defaultValues: {
      name: '',
      email: '',
      password: '',
      phone: '',
      termsAccepted: false,
    }
  });

  const onSubmit = (data: z.infer<ReturnType<typeof makeCustomerSchema>>) => {
    registerMutation.mutate({ data });
  };

  // When the user switches language, clear any displayed errors so the stale-
  // language messages disappear immediately. Fresh translated errors appear on
  // the next submit.
  useEffect(() => { form.clearErrors(); }, [language]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-1 items-center justify-center p-4 py-12 bg-muted/20">
      <Card className="w-full max-w-md shadow-xl border-border/50">
        <CardHeader className="space-y-3 text-center pt-8">
          <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-2">
            <User size={24} />
          </div>
          <CardTitle className="text-2xl font-serif">{t('auth.register_customer')}</CardTitle>
          <CardDescription>
            {t('auth.register_customer_tagline')}
          </CardDescription>
        </CardHeader>
        <CardContent className="pb-8">
          {registerMutation.error && (
            <Alert variant="destructive" className="mb-6">
              <AlertDescription>
                {registerMutation.error.data?.error || t('common.error')}
              </AlertDescription>
            </Alert>
          )}

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit as any)} className="space-y-5">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('auth.name')}</FormLabel>
                    <FormControl>
                      <Input autoComplete="name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('auth.email')}</FormLabel>
                    <FormControl>
                      <Input type="email" dir="ltr" className="text-left" autoComplete="email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('auth.phone')} {t('common.optional')}</FormLabel>
                    <FormControl>
                      <Input type="tel" dir="ltr" className="text-left" autoComplete="tel" {...field} />
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
                    <FormLabel>{t('auth.password')}</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input type={showPassword ? 'text' : 'password'} dir="ltr" className="text-left pe-10" autoComplete="new-password" {...field} />
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

              <FormField
                control={form.control}
                name="termsAccepted"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start gap-3 space-y-0 pt-2">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="checkbox-customer-terms-accepted"
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel className="font-normal cursor-pointer">
                        {t('auth.terms_accept_intro')}{' '}
                        <Link href="/terms" className="text-primary underline hover:no-underline">
                          {t('auth.terms_link_label')}
                        </Link>
                        {' '}{t('auth.terms_and')}{' '}
                        <Link href="/privacy" className="text-primary underline hover:no-underline">
                          {t('auth.privacy_link_label')}
                        </Link>
                      </FormLabel>
                      <FormMessage />
                    </div>
                  </FormItem>
                )}
              />

              <Button type="submit" className="w-full" size="lg" disabled={registerMutation.isPending}>
                {registerMutation.isPending ? t('common.loading') : t('common.register')}
              </Button>
            </form>
          </Form>

          <div className="mt-8 text-center text-sm">
            <p className="text-muted-foreground">
              {t('auth.have_account')}{' '}
              <Link href="/login/customer" className="text-primary font-medium hover:underline">
                {t('common.login')}
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Office / Freelancer registration
// ──────────────────────────────────────────────────────────
export function RegisterOffice() {
  const { t, language } = useI18n();
  const [, setLocation] = useLocation();
  const [showPassword, setShowPassword] = useState(false);

  // Blocker 11: Stage 7 — funnel_registration_started (office form mount)
  useEffect(() => {
    try { trackFunnelRegistrationStarted(); } catch { /* never block */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const registerMutation = useRegisterOffice({
    mutation: {
      onSuccess: (data) => {
        captureSessionToken(data);
        // Blocker 11: Stage 8 — funnel_registration_completed
        try { trackFunnelRegistrationCompleted(); } catch { /* never block */ }
        setLocation('/office/dashboard');
      }
    }
  });

  const form = useForm({
    resolver: (...args: Parameters<ReturnType<typeof zodResolver>>) =>
      zodResolver(makeOfficeSchema(t))(...args),
    defaultValues: {
      officeName: '',
      email: '',
      password: '',
      whatsapp: '',
      city: '',
      category: 'translation' as any,
      providerType: undefined as any,
      termsAccepted: false,
    }
  });

  const onSubmit = (data: z.infer<ReturnType<typeof makeOfficeSchema>>) => {
    registerMutation.mutate({ data });
  };

  useEffect(() => { form.clearErrors(); }, [language]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-1 items-center justify-center p-4 py-12 bg-muted/20">
      <Card className="w-full max-w-xl shadow-xl border-border/50">
        <CardHeader className="space-y-3 text-center pt-8">
          <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-2">
            <Building2 size={24} />
          </div>
          <CardTitle className="text-2xl font-serif">{t('auth.register_office')}</CardTitle>
          <CardDescription>
            {t('auth.register_office_tagline')}
          </CardDescription>
        </CardHeader>
        <CardContent className="pb-8">
          {registerMutation.error && (
            <Alert variant="destructive" className="mb-6">
              <AlertDescription>
                {registerMutation.error.data?.error || t('common.error')}
              </AlertDescription>
            </Alert>
          )}

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit as any)} className="space-y-5">

              {/* Provider type — must be chosen first; no default so the user is forced to decide */}
              <FormField
                control={form.control}
                name="providerType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('provider.type_label')}</FormLabel>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => field.onChange('office')}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all text-sm font-medium ${
                          field.value === 'office'
                            ? 'border-primary bg-primary/5 text-primary'
                            : 'border-border/60 text-muted-foreground hover:border-primary/40'
                        }`}
                      >
                        <Building2 size={24} />
                        <span>{t('provider.office')}</span>
                        <span className="text-[11px] font-normal opacity-70 text-center leading-snug">
                          {t('provider.doc_guidance_office')}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => field.onChange('freelancer')}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all text-sm font-medium ${
                          field.value === 'freelancer'
                            ? 'border-primary bg-primary/5 text-primary'
                            : 'border-border/60 text-muted-foreground hover:border-primary/40'
                        }`}
                      >
                        <User size={24} />
                        <span>{t('provider.freelancer')}</span>
                        <span className="text-[11px] font-normal opacity-70 text-center leading-snug">
                          {t('provider.doc_guidance_freelancer')}
                        </span>
                      </button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <FormField
                  control={form.control}
                  name="officeName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('auth.office_name')}</FormLabel>
                      <FormControl>
                      <Input autoComplete="name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('auth.category')}</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={t('auth.category')} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {Object.entries(categoriesMap).filter(([key]) => key !== 'other').map(([key, labels]) => (
                            <SelectItem key={key} value={key}>
                              {labels[language]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('auth.email')}</FormLabel>
                      <FormControl>
                      <Input type="email" dir="ltr" className="text-left" autoComplete="email" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="whatsapp"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('dashboard.whatsapp')}</FormLabel>
                      <FormControl>
                      <Input type="tel" dir="ltr" className="text-left" autoComplete="tel" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="city"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('auth.city')}</FormLabel>
                      <FormControl>
                        <Input {...field} />
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
                      <FormLabel>{t('auth.password')}</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input type={showPassword ? 'text' : 'password'} dir="ltr" className="text-left pe-10" autoComplete="new-password" {...field} />
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
              </div>

              <FormField
                control={form.control}
                name="termsAccepted"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start gap-3 space-y-0 pt-2">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="checkbox-terms-accepted"
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel className="font-normal cursor-pointer">
                        {t('auth.terms_accept_intro')}{' '}
                        <Link href="/terms" className="text-primary underline hover:no-underline">
                          {t('auth.terms_link_label')}
                        </Link>
                        {' '}{t('auth.terms_and')}{' '}
                        <Link href="/privacy" className="text-primary underline hover:no-underline">
                          {t('auth.privacy_link_label')}
                        </Link>
                      </FormLabel>
                      <FormMessage />
                    </div>
                  </FormItem>
                )}
              />

              <div className="pt-4">
                <Button type="submit" className="w-full" size="lg" disabled={registerMutation.isPending}>
                  {registerMutation.isPending ? t('common.loading') : t('auth.register_office')}
                </Button>
              </div>
            </form>
          </Form>

          <div className="mt-8 text-center text-sm">
            <p className="text-muted-foreground">
              {t('auth.have_account')}{' '}
              <Link href="/login/office" className="text-primary font-medium hover:underline">
                {t('common.login')}
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
