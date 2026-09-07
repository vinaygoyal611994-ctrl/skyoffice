/**
 * Server-side image processing pipeline for SkayOffice media uploads.
 *
 * Responsibilities:
 *  - Validate real image format (via sharp metadata, not filename/MIME)
 *  - Reject corrupted files, unsupported formats, images below minimum
 *    resolution, and files exceeding the size limit
 *  - Auto-rotate images using EXIF orientation metadata
 *  - Strip ALL EXIF / metadata (GPS, device info, camera settings)
 *  - Re-encode as optimised WebP variants sized per use case
 *  - Preserve the original GCS object privately for recovery
 *
 * Business rules enforced here:
 *  - No generative AI alteration of image content
 *  - No background removal, no filters, no colour manipulation
 *  - Only technical optimisation and EXIF-based orientation correction
 */
import sharp, { type Metadata as SharpMetadata } from 'sharp';
import { ObjectStorageService } from './objectStorage';

// Minimum dimensions required before processing.
// Prevents thumbnails of postage-stamp images.
const MIN_WIDTH = 400;
const MIN_HEIGHT = 300;

// Maximum file size accepted for processing (matches UPLOAD_LIMITS for images)
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// Real formats sharp can parse as raster images.
// SVG is intentionally absent — SVG can embed scripts.
const SUPPORTED_FORMATS = new Set([
  'jpeg', 'png', 'webp', 'tiff', 'avif', 'heif', 'gif',
]);

export type ImageVariantCategory =
  | 'quick_card_cover'
  | 'decision_card_cover'
  | 'decision_gallery'
  | 'works';

export const QUICK_CARD_IMAGE_SPEC = {
  aspect: 25 / 9,
  thumbnail: { width: 600, height: 216 },
  medium: { width: 1200, height: 432 },
} as const;

export const DECISION_CARD_IMAGE_SPEC = {
  aspect: 7 / 3,
  thumbnail: { width: 420, height: 180 },
  display: { width: 1400, height: 600 },
} as const;

/** Portfolio Works render in a 4:3 frame. */
export const WORKS_IMAGE_SPEC = {
  thumbnail: { width: 480, height: 360 },
  display: { width: 1200, height: 900 },
} as const;

/**
 * Variant paths stored in the `variants` JSONB column.
 *
 * `original`  — raw upload path; private, never returned to public callers.
 * `thumbnail` — small optimised variant for list cards / previews.
 * `medium`    — 1200×432 25:9 crop; quick_card_cover only.
 * `display`   — 1400×600 7:3 crop; gallery / DC cover only.
 */
export interface ImageVariants {
  original: string;
  thumbnail: string;
  medium?: string;
  display?: string;
}

/** Subset safe to return in public API responses (no raw path). */
export type PublicImageVariants = Omit<ImageVariants, 'original'>;

/** Strip the private `original` path before including variants in API responses. */
export function toPublicVariants(v: ImageVariants): PublicImageVariants {
  const { original: _orig, ...pub } = v;
  return pub;
}

// ── Result types ───────────────────────────────────────────────────────────

interface ProcessSuccess {
  ok: true;
  variants: ImageVariants;
}

interface ProcessFailure {
  ok: false;
  /** HTTP status to return to the client (always 422 for validation failures). */
  status: 422;
  code:
    | 'file_not_readable'
    | 'invalid_format'
    | 'file_too_large'
    | 'below_minimum_resolution'
    | 'image_processing_failed';
  error: string;
}

export type ProcessResult = ProcessSuccess | ProcessFailure;

function fail(
  code: ProcessFailure['code'],
  error: string,
): ProcessFailure {
  return { ok: false, status: 422, code, error };
}

// ── Main orchestrator ──────────────────────────────────────────────────────

/**
 * Pixel-space crop region in the **post-EXIF-rotation** image coordinate
 * space.  The browser applies EXIF rotation when displaying an image, and the
 * client's crop coordinates are expressed in that same post-rotation space.
 * Sharp's `.rotate()` also produces a post-rotation buffer, so coordinates
 * are directly comparable.
 */
export interface CropRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Reads, validates, processes and stores optimised WebP variants for an
 * image that was previously uploaded by the client via signed URL.
 *
 * Never throws for expected validation failures; those are returned as
 * typed `ProcessFailure` values. Only throws on truly unexpected internal
 * errors (network loss to GCS, OOM from a pathological image, etc.).
 *
 * @param options.cropRegion  Optional user-specified crop (quick_card_cover
 *   only).  When provided the server extracts only the selected region before
 *   resizing, replacing the default automatic center-crop.  The server
 *   validates the region against the actual image dimensions and ignores
 *   malformed or out-of-bounds values (falls back to center-crop).
 */
export async function processAndStoreVariants(
  rawObjectPath: string,
  category: ImageVariantCategory,
  storageService: ObjectStorageService,
  options?: { cropRegion?: CropRegion },
): Promise<ProcessResult> {
  // ── Download raw upload (with propagation-lag retry) ────────────────────
  // Objects uploaded via signed URL can take a few seconds to become
  // readable in some environments. Retry up to 8 times with 600 ms backoff
  // (4.8 s max) before concluding the file is genuinely unreadable.
  let buffer: Buffer | null = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const storageObject =
        await storageService.getObjectEntityFile(rawObjectPath);
      buffer = await storageService.downloadObjectBuffer(storageObject);
      break;
    } catch {
      if (attempt < 7) {
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
    }
  }
  if (!buffer) {
    return fail(
      'file_not_readable',
      'Uploaded file could not be read from storage. Please try uploading again.',
    );
  }

  if (buffer.length === 0) {
    return fail('invalid_format', 'Uploaded file is empty.');
  }

  if (buffer.length > MAX_IMAGE_BYTES) {
    const mb = (MAX_IMAGE_BYTES / 1024 / 1024).toFixed(0);
    return fail('file_too_large', `Image exceeds the ${mb} MB size limit.`);
  }

  // ── Format & dimension validation ────────────────────────────────────────
  // Use sharp's metadata() to detect the REAL format — not the filename or
  // MIME header that the client declared. This is the security-critical step:
  // it rejects SVG (script injection), executables disguised as images, and
  // any content sharp cannot parse as a raster image.
  let meta: SharpMetadata;
  try {
    meta = await sharp(buffer).metadata();
  } catch {
    return fail(
      'invalid_format',
      'File is not a supported image format or is corrupted. Supported formats: JPEG, PNG, WebP.',
    );
  }

  if (!meta.format || !SUPPORTED_FORMATS.has(meta.format)) {
    return fail(
      'invalid_format',
      `Unsupported image format "${meta.format ?? 'unknown'}". Supported formats: JPEG, PNG, WebP.`,
    );
  }

  const srcW = meta.width ?? 0;
  const srcH = meta.height ?? 0;

  // For EXIF-rotated images, sharp reports the pre-rotation dimensions.
  // The effective dimensions after .rotate() may be transposed (portrait↔landscape).
  // Use the smaller of (w, h) vs (h, w) to evaluate the minimum requirement
  // consistently, regardless of EXIF orientation.
  const effectiveW = meta.orientation && meta.orientation >= 5 ? srcH : srcW;
  const effectiveH = meta.orientation && meta.orientation >= 5 ? srcW : srcH;

  if (effectiveW < MIN_WIDTH || effectiveH < MIN_HEIGHT) {
    return fail(
      'below_minimum_resolution',
      `Image resolution is too low. Minimum required: ${MIN_WIDTH}×${MIN_HEIGHT} px. ` +
        `Uploaded: ${effectiveW}×${effectiveH} px.`,
    );
  }

  // ── Validate optional crop region ───────────────────────────────────────
  // Supported for all image categories:
  //   quick_card_cover    → 25:9 output
  //   decision_card_cover → 7:3 output
  //   decision_gallery    → 7:3 output
  //   works               → 4:3 output
  // When absent, all image categories fall back to a server-side automatic
  // center-crop at their customer-facing ratio.
  let validatedCrop: CropRegion | undefined;

  if (options?.cropRegion && (
    category === 'quick_card_cover' ||
    category === 'decision_card_cover' ||
    category === 'decision_gallery' ||
    category === 'works'
  )) {
    const { left, top, width, height } = options.cropRegion;

    // Minimum crop size varies by category so rounding artefacts don't produce
    // a degenerate extract region. Decision Card crops permit a smaller region
    // than Quick Card crops because the source image may be portrait.
    const minW = category === 'quick_card_cover' ? 100 : 60;
    const minH = category === 'quick_card_cover' ? 56 : 22;

    const isValid =
      Number.isFinite(left) && left >= 0 &&
      Number.isFinite(top) && top >= 0 &&
      Number.isFinite(width) && width >= minW &&
      Number.isFinite(height) && height >= minH &&
      left + width <= effectiveW &&
      top + height <= effectiveH;

    if (isValid) {
      validatedCrop = {
        left: Math.round(left),
        top: Math.round(top),
        width: Math.round(width),
        height: Math.round(height),
      };
    }
    // If the region is out-of-bounds or too small, fall back to the default
    // center-crop pipeline for that category. This handles browser rounding
    // artefacts and malformed payloads without returning an error to the user.
  }

  // ── Generate variants ────────────────────────────────────────────────────
  try {
    // .rotate() with no arguments reads the EXIF orientation and physically
    // rotates the pixels. The output has no EXIF orientation tag.
    // Omitting .withMetadata() strips ALL metadata (EXIF, GPS, ICC, XMP).
    //
    // When the user has provided a crop region, extract only that region
    // before resizing — this is the core fix for portrait images.
    // Without a crop region the old automatic center-crop behaviour is
    // preserved so existing uploads and non-portrait images are unaffected.
    const mkBase = () => {
      const pipeline = sharp(buffer!).rotate();
      if (validatedCrop) {
        return pipeline.extract(validatedCrop);
      }
      return pipeline;
    };

    let variants: ImageVariants;

    if (category === 'quick_card_cover') {
      // 25:9 landscape output. When a user-selected crop is applied the
      // extracted region is already (approximately) 25:9, so fit:'cover'
      // only performs a minimal safety trim to reach the exact target size.
      // Without a crop region the centre-gravity cover crop is used, which
      // is the pre-existing automatic behaviour.
      const [thumbBuf, mediumBuf] = await Promise.all([
        mkBase()
          .resize(
            QUICK_CARD_IMAGE_SPEC.thumbnail.width,
            QUICK_CARD_IMAGE_SPEC.thumbnail.height,
            { fit: 'cover', position: 'centre' },
          )
          .webp({ quality: 82 })
          .toBuffer(),
        mkBase()
          .resize(
            QUICK_CARD_IMAGE_SPEC.medium.width,
            QUICK_CARD_IMAGE_SPEC.medium.height,
            { fit: 'cover', position: 'centre' },
          )
          .webp({ quality: 82 })
          .toBuffer(),
      ]);

      const [thumbnailPath, mediumPath] = await Promise.all([
        storageService.saveObjectEntity(thumbBuf, 'image/webp', 'thumb'),
        storageService.saveObjectEntity(mediumBuf, 'image/webp', 'medium'),
      ]);

      variants = {
        original: rawObjectPath,
        thumbnail: thumbnailPath,
        medium: mediumPath,
      };
    } else if (
      (category === 'decision_card_cover' || category === 'decision_gallery') &&
      validatedCrop
    ) {
      // Decision Card cover OR gallery — user supplied a crop region.
      // Both categories share the same 7:3 target dimensions since they
      // both render inside the MarketingScreen aspect-[7/3] container.
      // The extracted region is already (approximately) 7:3, so fit:'cover'
      // performs only a minimal safety trim to reach the exact target size.
      // Output: 1400×600 display variant + 420×180 thumbnail (both exact 7:3).
      const [displayBuf, thumbBuf] = await Promise.all([
        mkBase()
          .resize(
            DECISION_CARD_IMAGE_SPEC.display.width,
            DECISION_CARD_IMAGE_SPEC.display.height,
            { fit: 'cover', position: 'centre' },
          )
          .webp({ quality: 82 })
          .toBuffer(),
        mkBase()
          .resize(
            DECISION_CARD_IMAGE_SPEC.thumbnail.width,
            DECISION_CARD_IMAGE_SPEC.thumbnail.height,
            { fit: 'cover', position: 'centre' },
          )
          .webp({ quality: 80 })
          .toBuffer(),
      ]);

      const [displayPath, thumbnailPath] = await Promise.all([
        storageService.saveObjectEntity(displayBuf, 'image/webp', 'display'),
        storageService.saveObjectEntity(thumbBuf, 'image/webp', 'thumb'),
      ]);

      variants = {
        original: rawObjectPath,
        thumbnail: thumbnailPath,
        display: displayPath,
      };
    } else if (category === 'decision_card_cover') {
      // No crop region supplied (or invalid): auto-center to 7:3.
      // Always produce an exact 7:3 output so the MarketingScreen never needs
      // to crop the generated image again.
      const [displayBuf, thumbBuf] = await Promise.all([
        mkBase()
          .resize(
            DECISION_CARD_IMAGE_SPEC.display.width,
            DECISION_CARD_IMAGE_SPEC.display.height,
            { fit: 'cover', position: 'centre' },
          )
          .webp({ quality: 82 })
          .toBuffer(),
        mkBase()
          .resize(
            DECISION_CARD_IMAGE_SPEC.thumbnail.width,
            DECISION_CARD_IMAGE_SPEC.thumbnail.height,
            { fit: 'cover', position: 'centre' },
          )
          .webp({ quality: 80 })
          .toBuffer(),
      ]);

      const [displayPath, thumbnailPath] = await Promise.all([
        storageService.saveObjectEntity(displayBuf, 'image/webp', 'display'),
        storageService.saveObjectEntity(thumbBuf, 'image/webp', 'thumb'),
      ]);

      variants = {
        original: rawObjectPath,
        thumbnail: thumbnailPath,
        display: displayPath,
      };
    } else if (category === 'works') {
      // Works is an independent 4:3 portfolio surface.
      const [displayBuf, thumbBuf] = await Promise.all([
        mkBase().resize(WORKS_IMAGE_SPEC.display.width, WORKS_IMAGE_SPEC.display.height,
          { fit: 'cover', position: 'centre' }).webp({ quality: 82 }).toBuffer(),
        mkBase().resize(WORKS_IMAGE_SPEC.thumbnail.width, WORKS_IMAGE_SPEC.thumbnail.height,
          { fit: 'cover', position: 'centre' }).webp({ quality: 80 }).toBuffer(),
      ]);
      const [displayPath, thumbnailPath] = await Promise.all([
        storageService.saveObjectEntity(displayBuf, 'image/webp', 'display'),
        storageService.saveObjectEntity(thumbBuf, 'image/webp', 'thumb'),
      ]);
      variants = { original: rawObjectPath, thumbnail: thumbnailPath, display: displayPath };
    } else {
      // decision_gallery (no crop / invalid crop): automatic 7:3 center-crop.
      // This makes the persisted output match the public frame rather than
      // deferring an invisible second crop to CSS object-cover.
      const [displayBuf, thumbBuf] = await Promise.all([
        mkBase()
          .resize(
            DECISION_CARD_IMAGE_SPEC.display.width,
            DECISION_CARD_IMAGE_SPEC.display.height,
            { fit: 'cover', position: 'centre' },
          )
          .webp({ quality: 82 })
          .toBuffer(),
        mkBase()
          .resize(
            DECISION_CARD_IMAGE_SPEC.thumbnail.width,
            DECISION_CARD_IMAGE_SPEC.thumbnail.height,
            { fit: 'cover', position: 'centre' },
          )
          .webp({ quality: 80 })
          .toBuffer(),
      ]);

      const [displayPath, thumbnailPath] = await Promise.all([
        storageService.saveObjectEntity(displayBuf, 'image/webp', 'display'),
        storageService.saveObjectEntity(thumbBuf, 'image/webp', 'thumb'),
      ]);

      variants = {
        original: rawObjectPath,
        thumbnail: thumbnailPath,
        display: displayPath,
      };
    }

    return { ok: true, variants };
  } catch (err) {
    return fail(
      'image_processing_failed',
      'Image processing failed. Please try uploading the file again.',
    );
  }
}

// ── Cleanup helper ─────────────────────────────────────────────────────────

/**
 * Best-effort deletion of ALL GCS objects in an image variants record,
 * including the private original.  Logs per-path failures but never throws
 * so a storage hiccup during cleanup never fails the surrounding request.
 *
 * Call when a media item is explicitly replaced or deleted by the user/admin.
 */
export async function deleteImageVariants(
  variants: ImageVariants | Record<string, string> | null | undefined,
  storageService: ObjectStorageService,
  logger?: { warn: (data: object, msg: string) => void },
): Promise<void> {
  if (!variants) return;

  const paths = [
    (variants as ImageVariants).original,
    (variants as ImageVariants).thumbnail,
    (variants as ImageVariants).medium,
    (variants as ImageVariants).display,
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);

  await Promise.allSettled(
    paths.map(async (p) => {
      try {
        await storageService.deleteObjectEntity(p);
      } catch (err) {
        logger?.warn({ err, path: p }, 'image-processor: failed to delete variant');
      }
    }),
  );
}
