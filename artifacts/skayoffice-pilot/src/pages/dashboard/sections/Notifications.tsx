import React, { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import {
  useListMyOfficeDocuments, useListMyOfficeVideoCallRequests,
  useGetMyOffice,
} from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Bell, CheckCircle2, XCircle, Video, FilePenLine } from 'lucide-react';

interface Notification {
  id: string;
  type: 'doc_approved' | 'doc_rejected' | 'video_request' | 'pending_change';
  titleKey: string;
  body: string;
  section: string;
  read: boolean;
  ts: string;
}

interface NotificationsProps {
  navigate: (section: string) => void;
}

const SEEN_KEY = 'skayoffice-notif-seen';
function getSeenIds(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'));
  } catch { return new Set(); }
}
function markSeen(ids: string[]) {
  try {
    const seen = getSeenIds();
    ids.forEach(id => seen.add(id));
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
  } catch {}
}

export function NotificationsSection({ navigate }: NotificationsProps) {
  const { t, language } = useI18n();
  const { data: office } = useGetMyOffice();
  const { data: documents } = useListMyOfficeDocuments();
  const { data: videoRequests } = useListMyOfficeVideoCallRequests();
  const [seenIds, setSeenIds] = useState<Set<string>>(getSeenIds);
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);

  // Build notifications from existing data
  const notifications: Notification[] = [];

  (documents || []).forEach(doc => {
    if (doc.status === 'approved') {
      const id = `doc_approved_${doc.id}`;
      notifications.push({
        id, type: 'doc_approved',
        titleKey: 'dash.notifications.type_doc_approved',
        body: `${t('dashboard.document_number_prefix')} #${doc.id} — ${t('dashboard.document_status_approved')}`,
        section: 'documents',
        read: seenIds.has(id),
        ts: '',
      });
    } else if (doc.status === 'rejected') {
      const id = `doc_rejected_${doc.id}`;
      notifications.push({
        id, type: 'doc_rejected',
        titleKey: 'dash.notifications.type_doc_rejected',
        body: `${t('dashboard.document_number_prefix')} #${doc.id} — ${t('dashboard.document_status_rejected')}`,
        section: 'documents',
        read: seenIds.has(id),
        ts: '',
      });
    }
  });

  (videoRequests || []).filter(r => r.status === 'new').forEach(req => {
    const id = `video_req_${req.id}`;
    notifications.push({
      id, type: 'video_request',
      titleKey: 'dash.notifications.type_video_request',
      body: `${req.customerName} — ${req.preferredDate} ${req.preferredTime}`,
      section: 'requests',
      read: seenIds.has(id),
      ts: req.createdAt,
    });
  });

  if (office?.pendingChanges) {
    const id = 'pending_change';
    notifications.push({
      id, type: 'pending_change',
      titleKey: 'dash.notifications.type_pending_change',
      body: office.pendingChangesSubmittedAt
        ? new Date(office.pendingChangesSubmittedAt).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-CA')
        : '',
      section: 'profile',
      read: seenIds.has(id),
      ts: office.pendingChangesSubmittedAt || '',
    });
  }

  const filtered = showUnreadOnly ? notifications.filter(n => !n.read) : notifications;
  const unreadCount = notifications.filter(n => !n.read).length;

  const handleMarkRead = (id: string) => {
    markSeen([id]);
    setSeenIds(getSeenIds());
  };

  const handleMarkAllRead = () => {
    markSeen(notifications.map(n => n.id));
    setSeenIds(getSeenIds());
  };

  const iconForType = (type: Notification['type']) => {
    switch (type) {
      case 'doc_approved': return <CheckCircle2 size={18} className="text-emerald-500" />;
      case 'doc_rejected': return <XCircle size={18} className="text-red-500" />;
      case 'video_request': return <Video size={18} className="text-blue-500" />;
      case 'pending_change': return <FilePenLine size={18} className="text-amber-500" />;
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Bell size={18} className="text-primary" />
              {t('dash.notifications.title')}
              {unreadCount > 0 && (
                <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </CardTitle>
            {unreadCount > 0 && (
              <Button variant="ghost" size="sm" onClick={handleMarkAllRead} className="text-xs">
                {t('dash.notifications.mark_all_read')}
              </Button>
            )}
          </div>
          {/* Filter chips */}
          <div className="flex gap-2 mt-2">
            {[false, true].map(unreadOnly => (
              <button
                key={String(unreadOnly)}
                onClick={() => setShowUnreadOnly(unreadOnly)}
                className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${
                  showUnreadOnly === unreadOnly
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-transparent text-muted-foreground border-border hover:border-foreground/30'
                }`}
              >
                {unreadOnly ? t('dash.notifications.unread') : t('dash.notifications.all')}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {filtered.length === 0 ? (
            <div className="py-14 text-center">
              <Bell size={36} className="text-muted-foreground/20 mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">{t('dash.notifications.empty')}</p>
              <p className="text-muted-foreground/60 text-xs mt-1">{t('dash.notifications.empty_desc')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map(notif => (
                <div
                  key={notif.id}
                  className={`flex items-start gap-3 p-3 rounded-xl border transition-colors ${
                    !notif.read ? 'bg-primary/5 border-primary/20' : 'border-border/50'
                  }`}
                >
                  <div className="shrink-0 mt-0.5">{iconForType(notif.type)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{t(notif.titleKey as any)}</p>
                    {notif.body && <p className="text-xs text-muted-foreground mt-0.5">{notif.body}</p>}
                    <div className="flex items-center gap-3 mt-2">
                      <button
                        onClick={() => navigate(notif.section)}
                        className="text-xs text-primary underline-offset-2 hover:underline"
                      >
                        {t('dash.notifications.view')}
                      </button>
                      {!notif.read && (
                        <button
                          onClick={() => handleMarkRead(notif.id)}
                          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                        >
                          {t('dash.notifications.mark_read')}
                        </button>
                      )}
                    </div>
                  </div>
                  {!notif.read && (
                    <div className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
