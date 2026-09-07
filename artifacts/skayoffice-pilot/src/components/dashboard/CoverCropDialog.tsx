/**
 * CoverCropDialog — lets the user choose a specific visible area of an image
 * before it is committed to the server.
 *
 * Generalised to support any crop aspect ratio:
 *  - Quick Card cover: aspect={25/9}
 *  - Decision Card cover/gallery: aspect={7/3}
 *
 * Always shown for uploads regardless of orientation:
 *  - Portrait images: displays an optional warning banner (pass `portraitWarningText`).
 *  - Landscape / square images: shown without the warning so the user can still
 *    fine-tune which part of the image is visible.
 *
 * The crop coordinates returned by onConfirm are in NATURAL pixel space
 * (relative to the original, EXIF-rotated image dimensions as the browser
 * displays them), ready to be forwarded to the server's sharp .extract() call.
 */

import React, { useCallback, useRef, useState } from 'react';
import ReactCrop, {
  centerCrop,
  makeAspectCrop,
  type Crop,
  type PixelCrop,
} from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { useI18n } from '@/lib/i18n';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Crop as CropIcon } from 'lucide-react';

export interface CropRegion {
  /** Pixel offset from the LEFT edge of the original image. */
  left: number;
  /** Pixel offset from the TOP edge of the original image. */
  top: number;
  /** Width of the crop region in original image pixels. */
  width: number;
  /** Height of the crop region in original image pixels. */
  height: number;
}

interface CoverCropDialogProps {
  open: boolean;
  /** Object URL (URL.createObjectURL) or any URL the browser can render. */
  imageSrc: string;
  /**
   * Crop aspect ratio (width / height).
   * Required so each caller explicitly declares its customer-facing ratio.
   */
  aspect: number;
  /**
   * Dialog title text. Defaults to the Quick Card crop title from i18n.
   */
  title?: string;
  /**
   * Hint text shown below the title. Defaults to the Quick Card crop hint from i18n.
   */
  hint?: string;
  /**
   * Text shown in the portrait-warning banner when the loaded image is taller
   * than it is wide. Omit to suppress the banner entirely.
   * Defaults to the Quick Card portrait-warning from i18n.
   */
  portraitWarningText?: string;
  /**
   * Called when the user confirms their crop selection.
   * The coordinates are in natural image pixel space.
   */
  onConfirm: (region: CropRegion) => void;
  /**
   * Called when the user clicks the "Auto Center Crop" (skip) button.
   * Also called on backdrop/Esc if `onCancel` is not provided.
   */
  onSkip: () => void;
  /**
   * If provided, called instead of `onSkip` when the dialog is closed via the
   * backdrop or Escape key. Useful when cancel should discard the upload
   * entirely (gallery queue) rather than falling back to auto-crop (QC cover).
   */
  onCancel?: () => void;
}

/** Initialise a centered crop that spans 90 % of the image width at the given aspect ratio. */
function makeInitialCrop(mediaWidth: number, mediaHeight: number, aspect: number): Crop {
  return centerCrop(
    makeAspectCrop({ unit: '%', width: 90 }, aspect, mediaWidth, mediaHeight),
    mediaWidth,
    mediaHeight,
  );
}

export function CoverCropDialog({
  open,
  imageSrc,
  aspect,
  title: titleProp,
  hint: hintProp,
  portraitWarningText,
  onConfirm,
  onSkip,
  onCancel,
}: CoverCropDialogProps) {
  const { t } = useI18n();
  const title = titleProp ?? t('dashboard.media.crop_title');
  const hint = hintProp ?? t('dashboard.media.crop_hint');
  // Fall back to the built-in QC warning text if the caller didn't override it.
  const resolvedPortraitWarning =
    portraitWarningText !== undefined
      ? portraitWarningText
      : t('dashboard.media.portrait_crop_warning');

  const imgRef = useRef<HTMLImageElement>(null);
  const [crop, setCrop] = useState<Crop | undefined>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop | undefined>();
  // Portrait is detected once the image loads inside the dialog itself,
  // avoiding any async work in the parent's onComplete handler.
  const [isPortrait, setIsPortrait] = useState(false);

  /** Initialise the crop once the image element has loaded and its size is known. */
  const handleImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const { naturalWidth, naturalHeight } = e.currentTarget;
      setIsPortrait(naturalHeight > naturalWidth);
      setCrop(makeInitialCrop(naturalWidth, naturalHeight, aspect));
    },
    [aspect],
  );

  const handleConfirm = () => {
    if (!completedCrop || !imgRef.current) return;

    const img = imgRef.current;
    // Scale from displayed-pixel coordinates → natural-pixel coordinates.
    // The browser may render the image at a different size than its natural
    // dimensions, so we compute the ratio and multiply.
    const scaleX = img.naturalWidth / img.width;
    const scaleY = img.naturalHeight / img.height;

    onConfirm({
      left: Math.round(completedCrop.x * scaleX),
      top: Math.round(completedCrop.y * scaleY),
      width: Math.round(completedCrop.width * scaleX),
      height: Math.round(completedCrop.height * scaleY),
    });
  };

  // Reset crop state whenever the dialog opens with a new image.
  React.useEffect(() => {
    if (open) {
      setCrop(undefined);
      setCompletedCrop(undefined);
      setIsPortrait(false);
    }
  }, [open, imageSrc]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // Treat dialog close (backdrop click / Esc) as cancel (if provided)
        // or as a skip (auto-crop fallback) if no separate cancel handler exists.
        if (!o) (onCancel ?? onSkip)();
      }}
    >
      <DialogContent className="flex max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <DialogHeader className="shrink-0 border-b px-4 py-3 pe-12">
          <DialogTitle className="flex items-center gap-2 text-base">
            <CropIcon className="h-4 w-4 shrink-0 text-primary" />
            {title}
          </DialogTitle>
        </DialogHeader>

        {/* ── Portrait warning ─────────────────────────────────────────── */}
        {isPortrait && resolvedPortraitWarning && (
          <div className="flex shrink-0 items-start gap-2 border-b bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{resolvedPortraitWarning}</p>
          </div>
        )}

        {/* ── Hint ────────────────────────────────────────────────────── */}
        <p className="shrink-0 px-4 pb-1 pt-3 text-center text-xs text-muted-foreground">
          {hint}
        </p>

        {/* ── Crop canvas ─────────────────────────────────────────────── */}
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-neutral-100 p-4 dark:bg-neutral-900">
          <ReactCrop
            crop={crop}
            onChange={(_, percentCrop) => setCrop(percentCrop)}
            onComplete={(pixelCrop) => setCompletedCrop(pixelCrop)}
            aspect={aspect}
            minWidth={60}
            keepSelection
          >
            {/* eslint-disable-next-line jsx-a11y/img-redundant-alt */}
            <img
              ref={imgRef}
              src={imageSrc}
              alt="crop preview"
              onLoad={handleImageLoad}
              style={{
                maxHeight: '55vh',
                maxWidth: '100%',
                display: 'block',
                objectFit: 'contain',
              }}
            />
          </ReactCrop>
        </div>

        {/* ── Action row ──────────────────────────────────────────────── */}
        {/*
          Two-button bar. Cancel is intentionally absent here — the × in the
          dialog header handles close/cancel on all screen sizes.

          Both buttons share the full available width equally (flex-1 min-w-0)
          so neither clips or causes horizontal overflow on narrow mobile screens
          (320 px and up), including in Arabic where labels are longer.
          h-auto + min-h-9 + whitespace-normal allow multi-word labels to wrap
          to a second line rather than overflow the button boundary.
        */}
        <div className="flex shrink-0 gap-2 border-t px-4 py-3">
          {/* Secondary — Auto Center Crop */}
          <Button
            variant="outline"
            size="sm"
            className="h-auto min-h-9 min-w-0 flex-1 whitespace-normal py-1.5 text-center leading-tight"
            onClick={onSkip}
          >
            {t('dashboard.media.crop_skip')}
          </Button>

          {/* Primary — Use This Selection */}
          <Button
            size="sm"
            className="h-auto min-h-9 min-w-0 flex-1 whitespace-normal py-1.5 text-center leading-tight"
            onClick={handleConfirm}
            disabled={!completedCrop || completedCrop.width < 1 || completedCrop.height < 1}
          >
            <CropIcon className="me-1.5 h-3.5 w-3.5 shrink-0" />
            {t('dashboard.media.crop_confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
