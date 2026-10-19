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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { QuickOfficeCard } from '@/components/office/QuickOfficeCard';
import {
  Mail, Phone, LogOut, HeartCrack, Search, Video,
  ShieldCheck, ShieldAlert, MessageCircle, MapPin, Share2,
  History, Heart, Clock, CalendarCheck,
} from 'lucide-react';
import { MyServiceRequests } from '@/components/account/MyServiceRequests';
import { format } from 'date-fns';

const VIDEO_STATUS_TONE: Record<string, string> = {
  new:       'bg-blue-100 text-blue-700 border-blue-200',
  viewed:    'bg-slate-100 text-slate-700 border-slate-200',
  accepted:  'bg-emerald-100 text-emerald-700 border-emerald-200',
  declined:  'bg-red-100 text-red-700 border-red-200',
  completed: 'bg-purple-100 text-purple-700 border-purple-200',
};

function SectionHeader({ icon, title, description }: { icon: React.ReactNode; title: string; description?: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div>
        <h2 className="text-base font-bold text-foreground leading-tight">{title}</h2>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
    </div>
  );
}

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
        clearSessionToken();
        queryClient.removeQueries();
        setLocation('/');
      },
      onError: () => {
        clearSessionToken();
        queryClient.removeQueries();
        setLocation('/');
      },
    },
  });

  if (!user) {
    return (
      <div className="p-20 flex justify-center min-h-[60vh] items-center">
        <div className="animate-spin w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full" />
      </div>
    );
  }

  const isSuspended = user.status === 'suspended';
  const initials = user.name?.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2) || '?';

  return (
    <div className="bg-background min-h-screen">

      {/* ── Hero banner ── */}
      <div className="bg-gradient-to-r from-[hsl(215,25%,18%)] via-[hsl(215,25%,27%)] to-[hsl(215,30%,36%)] pb-16 pt-10 px-4">
        <div className="container mx-auto flex items-center gap-5">
          <div className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur text-white flex items-center justify-center text-2xl font-bold shrink-0 shadow-lg border border-white/30">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl sm:text-2xl font-bold text-white leading-tight break-words">{user.name}</h1>
            <p className="text-sm text-white/75 mt-0.5 break-all">{user.email}</p>
            <div className="mt-2">
              {isSuspended ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold bg-red-500/20 text-red-100 border border-red-400/30 px-2.5 py-1 rounded-full">
                  <ShieldAlert size={12} /> Suspended
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold bg-emerald-500/20 text-emerald-100 border border-emerald-400/30 px-2.5 py-1 rounded-full">
                  <ShieldCheck size={12} /> Active
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Stats strip — pulled up over banner ── */}
      <div className="container mx-auto px-4 -mt-8">
        <div className="grid grid-cols-3 gap-3">
          {[
            { icon: <Heart size={16} />, value: favourites?.length ?? 0, label: t('nav.favourites'), color: 'text-rose-500' },
            { icon: <History size={16} />, value: contactEvents?.length ?? 0, label: t('account.contact_history_section'), color: 'text-blue-500' },
            { icon: <Video size={16} />, value: videoRequests?.length ?? 0, label: t('account.video_requests_section'), color: 'text-purple-500' },
          ].map(({ icon, value, label, color }) => (
            <div key={label} className="bg-white rounded-2xl border border-border/50 shadow-sm p-3 flex flex-col items-center gap-1">
              <span className={color}>{icon}</span>
              <span className="text-xl font-bold leading-tight">{value}</span>
              <span className="text-[10px] text-muted-foreground text-center leading-tight">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="container mx-auto px-4 py-6 flex flex-col gap-5">

        {/* Profile info card */}
        <div className="bg-white rounded-2xl border border-border/50 shadow-sm p-5">
          <SectionHeader icon={<Mail size={17} />} title={t('account.profile_section')} />
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/30 border border-border/40">
              <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Mail size={15} />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-semibold">Email</p>
                <p className="text-sm font-medium break-all" dir="ltr">{user.email}</p>
              </div>
            </div>
            {user.phone && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/30 border border-border/40">
                <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Phone size={15} />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-semibold">Phone</p>
                  <p className="text-sm font-medium" dir="ltr">{user.phone}</p>
                </div>
              </div>
            )}
            {isSuspended && user.statusReason && (
              <div className="flex items-start gap-3 p-3 rounded-xl bg-red-50 border border-red-200">
                <ShieldAlert size={15} className="text-red-600 mt-0.5 shrink-0" />
                <p className="text-sm text-red-700">{user.statusReason}</p>
              </div>
            )}
          </div>
          <div className="mt-4 pt-4 border-t border-border/40">
            <Button
              variant="outline"
              size="sm"
              className="gap-2 text-destructive hover:text-destructive hover:bg-destructive/5 border-destructive/30 cursor-pointer"
              onClick={() => logoutMutation.mutate()}
              data-testid="button-account-logout"
            >
              <LogOut size={15} />
              {t('common.logout')}
            </Button>
          </div>
        </div>

        {/* Favourites */}
        <div className="bg-white rounded-2xl border border-border/50 shadow-sm p-5">
          <SectionHeader
            icon={<Heart size={17} />}
            title={t('account.favourites_section')}
            description={favourites?.length ? `${favourites.length} saved` : undefined}
          />
          {favouritesLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-56 rounded-xl" />)}
            </div>
          ) : !favourites?.length ? (
            <div className="flex flex-col items-center justify-center py-10 text-center border-2 border-dashed border-border/50 rounded-2xl bg-muted/10">
              <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-400 flex items-center justify-center mb-3">
                <HeartCrack size={22} />
              </div>
              <p className="text-muted-foreground mb-4 text-sm max-w-xs">{t('fav.empty')}</p>
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
        </div>

        {/* Contact History */}
        <div className="bg-white rounded-2xl border border-border/50 shadow-sm p-5">
          <SectionHeader icon={<History size={17} />} title={t('account.contact_history_section')} />
          {contactEventsLoading ? (
            <Skeleton className="h-24 w-full rounded-lg" />
          ) : !contactEvents?.length ? (
            <div className="flex flex-col items-center justify-center py-8 text-center border-2 border-dashed border-border/50 rounded-2xl bg-muted/10">
              <Clock size={22} className="text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground italic">{t('account.no_contact_history')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {contactEvents.map((evt) => {
                const icon = evt.actionType === 'whatsapp_click'    ? <MessageCircle size={14} className="text-emerald-600" />
                           : evt.actionType === 'video_call_request' ? <Video size={14} className="text-blue-600" />
                           : evt.actionType === 'location_click'     ? <MapPin size={14} className="text-orange-500" />
                           : <Share2 size={14} className="text-purple-500" />;
                return (
                  <div
                    key={evt.id}
                    className="flex items-center justify-between rounded-xl border border-border/40 bg-muted/20 px-4 py-3 gap-3 flex-wrap"
                    data-testid={`row-my-contact-event-${evt.id}`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-wrap">
                      <div className="w-7 h-7 rounded-lg bg-white border border-border/50 flex items-center justify-center shrink-0 shadow-sm">
                        {icon}
                      </div>
                      <span className="text-sm font-medium break-words min-w-0">{evt.officeName}</span>
                      <Badge variant="outline" className="text-[10px] shrink-0">{t(`contact.action_${evt.actionType}` as any)}</Badge>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">{format(new Date(evt.createdAt), 'yyyy-MM-dd HH:mm')}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Service Requests */}
        <div className="bg-white rounded-2xl border border-border/50 shadow-sm p-5">
          <SectionHeader icon={<CalendarCheck size={17} />} title={t('account.service_requests_section')} />
          <MyServiceRequests />
        </div>

        {/* Video Requests */}
        <div className="bg-white rounded-2xl border border-border/50 shadow-sm p-5">
          <SectionHeader icon={<Video size={17} />} title={t('account.video_requests_section')} />
          {videoRequestsLoading ? (
            <Skeleton className="h-24 w-full rounded-lg" />
          ) : !videoRequests?.length ? (
            <div className="flex flex-col items-center justify-center py-8 text-center border-2 border-dashed border-border/50 rounded-2xl bg-muted/10">
              <Video size={22} className="text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground italic">{t('account.no_video_requests')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {videoRequests.map((req) => (
                <div
                  key={req.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between rounded-xl border border-border/40 bg-muted/20 px-4 py-3 gap-3"
                  data-testid={`row-my-video-request-${req.id}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
                      <Video size={15} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium" dir="ltr">{req.preferredDate} — {req.preferredTime} ({req.timezone})</div>
                      <div className="text-xs text-muted-foreground">{format(new Date(req.createdAt), 'yyyy-MM-dd HH:mm')}</div>
                    </div>
                  </div>
                  <Badge variant="outline" className={`shrink-0 ${VIDEO_STATUS_TONE[req.status] || ''}`}>
                    {t(`videocall.status_${req.status}` as any)}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
