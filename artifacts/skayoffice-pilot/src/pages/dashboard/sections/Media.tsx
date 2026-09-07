import React, { useRef, useState, useCallback } from 'react';
import { useI18n } from '@/lib/i18n';
import { CoverCropDialog, type CropRegion } from '@/components/dashboard/CoverCropDialog';
import {
  useGetMyOffice, useUpdateMyOffice, useAddMyOfficeMedia, useRemoveMyOfficeMedia,
  useSetMyOfficeMarketingVideo, useRemoveMyOfficeMarketingVideo, useSetMyOfficePrimaryMedia,
  getGetMyOfficeQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { ObjectUploader } from '@workspace/object-storage-web';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  ImagePlus, Plus, Trash2, Video, FileImage, Star, Film, Loader2,
  AlertTriangle, Clock, CheckCircle2, XCircle, ArrowUp, ArrowDown,
} from 'lucide-react';
import { authFetch } from '@/lib/sessionToken';
import { safeApiError } from '@/lib/apiError';
import { buildStoragePutParameters } from '@/lib/uploadParameters';

const UPLOAD_CATEGORY_LIMITS = {
  cover: { allowedFileTypes: ['image/jpeg', 'image/png', 'image/webp'], maxFileSize: 8 * 1024 * 1024 },
  quick_card_cover: { allowedFileTypes: ['image/jpeg', 'image/png', 'image/webp'], maxFileSize: 8 * 1024 * 1024 },
  decision_card_cover: { allowedFileTypes: ['image/jpeg', 'image/png', 'image/webp'], maxFileSize: 8 * 1024 * 1024 },
  gallery_image: { allowedFileTypes: ['image/jpeg', 'image/png', 'image/webp'], maxFileSize: 8 * 1024 * 1024 },
  works_image: { allowedFileTypes: ['image/jpeg', 'image/png', 'image/webp'], maxFileSize: 8 * 1024 * 1024 },
  gallery_video: { allowedFileTypes: ['video/mp4', 'video/webm', 'video/quicktime'], maxFileSize: 100 * 1024 * 1024 },
  marketing_video: { allowedFileTypes: ['video/mp4'], maxFileSize: 80 * 1024 * 1024 },
} as const;

const MARKETING_VIDEO_MAX_SECONDS = 75;

class MarketingVideoDurationExceededError extends Error {
  readonly code = 'video_duration_exceeded';

  constructor(durationSeconds: number) {
    super(`Marketing video exceeds the ${MARKETING_VIDEO_MAX_SECONDS}-second limit (${Math.round(durationSeconds)}s).`);
    this.name = 'MarketingVideoDurationExceededError';
  }
}

function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(video.duration); };
    video.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read video file.')); };
    video.src = url;
  });
}

// ── Helper: pending-state notice badge ─────────────────────────────────────
function PendingBadge({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      <Clock className="h-3.5 w-3.5 shrink-0" />
      <span>{label}</span>
    </div>
  );
}

// ── Helper: small image preview tile ───────────────────────────────────────
function ImageTile({
  objectPath,
  thumbnailPath,
  label,
  badge,
  onRemove,
  aspectRatio = '16 / 9',
}: {
  objectPath: string;
  /** Optional thumbnail variant — smaller file for preview grids. Falls back to objectPath. */
  thumbnailPath?: string | null;
  label?: string;
  badge?: React.ReactNode;
  onRemove?: () => void;
  aspectRatio?: string;
}) {
  const displayPath = thumbnailPath ?? objectPath;
  return (
    <div className="relative group rounded-xl overflow-hidden border border-border/60 shadow-sm bg-card" style={{ aspectRatio, width: 200, maxWidth: '100%' }}>
      <img
        src={`/api/storage${displayPath}`}
        alt={label ?? 'preview'}
        loading="lazy"
        decoding="async"
        className="w-full h-full object-cover"
      />
      {badge && (
        <div className="absolute top-1.5 start-1.5">
          {badge}
        </div>
      )}
      {onRemove && (
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <Button size="sm" variant="destructive" className="rounded-full text-xs shadow" onClick={onRemove}>
            <Trash2 size={12} className="me-1" />
          </Button>
        </div>
      )}
    </div>
  );
}

export function MediaSection() {
  const { t, language } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const uploadPathsRef = useRef<Record<string, string>>({});
  const marketingVideoDurationRef = useRef<Record<string, number>>({});
  const [confirmDeleteVideo, setConfirmDeleteVideo] = useState(false);
  const [confirmDeleteQCImage, setConfirmDeleteQCImage] = useState(false);
  const [deletingQCImage, setDeletingQCImage] = useState(false);
  const [confirmDeleteDCCover, setConfirmDeleteDCCover] = useState(false);
  const [confirmDeleteGalleryId, setConfirmDeleteGalleryId] = useState<number | null>(null);
  const [confirmDeleteWorksId, setConfirmDeleteWorksId] = useState<number | null>(null);
  const [qcUploading, setQcUploading] = useState(false);
  const [qcCancelling, setQcCancelling] = useState(false);
  const [settingQcImageId, setSettingQcImageId] = useState<number | null>(null);
  const [reorderingId, setReorderingId] = useState<number | null>(null);

  // ── Quick Card cover crop dialog state ─────────────────────────────────
  // Populated after the user's file has been uploaded to GCS but before the
  // PATCH endpoint is called. Cleared once the crop is confirmed or skipped.
  const [cropDialog, setCropDialog] = useState<{
    objectPath: string;
    objectUrl: string;   // revocable object URL for displaying the image locally
  } | null>(null);

  // ── Decision Card gallery crop queue ────────────────────────────────────
  // When the gallery ObjectUploader completes, image files are queued here
  // (one entry per image).  The dialog shows galleryCropQueue[0]; on each
  // confirm / skip / cancel the front item is shifted off and its object URL
  // is revoked.  Videos bypass the queue entirely.
  const [galleryCropQueue, setGalleryCropQueue] = useState<Array<{
    objectPath: string;
    objectUrl: string;
  }>>([]);

  // ── Decision Card cover crop queue ──────────────────────────────────────
  // Same pattern as galleryCropQueue but for placement='decision_card_cover'.
  // Supports at most one item at a time (single-file upload), but a queue is
  // used for lifecycle consistency (object URL revocation, clear on cancel).
  const [dcCoverCropQueue, setDcCoverCropQueue] = useState<Array<{
    objectPath: string;
    objectUrl: string;
  }>>([]);
  const [worksCropQueue, setWorksCropQueue] = useState<Array<{
    objectPath: string;
    objectUrl: string;
  }>>([]);

  const { data: office, isLoading } = useGetMyOffice();

  const updateMutation = useUpdateMyOffice({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetMyOfficeQueryKey(), data);
        toast({ title: t('common.save'), description: t('dashboard.update_success') });
      },
      onError: (err: any) => {
        toast({
          title: t('dashboard.upload_failed_title'),
          description: safeApiError(err, language, { ar: t('dashboard.upload_failed_desc_generic'), en: t('dashboard.upload_failed_desc_generic') }),
          variant: 'destructive',
        });
      },
    },
  });

  const addMediaMut = useAddMyOfficeMedia({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetMyOfficeQueryKey() }),
      onError: (err: any) => {
        toast({
          title: t('dashboard.upload_failed_title'),
          description: safeApiError(err, language, { ar: t('dashboard.upload_failed_desc_generic'), en: t('dashboard.upload_failed_desc_generic') }),
          variant: 'destructive',
        });
      },
    },
  });

  const removeMediaMut = useRemoveMyOfficeMedia({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetMyOfficeQueryKey() }),
    },
  });

  const setMarketingVideoMut = useSetMyOfficeMarketingVideo({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetMyOfficeQueryKey(), data);
        toast({ title: t('dashboard.video_uploaded_title'), description: t('dashboard.video_uploaded_desc') });
      },
      onError: (err: any) => {
        toast({
          title: t('dashboard.upload_failed_title'),
          description: safeApiError(err, language, { ar: t('dashboard.upload_failed_desc_generic'), en: t('dashboard.upload_failed_desc_generic') }),
          variant: 'destructive',
        });
      },
    },
  });

  const removeMarketingVideoMut = useRemoveMyOfficeMarketingVideo({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetMyOfficeQueryKey(), data);
        toast({ title: t('dashboard.video_deleted_title'), description: t('dashboard.video_deleted_desc') });
      },
      onError: () => {
        toast({
          title: t('dashboard.video_delete_failed_title'),
          description: t('dashboard.video_delete_failed_desc'),
          variant: 'destructive',
        });
      },
    },
  });

  const setPrimaryMediaMut = useSetMyOfficePrimaryMedia({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetMyOfficeQueryKey(), data);
        toast({ title: t('dashboard.primary_media_set_title'), description: t('dashboard.primary_media_set_desc') });
      },
      onError: () => {
        toast({
          title: t('dashboard.primary_media_failed_title'),
          description: t('dashboard.primary_media_failed_desc'),
          variant: 'destructive',
        });
      },
    },
  });

  const makeUploadParamsHandler = (category: keyof typeof UPLOAD_CATEGORY_LIMITS) => async (file: any) => {
    const res = await authFetch('/api/storage/uploads/request-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type, category }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(safeApiError(err, language, { ar: t('dashboard.gallery_upload_rejected'), en: t('dashboard.gallery_upload_rejected') }));
    }
    const data = await res.json();
    uploadPathsRef.current[file.id] = data.objectPath;
    return buildStoragePutParameters(data.uploadURL, file.type);
  };

  const handleGalleryUploadParams = async (file: any) => {
    const category = file.type?.startsWith('video/') ? 'gallery_video' : 'gallery_image';
    return makeUploadParamsHandler(category)(file);
  };

  const handleMarketingVideoUploadParams = async (file: any) => {
    const rawFile: File | undefined = file.data instanceof File ? file.data : undefined;
    if (rawFile) {
      try {
        const duration = await readVideoDuration(rawFile);
        if (duration > MARKETING_VIDEO_MAX_SECONDS) {
          throw new MarketingVideoDurationExceededError(duration);
        }
        marketingVideoDurationRef.current[file.id] = Math.round(duration);
      } catch (err) {
        if (err instanceof MarketingVideoDurationExceededError) throw err;
      }
    }
    return makeUploadParamsHandler('marketing_video')(file);
  };

  // Freelancer: immediately set the Quick Card image from an approved gallery item.
  const handleSetQuickCardImage = async (mediaId: number) => {
    setSettingQcImageId(mediaId);
    try {
      const res = await authFetch(`/api/offices/me/media/${mediaId}/quick-card-image`, { method: 'PATCH' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: t('dashboard.upload_failed_title'), description: safeApiError(err, language, { ar: t('dashboard.upload_failed_desc_generic'), en: t('dashboard.upload_failed_desc_generic') }), variant: 'destructive' });
        return;
      }
      const updated = await res.json();
      queryClient.setQueryData(getGetMyOfficeQueryKey(), updated);
      toast({ title: t('common.save'), description: t('dashboard.update_success') });
    } finally {
      setSettingQcImageId(null);
    }
  };

  // Submit a quick-card-cover via the dedicated endpoint (not the legacy PATCH /offices/me).
  // cropRegion is optional: when provided the server uses it instead of automatic center-crop.
  const handleQuickCardCoverComplete = useCallback(async (
    objectPath: string,
    cropRegion?: CropRegion,
  ) => {
    setQcUploading(true);
    try {
      const body: Record<string, unknown> = { objectPath };
      if (cropRegion) body.cropRegion = cropRegion;

      const res = await authFetch('/api/offices/me/quick-card-cover', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: t('dashboard.upload_failed_title'), description: safeApiError(err, language, { ar: t('dashboard.upload_failed_desc_generic'), en: t('dashboard.upload_failed_desc_generic') }), variant: 'destructive' });
        return;
      }
      const updated = await res.json();
      queryClient.setQueryData(getGetMyOfficeQueryKey(), updated);
      toast({ title: t('common.save'), description: t('dashboard.update_success') });
    } finally {
      setQcUploading(false);
    }
  }, [queryClient, t, toast]);

  /** Dismiss the QC cover crop dialog and revoke the temporary object URL. */
  const closeCropDialog = useCallback(() => {
    setCropDialog((prev) => {
      if (prev) URL.revokeObjectURL(prev.objectUrl);
      return null;
    });
  }, []);

  // ── Gallery crop helpers ────────────────────────────────────────────────

  /**
   * POST a gallery image to /api/offices/me/media.
   * cropRegion is optional: when provided the server applies it before resize;
   * when absent the server applies an automatic 7:3 center-crop.
   */
  const submitGalleryImage = useCallback(async (
    objectPath: string,
    cropRegion?: CropRegion,
  ) => {
    const body: Record<string, unknown> = { objectPath, type: 'image' };
    if (cropRegion) body.cropRegion = cropRegion;
    const res = await authFetch('/api/offices/me/media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast({
        title: t('dashboard.upload_failed_title'),
        description: safeApiError(err, language, { ar: t('dashboard.upload_failed_desc_generic'), en: t('dashboard.upload_failed_desc_generic') }),
        variant: 'destructive',
      });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: getGetMyOfficeQueryKey() });
  }, [queryClient, t, toast]);

  /**
   * Shift the front item off the gallery crop queue and revoke its object URL.
   * Call after every confirm / skip / cancel to move to the next image.
   */
  const advanceGalleryCrop = useCallback(() => {
    setGalleryCropQueue((prev) => {
      if (prev[0]) URL.revokeObjectURL(prev[0].objectUrl);
      return prev.slice(1);
    });
  }, []);

  // ── DC cover crop helpers ───────────────────────────────────────────────

  /**
   * POST a Decision Card cover image to /api/offices/me/media.
   * cropRegion is optional: when provided the server extracts that region then
   * resizes to 1400×600; when absent the server auto-center-crops to 7:3.
   */
  const submitDCCoverImage = useCallback(async (
    objectPath: string,
    cropRegion?: CropRegion,
  ) => {
    const body: Record<string, unknown> = {
      objectPath,
      type: 'image',
      placement: 'decision_card_cover',
    };
    if (cropRegion) body.cropRegion = cropRegion;
    const res = await authFetch('/api/offices/me/media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast({
        title: t('dashboard.upload_failed_title'),
        description: safeApiError(err, language, { ar: t('dashboard.upload_failed_desc_generic'), en: t('dashboard.upload_failed_desc_generic') }),
        variant: 'destructive',
      });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: getGetMyOfficeQueryKey() });
    toast({ title: t('common.save'), description: t('dashboard.update_success') });
  }, [queryClient, t, toast]);

  const submitWorksImage = useCallback(async (objectPath: string, cropRegion?: CropRegion) => {
    const body: Record<string, unknown> = { objectPath, type: 'image', placement: 'works' };
    if (cropRegion) body.cropRegion = cropRegion;
    const res = await authFetch('/api/offices/me/media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast({
        title: t('dashboard.upload_failed_title'),
        description: safeApiError(err, language, { ar: t('dashboard.upload_failed_desc_generic'), en: t('dashboard.upload_failed_desc_generic') }),
        variant: 'destructive',
      });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: getGetMyOfficeQueryKey() });
  }, [queryClient, t, toast]);

  /**
   * Shift the front item off the DC cover crop queue and revoke its object URL.
   * Call after every confirm / skip / cancel.
   */
  const advanceDCCoverCrop = useCallback(() => {
    setDcCoverCropQueue((prev) => {
      if (prev[0]) URL.revokeObjectURL(prev[0].objectUrl);
      return prev.slice(1);
    });
  }, []);

  const advanceWorksCrop = useCallback(() => {
    setWorksCropQueue((prev) => {
      if (prev[0]) URL.revokeObjectURL(prev[0].objectUrl);
      return prev.slice(1);
    });
  }, []);

  const handleDeleteApprovedQCImage = async () => {
    setDeletingQCImage(true);
    try {
      const res = await authFetch('/api/offices/me/quick-card-image', { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({
          title: t('dashboard.upload_failed_title'),
          description: safeApiError(err, language, { ar: t('dashboard.upload_failed_desc_generic'), en: t('dashboard.upload_failed_desc_generic') }),
          variant: 'destructive',
        });
        return;
      }
      const updated = await res.json();
      queryClient.setQueryData(getGetMyOfficeQueryKey(), updated);
      toast({ title: t('dashboard.media.delete_qc_image_success') });
    } finally {
      setDeletingQCImage(false);
      setConfirmDeleteQCImage(false);
    }
  };

  const handleCancelPendingQC = async () => {
    setQcCancelling(true);
    try {
      const res = await authFetch('/api/offices/me/quick-card-cover/pending', { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: t('dashboard.upload_failed_title'), description: safeApiError(err, language), variant: 'destructive' });
        return;
      }
      const updated = await res.json();
      queryClient.setQueryData(getGetMyOfficeQueryKey(), updated);
    } finally {
      setQcCancelling(false);
    }
  };

  // ── Gallery reorder ─────────────────────────────────────────────────────────
  // Swaps the sort_order of the clicked gallery item with its neighbour.
  // After the server responds with the updated office profile, React Query
  // cache is updated so the gallery re-renders in the new order immediately.
  const handleReorderGallery = async (mediaId: number, direction: 'up' | 'down') => {
    if (!office) return;
    const sorted = [...(office.gallery ?? [])].sort(
      (a, b) => (((a as any).sortOrder ?? a.id) - ((b as any).sortOrder ?? b.id)),
    );
    const idx = sorted.findIndex((g) => g.id === mediaId);
    if (idx < 0) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;

    const a = sorted[idx];
    const b = sorted[swapIdx];
    const aOrder: number = (a as any).sortOrder ?? idx + 1;
    const bOrder: number = (b as any).sortOrder ?? swapIdx + 1;

    setReorderingId(mediaId);
    try {
      const res = await authFetch('/api/offices/me/media/reorder', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ id: a.id, sortOrder: bOrder }, { id: b.id, sortOrder: aOrder }] }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: t('dashboard.upload_failed_title'), description: safeApiError(err, language, { ar: t('dashboard.upload_failed_desc_generic'), en: t('dashboard.upload_failed_desc_generic') }), variant: 'destructive' });
        return;
      }
      const updated = await res.json();
      queryClient.setQueryData(getGetMyOfficeQueryKey(), updated);
    } catch {
      toast({ title: t('dashboard.upload_failed_title'), description: t('dashboard.upload_failed_desc_generic'), variant: 'destructive' });
    } finally {
      setReorderingId(null);
    }
  };

  const handleReorderWorks = async (mediaId: number, direction: 'up' | 'down') => {
    if (!office) return;
    const sorted = [...((office as any).works ?? [])].sort(
      (a: any, b: any) => ((a.sortOrder ?? a.id) - (b.sortOrder ?? b.id)),
    );
    const idx = sorted.findIndex((item: any) => item.id === mediaId);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (idx < 0 || swapIdx < 0 || swapIdx >= sorted.length) return;
    const current = sorted[idx];
    const neighbour = sorted[swapIdx];
    setReorderingId(mediaId);
    try {
      const res = await authFetch('/api/offices/me/media/reorder', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          placement: 'works',
          items: [
            { id: current.id, sortOrder: neighbour.sortOrder ?? swapIdx + 1 },
            { id: neighbour.id, sortOrder: current.sortOrder ?? idx + 1 },
          ],
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: t('dashboard.upload_failed_title'), description: safeApiError(err, language, { ar: t('dashboard.upload_failed_desc_generic'), en: t('dashboard.upload_failed_desc_generic') }), variant: 'destructive' });
        return;
      }
      queryClient.setQueryData(getGetMyOfficeQueryKey(), await res.json());
    } finally {
      setReorderingId(null);
    }
  };


  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-56 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    );
  }

  if (!office) return null;

  // Pending media fields from the extended API response
  const pendingQCCoverUrl: string | null = (office as any).pendingQuickCardCoverUrl ?? null;
  const pendingQCRejection: string | null = (office as any).pendingMediaRejectionReason ?? null;
  const pendingGalleryItems: Array<{
    id: number;
    url: string;
    type: string;
    rejectionReason: string | null;
    variants?: { thumbnail: string; display?: string } | null;
  }> = (office as any).pendingGalleryItems ?? [];
  const pendingDCCovers: Array<{
    id: number;
    url: string;
    type: string;
    rejectionReason: string | null;
    variants?: { thumbnail: string; display?: string } | null;
  }> = (office as any).pendingDecisionCardCovers ?? [];
  const approvedDCCover: {
    id: number;
    url: string;
    type: string;
    variants?: { thumbnail: string; display?: string } | null;
  } | null = (office as any).approvedDecisionCardCover ?? null;
  const sortedWorks = [...((office as any).works ?? [])].sort(
    (a: any, b: any) => ((a.sortOrder ?? a.id) - (b.sortOrder ?? b.id)),
  );
  const pendingWorks: Array<{ id: number; url: string; variants?: { thumbnail: string } | null }> =
    (office as any).pendingWorksItems ?? (office as any).pendingWorks ?? [];
  const isWorksFull = sortedWorks.length + pendingWorks.length >= 4;

  const isFreelancer = office.providerType === 'freelancer';

  // Sort approved gallery items by owner-assigned sort_order, falling back to
  // id for rows that pre-date migration 0021 (sort_order IS NULL on those rows).
  const sortedGallery = [...(office.gallery ?? [])].sort(
    (a, b) => (((a as any).sortOrder ?? a.id) - ((b as any).sortOrder ?? b.id)),
  );
  // Total Decision Card gallery count (approved + pending) — used to enforce
  // the 3-image cap on gallery slots 2–4.
  const galleryItemCount = sortedGallery.length + pendingGalleryItems.length;
  const isGalleryFull = galleryItemCount >= 3;

  return (
    <Tabs defaultValue="quick-card" className="space-y-4">
      <TabsList scrollable className="w-full justify-start">
        <TabsTrigger value="quick-card">{t('dashboard.media.tab_quick_card')}</TabsTrigger>
        <TabsTrigger value="decision-card">{t('dashboard.media.tab_decision_card')}</TabsTrigger>
        <TabsTrigger value="works">{t('dashboard.media.tab_works')}</TabsTrigger>
      </TabsList>

      {/* ── Tab 1: Quick Card ─────────────────────────────────────────── */}
      <TabsContent value="quick-card" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('dashboard.media.qc_title')}</CardTitle>
            <CardDescription>{t('dashboard.media.qc_desc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Rejection notice */}
            {pendingQCRejection && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">{t('dashboard.media.qc_rejected_notice')}</p>
                  <p className="text-xs mt-0.5">{t('dashboard.media.qc_rejection_reason')}: {pendingQCRejection}</p>
                </div>
              </div>
            )}

            {/* Pending notice */}
            {pendingQCCoverUrl && !pendingQCRejection && (
              <PendingBadge label={t('dashboard.media.qc_pending_notice')} />
            )}

            {/* Side-by-side: approved vs pending */}
            <div className="flex flex-wrap gap-4 items-start">
              {/* Approved */}
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">{t('dashboard.media.qc_approved_label')}</p>
                {office.coverUrl ? (
                  <ImageTile
                    objectPath={office.coverUrl}
                    aspectRatio="25 / 9"
                    badge={<Badge className="text-[10px] bg-emerald-500 text-white border-0 px-1.5 py-0"><CheckCircle2 size={9} className="me-1 inline" />{t('common.verified')}</Badge>}
                  />
                ) : (
                  <div className="flex w-40 items-center justify-center rounded-xl border-2 border-dashed border-border/40 bg-muted/20 text-muted-foreground" style={{ aspectRatio: '25 / 9' }}>
                    <FileImage size={24} />
                  </div>
                )}
              </div>

              {/* Pending */}
              {pendingQCCoverUrl && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-amber-600">{t('dashboard.media.qc_pending_label')}</p>
                  <ImageTile
                    objectPath={pendingQCCoverUrl}
                    aspectRatio="25 / 9"
                    badge={<Badge className="text-[10px] bg-amber-500 text-white border-0 px-1.5 py-0"><Clock size={9} className="me-1 inline" />Pending</Badge>}
                  />
                </div>
              )}
            </div>

            {/* Upload & actions row */}
            <div className="flex flex-wrap gap-2 items-center">
              <ObjectUploader
                maxNumberOfFiles={1}
                allowedFileTypes={[...UPLOAD_CATEGORY_LIMITS.quick_card_cover.allowedFileTypes]}
                maxFileSize={UPLOAD_CATEGORY_LIMITS.quick_card_cover.maxFileSize}
                onGetUploadParameters={makeUploadParamsHandler('quick_card_cover')}
                onComplete={async result => {
                  const uppyFile = result.successful?.[0];
                  if (!uppyFile) return;

                  const objectPath = uploadPathsRef.current[uppyFile.id];
                  if (!objectPath) return;

                  // The raw File/Blob is available in the Uppy file's `data`
                  // property.  Create a local object URL immediately (no
                  // async await) so the crop dialog opens the instant Uppy's
                  // complete handler fires — before Uppy closes its modal.
                  const blob: Blob | null =
                    uppyFile.data instanceof Blob ? uppyFile.data : null;

                  if (!blob) {
                    // Fallback: no local blob — skip crop, server auto-crops.
                    void handleQuickCardCoverComplete(objectPath);
                    return;
                  }

                  const objectUrl = URL.createObjectURL(blob);

                  // Portrait detection happens inside CoverCropDialog's own
                  // onLoad handler, keeping this callback fully synchronous.
                  setCropDialog({ objectPath, objectUrl });
                }}
                buttonClassName="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-lg font-medium text-sm transition-colors flex items-center gap-2 shadow-sm"
              >
                {qcUploading ? <Loader2 size={14} className="animate-spin me-1" /> : <ImagePlus size={14} className="me-1" />}
                {t('dashboard.media.qc_upload_btn')}
              </ObjectUploader>

              {pendingQCCoverUrl && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={qcCancelling}
                  onClick={handleCancelPendingQC}
                  className="text-muted-foreground"
                >
                  {qcCancelling ? <Loader2 size={13} className="me-1.5 animate-spin" /> : <XCircle size={13} className="me-1.5" />}
                  {t('dashboard.media.qc_cancel_pending')}
                </Button>
              )}
              {office.coverUrl && (
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={deletingQCImage}
                  onClick={() => setConfirmDeleteQCImage(true)}
                >
                  {deletingQCImage ? <Loader2 size={13} className="me-1.5 animate-spin" /> : <Trash2 size={13} className="me-1.5" />}
                  {t('dashboard.media.delete_qc_image_btn')}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      {/* ── Tab 3: Works (separate from Decision Card gallery) ─────────── */}
      <TabsContent value="works" className="space-y-4">
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <CardTitle className="text-base">{t('dashboard.media.works_title')}</CardTitle>
              <CardDescription>{t('dashboard.media.works_desc')}</CardDescription>
            </div>
            {!isWorksFull && (
              <ObjectUploader
                maxNumberOfFiles={4 - sortedWorks.length - pendingWorks.length}
                maxFileSize={UPLOAD_CATEGORY_LIMITS.works_image.maxFileSize}
                allowedFileTypes={[...UPLOAD_CATEGORY_LIMITS.works_image.allowedFileTypes]}
                onGetUploadParameters={makeUploadParamsHandler('works_image')}
                onComplete={async result => {
                  const images: Array<{ objectPath: string; objectUrl: string }> = [];
                  for (const file of result.successful ?? []) {
                    const objectPath = uploadPathsRef.current[file.id];
                    const blob = file.data instanceof Blob ? file.data : null;
                    if (!objectPath) continue;
                    if (!blob) {
                      await submitWorksImage(objectPath);
                      continue;
                    }
                    images.push({ objectPath, objectUrl: URL.createObjectURL(blob) });
                  }
                  if (images.length) setWorksCropQueue(images);
                }}
                buttonClassName="w-full sm:w-auto shrink-0 justify-center whitespace-nowrap bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-lg font-medium text-sm transition-colors flex items-center gap-2 shadow-sm"
              >
                <Plus size={16} />{t('dashboard.media.works_upload')}
              </ObjectUploader>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {isWorksFull && <PendingBadge label={t('dashboard.media.works_max_reached')} />}
            {pendingWorks.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium text-amber-700">{t('dashboard.media.works_pending')}</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {pendingWorks.map(item => (
                    <ImageTile key={item.id} objectPath={item.url} thumbnailPath={item.variants?.thumbnail} aspectRatio="4 / 3"
                      badge={<Badge className="text-[10px] bg-amber-500 text-white border-0"><Clock size={9} className="me-1" />{t('dashboard.media.status_pending')}</Badge>}
                      onRemove={() => setConfirmDeleteWorksId(item.id)} />
                  ))}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {sortedWorks.map((item: any, idx: number) => (
                <div key={item.id} className="space-y-1.5">
                  <ImageTile objectPath={item.url} thumbnailPath={item.variants?.thumbnail} aspectRatio="4 / 3"
                    badge={<Badge className="text-[10px] bg-emerald-500 text-white border-0"><CheckCircle2 size={9} className="me-1" />{t('dashboard.media.status_approved')}</Badge>}
                    onRemove={() => setConfirmDeleteWorksId(item.id)} />
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" disabled={reorderingId !== null || idx === 0} onClick={() => handleReorderWorks(item.id, 'up')} aria-label={t('dashboard.media.gallery_move_up')}><ArrowUp size={13} /></Button>
                    <Button size="sm" variant="outline" disabled={reorderingId !== null || idx === sortedWorks.length - 1} onClick={() => handleReorderWorks(item.id, 'down')} aria-label={t('dashboard.media.gallery_move_down')}><ArrowDown size={13} /></Button>
                  </div>
                </div>
              ))}
              {sortedWorks.length === 0 && pendingWorks.length === 0 && (
                <div className="col-span-full py-5 text-center text-sm text-muted-foreground sm:py-6">
                  <p>{t('dashboard.media.works_empty')}</p>
                  {!isWorksFull && (
                    <p className="mt-1.5 font-medium text-primary">{t('dashboard.media.works_empty_cta')}</p>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      {/* ── Tab 2: Decision Card ──────────────────────────────────────── */}
      <TabsContent value="decision-card" className="space-y-4">

        {/* Decision Card Hero Image sub-section */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('dashboard.media.dc_cover_title')}</CardTitle>
            <CardDescription>{t('dashboard.media.dc_cover_desc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Approved DC cover */}
            <div className="flex flex-wrap gap-4 items-start">
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">{t('dashboard.media.dc_cover_approved')}</p>
                {approvedDCCover ? (
                  <div className="space-y-2">
                    <ImageTile objectPath={approvedDCCover.url} aspectRatio="7 / 3" badge={<Badge className="text-[10px] bg-emerald-500 text-white border-0 px-1.5 py-0"><CheckCircle2 size={9} className="me-1 inline" />Approved</Badge>} />
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={removeMediaMut.isPending}
                      onClick={() => setConfirmDeleteDCCover(true)}
                    >
                      <Trash2 size={13} className="me-1.5" />
                      {t('dashboard.media.delete_dc_cover_btn')}
                    </Button>
                  </div>
                ) : (
                  <div className="flex w-40 items-center justify-center rounded-xl border-2 border-dashed border-border/40 bg-muted/20 text-muted-foreground" style={{ aspectRatio: '7 / 3' }}>
                    <FileImage size={24} />
                  </div>
                )}
              </div>

              {/* Pending DC covers */}
              {pendingDCCovers.map(item => (
                <div key={item.id} className="space-y-1.5">
                  <p className="text-xs font-medium text-amber-600">{t('dashboard.media.dc_cover_pending')}</p>
                  <ImageTile
                    objectPath={item.url}
                    aspectRatio="7 / 3"
                    badge={<Badge className="text-[10px] bg-amber-500 text-white border-0 px-1.5 py-0"><Clock size={9} className="me-1 inline" />Pending</Badge>}
                    onRemove={() => removeMediaMut.mutate({ mediaId: item.id })}
                  />
                </div>
              ))}
            </div>

            {pendingDCCovers.length > 0 ? (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <Clock className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{t('dashboard.media.dc_cover_pending_exists')}</span>
              </div>
            ) : (
              <ObjectUploader
                maxNumberOfFiles={1}
                allowedFileTypes={[...UPLOAD_CATEGORY_LIMITS.decision_card_cover.allowedFileTypes]}
                maxFileSize={UPLOAD_CATEGORY_LIMITS.decision_card_cover.maxFileSize}
                onGetUploadParameters={makeUploadParamsHandler('decision_card_cover')}
                onComplete={result => {
                  const uppyFile = result.successful?.[0];
                  if (!uppyFile) return;

                  const objectPath = uploadPathsRef.current[uppyFile.id];
                  if (!objectPath) return;

                  // Build a local object URL so the crop dialog can render the
                  // image without waiting for GCS propagation.
                  const blob: Blob | null =
                    uppyFile.data instanceof Blob ? uppyFile.data : null;

                  if (!blob) {
                    // No local blob — skip crop dialog, let server auto-center-crop.
                    void submitDCCoverImage(objectPath);
                    return;
                  }

                  const objectUrl = URL.createObjectURL(blob);
                  setDcCoverCropQueue((prev) => [...prev, { objectPath, objectUrl }]);
                }}
                buttonClassName="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-lg font-medium text-sm transition-colors flex items-center gap-2 shadow-sm"
              >
                <ImagePlus size={14} className="me-1" />
                {t('dashboard.media.dc_cover_upload')}
              </ObjectUploader>
            )}
          </CardContent>
        </Card>

        {/* Marketing video sub-section */}
        <Card data-testid="card-marketing-video">
          <CardHeader className="flex flex-row items-center justify-between border-b pb-4 flex-wrap gap-2">
            <div>
              <CardTitle className="text-base">{t('dashboard.marketing_video')}</CardTitle>
              <CardDescription>{t('dashboard.marketing_video_desc')}</CardDescription>
            </div>
            {!office.marketingVideoUrl && (
              <ObjectUploader
                maxNumberOfFiles={1}
                maxFileSize={UPLOAD_CATEGORY_LIMITS.marketing_video.maxFileSize}
                allowedFileTypes={[...UPLOAD_CATEGORY_LIMITS.marketing_video.allowedFileTypes]}
                onGetUploadParameters={handleMarketingVideoUploadParams}
                onComplete={async result => {
                  if (result.successful && result.successful[0]) {
                    const file = result.successful[0];
                    const path = uploadPathsRef.current[file.id];
                    try {
                      await setMarketingVideoMut.mutateAsync({
                        data: {
                          objectPath: path,
                          mimeType: file.type || 'video/mp4',
                          size: file.size || 0,
                          duration: marketingVideoDurationRef.current[file.id],
                        },
                      });
                    } catch { /* toast already fired */ }
                  }
                }}
                buttonClassName="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-lg font-medium text-sm transition-colors flex items-center gap-2 shadow-sm"
              >
                <Plus size={16} />
                {t('dashboard.marketing_video_upload')}
              </ObjectUploader>
            )}
          </CardHeader>
          <CardContent className="pt-5">
            {office.marketingVideoUrl ? (
              <div className="flex flex-col sm:flex-row items-start gap-4">
                <div className="w-full sm:w-56 aspect-video rounded-xl overflow-hidden border bg-slate-900 shrink-0" data-testid="preview-marketing-video">
                  <video
                    src={`/api/storage${office.marketingVideoUrl}`}
                    poster={office.coverUrl ? `/api/storage${office.coverUrl}` : undefined}
                    preload="none"
                    controls
                    playsInline
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="flex-1 space-y-3">
                  <p className="text-sm text-muted-foreground">
                    {t('dashboard.marketing_video_active')}
                    {office.marketingVideoDuration ? ` · ${office.marketingVideoDuration}${t('dashboard.seconds_suffix')}` : ''}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <ObjectUploader
                      maxNumberOfFiles={1}
                      maxFileSize={UPLOAD_CATEGORY_LIMITS.marketing_video.maxFileSize}
                      allowedFileTypes={[...UPLOAD_CATEGORY_LIMITS.marketing_video.allowedFileTypes]}
                      onGetUploadParameters={handleMarketingVideoUploadParams}
                      onComplete={async result => {
                        if (result.successful && result.successful[0]) {
                          const file = result.successful[0];
                          const path = uploadPathsRef.current[file.id];
                          try {
                            await setMarketingVideoMut.mutateAsync({
                              data: {
                                objectPath: path,
                                mimeType: file.type || 'video/mp4',
                                size: file.size || 0,
                                duration: marketingVideoDurationRef.current[file.id],
                              },
                            });
                          } catch { /* toast already fired */ }
                        }
                      }}
                      buttonClassName="bg-secondary hover:bg-secondary/80 px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-2"
                    >
                      <Film size={14} />
                      {t('dashboard.marketing_video_replace')}
                    </ObjectUploader>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => setConfirmDeleteVideo(true)}
                      disabled={removeMarketingVideoMut.isPending}
                      data-testid="button-delete-marketing-video"
                    >
                      {removeMarketingVideoMut.isPending ? <Loader2 size={14} className="me-1.5 animate-spin" /> : <Trash2 size={14} className="me-1.5" />}
                      {t('dashboard.marketing_video_delete')}
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-10 text-center text-muted-foreground italic border border-dashed rounded-xl bg-muted/5" data-testid="empty-marketing-video">
                {t('dashboard.marketing_video_empty')}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Gallery sub-section — positions 2-4 */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between border-b pb-4 flex-wrap gap-2">
            <div>
              <CardTitle className="text-base">{t('dashboard.media.gallery_title')}</CardTitle>
              <CardDescription>{t('dashboard.media.gallery_desc')}</CardDescription>
            </div>
            {isGalleryFull ? (
              <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 max-w-xs">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span>{t('dashboard.media.gallery_max_reached')}</span>
              </div>
            ) : (
            <ObjectUploader
              maxNumberOfFiles={3}
              maxFileSize={UPLOAD_CATEGORY_LIMITS.gallery_image.maxFileSize}
              allowedFileTypes={[
                ...UPLOAD_CATEGORY_LIMITS.gallery_image.allowedFileTypes,
              ]}
              onGetUploadParameters={handleGalleryUploadParams}
              onComplete={async result => {
                if (!result.successful?.length) return;

                const imageItems: Array<{ objectPath: string; objectUrl: string }> = [];

                for (const file of result.successful) {
                  const objectPath = uploadPathsRef.current[file.id];
                  const isVideo = file.type?.startsWith('video/');

                  if (isVideo) {
                    // Videos bypass the crop queue — submit immediately.
                    try {
                      const res = await authFetch('/api/offices/me/media', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ objectPath, type: 'video' }),
                      });
                      if (res.ok) {
                        await queryClient.invalidateQueries({ queryKey: getGetMyOfficeQueryKey() });
                      } else {
                        const err = await res.json().catch(() => ({}));
                        toast({ title: t('dashboard.upload_failed_title'), description: safeApiError(err, language, { ar: t('dashboard.upload_failed_desc_generic'), en: t('dashboard.upload_failed_desc_generic') }), variant: 'destructive' });
                      }
                    } catch { /* toast fired above */ }
                  } else {
                    // Images: create a local object URL synchronously so the
                    // crop dialog can open without any async delay.
                    const blob: Blob | null = file.data instanceof Blob ? file.data : null;
                    if (!blob) {
                      // No local blob — skip manual selection; server applies a 7:3 center-crop.
                      try { await submitGalleryImage(objectPath); } catch { /* toast fired */ }
                      continue;
                    }
                    const objectUrl = URL.createObjectURL(blob);
                    imageItems.push({ objectPath, objectUrl });
                  }
                }

                // Open the crop dialog for all image files sequentially.
                if (imageItems.length > 0) {
                  setGalleryCropQueue(imageItems);
                }
              }}
              buttonClassName="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-lg font-medium text-sm transition-colors flex items-center gap-2 shadow-sm"
            >
              <Plus size={16} />
              {t('dashboard.gallery_upload')}
            </ObjectUploader>
            )}
          </CardHeader>
          <CardContent className="pt-5 space-y-4">
            {/* Pending gallery items notice */}
            {pendingGalleryItems.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-amber-700 flex items-center gap-1.5">
                  <Clock size={12} />
                  {t('dashboard.media.gallery_pending_section')}
                </p>
                <PendingBadge label={t('dashboard.media.gallery_pending_notice')} />
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {pendingGalleryItems.map(item => (
                    <div key={item.id} className="aspect-square rounded-xl overflow-hidden border bg-muted relative group shadow-sm opacity-70">
                      {item.type === 'video' ? (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-slate-900 text-slate-400">
                          <Video size={28} />
                          <span className="text-[10px] uppercase tracking-wider font-semibold">Video</span>
                        </div>
                      ) : (
                        <img
                          src={`/api/storage${item.variants?.thumbnail ?? item.url}`}
                          alt="Pending gallery"
                          loading="lazy"
                          decoding="async"
                          className="w-full h-full object-cover"
                        />
                      )}
                      <div className="absolute top-1.5 start-1.5">
                        <Badge className="text-[10px] bg-amber-500 text-white border-0 px-1.5 py-0"><Clock size={9} className="me-1 inline" />Pending</Badge>
                      </div>
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <Button
                          variant="destructive"
                          size="sm"
                          className="rounded-full shadow-lg text-xs"
                          onClick={() => removeMediaMut.mutate({ mediaId: item.id })}
                        >
                          <Trash2 size={13} className="me-1" />
                          {t('common.delete')}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Approved gallery items */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {sortedGallery.map((media, idx) => {
                const isPrimary = office.primaryMediaId === media.id;
                // For freelancers, coverUrl is set from gallery (Quick Card Image)
                const isQuickCardImage = isFreelancer && office.coverUrl === media.url;
                const isDecisionCardMain = isFreelancer && isPrimary;
                return (
                  <div key={media.id} className="aspect-square rounded-xl overflow-hidden border bg-muted relative group shadow-sm">
                    {media.type === 'video' ? (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-slate-900 text-slate-400">
                        <Video size={28} />
                        <span className="text-[10px] uppercase tracking-wider font-semibold">Video</span>
                      </div>
                    ) : (
                      <img
                        src={`/api/storage${media.variants?.thumbnail ?? media.url}`}
                        alt="Gallery"
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover"
                      />
                    )}
                    {/* Badges */}
                    {isFreelancer ? (
                      <div className="absolute top-2 start-2 flex flex-col gap-1">
                        {isQuickCardImage && (
                          <div className="flex items-center gap-1 rounded-full bg-sky-500 text-white text-[10px] font-semibold px-2 py-0.5 shadow" data-testid={`badge-quick-card-image-${media.id}`}>
                            <Star size={10} className="fill-current" /> {t('dashboard.media.quick_card_image_badge')}
                          </div>
                        )}
                        {isDecisionCardMain && (
                          <div className="flex items-center gap-1 rounded-full bg-amber-500 text-white text-[10px] font-semibold px-2 py-0.5 shadow" data-testid={`badge-decision-card-main-${media.id}`}>
                            <Star size={10} className="fill-current" /> {t('dashboard.media.decision_card_main_badge')}
                          </div>
                        )}
                      </div>
                    ) : (
                      isPrimary && (
                        <div className="absolute top-2 start-2 flex items-center gap-1 rounded-full bg-amber-500 text-white text-[10px] font-semibold px-2 py-0.5 shadow" data-testid={`badge-primary-media-${media.id}`}>
                          <Star size={10} className="fill-current" /> {t('dashboard.gallery_primary_badge')}
                        </div>
                      )
                    )}
                    <div className="absolute inset-0 bg-black/60 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-2">
                      {isFreelancer ? (
                        <>
                          {!isQuickCardImage && media.type !== 'video' && (
                            <Button
                              variant="secondary"
                              size="sm"
                              className="rounded-full shadow-lg text-xs w-full max-w-[140px]"
                              disabled={settingQcImageId === media.id}
                              onClick={() => handleSetQuickCardImage(media.id)}
                              data-testid={`button-set-quick-card-image-${media.id}`}
                            >
                              {settingQcImageId === media.id
                                ? <Loader2 size={12} className="me-1 animate-spin" />
                                : <Star size={12} className="me-1" />}
                              {t('dashboard.media.set_as_quick_card_image')}
                            </Button>
                          )}
                          {!isDecisionCardMain && (
                            <Button
                              variant="secondary"
                              size="sm"
                              className="rounded-full shadow-lg text-xs w-full max-w-[140px]"
                              disabled={setPrimaryMediaMut.isPending}
                              onClick={() => setPrimaryMediaMut.mutate({ mediaId: media.id })}
                              data-testid={`button-set-primary-media-${media.id}`}
                            >
                              <Star size={12} className="me-1" />
                              {t('dashboard.media.set_as_decision_card_main')}
                            </Button>
                          )}
                        </>
                      ) : (
                        // Reorder buttons for offices (positions 2–4)
                        <div className="flex gap-1.5">
                          <Button
                            variant="secondary"
                            size="sm"
                            className="rounded-full shadow text-xs px-2"
                            disabled={reorderingId !== null || idx === 0}
                            onClick={() => handleReorderGallery(media.id, 'up')}
                            title={t('dashboard.media.gallery_move_up')}
                            data-testid={`button-move-up-${media.id}`}
                          >
                            {reorderingId === media.id
                              ? <Loader2 size={12} className="animate-spin" />
                              : <ArrowUp size={12} />}
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            className="rounded-full shadow text-xs px-2"
                            disabled={reorderingId !== null || idx === sortedGallery.length - 1}
                            onClick={() => handleReorderGallery(media.id, 'down')}
                            title={t('dashboard.media.gallery_move_down')}
                            data-testid={`button-move-down-${media.id}`}
                          >
                            {reorderingId === media.id
                              ? <Loader2 size={12} className="animate-spin" />
                              : <ArrowDown size={12} />}
                          </Button>
                        </div>
                      )}
                      <Button
                        variant="destructive"
                        size="sm"
                        className="rounded-full shadow-lg text-xs"
                        onClick={() => setConfirmDeleteGalleryId(media.id)}
                        data-testid={`button-remove-media-${media.id}`}
                      >
                        <Trash2 size={13} className="me-1" />
                        {t('common.delete')}
                      </Button>
                    </div>
                  </div>
                );
              })}
              {sortedGallery.length === 0 && pendingGalleryItems.length === 0 && (
                <div className="col-span-full py-12 text-center text-muted-foreground italic border border-dashed rounded-xl bg-muted/5 text-sm">
                  {t('dashboard.gallery_empty')}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      {/* ── Quick Card cover crop dialog ──────────────────────────────── */}
      {/* Shown after upload completes, before the PATCH endpoint is called.
          onConfirm → send crop region to server (user-selected 25:9 area).
          onSkip    → call server with no crop region (automatic center-crop).  */}
      {cropDialog && (
        <CoverCropDialog
          open={!!cropDialog}
          imageSrc={cropDialog.objectUrl}
          aspect={25 / 9}
          onConfirm={async (region) => {
            const { objectPath } = cropDialog;
            closeCropDialog();
            await handleQuickCardCoverComplete(objectPath, region);
          }}
          onSkip={async () => {
            const { objectPath } = cropDialog;
            closeCropDialog();
            await handleQuickCardCoverComplete(objectPath);
          }}
        />
      )}

      {/* ── Decision Card gallery crop dialog ─────────────────────────── */}
      {/* Shown for each image in the gallery queue after upload completes.
          aspect={7/3} matches the MarketingScreen carousel in office-profile.
          onConfirm → POST gallery image with user-selected 7:3 crop region.
          onSkip    → POST gallery image with no crop (server auto-center-crops).
          onCancel  → discard this upload entirely (advance to next image).    */}
      <CoverCropDialog
        open={galleryCropQueue.length > 0}
        imageSrc={galleryCropQueue[0]?.objectUrl ?? ''}
        aspect={7 / 3}
        title={t('dashboard.media.gallery_crop_title')}
        hint={t('dashboard.media.gallery_crop_hint')}
        portraitWarningText={t('dashboard.media.gallery_portrait_warning')}
        onConfirm={async (region) => {
          const current = galleryCropQueue[0];
          advanceGalleryCrop();
          if (current) await submitGalleryImage(current.objectPath, region);
        }}
        onSkip={async () => {
          const current = galleryCropQueue[0];
          advanceGalleryCrop();
          if (current) await submitGalleryImage(current.objectPath);
        }}
        onCancel={() => {
          // Cancel this image — revoke URL and advance without submitting.
          advanceGalleryCrop();
        }}
      />

      <CoverCropDialog
        open={worksCropQueue.length > 0}
        imageSrc={worksCropQueue[0]?.objectUrl ?? ''}
        aspect={4 / 3}
        title={t('dashboard.media.works_crop_title')}
        hint={t('dashboard.media.works_crop_hint')}
        onConfirm={async region => { const item = worksCropQueue[0]; advanceWorksCrop(); if (item) await submitWorksImage(item.objectPath, region); }}
        onSkip={async () => { const item = worksCropQueue[0]; advanceWorksCrop(); if (item) await submitWorksImage(item.objectPath); }}
        onCancel={advanceWorksCrop}
      />

      {/* ── Decision Card cover crop dialog ───────────────────────────── */}
      {/* Shown after a DC cover upload completes, before the POST is called.
          aspect={7/3} matches the MarketingScreen aspect-[7/3] container.
          onConfirm → POST DC cover with user-selected 7:3 crop region.
          onSkip    → POST DC cover with no crop (server auto-center-crops).
          onCancel  → discard this upload; revoke the object URL.           */}
      <CoverCropDialog
        open={dcCoverCropQueue.length > 0}
        imageSrc={dcCoverCropQueue[0]?.objectUrl ?? ''}
        aspect={7 / 3}
        title={t('dashboard.media.dc_cover_crop_title')}
        hint={t('dashboard.media.dc_cover_crop_hint')}
        portraitWarningText={t('dashboard.media.dc_cover_portrait_warning')}
        onConfirm={async (region) => {
          const current = dcCoverCropQueue[0];
          advanceDCCoverCrop();
          if (current) await submitDCCoverImage(current.objectPath, region);
        }}
        onSkip={async () => {
          const current = dcCoverCropQueue[0];
          advanceDCCoverCrop();
          if (current) await submitDCCoverImage(current.objectPath);
        }}
        onCancel={() => {
          // Cancel upload — revoke URL and clear without submitting.
          advanceDCCoverCrop();
        }}
      />

      {/* Confirm delete Quick Card image dialog */}
      <AlertDialog open={confirmDeleteQCImage} onOpenChange={setConfirmDeleteQCImage}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('dashboard.media.delete_qc_image_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('dashboard.media.delete_qc_image_confirm_desc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteApprovedQCImage}
            >
              {t('dashboard.media.delete_qc_image_btn')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm delete DC cover image dialog */}
      <AlertDialog open={confirmDeleteDCCover} onOpenChange={setConfirmDeleteDCCover}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('dashboard.media.delete_dc_cover_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('dashboard.media.delete_dc_cover_confirm_desc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const id = approvedDCCover?.id;
                if (!id) { setConfirmDeleteDCCover(false); return; }
                removeMediaMut.mutate({ mediaId: id }, {
                  onSuccess: () => {
                    queryClient.invalidateQueries({ queryKey: getGetMyOfficeQueryKey() });
                    toast({ title: t('dashboard.media.delete_dc_cover_success') });
                    setConfirmDeleteDCCover(false);
                  },
                  onError: (err: any) => {
                    toast({
                      title: t('dashboard.upload_failed_title'),
                      description: safeApiError(err, language, { ar: t('dashboard.upload_failed_desc_generic'), en: t('dashboard.upload_failed_desc_generic') }),
                      variant: 'destructive',
                    });
                    setConfirmDeleteDCCover(false);
                  },
                });
              }}
            >
              {t('dashboard.media.delete_dc_cover_btn')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm delete gallery item dialog */}
      <AlertDialog open={confirmDeleteGalleryId !== null} onOpenChange={(open) => { if (!open) setConfirmDeleteGalleryId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('dashboard.media.delete_gallery_item_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('dashboard.media.delete_gallery_item_confirm_desc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const id = confirmDeleteGalleryId;
                if (!id) return;
                removeMediaMut.mutate({ mediaId: id }, {
                  onSuccess: () => {
                    queryClient.invalidateQueries({ queryKey: getGetMyOfficeQueryKey() });
                    toast({ title: t('dashboard.media.delete_gallery_item_success') });
                    setConfirmDeleteGalleryId(null);
                  },
                  onError: (err: any) => {
                    toast({
                      title: t('dashboard.upload_failed_title'),
                      description: safeApiError(err, language, { ar: t('dashboard.upload_failed_desc_generic'), en: t('dashboard.upload_failed_desc_generic') }),
                      variant: 'destructive',
                    });
                    setConfirmDeleteGalleryId(null);
                  },
                });
              }}
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDeleteWorksId !== null} onOpenChange={(open) => { if (!open) setConfirmDeleteWorksId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('dashboard.media.delete_works_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('dashboard.media.delete_works_confirm_desc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => {
              if (confirmDeleteWorksId) removeMediaMut.mutate({ mediaId: confirmDeleteWorksId }, { onSuccess: () => setConfirmDeleteWorksId(null) });
            }}>{t('common.delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm delete marketing video dialog */}
      <AlertDialog open={confirmDeleteVideo} onOpenChange={setConfirmDeleteVideo}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('dashboard.marketing_video_delete_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('dashboard.marketing_video_delete_confirm_desc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-marketing-video">{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { removeMarketingVideoMut.mutate(); setConfirmDeleteVideo(false); }}
              data-testid="button-confirm-delete-marketing-video"
            >
              {t('dashboard.marketing_video_delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Tabs>
  );
}
