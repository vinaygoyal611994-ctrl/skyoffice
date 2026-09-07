import React, { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import {
  getGetMyOfficeQueryKey,
  useGetMyOffice,
  useUpdateMyOfficeWorksVisibility,
} from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Images, Globe, User, LogOut, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { clearSessionToken } from '@/lib/sessionToken';
import { useQueryClient } from '@tanstack/react-query';
import { useLogout } from '@workspace/api-client-react';

export function SettingsSection() {
  const { t, language, setLanguage } = useI18n();
  const { data: office } = useGetMyOffice();
  const queryClient = useQueryClient();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const logoutMutation = useLogout();
  const worksVisibilityMutation = useUpdateMyOfficeWorksVisibility({
    mutation: {
      onSuccess: (updatedOffice) => {
        queryClient.setQueryData(getGetMyOfficeQueryKey(), updatedOffice);
      },
    },
  });

  const handleLogout = () => {
    // Destroy the server-side session first (invalidates the session cookie),
    // then clear the client-side bearer token and query cache.
    logoutMutation.mutate(undefined, {
      onSettled: () => {
        clearSessionToken();
        queryClient.clear();
        // replace() removes this protected page from the browser history stack
        // so the Back button cannot restore it from bfcache after logout.
        window.location.replace('/');
      },
    });
  };

  return (
    <div className="space-y-5">
      {/* Language */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe size={18} className="text-primary" />
            {t('dash.settings.language_section')}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setLanguage('ar')}
              className={`relative flex items-center justify-center gap-2 p-4 rounded-xl border-2 font-medium transition-colors ${
                language === 'ar'
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-border text-muted-foreground hover:border-foreground/20'
              }`}
            >
              {language === 'ar' && (
                <CheckCircle2 size={14} className="absolute top-2 end-2 text-primary" />
              )}
              <span className="text-xl">🇸🇦</span>
              <span>{t('dash.settings.language_ar')}</span>
            </button>
            <button
              onClick={() => setLanguage('en')}
              className={`relative flex items-center justify-center gap-2 p-4 rounded-xl border-2 font-medium transition-colors ${
                language === 'en'
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-border text-muted-foreground hover:border-foreground/20'
              }`}
            >
              {language === 'en' && (
                <CheckCircle2 size={14} className="absolute top-2 end-2 text-primary" />
              )}
              <span className="text-xl">🇬🇧</span>
              <span>{t('dash.settings.language_en')}</span>
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Optional Works portfolio */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Images size={18} className="text-primary" />
            {t('dash.settings.works_section')}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex items-start justify-between gap-4 rounded-xl border p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t('dash.settings.works_toggle')}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {t('dash.settings.works_description')}
              </p>
            </div>
            <Switch
              checked={office?.worksEnabled ?? false}
              disabled={!office || worksVisibilityMutation.isPending}
              onCheckedChange={(enabled) =>
                worksVisibilityMutation.mutate({ data: { enabled } })
              }
              aria-label={t('dash.settings.works_toggle')}
              data-testid="switch-works-visibility"
            />
          </div>
        </CardContent>
      </Card>

      {/* Account info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <User size={18} className="text-primary" />
            {t('dash.settings.account_section')}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          {office && (
            <>
              <div className="flex items-center justify-between py-2 border-b">
                <span className="text-sm text-muted-foreground">{t('auth.office_name')}</span>
                <span className="text-sm font-medium">{office.name}</span>
              </div>
              {office.email && (
                <div className="flex items-center justify-between py-2 border-b">
                  <span className="text-sm text-muted-foreground">{t('auth.email')}</span>
                  <span className="text-sm font-medium dir-ltr">{office.email}</span>
                </div>
              )}
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-muted-foreground">{t('auth.account_type' as any)}</span>
                <div className="flex items-center gap-1.5">
                  {office.isVerified && <ShieldCheck size={14} className="text-emerald-500" />}
                  <Badge variant="outline" className="text-xs">{t('dash.settings.role_office' as any)}</Badge>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Danger zone */}
      <Card className="border-destructive/20">
        <CardContent className="pt-4 pb-4">
          <Button
            variant="destructive"
            className="w-full gap-2"
            onClick={() => setConfirmLogout(true)}
          >
            <LogOut size={16} />
            {t('dash.settings.logout')}
          </Button>
        </CardContent>
      </Card>

      <AlertDialog open={confirmLogout} onOpenChange={setConfirmLogout}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('dash.settings.logout_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('dash.settings.logout_confirm_desc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleLogout}
            >
              {t('dash.settings.logout')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
