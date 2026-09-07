import React from 'react';
import { useI18n } from '@/lib/i18n';
import { Link, useLocation } from 'wouter';
import { clearSessionToken } from '@/lib/sessionToken';
import {
  useGetCurrentUser,
  useLogout,
  useListFavourites,
  useRemoveFavourite,
  useListMyVideoCallRequests,
  useListMyContactEvents,
  getListFavouritesQueryKey,
  getGetCurrentUserQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { QuickOfficeCard } from '@/components/office/QuickOfficeCard';
import { UserCircle, Mail, Phone, LogOut, HeartCrack, Search, Video, ShieldCheck, ShieldAlert, MessageCircle, MapPin, Share2, History } from 'lucide-react';
import { MyServiceRequests } from '@/components/account/MyServiceRequests';
import { format } from 'date-fns';

const VIDEO_STATUS_TONE: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700 border-blue-200',
  viewed: 'bg-slate-100 text-slate-700 border-slate-200',
  accepted: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  declined: 'bg-red-100 text-red-700 border-red-200',
  completed: 'bg-purple-100 text-purple-700 border-purple-200',
};

export function Account() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const { data: user } = useGetCurrentUser({ query: { retry: false, queryKey: getGetCurrentUserQueryKey() } });
  const { data: favourites, isLoading: favouritesLoading } = useListFavourites();
  const { data: videoRequests, isLoading: videoRequestsLoading } = useListMyVideoCallRequests();
  const { data: contactEvents, isLoading: contactEventsLoading } = useListMyContactEvents({ limit: 20 });

  const removeFavMutation = useRemoveFavourite({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListFavouritesQueryKey() }),
    },
  });

  const logoutMutation = useLogout({
    mutation: {
      onSuccess: () => {
        // See Shell.tsx logout handler: client-side navigation + removing
        // (not just invalidating) cached queries avoids both the hard-reload
        // blank-screen flash and the stale-user-data-after-error bug where
        // react-query keeps the last successful `data` around after a query
        // errors.
        clearSessionToken();
        queryClient.removeQueries();
        setLocation('/');
      },
      // If the destroy call fails, still clear client-side state — the
      // session is unusable at that point and the UI must not stay stuck.
      onError: () => {
        clearSessionToken();
        queryClient.removeQueries();
        setLocation('/');
      },
    },
  });

  if (!user) {
    return <div className="p-20 flex justify-center min-h-[60vh] items-center"><div className="animate-spin w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full" /></div>;
  }

  const isSuspended = user.status === 'suspended';

  return (
    <div className="dashboard-surface container mx-auto px-3 sm:px-4 py-6 md:py-12 flex flex-col gap-5 sm:gap-8 max-w-4xl">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shadow-lg">
          <UserCircle size={24} />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-serif font-bold tracking-tight break-words">{t('account.title')}</h1>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('account.profile_section')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm">
            <UserCircle size={16} className="text-muted-foreground" />
            <span className="font-medium">{user.name}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Mail size={16} className="text-muted-foreground" />
            <span dir="ltr" className="min-w-0 break-all">{user.email}</span>
          </div>
          {user.phone && (
            <div className="flex items-center gap-2 text-sm">
              <Phone size={16} className="text-muted-foreground" />
              <span dir="ltr">{user.phone}</span>
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            className="w-fit gap-2 mt-2"
            onClick={() => logoutMutation.mutate()}
            data-testid="button-account-logout"
          >
            <LogOut size={16} />
            {t('common.logout')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('account.status_section')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className={`rounded-lg border p-4 flex items-start gap-3 ${isSuspended ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'}`} data-testid="account-status-banner">
            {isSuspended ? <ShieldAlert className="h-5 w-5 text-red-600 mt-0.5 shrink-0" /> : <ShieldCheck className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />}
            <div>
              <p className={`text-sm font-medium ${isSuspended ? 'text-red-800' : 'text-emerald-800'}`}>
                {isSuspended ? t('account.status_suspended_notice') : t('account.status_active_notice')}
              </p>
              {user.statusReason && (
                <p className="text-xs text-muted-foreground mt-1">{user.statusReason}</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('account.favourites_section')}</CardTitle>
        </CardHeader>
        <CardContent>
          {favouritesLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-56 rounded-xl" />)}
            </div>
          ) : !favourites?.length ? (
            <div className="flex flex-col items-center justify-center py-12 text-center border rounded-xl border-dashed bg-muted/10">
              <HeartCrack className="h-8 w-8 text-muted-foreground/60 mb-3" />
              <p className="text-muted-foreground mb-4 text-sm">{t('fav.empty')}</p>
              <Button size="sm" className="rounded-full px-6" asChild>
                <Link href="/discover"><Search className="mr-2 rtl:ml-2 rtl:mr-0" size={14} />{t('nav.discover')}</Link>
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {favourites.map((fav, index) => (
                <QuickOfficeCard
                  key={fav.id}
                  office={fav}
                  index={index}
                  showFavourite
                  isFavourite
                  favouriteDisabled={removeFavMutation.isPending}
                  onToggleFavourite={() => removeFavMutation.mutate({ officeId: fav.id })}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><History size={18} />{t('account.contact_history_section')}</CardTitle>
        </CardHeader>
        <CardContent>
          {contactEventsLoading ? (
            <Skeleton className="h-24 w-full rounded-lg" />
          ) : !contactEvents?.length ? (
            <p className="text-sm text-muted-foreground italic py-6 text-center">{t('account.no_contact_history')}</p>
          ) : (
            <div className="space-y-2">
              {contactEvents.map((evt) => {
                const icon = evt.actionType === 'whatsapp_click' ? <MessageCircle size={14} />
                  : evt.actionType === 'video_call_request' ? <Video size={14} />
                  : evt.actionType === 'location_click' ? <MapPin size={14} />
                  : <Share2 size={14} />;
                return (
                  <div key={evt.id} className="flex items-center justify-between bg-muted/30 rounded-md px-3 py-2 text-sm flex-wrap gap-2" data-testid={`row-my-contact-event-${evt.id}`}>
                    <div className="flex min-w-0 items-center gap-2 flex-wrap">
                      {icon}
                      <span className="min-w-0 break-words font-medium">{evt.officeName}</span>
                      <Badge variant="outline" className="text-[10px]">{t(`contact.action_${evt.actionType}` as any)}</Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">{format(new Date(evt.createdAt), 'yyyy-MM-dd HH:mm')}</span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <MyServiceRequests />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Video size={18} />{t('account.video_requests_section')}</CardTitle>
        </CardHeader>
        <CardContent>
          {videoRequestsLoading ? (
            <Skeleton className="h-24 w-full rounded-lg" />
          ) : !videoRequests?.length ? (
            <p className="text-sm text-muted-foreground italic py-6 text-center">{t('account.no_video_requests')}</p>
          ) : (
            <div className="space-y-3">
              {videoRequests.map((req) => (
                <div key={req.id} className="flex items-center justify-between border rounded-lg p-3 flex-wrap gap-2" data-testid={`row-my-video-request-${req.id}`}>
                  <div className="text-sm">
                    <div className="font-medium" dir="ltr">{req.preferredDate} — {req.preferredTime} ({req.timezone})</div>
                    <div className="text-xs text-muted-foreground">{format(new Date(req.createdAt), 'yyyy-MM-dd HH:mm')}</div>
                  </div>
                  <Badge variant="outline" className={VIDEO_STATUS_TONE[req.status] || ''}>
                    {t(`videocall.status_${req.status}` as any)}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
