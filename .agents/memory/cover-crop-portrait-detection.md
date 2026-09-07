---
name: Cover crop portrait detection
description: How portrait QC cover images are handled — crop dialog, server-side extract, and the data flow between client and server.
---

## Problem
Portrait images uploaded as Quick Card covers were center-cropped automatically to 16:9, cutting off important content (faces, logos, subjects at top/bottom).

## Fix: two-phase crop flow
1. **Client detects orientation** from `File.naturalWidth/naturalHeight` after Uppy upload completes.
2. **CoverCropDialog appears** (always shown for QC cover, not just portrait) — `react-image-crop` with `aspect={16/9}` enforced; portrait images also show a warning banner.
3. User confirms a crop region OR skips (falls back to automatic center-crop).
4. **PATCH /api/offices/me/quick-card-cover** now accepts optional `cropRegion: { left, top, width, height }` (natural pixel coordinates, post-EXIF-rotation space).
5. **Server**: `processAndStoreVariants()` accepts `options.cropRegion`. If valid, calls `sharp.extract(cropRegion)` AFTER `.rotate()` BEFORE resize. Invalid/out-of-bounds region silently falls back to center-crop.
6. Original image is always preserved privately in GCS as `variants.original`.

## Key files
- `artifacts/skayoffice-pilot/src/components/dashboard/CoverCropDialog.tsx` — NEW crop UI
- `artifacts/skayoffice-pilot/src/pages/dashboard/sections/Media.tsx` — intercepts onComplete
- `artifacts/api-server/src/lib/imageProcessor.ts` — accepts CropRegion, validates, extracts
- `artifacts/api-server/src/routes/offices.ts` — parses cropRegion from body
- `artifacts/skayoffice-pilot/src/lib/i18n.ts` — 5 new keys: crop_title, crop_hint, crop_confirm, crop_skip, portrait_crop_warning

## Why crop coordinates are safe
Browsers and sharp both apply EXIF rotation. Client crops are expressed in post-rotation space (what the user sees). `sharp(buffer).rotate()` produces the same post-rotation space. So crop coordinates transferred from client to server are directly usable with `sharp.extract()`.

## Coordinate scaling
react-image-crop's `onComplete` gives a `PixelCrop` in DISPLAYED pixel space (browser rendered size). To convert to natural pixels: `scaleX = img.naturalWidth / img.width`, then `Math.round(pixelCrop.x * scaleX)`.

## Validation
Server validates: left ≥ 0, top ≥ 0, width ≥ 100, height ≥ 56, left+width ≤ effectiveW, top+height ≤ effectiveH. Bad crop silently falls back to center-crop, never returns an error to the user.

## react-image-crop dependency
- Installed in `artifacts/skayoffice-pilot` as `react-image-crop` (v11+)
- CSS imported inside the component: `import 'react-image-crop/dist/ReactCrop.css'`
