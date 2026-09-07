/**
 * ImageLightbox — fullscreen image viewer for the public Decision Card.
 *
 * Features:
 *  - Pinch-to-zoom, double-tap zoom, pan (clamped)
 *  - Horizontal swipe to navigate when not zoomed
 *  - Desktop prev/next arrow buttons + keyboard (←  →  Esc)
 *  - Image counter (n / total)
 *  - X close button; scroll lock while open
 *  - Zoom + pan reset on image change or close
 *  - RTL-aware: swipe direction, arrow positions, and chevron icons are flipped
 *
 * Touch events are attached as native listeners with { passive: false } so we
 * can call e.preventDefault() during pinch/pan without browser warnings.
 * All mutable state accessed in those handlers is mirrored in refs so there
 * are no stale closures.
 *
 * Only applies to public Decision Card images — not Quick Cards, dashboard,
 * admin pages, or upload previews.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

// ── Public types ─────────────────────────────────────────────────────────────

export interface LightboxImage {
  id: string | number;
  /** Path component passed to `/api/storage${url}` — same convention as MediaItem. */
  url: string;
}

interface ImageLightboxProps {
  images: LightboxImage[];
  initialIndex?: number;
  open: boolean;
  onClose: () => void;
  officeName?: string;
  /** Keep the image itself within a comfortable inspection viewport. */
  comfortableViewport?: boolean;
  /** Return keyboard focus to the control that opened the viewer. */
  restoreFocusRef?: React.RefObject<HTMLElement | null>;
  /** Enable backdrop dismissal for viewers that opt into it. */
  closeOnBackdropClick?: boolean;
}

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_ZOOM = 4;
const DOUBLE_TAP_ZOOM = 2.5;
/** Max ms between taps to count as a double-tap. */
const DOUBLE_TAP_MS = 300;
/** Max px movement between taps to still count as double-tap. */
const DOUBLE_TAP_PX = 44;
/** Min px of horizontal movement to register as a swipe. */
const SWIPE_THRESHOLD = 50;

// ── Helpers ──────────────────────────────────────────────────────────────────

function touchDist(t1: Touch, t2: Touch) {
  return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
}

/**
 * Clamp a pan offset so the image never slides completely off screen.
 * The clamping envelope scales with zoom level: at 2× zoom, the image is
 * twice as large, so you can pan up to half the viewport in each direction.
 */
function clampPan(x: number, y: number, z: number) {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 390;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 844;
  const maxX = Math.max(0, ((z - 1) / 2) * vw);
  const maxY = Math.max(0, ((z - 1) / 2) * vh);
  return {
    x: Math.max(-maxX, Math.min(maxX, x)),
    y: Math.max(-maxY, Math.min(maxY, y)),
  };
}

// ── Component ────────────────────────────────────────────────────────────────

export function ImageLightbox({
  images,
  initialIndex = 0,
  open,
  onClose,
  officeName = '',
  comfortableViewport = false,
  restoreFocusRef,
  closeOnBackdropClick = false,
}: ImageLightboxProps) {
  const { t, language } = useI18n();
  const isRTL = language === 'ar';

  // ── React state (drives re-renders) ────────────────────────────────────────
  const [index, setIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  // ── Always-current refs (no stale closures in native event handlers) ────────
  // Pattern: assign `.current = value` during render — always in sync.
  const isRTLRef = useRef(isRTL);
  isRTLRef.current = isRTL;
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // These are kept in sync with state so handlers always read the latest value.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const panRef = useRef(pan);
  panRef.current = pan;
  const wasOpenRef = useRef(false);
  const imageRef = useRef<HTMLImageElement>(null);

  // ── Purely mutable gesture tracking (no React state — no re-render needed) ─
  const gestureRef = useRef<{
    type: 'idle' | 'pan' | 'pinch' | 'swipe';
    startX: number;
    startY: number;
    startPanX: number;
    startPanY: number;
    startDist: number;
    startZoom: number;
  }>({
    type: 'idle',
    startX: 0, startY: 0,
    startPanX: 0, startPanY: 0,
    startDist: 0, startZoom: 1,
  });
  const lastTapRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Navigation — stable, safe to capture in effects ────────────────────────
  const navigate = useCallback((delta: number) => {
    setIndex((prev) => {
      const next = Math.max(0, Math.min(imagesRef.current.length - 1, prev + delta));
      if (next === prev) return prev;
      // Reset view immediately; refs are updated so subsequent handlers see the
      // correct state even before the next render.
      setZoom(1);   zoomRef.current = 1;
      setPan({ x: 0, y: 0 }); panRef.current = { x: 0, y: 0 };
      return next;
    });
  }, []);

  // ── Sync index + reset view when the viewer is opened ─────────────────────
  useEffect(() => {
    if (open) {
      setIndex(initialIndex);
      setZoom(1);   zoomRef.current = 1;
      setPan({ x: 0, y: 0 }); panRef.current = { x: 0, y: 0 };
      lastTapRef.current = null;
    }
  }, [open, initialIndex]);

  // ── Scroll lock ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const saved = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = saved; };
  }, [open]);

  // Restore focus to the image trigger after the viewer closes.
  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      return;
    }
    if (!wasOpenRef.current || !restoreFocusRef) return;
    wasOpenRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      restoreFocusRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, restoreFocusRef]);

  // ── Keyboard (Escape / Arrow keys) ─────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onCloseRef.current(); return; }
      // ArrowLeft/ArrowRight navigate in visual direction; RTL flips the logical mapping.
      if (e.key === 'ArrowLeft')  navigate(isRTLRef.current ?  1 : -1);
      if (e.key === 'ArrowRight') navigate(isRTLRef.current ? -1 :  1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, navigate]);

  // ── Touch events (native, passive:false so we can preventDefault) ───────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !open) return;

    const onStart = (e: TouchEvent) => {
      const g = gestureRef.current;

      if (e.touches.length === 2) {
        // Pinch start
        g.type = 'pinch';
        g.startDist = touchDist(e.touches[0], e.touches[1]);
        g.startZoom = zoomRef.current;
        e.preventDefault();
        return;
      }

      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      const now = Date.now();

      // Double-tap detection
      const last = lastTapRef.current;
      if (
        last &&
        now - last.time < DOUBLE_TAP_MS &&
        Math.abs(touch.clientX - last.x) < DOUBLE_TAP_PX &&
        Math.abs(touch.clientY - last.y) < DOUBLE_TAP_PX
      ) {
        e.preventDefault();
        const newZoom = zoomRef.current > 1 ? 1 : DOUBLE_TAP_ZOOM;
        setZoom(newZoom);   zoomRef.current = newZoom;
        setPan({ x: 0, y: 0 }); panRef.current = { x: 0, y: 0 };
        lastTapRef.current = null;
        g.type = 'idle';
        return;
      }
      lastTapRef.current = { x: touch.clientX, y: touch.clientY, time: now };

      // Determine gesture type from current zoom level
      g.type = zoomRef.current > 1 ? 'pan' : 'swipe';
      g.startX = touch.clientX;
      g.startY = touch.clientY;
      g.startPanX = panRef.current.x;
      g.startPanY = panRef.current.y;
    };

    const onMove = (e: TouchEvent) => {
      const g = gestureRef.current;

      if (g.type === 'pinch' && e.touches.length === 2) {
        e.preventDefault();
        const d = touchDist(e.touches[0], e.touches[1]);
        const newZoom = Math.min(MAX_ZOOM, Math.max(1, g.startZoom * (d / g.startDist)));
        setZoom(newZoom); zoomRef.current = newZoom;
        if (newZoom <= 1) {
          setPan({ x: 0, y: 0 }); panRef.current = { x: 0, y: 0 };
        }
        return;
      }

      if (g.type === 'pan' && e.touches.length === 1) {
        e.preventDefault();
        const touch = e.touches[0];
        const newPan = clampPan(
          g.startPanX + (touch.clientX - g.startX),
          g.startPanY + (touch.clientY - g.startY),
          zoomRef.current,
        );
        setPan(newPan); panRef.current = newPan;
        return;
      }
      // swipe type: no preventDefault — browser handles native scroll momentum
    };

    const onEnd = (e: TouchEvent) => {
      const g = gestureRef.current;

      if (g.type === 'swipe' && e.changedTouches.length === 1) {
        const touch = e.changedTouches[0];
        const dx = touch.clientX - g.startX;
        const dy = touch.clientY - g.startY;
        // Require predominately horizontal movement
        if (Math.abs(dx) >= SWIPE_THRESHOLD && Math.abs(dx) >= Math.abs(dy) * 1.5) {
          // dx < 0: finger moved left (swipe left)
          // LTR: left swipe = next; right swipe = prev
          // RTL: left swipe = prev; right swipe = next (mirrors carousel convention)
          navigate(dx < 0
            ? (isRTLRef.current ? -1 :  1)
            : (isRTLRef.current ?  1 : -1));
        }
      }

      // Snap back to 1× if pinch released near min zoom
      if (g.type === 'pinch' && zoomRef.current < 1.1) {
        setZoom(1); zoomRef.current = 1;
        setPan({ x: 0, y: 0 }); panRef.current = { x: 0, y: 0 };
      }

      g.type = 'idle';
    };

    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove',  onMove,  { passive: false });
    el.addEventListener('touchend',   onEnd,   { passive: false });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove',  onMove);
      el.removeEventListener('touchend',   onEnd);
    };
  }, [open, navigate]);

  // ── Render ──────────────────────────────────────────────────────────────────
  if (!open || images.length === 0) return null;

  const image   = images[index];
  const showNav = images.length > 1;
  // Chevron icons and arrow positions are flipped in RTL to match the carousel convention.
  const PrevIcon = isRTL ? ChevronRight : ChevronLeft;
  const NextIcon = isRTL ? ChevronLeft  : ChevronRight;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={officeName}
      className="fixed inset-0 z-[9999] flex flex-col bg-black select-none"
    >
      {/* ── Header: counter (centred) + X button (end) ─────────────────────── */}
      <div
        className="relative flex shrink-0 items-center justify-center px-12 py-2 min-h-[52px]"
        // Reserve extra top space for iOS notch / Dynamic Island.
        style={{ paddingTop: 'max(8px, env(safe-area-inset-top, 8px))' }}
        onClick={(event) => {
          if (closeOnBackdropClick && event.target === event.currentTarget) onClose();
        }}
      >
        {showNav && (
          <span className="rounded-full bg-white/15 px-3 py-0.5 text-sm font-medium tabular-nums text-white/90 leading-6">
            {index + 1} / {images.length}
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className="absolute end-2 top-1/2 -translate-y-1/2 flex h-11 w-11 cursor-pointer items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/30 active:bg-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* ── Image area ─────────────────────────────────────────────────────── */}
      <div
        ref={containerRef}
        className="relative min-h-0 flex-1 overflow-hidden"
        style={{ touchAction: 'none' }}
        onClick={(event) => {
          if (closeOnBackdropClick && event.target === event.currentTarget) onClose();
        }}
      >
        <img
          ref={imageRef}
          key={image.id}
          src={`/api/storage${image.url}`}
          alt={officeName}
          draggable={false}
          style={{
            position: 'absolute',
            inset: 0,
            width: comfortableViewport ? 'min(92vw, 1100px)' : '100%',
            height: comfortableViewport ? 'min(78dvh, 760px)' : '100%',
            margin: comfortableViewport ? 'auto' : undefined,
            objectFit: 'contain',
            // Apply zoom then translate. Dividing pan by zoom keeps the pixel
            // offset in the pre-zoom coordinate space so the image stays centred.
            transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
            transformOrigin: 'center center',
            willChange: 'transform',
            // Smooth snap-back to 1× zoom; no transition during active gesture.
            transition: zoom === 1 ? 'transform 0.2s ease-out' : 'none',
            userSelect: 'none',
             pointerEvents: closeOnBackdropClick ? 'auto' : 'none',
          } as React.CSSProperties}
          onClick={closeOnBackdropClick ? (event) => {
            const imageElement = imageRef.current;
            const container = containerRef.current;
            if (!imageElement || !container || !imageElement.naturalWidth || !imageElement.naturalHeight) return;

            // The object-contain box fills its area, so calculate the actual
            // rendered image rectangle to distinguish the backdrop from the image.
            const box = imageElement.getBoundingClientRect();
            const imageRatio = imageElement.naturalWidth / imageElement.naturalHeight;
            const boxRatio = box.width / box.height;
            const renderedWidth = boxRatio > imageRatio ? box.height * imageRatio : box.width;
            const renderedHeight = boxRatio > imageRatio ? box.height : box.width / imageRatio;
            const renderedLeft = box.left + (box.width - renderedWidth) / 2;
            const renderedTop = box.top + (box.height - renderedHeight) / 2;
            const isOutsideImage =
              event.clientX < renderedLeft ||
              event.clientX > renderedLeft + renderedWidth ||
              event.clientY < renderedTop ||
              event.clientY > renderedTop + renderedHeight;

            if (isOutsideImage) onClose();
          } : undefined}
        />
      </div>

      {/* ── Desktop prev / next arrows (hidden on touch-only mobile) ──────── */}
      {showNav && (
        <>
          {/* Prev — ltr:left / rtl:right; PrevIcon chevron direction is also flipped */}
          <button
            type="button"
            onClick={() => navigate(-1)}
            disabled={index === 0}
            aria-label={t('lightbox.prev_image')}
            className="absolute inset-y-0 ltr:left-3 rtl:right-3 hidden sm:flex items-center"
          >
            <span
              className={[
                'flex h-11 w-11 items-center justify-center rounded-full',
                'bg-black/40 text-white backdrop-blur-sm transition hover:bg-black/60',
                index === 0 ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer',
              ].join(' ')}
            >
              <PrevIcon className="h-6 w-6" />
            </span>
          </button>

          {/* Next — ltr:right / rtl:left */}
          <button
            type="button"
            onClick={() => navigate(1)}
            disabled={index >= images.length - 1}
            aria-label={t('lightbox.next_image')}
            className="absolute inset-y-0 ltr:right-3 rtl:left-3 hidden sm:flex items-center"
          >
            <span
              className={[
                'flex h-11 w-11 items-center justify-center rounded-full',
                'bg-black/40 text-white backdrop-blur-sm transition hover:bg-black/60',
                index >= images.length - 1 ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer',
              ].join(' ')}
            >
              <NextIcon className="h-6 w-6" />
            </span>
          </button>
        </>
      )}
    </div>
  );
}
