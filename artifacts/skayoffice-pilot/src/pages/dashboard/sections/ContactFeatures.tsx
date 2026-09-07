import React, { useState, useEffect } from 'react';
import { useI18n } from '@/lib/i18n';
import { useGetMyOffice, useUpdateMyOffice, getGetMyOfficeQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { MessageCircle, Phone, Video, MapPin, Info } from 'lucide-react';

export function ContactFeaturesSection({ navigate }: { navigate?: (s: string) => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: office, isLoading } = useGetMyOffice();
  const updateMut = useUpdateMyOffice({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetMyOfficeQueryKey(), data);
        toast({ title: t('dash.contact.saved') });
      },
      onError: () => {
        toast({ title: t('common.error'), variant: 'destructive' });
        // Revert to server state
        const cached = queryClient.getQueryData<typeof office>(getGetMyOfficeQueryKey());
        setSwitches({
          phone: !!cached?.acceptsPhoneCalls,
          video: !!cached?.videoCallEnabled,
        });
      },
    },
  });

  const [switches, setSwitches] = useState({ phone: false, video: false });

  useEffect(() => {
    if (office) {
      setSwitches({ phone: !!office.acceptsPhoneCalls, video: !!office.videoCallEnabled });
    }
  }, [office]);

  const handleToggle = (field: 'acceptsPhoneCalls' | 'videoCallEnabled', value: boolean) => {
    setSwitches(prev => ({ ...prev, [field === 'acceptsPhoneCalls' ? 'phone' : 'video']: value }));
    updateMut.mutate({ data: { [field]: value } });
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-20 w-full rounded-2xl" />)}
      </div>
    );
  }

  const hasWhatsApp = !!office?.whatsapp;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('dash.contact.title')}</CardTitle>
          <CardDescription>{t('dash.contact.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-0 divide-y pt-0">
          {/* WhatsApp — auto-enabled if whatsapp number is set */}
          <div className="py-4 flex items-start gap-4">
            <MessageCircle size={20} className="text-emerald-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">{t('dash.contact.whatsapp_feature')}</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{t('dash.contact.whatsapp_desc')}</p>
              {!hasWhatsApp && (
                <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                  <Info size={12} className="shrink-0" />
                  {t('dashboard.whatsapp_placeholder')}
                </p>
              )}
            </div>
            <Switch checked={hasWhatsApp} disabled />
          </div>

          {/* Phone calls */}
          <div className="py-4 flex items-start gap-4">
            <Phone size={20} className="text-blue-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">{t('dash.contact.phone_feature')}</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{t('dash.contact.phone_desc')}</p>
            </div>
            <Switch
              checked={switches.phone}
              disabled={updateMut.isPending}
              onCheckedChange={v => handleToggle('acceptsPhoneCalls', v)}
            />
          </div>

          {/* Video call booking — disabled until feature is officially released publicly */}
          <div className="py-4 flex items-start gap-4 opacity-60">
            <Video size={20} className="text-rose-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-medium text-sm">{t('dash.contact.video_call_feature')}</p>
                <span className="inline-flex items-center text-[10px] font-semibold uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                  {t('dash.contact.video_call_coming_soon')}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{t('dash.contact.video_call_desc')}</p>
            </div>
            <Switch checked={false} disabled />
          </div>

          {/* Location — derived from googleMapsUrl */}
          <div className="py-4 flex items-start gap-4">
            <MapPin size={20} className="text-orange-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">{t('dash.contact.location_feature')}</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{t('dash.contact.location_desc')}</p>
            </div>
            <Switch checked={!!office?.googleMapsUrl} disabled />
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground px-1 flex items-start gap-1.5">
        <Info size={12} className="shrink-0 mt-0.5" />
        {t('dash.contact.note')}
      </p>
    </div>
  );
}
