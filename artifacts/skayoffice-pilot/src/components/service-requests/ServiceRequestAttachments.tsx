import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, Loader2, Paperclip } from 'lucide-react';
import { ObjectUploader } from '@workspace/object-storage-web';
import {
  getGetServiceRequestAttachmentsQueryKey,
  registerServiceRequestAttachment,
  requestServiceRequestAttachmentUploadUrl,
  useGetServiceRequestAttachments,
  type ServiceRequestAttachmentItem,
} from '@workspace/api-client-react';
import { useI18n } from '@/lib/i18n';
import { authFetch } from '@/lib/sessionToken';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;

function humanFileSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.ceil(bytes / 1024)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface ServiceRequestAttachmentsProps {
  requestId: number;
  canUpload: boolean;
  testIdPrefix?: string;
}

/**
 * Compact, lazily loaded private attachment list. The upload flow reuses the
 * existing Uppy + presigned object-storage path; direct API calls use authFetch
 * so production bearer sessions work even where platform cookies are removed.
 */
export function ServiceRequestAttachments({
  requestId,
  canUpload,
  testIdPrefix = 'service-request',
}: ServiceRequestAttachmentsProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const objectPaths = useRef(new Map<string, string>());
  const { data, isLoading } = useGetServiceRequestAttachments(requestId, {
    query: { enabled: open },
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({
      queryKey: getGetServiceRequestAttachmentsQueryKey(requestId),
    });
  };

  const downloadAttachment = async (attachment: ServiceRequestAttachmentItem) => {
    setDownloadingId(attachment.id);
    setError('');
    try {
      const response = await authFetch(attachment.downloadUrl);
      if (!response.ok) {
        throw new Error('download_failed');
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = attachment.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      setError(t('sr.attachment_download_error'));
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <>
      <Button
        size="sm"
        type="button"
        variant="outline"
        className="gap-1.5"
        onClick={() => {
          setError('');
          setOpen(true);
        }}
        data-testid={`${testIdPrefix}-attachments-${requestId}`}
      >
        <Paperclip size={14} />
        {t('sr.attachments')}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('sr.attachments')}</DialogTitle>
            <DialogDescription>{t('sr.attachment_private_note')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {canUpload && (
              <div className="rounded-lg border border-dashed bg-muted/20 p-3">
                <p className="mb-2 text-xs text-muted-foreground">
                  {t('sr.attachment_upload_hint')}
                </p>
                <ObjectUploader
                  maxNumberOfFiles={5}
                  maxFileSize={MAX_FILE_SIZE}
                  allowedFileTypes={[...ACCEPTED_TYPES]}
                  buttonClassName="inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  onGetUploadParameters={async (file) => {
                    setError('');
                    const contentType = file.type as (typeof ACCEPTED_TYPES)[number];
                    if (!file.size || file.size < 1) {
                      throw new Error('invalid_attachment_size');
                    }
                    const result = await requestServiceRequestAttachmentUploadUrl(
                      requestId,
                      {
                        name: file.name,
                        size: file.size,
                        contentType,
                      },
                    );
                    objectPaths.current.set(file.id, result.objectPath);
                    return {
                      method: 'PUT',
                      url: result.uploadURL,
                      headers: { 'Content-Type': contentType },
                    };
                  }}
                  onComplete={async (result) => {
                    try {
                      for (const file of result.successful ?? []) {
                        const objectPath = objectPaths.current.get(file.id);
                        if (!objectPath) throw new Error('missing_attachment_path');
                        await registerServiceRequestAttachment(requestId, objectPath);
                      }
                      objectPaths.current.clear();
                      await refresh();
                    } catch (uploadError: any) {
                      setError(uploadError?.data?.error || t('sr.attachment_upload_error'));
                      throw uploadError;
                    }
                  }}
                >
                  <Paperclip size={13} className="me-1.5" />
                  {t('sr.add_attachments')}
                </ObjectUploader>
              </div>
            )}

            {isLoading ? (
              <div className="flex items-center gap-2 py-5 text-sm text-muted-foreground">
                <Loader2 size={15} className="animate-spin" />
                {t('common.loading')}
              </div>
            ) : data?.items.length ? (
              <ul className="divide-y rounded-lg border">
                {data.items.map((attachment) => (
                  <li key={attachment.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{attachment.fileName}</p>
                      <p className="text-xs text-muted-foreground">
                        {humanFileSize(attachment.fileSize)} · {attachment.uploaderRole === 'office'
                          ? t('sr.attachment_from_office')
                          : t('sr.attachment_from_customer')}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="shrink-0 gap-1"
                      onClick={() => downloadAttachment(attachment)}
                      disabled={downloadingId === attachment.id}
                      data-testid={`${testIdPrefix}-attachment-download-${attachment.id}`}
                    >
                      {downloadingId === attachment.id
                        ? <Loader2 size={14} className="animate-spin" />
                        : <Download size={14} />}
                      {t('sr.download_attachment')}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-dashed py-5 text-center text-sm text-muted-foreground">
                {t('sr.no_attachments')}
              </p>
            )}
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}