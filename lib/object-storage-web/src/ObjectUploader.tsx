import { useEffect, useRef, useState, type ReactNode } from 'react';
import DashboardModal from '@uppy/react/dashboard-modal';
import Uppy, { type UploadResult, type UppyFile } from '@uppy/core';

import '@uppy/core/css/style.min.css';
import '@uppy/dashboard/css/style.min.css';

import AwsS3 from '@uppy/aws-s3';

interface ObjectUploaderProps {
  maxNumberOfFiles?: number;
  maxFileSize?: number;
  /**
   * MIME types accepted by the picker (e.g. ['image/jpeg', 'image/png']).
   * Mirrors the server-side allow-list for fast client feedback — the
   * server still re-validates, since this can be bypassed.
   */
  allowedFileTypes?: string[];
  /**
   * Function to get upload parameters for each file.
   * IMPORTANT: This receives the file object - use file.name, file.size, file.type
   * to request per-file presigned URLs from your backend.
   */
  onGetUploadParameters: (
    file: UppyFile<Record<string, unknown>, Record<string, unknown>>,
  ) => Promise<{
    method: 'PUT';
    url: string;
    headers?: Record<string, string>;
  }>;
  /**
   * Called with the successfully-uploaded files once Uppy's PUT to the
   * presigned URL finishes. May return a Promise (e.g. to await the
   * server-side "register this upload" call) — the modal stays open with
   * controls disabled until it settles, so the user never sees the dialog
   * close (which reads as "success") before that call has actually
   * confirmed the upload.
   */
  onComplete?: (
    result: UploadResult<Record<string, unknown>, Record<string, unknown>>,
  ) => void | Promise<void>;
  buttonClassName?: string;
  children: ReactNode;
}

/**
 * A file upload component that renders as a button and provides a modal interface for
 * file management.
 *
 * Features:
 * - Renders as a customizable button that opens a file upload modal
 * - Provides a modal interface for:
 *   - File selection
 *   - File preview
 *   - Upload progress tracking
 *   - Upload status display
 *
 * The component uses Uppy v5 under the hood to handle all file upload functionality.
 * All file management features are automatically handled by the Uppy dashboard modal.
 *
 * @param props - Component props
 * @param props.maxNumberOfFiles - Maximum number of files allowed to be uploaded
 *   (default: 1)
 * @param props.maxFileSize - Maximum file size in bytes (default: 10MB)
 * @param props.onGetUploadParameters - Function to get upload parameters for each file.
 *   Receives the UppyFile object with file.name, file.size, file.type properties.
 *   Use these to request per-file presigned URLs from your backend. Returns method,
 *   url, and optional headers for the upload request.
 * @param props.onComplete - Callback function called when upload is complete. Typically
 *   used to make post-upload API calls to update server state and set object ACL
 *   policies.
 * @param props.buttonClassName - Optional CSS class name for the button
 * @param props.children - Content to be rendered inside the button
 */
export function ObjectUploader({
  maxNumberOfFiles = 1,
  maxFileSize = 10485760, // 10MB default
  allowedFileTypes,
  onGetUploadParameters,
  onComplete,
  buttonClassName,
  children,
}: ObjectUploaderProps) {
  const onCompleteRef = useRef(onComplete);
  const onGetUploadParametersRef = useRef(onGetUploadParameters);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);
  useEffect(() => {
    onGetUploadParametersRef.current = onGetUploadParameters;
  }, [onGetUploadParameters]);

  const [showModal, setShowModal] = useState(false);
  // True while we're awaiting the caller's onComplete (e.g. the API call
  // that registers the upload server-side). The dashboard modal stays open
  // and the trigger button is disabled during this window so the user
  // never sees a "closed" state that reads as success before the upload is
  // actually confirmed.
  const [finalizing, setFinalizing] = useState(false);
  const [uppy] = useState(() =>
    new Uppy({
      restrictions: {
        maxNumberOfFiles,
        maxFileSize,
        allowedFileTypes,
      },
      autoProceed: false,
      // Bilingual (AR/EN) restriction-violation messages: this app has no
      // language toggle on the dashboard, and Uppy's built-in strings are
      // English-only by default, so type/size rejections were previously
      // shown to Arabic-speaking offices in English only.
      locale: {
        // Uppy requires a pluralize function that maps a count → plural-form
        // index. Keys 0 = singular (n=1), 1 = plural (n≠1) — matches both
        // the Arabic and English strings defined below.
        pluralize: (n: number) => (n === 1 ? 0 : 1),
        strings: {
          exceedsSize: '%{file} حجمه أكبر من الحد المسموح %{size} / exceeds the maximum allowed size of %{size}',
          youCanOnlyUploadFileTypes: 'الأنواع المسموحة فقط: %{types} / You can only upload: %{types}',
          youCanOnlyUploadX: {
            0: 'يمكنك رفع ملف واحد فقط / You can only upload %{smart_count} file',
            1: 'يمكنك رفع %{smart_count} ملفات فقط / You can only upload %{smart_count} files',
          },
        },
      },
    })
      .use(AwsS3, {
        shouldUseMultipart: false,
        // The same-origin upload relay intentionally allows one in-flight
        // upload per provider account to cap server memory usage. Uppy's
        // default parallelism makes a normal multi-file gallery batch send
        // the second PUT before the first finishes, so the relay correctly
        // rejects it with 429 upload_in_progress. Queue files one at a time
        // to match that backend contract while preserving batch selection.
        limit: 1,
        getUploadParameters: (file) => onGetUploadParametersRef.current(file),
      })
      .on('complete', async (result) => {
        const hasSuccess = (result.successful?.length ?? 0) > 0;
        const hasFailure = (result.failed?.length ?? 0) > 0;

        if (hasSuccess) {
          setFinalizing(true);
          try {
            await onCompleteRef.current?.(result);
          } finally {
            setFinalizing(false);
          }
          // Reset completed files so reopening the dashboard for another
          // upload starts clean. Without this, Uppy keeps already-completed
          // files in its internal state, and re-triggering an upload run
          // (e.g. the user opens the modal again and clicks upload) could
          // re-fire this handler for the same file and register a
          // duplicate record server-side.
          uppy.clear();
        }

        // If nothing failed, close the modal — the upload is fully done.
        // If something failed, leave it open so the user can see Uppy's
        // own error/retry UI for the failed file(s) instead of the dialog
        // silently disappearing, which would look like a stall.
        if (!hasFailure) {
          setShowModal(false);
        }
      }),
  );

  return (
    <div>
      <button
        onClick={() => setShowModal(true)}
        className={buttonClassName}
        disabled={finalizing}
      >
        {children}
      </button>

      <DashboardModal
        uppy={uppy}
        open={showModal}
        onRequestClose={() => {
          if (!finalizing) setShowModal(false);
        }}
        proudlyDisplayPoweredByUppy={false}
      />
    </div>
  );
}
