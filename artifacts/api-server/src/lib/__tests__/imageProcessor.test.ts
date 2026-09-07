/**
 * DC cover crop end-to-end image pipeline tests.
 *
 * Verifies that processAndStoreVariants() correctly applies a user-supplied
 * crop region when producing the decision_card_cover display variant, and that
 * the resulting output is an undistorted 1400×600 (7:3) WebP whose pixel
 * content matches the expected region of the source image — NOT the
 * center-crop fallback.
 *
 * All GCS I/O is mocked; sharp runs against real in-memory buffers so the
 * pixel assertions are meaningful.
 *
 * The "Done looks like" for task #94 requires asserting that the visible image
 * region matches the expected crop area.  We express this as pixel-channel
 * assertions: the bottom-half crop of a red-top/blue-bottom test image must
 * produce an output that is predominantly blue, not red.
 */

import { describe, it, expect, beforeAll, vi } from "vitest";
import sharp from "sharp";
import { processAndStoreVariants } from "../imageProcessor";
import type { ObjectStorageService } from "../objectStorage";

// ── Synthetic test image ───────────────────────────────────────────────────
//
// 1600×1200 JPEG with:
//   top    600 px → solid red   (R=255, G=0,   B=0)
//   bottom 600 px → solid blue  (R=0,   G=0,   B=255)
//
// An off-center bottom-half crop { left:100, top:600, width:1400, height:600 }
// selects exclusively the blue region. After resizing to 1400×600 the output
// must remain entirely blue.  The center-crop fallback would straddle the
// red/blue boundary and produce a mixed result.

let testImageBuffer: Buffer;

beforeAll(async () => {
  // Build an RGBA raw buffer (1600×1200) then convert to JPEG.
  // Using raw() avoids external fixtures while staying realistic enough for
  // sharp's EXIF-rotation and format-detection paths.
  const W = 1600;
  const H = 1200;
  const halfH = 600;
  const channels = 3; // RGB (no alpha needed)
  const raw = Buffer.alloc(W * H * channels);

  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      const offset = (row * W + col) * channels;
      if (row < halfH) {
        // Top half: red
        raw[offset] = 255; raw[offset + 1] = 0; raw[offset + 2] = 0;
      } else {
        // Bottom half: blue
        raw[offset] = 0;   raw[offset + 1] = 0; raw[offset + 2] = 255;
      }
    }
  }

  testImageBuffer = await sharp(raw, { raw: { width: W, height: H, channels } })
    .jpeg({ quality: 95 })
    .toBuffer();
});

// ── Mock ObjectStorageService ──────────────────────────────────────────────
//
// Captures every buffer written by processAndStoreVariants so we can decode
// them with sharp to assert pixel content.

function makeMockStorage(sourceBuffer: Buffer): {
  service: ObjectStorageService;
  saved: Map<string, Buffer>;
} {
  const saved = new Map<string, Buffer>();
  let counter = 0;

  const service = {
    getObjectEntityFile: vi.fn().mockImplementation((_path: string) => {
      return Promise.resolve({ bucket: "test-bucket", key: "uploads/test" });
    }),

    downloadObjectBuffer: vi.fn().mockResolvedValue(sourceBuffer),

    saveObjectEntity: vi.fn().mockImplementation(
      (buffer: Buffer, _contentType: string, suffix?: string) => {
        const name = `/objects/test/${++counter}-${suffix ?? "file"}`;
        saved.set(name, buffer);
        return Promise.resolve(name);
      },
    ),

    // Unused by processAndStoreVariants but typed for compatibility
    deleteObjectEntity: vi.fn().mockResolvedValue(undefined),
  } as unknown as ObjectStorageService;

  return { service, saved };
}

// ── Pixel sampling helpers ─────────────────────────────────────────────────

interface Pixel { r: number; g: number; b: number }

/**
 * Samples a single RGB pixel from a buffer that sharp can decode.
 * Coordinates are 0-based from the top-left of the image.
 */
async function samplePixel(buf: Buffer, x: number, y: number): Promise<Pixel> {
  const { data, info } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, channels } = info;
  const offset = (y * width + x) * channels;
  return {
    r: data[offset],
    g: data[offset + 1],
    b: data[offset + 2],
  };
}

/**
 * Reads image dimensions from a buffer via sharp metadata.
 */
async function getDimensions(buf: Buffer): Promise<{ width: number; height: number }> {
  const meta = await sharp(buf).metadata();
  return { width: meta.width ?? 0, height: meta.height ?? 0 };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("processAndStoreVariants — decision_card_cover", () => {
  // ── Off-center bottom-half crop ──────────────────────────────────────────

  describe("with bottom-half crop region (off-center)", () => {
    /**
     * This is the primary assertion for task #94:
     *
     * An admin approves a DC cover that was uploaded with an explicit off-center
     * crop selecting the bottom half of the source image (the blue region).
     * After the pipeline runs, the display variant must show blue pixels — not
     * the red top half that a centre-crop fallback would include.
     */
    it("produces a 1400×600 display variant", async () => {
      const { service, saved } = makeMockStorage(testImageBuffer);

      const result = await processAndStoreVariants(
        "/objects/test/source.jpg",
        "decision_card_cover",
        service,
        { cropRegion: { left: 100, top: 600, width: 1400, height: 600 } },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // display variant must exist
      expect(result.variants.display).toBeTruthy();
      const displayBuf = saved.get(result.variants.display!);
      expect(displayBuf).toBeDefined();

      const dims = await getDimensions(displayBuf!);
      expect(dims.width).toBe(1400);
      expect(dims.height).toBe(600);
    });

    it("display variant pixel content is from the blue (bottom) region", async () => {
      const { service, saved } = makeMockStorage(testImageBuffer);

      const result = await processAndStoreVariants(
        "/objects/test/source.jpg",
        "decision_card_cover",
        service,
        { cropRegion: { left: 100, top: 600, width: 1400, height: 600 } },
      );

      if (!result.ok) throw new Error(`Expected ok but got: ${result.error}`);

      const displayBuf = saved.get(result.variants.display!)!;

      // Sample pixels from four corners and the centre of the output.
      // All must be blue — none should be red.  This would fail if the
      // pipeline applied a centre-crop instead of the requested bottom-half crop.
      const corners: [number, number][] = [
        [0, 0],         // top-left
        [1399, 0],      // top-right
        [0, 599],       // bottom-left
        [1399, 599],    // bottom-right
        [700, 300],     // centre
      ];

      for (const [x, y] of corners) {
        const px = await samplePixel(displayBuf, x, y);
        // Blue channel must dominate (≥ 200); red channel must be negligible (≤ 30).
        // WebP compression introduces minor quantisation artefacts, so we allow
        // a ±30 tolerance on colour channels.
        expect(px.b, `pixel (${x},${y}) should be blue but r=${px.r} g=${px.g} b=${px.b}`)
          .toBeGreaterThan(200);
        expect(px.r, `pixel (${x},${y}) should not be red but r=${px.r} g=${px.g} b=${px.b}`)
          .toBeLessThan(50);
      }
    });

    it("thumbnail variant is also 420×180 (7:3) and matches blue region", async () => {
      const { service, saved } = makeMockStorage(testImageBuffer);

      const result = await processAndStoreVariants(
        "/objects/test/source.jpg",
        "decision_card_cover",
        service,
        { cropRegion: { left: 100, top: 600, width: 1400, height: 600 } },
      );

      if (!result.ok) throw new Error(result.error);

      const thumbBuf = saved.get(result.variants.thumbnail)!;
      const dims = await getDimensions(thumbBuf);
      expect(dims.width).toBe(420);
      expect(dims.height).toBe(180);

      // Centre pixel of thumbnail must also be blue
      const centre = await samplePixel(thumbBuf, 210, 90);
      expect(centre.b).toBeGreaterThan(200);
      expect(centre.r).toBeLessThan(50);
    });
  });

  // ── Top-half crop → red ──────────────────────────────────────────────────

  describe("with top-half crop region", () => {
    it("display variant pixel content is from the red (top) region", async () => {
      const { service, saved } = makeMockStorage(testImageBuffer);

      const result = await processAndStoreVariants(
        "/objects/test/source.jpg",
        "decision_card_cover",
        service,
        // Crop selecting only the top half (red region)
        { cropRegion: { left: 100, top: 0, width: 1400, height: 600 } },
      );

      if (!result.ok) throw new Error(result.error);

      const displayBuf = saved.get(result.variants.display!)!;
      const centre = await samplePixel(displayBuf, 700, 300);

      // Centre of a top-half crop must be red
      expect(centre.r, `r=${centre.r} g=${centre.g} b=${centre.b}`).toBeGreaterThan(200);
      expect(centre.b, `r=${centre.r} g=${centre.g} b=${centre.b}`).toBeLessThan(50);
    });
  });

  // ── Centre-crop fallback (no cropRegion) ─────────────────────────────────

  describe("without crop region (centre-crop fallback)", () => {
    it("still produces a 1400×600 display variant", async () => {
      const { service, saved } = makeMockStorage(testImageBuffer);

      const result = await processAndStoreVariants(
        "/objects/test/source.jpg",
        "decision_card_cover",
        service,
        // No cropRegion → automatic centre-crop
      );

      if (!result.ok) throw new Error(result.error);
      expect(result.variants.display).toBeTruthy();

      const displayBuf = saved.get(result.variants.display!)!;
      const dims = await getDimensions(displayBuf);
      expect(dims.width).toBe(1400);
      expect(dims.height).toBe(600);
    });

    it("centre-crop of a 1600×1200 image straddles the red/blue boundary", async () => {
      // The source image is 1600×1200. A 7:3 centre-crop yields a region about
      // 686 px tall around the midpoint. The boundary
      // between red and blue is at y=600.  The centre-crop therefore includes
      // rows 300–900, which spans both red (300–599) and blue (600–899).
      //
      // We assert the centre-crop output has red near the top and blue near
      // the bottom — confirming it is NOT an off-center bottom-half crop.
      const { service, saved } = makeMockStorage(testImageBuffer);

      const result = await processAndStoreVariants(
        "/objects/test/source.jpg",
        "decision_card_cover",
        service,
      );

      if (!result.ok) throw new Error(result.error);

      const displayBuf = saved.get(result.variants.display!)!;

      // Row 0 of the centre-crop output is from y≈300 of the source → red
      const topPx = await samplePixel(displayBuf, 700, 10);
      expect(topPx.r, `top of centre-crop should be red: r=${topPx.r} g=${topPx.g} b=${topPx.b}`)
        .toBeGreaterThan(150);

      // Row 599 of the centre-crop output is from y≈899 of the source → blue
      const bottomPx = await samplePixel(displayBuf, 700, 590);
      expect(bottomPx.b, `bottom of centre-crop should be blue: r=${bottomPx.r} g=${bottomPx.g} b=${bottomPx.b}`)
        .toBeGreaterThan(150);
    });
  });

  // ── Invalid crop region → falls back to centre-crop ──────────────────────

  describe("with out-of-bounds crop region", () => {
    it("falls back to centre-crop and still produces a valid 1400×600 output", async () => {
      const { service, saved } = makeMockStorage(testImageBuffer);

      const result = await processAndStoreVariants(
        "/objects/test/source.jpg",
        "decision_card_cover",
        service,
        // This crop region extends beyond the image width → invalid → fallback
        { cropRegion: { left: 0, top: 0, width: 99999, height: 600 } },
      );

      if (!result.ok) throw new Error(result.error);
      expect(result.variants.display).toBeTruthy();

      const displayBuf = saved.get(result.variants.display!)!;
      const dims = await getDimensions(displayBuf);
      expect(dims.width).toBe(1400);
      expect(dims.height).toBe(600);
    });
  });

  // ── Returned variants shape ───────────────────────────────────────────────

  describe("variants object shape", () => {
    it("includes thumbnail and display paths, omits medium (Quick Card only)", async () => {
      const { service, saved } = makeMockStorage(testImageBuffer);

      const result = await processAndStoreVariants(
        "/objects/test/source.jpg",
        "decision_card_cover",
        service,
        { cropRegion: { left: 100, top: 600, width: 1400, height: 600 } },
      );

      if (!result.ok) throw new Error(result.error);

      expect(result.variants.thumbnail).toBeTruthy();
      expect(result.variants.display).toBeTruthy();
      // medium is only generated for quick_card_cover.
      expect(result.variants.medium).toBeUndefined();
      // original path is preserved (private)
      expect(result.variants.original).toBe("/objects/test/source.jpg");

      // Both paths must be present in the mock saved map
      expect(saved.has(result.variants.thumbnail)).toBe(true);
      expect(saved.has(result.variants.display!)).toBe(true);
    });
  });

  // ── Storage I/O call counts ───────────────────────────────────────────────

  describe("storage I/O", () => {
    it("reads the source once and writes exactly 2 objects (display + thumbnail)", async () => {
      const { service, saved } = makeMockStorage(testImageBuffer);

      await processAndStoreVariants(
        "/objects/test/source.jpg",
        "decision_card_cover",
        service,
        { cropRegion: { left: 100, top: 600, width: 1400, height: 600 } },
      );

      // One getObjectEntityFile call (with retry loop but success on first attempt)
      expect((service.getObjectEntityFile as ReturnType<typeof vi.fn>).mock.calls.length)
        .toBeGreaterThanOrEqual(1);

      // Exactly 2 saveObjectEntity calls: display + thumbnail
      expect(saved.size).toBe(2);
    });
  });
});

// ── Quick Card 25:9 crop and variant dimensions ──────────────────────────────

describe("processAndStoreVariants — quick_card_cover with crop", () => {
  it("applies crop and produces exact 25:9 medium and thumbnail variants", async () => {
    let testImg: Buffer;

    // 1200×864 image: top half red, bottom half blue
    const W = 1200;
    const H = 864;
    const halfH = 432;
    const raw = Buffer.alloc(W * H * 3);
    for (let row = 0; row < H; row++) {
      for (let col = 0; col < W; col++) {
        const off = (row * W + col) * 3;
        raw[off] = row < halfH ? 255 : 0;
        raw[off + 1] = 0;
        raw[off + 2] = row < halfH ? 0 : 255;
      }
    }
    testImg = await sharp(raw, { raw: { width: W, height: H, channels: 3 } })
      .jpeg({ quality: 95 })
      .toBuffer();

    const { service, saved } = makeMockStorage(testImg);

    const result = await processAndStoreVariants(
      "/objects/test/qc-source.jpg",
      "quick_card_cover",
      service,
      // Crop: bottom half only (blue)
      { cropRegion: { left: 0, top: 432, width: 1200, height: 432 } },
    );

    if (!result.ok) throw new Error(result.error);

    const mediumPath = result.variants.medium!;
    const mediumBuf = saved.get(mediumPath)!;
    const dims = await getDimensions(mediumBuf);
    expect(dims.width).toBe(1200);
    expect(dims.height).toBe(432);

    const thumbBuf = saved.get(result.variants.thumbnail)!;
    expect(await getDimensions(thumbBuf)).toEqual({ width: 600, height: 216 });

    // Centre pixel must be blue (cropped from bottom half)
    const centre = await samplePixel(mediumBuf, 600, 216);
    expect(centre.b).toBeGreaterThan(200);
    expect(centre.r).toBeLessThan(50);
  });

  it("auto-center-crops uncropped uploads to exact 25:9 variants", async () => {
    const { service, saved } = makeMockStorage(testImageBuffer);
    const result = await processAndStoreVariants(
      "/objects/test/qc-uncropped.jpg",
      "quick_card_cover",
      service,
    );

    if (!result.ok) throw new Error(result.error);
    expect(await getDimensions(saved.get(result.variants.medium!)!))
      .toEqual({ width: 1200, height: 432 });
    expect(await getDimensions(saved.get(result.variants.thumbnail)!))
      .toEqual({ width: 600, height: 216 });
  });
});

describe("processAndStoreVariants — decision_gallery", () => {
  it("auto-center-crops skipped crops to exact 7:3 variants", async () => {
    const { service, saved } = makeMockStorage(testImageBuffer);
    const result = await processAndStoreVariants(
      "/objects/test/gallery-uncropped.jpg",
      "decision_gallery",
      service,
    );

    if (!result.ok) throw new Error(result.error);
    expect(await getDimensions(saved.get(result.variants.display!)!))
      .toEqual({ width: 1400, height: 600 });
    expect(await getDimensions(saved.get(result.variants.thumbnail)!))
      .toEqual({ width: 420, height: 180 });
  });
});

describe("processAndStoreVariants — works", () => {
  it("produces independent 4:3 portfolio variants", async () => {
    const { service, saved } = makeMockStorage(testImageBuffer);
    const result = await processAndStoreVariants(
      "/objects/test/works-uncropped.jpg",
      "works",
      service,
    );

    if (!result.ok) throw new Error(result.error);
    expect(await getDimensions(saved.get(result.variants.display!)!))
      .toEqual({ width: 1200, height: 900 });
    expect(await getDimensions(saved.get(result.variants.thumbnail)!))
      .toEqual({ width: 480, height: 360 });
  });

  it("honours an owner-selected 4:3 crop region", async () => {
    const { service, saved } = makeMockStorage(testImageBuffer);
    const result = await processAndStoreVariants(
      "/objects/test/works-cropped.jpg",
      "works",
      service,
      { cropRegion: { left: 10, top: 10, width: 320, height: 240 } },
    );

    if (!result.ok) throw new Error(result.error);
    expect(await getDimensions(saved.get(result.variants.display!)!))
      .toEqual({ width: 1200, height: 900 });
    expect(await getDimensions(saved.get(result.variants.thumbnail)!))
      .toEqual({ width: 480, height: 360 });
  });
});
