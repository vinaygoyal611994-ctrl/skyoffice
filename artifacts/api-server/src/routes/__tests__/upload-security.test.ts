/**
 * Upload security tests — Controlled Pilot Blocker 2
 *
 * Covers:
 *  1.  Presigned URL binds object path to authenticated office + category.
 *  2.  POST /offices/me/media rejects uploads with no claim.
 *  3.  POST /offices/me/media rejects claims belonging to a different office.
 *  4.  POST /offices/me/media rejects category-mismatched claims.
 *  5.  POST /offices/me/media rejects expired claims.
 *  6.  POST /offices/me/media accepts valid claims (happy path, video).
 *  7.  POST /offices/me/documents validates claim against document category.
 *  8.  PUT /offices/me/marketing-video validates claim against marketing_video.
 *  9.  PATCH /offices/me/quick-card-cover validates claim against cover categories.
 *  10. GET /storage/objects: private paths require their owner or an admin.
 *  11. GET /storage/objects: only active-office approved media is public.
 *  12. GET /storage/objects: unregistered claimed uploads remain owner-only.
 *  13. GET /storage/objects: unknown private paths are denied.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted mock factories
// ---------------------------------------------------------------------------

const { mockDb, mockObjStorage, mockVerifyReadable, mockVerifyMarketingVideo, mockProcessImage, mockDeleteImageVariants } = vi.hoisted(() => {
  const mockDb = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    execute: vi.fn(),
    transaction: vi.fn(),
  };
  const mockObjStorage = {
    getObjectEntityUploadURL: vi.fn(),
    normalizeObjectEntityPath: vi.fn(),
    createObjectEntityPath: vi.fn(),
    uploadObjectEntity: vi.fn(),
    getObjectEntityMetadata: vi.fn(),
    getObjectEntityFile: vi.fn(),
    downloadObject: vi.fn(),
    writeObjectEntityToFile: vi.fn(),
  };
  const mockVerifyReadable = vi.fn();
  const mockVerifyMarketingVideo = vi.fn();
  const mockProcessImage = vi.fn();
  const mockDeleteImageVariants = vi.fn();
  return { mockDb, mockObjStorage, mockVerifyReadable, mockVerifyMarketingVideo, mockProcessImage, mockDeleteImageVariants };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: mockDb,
  officesTable: { id: {}, userId: {}, status: {}, providerType: {}, coverUrl: {}, coverVariants: {}, pendingQuickCardCoverUrl: {}, pendingQuickCardCoverVariants: {}, pendingMediaSubmittedAt: {}, pendingMediaRejectionReason: {}, primaryMediaId: {}, pendingChanges: {}, pendingChangesSubmittedAt: {}, isSubscriptionHidden: {} },
  officeServicesTable: { id: {}, officeId: {}, name: {} },
  officeMediaTable: { id: {}, officeId: {}, status: {}, url: {}, variants: {}, placement: {}, type: {}, sortOrder: {} },
  officeVerificationDocumentsTable: { id: {}, officeId: {}, objectPath: {}, status: {}, documentType: {} },
  officeAdminNotesTable: { id: {}, officeId: {} },
  uploadClaimsTable: { id: {}, userId: {}, officeId: {}, objectPath: {}, category: {}, expiresAt: {} },
  defaultSpokenLanguageCodes: ["ar", "en"],
  mediaPlacementEnum: ["decision_gallery"],
  mediaItemStatusEnum: ["approved", "pending_review", "rejected"],
  providerTypeEnum: ["office", "freelancer"],
  mediaTypeEnum: ["image", "video"],
  officeCategoryEnum: ["translation", "legal", "other"],
  officeStatusEnum: ["draft", "active", "approved", "suspended"],
  verificationDocumentTypeEnum: ["identity", "trade_license"],
  verificationDocumentStatusEnum: ["pending", "approved", "rejected"],
}));

vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class MockObjectStorageService {
    getObjectEntityUploadURL() { return mockObjStorage.getObjectEntityUploadURL(); }
    normalizeObjectEntityPath(p: string) { return mockObjStorage.normalizeObjectEntityPath(p); }
    createObjectEntityPath() { return mockObjStorage.createObjectEntityPath(); }
    uploadObjectEntity(p: string, b: Buffer, t: string) { return mockObjStorage.uploadObjectEntity(p, b, t); }
    getObjectEntityMetadata(p: string) { return mockObjStorage.getObjectEntityMetadata(p); }
    getObjectEntityFile(p: string) { return mockObjStorage.getObjectEntityFile(p); }
    downloadObject(o: unknown) { return mockObjStorage.downloadObject(o); }
    writeObjectEntityToFile(p: string, d: string, m: number) { return mockObjStorage.writeObjectEntityToFile(p, d, m); }
  },
  verifyObjectReadable: mockVerifyReadable,
  ObjectNotFoundError: class ObjectNotFoundError extends Error {
    constructor() { super("Object not found"); this.name = "ObjectNotFoundError"; }
  },
}));

vi.mock("../../lib/marketingVideoProbe", () => ({
  verifyMarketingVideoFile: mockVerifyMarketingVideo,
}));

vi.mock("../../lib/imageProcessor", () => ({
  processAndStoreVariants: mockProcessImage.mockResolvedValue({
    ok: true,
    variants: { display: "/objects/uploads/display-uuid", thumbnail: "/objects/uploads/thumb-uuid", original: "/objects/uploads/orig-uuid" },
  }),
  deleteImageVariants: mockDeleteImageVariants.mockResolvedValue(undefined),
}));

vi.mock("../../lib/auditLog", () => ({
  recordAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/analyticsWriter", () => ({
  fireAnalyticsEvent: vi.fn(),
  extractRequestContext: vi.fn().mockReturnValue({}),
}));

vi.mock("../../lib/visitorSession", () => ({
  readVisitorId: vi.fn().mockReturnValue(null),
  getOrCreateVisitorId: vi.fn().mockReturnValue("v1"),
  resolveSource: vi.fn().mockReturnValue("direct"),
}));

vi.mock("../../lib/searchNormalizer", () => ({
  normalizeSearchQuery: vi.fn().mockReturnValue(""),
  classifyCityId: vi.fn().mockReturnValue(null),
  classifyCategoryId: vi.fn().mockReturnValue(null),
  classifySearchIntent: vi.fn().mockReturnValue({ intent: "generic", confidence: 0 }),
  detectQueryLanguage: vi.fn().mockReturnValue(null),
}));

vi.mock("../../lib/ranking", () => ({
  buildRankOrderBy: vi.fn().mockReturnValue([]),
  haversineKm: vi.fn().mockReturnValue(0),
}));

vi.mock("../../lib/marketGate", () => ({
  checkMarketGateForOffice: vi.fn().mockResolvedValue({ status: "allowed" }),
  checkFullGate: vi.fn().mockResolvedValue({ status: "allowed" }),
  buildMarketClosedError: vi.fn().mockReturnValue({}),
  buildCapFullError: vi.fn().mockReturnValue({}),
}));

vi.mock("../../lib/officeSerializer", () => ({
  serializeOfficeSummary: vi.fn().mockReturnValue({}),
  serializeOfficeProfile: vi.fn().mockResolvedValue({}),
  serializePublicOfficeProfile: vi.fn().mockResolvedValue({}),
  serializeVerificationDocument: vi.fn().mockReturnValue({
    id: 5,
    documentType: "identity",
    objectPath: "/objects/uploads/test-uuid",
    status: "pending",
    reviewNote: null,
    createdAt: new Date(),
  }),
  loadServiceTagsByOfficeId: vi.fn().mockResolvedValue(new Map()),
  batchLoadTrustMetrics: vi.fn().mockResolvedValue(new Map()),
  loadDocumentsByOfficeId: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../lib/rateLimiter", () => ({
  uploadUrlLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
  directUploadLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock("../../lib/citySynonyms", () => ({
  expandCitySynonyms: vi.fn().mockReturnValue([]),
}));

vi.mock("../../lib/storageConfig", () => ({
  getPrivateBucket: vi.fn().mockReturnValue("sk-private"),
  getPublicBucket: vi.fn().mockReturnValue("sk-public"),
  getS3Client: vi.fn().mockReturnValue({}),
  missingStorageEnvVars: vi.fn().mockReturnValue([]),
}));

// ---------------------------------------------------------------------------
// DB mock chain helpers
// ---------------------------------------------------------------------------

function selectChain(rows: unknown[]) {
  const promise = Promise.resolve(rows);
  const obj: Record<string, unknown> = {
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
  for (const m of ["from", "where", "innerJoin", "leftJoin", "orderBy", "limit", "offset", "for"]) {
    obj[m] = vi.fn().mockReturnValue(obj);
  }
  return obj;
}

function insertChain(rows: unknown[], opts: { conflictOverride?: boolean } = {}) {
  const returningObj = {
    returning: vi.fn().mockResolvedValue(rows),
  };
  const valuesObj = {
    values: vi.fn().mockReturnValue(
      opts.conflictOverride
        ? { onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) }
        : returningObj,
    ),
  };
  return valuesObj;
}

function deleteChain() {
  const obj: Record<string, unknown> = {};
  obj["where"] = vi.fn().mockReturnValue({
    returning: vi.fn().mockResolvedValue([{ id: 1 }]),
  });
  return obj;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OFFICE_USER = { id: 10, role: "office" as const, name: "OfficeOwner", email: "o@test.com", status: "active" as const, statusReason: null, officeId: 42, createdAt: new Date(), phone: null };
const OTHER_OFFICE_USER = { id: 20, role: "office" as const, name: "Other", email: "other@test.com", status: "active" as const, statusReason: null, officeId: 99, createdAt: new Date(), phone: null };
const ADMIN_USER = { id: 1, role: "admin" as const, name: "Admin", email: "admin@test.com", status: "active" as const, statusReason: null, officeId: null, createdAt: new Date(), phone: null };

const MOCK_OFFICE = { id: 42, userId: 10, status: "active" as const };

const VALID_CLAIM = {
  id: 1,
  userId: 10,
  officeId: 42,
  objectPath: "/objects/uploads/test-uuid",
  category: "gallery_video",
  expiresAt: new Date(Date.now() + 10 * 60 * 1000), // not expired
  createdAt: new Date(),
};

const EXPIRED_CLAIM = {
  ...VALID_CLAIM,
  id: 2,
  expiresAt: new Date(Date.now() - 60 * 1000), // 1 minute ago
};

// ---------------------------------------------------------------------------
// App factories
// ---------------------------------------------------------------------------

async function makeOfficesApp(sessionUser: typeof OFFICE_USER | typeof ADMIN_USER | null = null) {
  const { default: officesRouter } = await import("../offices");
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    Object.defineProperty(req, "session", {
      value: {
        user: sessionUser,
        regenerate: (cb: (e?: unknown) => void) => cb(),
        save: (cb: (e?: unknown) => void) => cb(),
        destroy: (cb?: (e?: unknown) => void) => cb?.(),
      },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(req, "log", {
      value: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      writable: true,
      configurable: true,
    });
    next();
  });
  app.use(officesRouter);
  // Catch-all error handler to return JSON 500 with the error message for debugging
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err.message, stack: err.stack?.split('\n')[0] });
  });
  return app;
}

async function makeStorageApp(sessionUser: typeof OFFICE_USER | typeof ADMIN_USER | null = null) {
  const { default: storageRouter } = await import("../storage");
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    Object.defineProperty(req, "session", {
      value: { user: sessionUser },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(req, "log", {
      value: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      writable: true,
      configurable: true,
    });
    next();
  });
  app.use(storageRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Tests: same-origin upload relay
// ---------------------------------------------------------------------------

describe("PUT /storage/uploads/direct/:objectId", () => {
  const objectId = "123e4567-e89b-42d3-a456-426614174000";
  const objectPath = `/objects/uploads/${objectId}`;

  beforeEach(() => {
    vi.resetAllMocks();
    mockDb.transaction.mockImplementation(async (callback: (tx: typeof mockDb) => unknown) => callback(mockDb));
  });

  it.each([
    ["image/png", "gallery_image", Buffer.from("valid-image-bytes")],
    ["video/mp4", "marketing_video", Buffer.from("valid-video-bytes")],
  ])("uploads %s for its matching claim and exposes ETag", async (contentType, category, body) => {
    mockDb.select.mockReturnValueOnce(selectChain([{
      ...VALID_CLAIM,
      objectPath,
      category,
    }])).mockReturnValueOnce(selectChain([{
      ...VALID_CLAIM,
      objectPath,
      category,
    }]));
    mockObjStorage.uploadObjectEntity.mockResolvedValueOnce('"test-etag"');

    const app = await makeStorageApp(OFFICE_USER);
    const res = await request(app)
      .put(`/storage/uploads/direct/${objectId}`)
      .set("Content-Type", contentType)
      .send(body);

    expect(res.status).toBe(204);
    expect(res.headers.etag).toBe('"test-etag"');
    expect(mockObjStorage.uploadObjectEntity).toHaveBeenCalledWith(
      objectPath,
      expect.any(Buffer),
      contentType,
    );
  });

  it("rejects a MIME type that does not match the reserved category", async () => {
    mockDb.select.mockReturnValueOnce(selectChain([{
      ...VALID_CLAIM,
      objectPath,
      category: "gallery_image",
    }]));

    const app = await makeStorageApp(OFFICE_USER);
    const res = await request(app)
      .put(`/storage/uploads/direct/${objectId}`)
      .set("Content-Type", "video/mp4")
      .send(Buffer.from("video"));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_file_type");
    expect(res.body.error).toContain("نوع الملف");
    expect(res.body.error).toContain("File type");
    expect(mockObjStorage.uploadObjectEntity).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated uploads before reading or writing bytes", async () => {
    const app = await makeStorageApp(null);
    const res = await request(app)
      .put(`/storage/uploads/direct/${objectId}`)
      .set("Content-Type", "image/png")
      .send(Buffer.from("image"));

    expect(res.status).toBe(401);
    expect(mockDb.select).not.toHaveBeenCalled();
    expect(mockObjStorage.uploadObjectEntity).not.toHaveBeenCalled();
  });

  it("rejects a claim owned by another office", async () => {
    mockDb.select.mockReturnValueOnce(selectChain([{
      ...VALID_CLAIM,
      objectPath,
      userId: OTHER_OFFICE_USER.id,
      officeId: OTHER_OFFICE_USER.officeId,
      category: "gallery_image",
    }]));

    const app = await makeStorageApp(OFFICE_USER);
    const res = await request(app)
      .put(`/storage/uploads/direct/${objectId}`)
      .set("Content-Type", "image/png")
      .send(Buffer.from("image"));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("claim_office_mismatch");
  });

  it("rejects an expired claim before reading or writing bytes", async () => {
    mockDb.select.mockReturnValueOnce(selectChain([{
      ...EXPIRED_CLAIM,
      objectPath,
      category: "gallery_image",
    }]));
    mockDb.delete.mockReturnValueOnce(deleteChain());

    const app = await makeStorageApp(OFFICE_USER);
    const res = await request(app)
      .put(`/storage/uploads/direct/${objectId}`)
      .set("Content-Type", "image/png")
      .send(Buffer.from("image"));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("claim_expired");
    expect(mockObjStorage.uploadObjectEntity).not.toHaveBeenCalled();
  });

  it("rejects an empty body with a bilingual error", async () => {
    mockDb.select.mockReturnValueOnce(selectChain([{
      ...VALID_CLAIM,
      objectPath,
      category: "gallery_image",
    }]));

    const app = await makeStorageApp(OFFICE_USER);
    const res = await request(app)
      .put(`/storage/uploads/direct/${objectId}`)
      .set("Content-Type", "image/png")
      .send(Buffer.alloc(0));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_file_body");
    expect(res.body.error).toContain("الملف فارغ");
    expect(res.body.error).toContain("empty");
  });

  it("returns 413 when the body exceeds the claim category limit", async () => {
    mockDb.select.mockReturnValueOnce(selectChain([{
      ...VALID_CLAIM,
      objectPath,
      category: "gallery_image",
    }]));

    const app = await makeStorageApp(OFFICE_USER);
    const res = await request(app)
      .put(`/storage/uploads/direct/${objectId}`)
      .set("Content-Type", "image/png")
      .send(Buffer.alloc(8 * 1024 * 1024 + 1));

    expect(res.status).toBe(413);
    expect(res.body.code).toBe("file_too_large");
    expect(mockObjStorage.uploadObjectEntity).not.toHaveBeenCalled();
  });

  it("does not write when association consumes the claim before the PUT lock", async () => {
    mockDb.select
      .mockReturnValueOnce(selectChain([{
        ...VALID_CLAIM,
        objectPath,
        category: "gallery_image",
      }]))
      .mockReturnValueOnce(selectChain([]));

    const app = await makeStorageApp(OFFICE_USER);
    const res = await request(app)
      .put(`/storage/uploads/direct/${objectId}`)
      .set("Content-Type", "image/png")
      .send(Buffer.from("image"));

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("upload_claim_changed");
    expect(mockObjStorage.uploadObjectEntity).not.toHaveBeenCalled();
  });

  it("rejects a second concurrent upload from the same account before buffering it", async () => {
    let releaseFirstUpload!: () => void;
    const firstUploadBlocked = new Promise<void>((resolve) => {
      releaseFirstUpload = resolve;
    });
    mockDb.select
      .mockReturnValueOnce(selectChain([{ ...VALID_CLAIM, objectPath, category: "gallery_image" }]))
      .mockReturnValueOnce(selectChain([{ ...VALID_CLAIM, objectPath, category: "gallery_image" }]));
    mockObjStorage.uploadObjectEntity.mockImplementationOnce(async () => {
      await firstUploadBlocked;
      return '"first-etag"';
    });

    const app = await makeStorageApp(OFFICE_USER);
    const firstRequest = request(app)
      .put(`/storage/uploads/direct/${objectId}`)
      .set("Content-Type", "image/png")
      .send(Buffer.from("first"))
      .then((res) => res);

    while (mockObjStorage.uploadObjectEntity.mock.calls.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const secondRes = await request(app)
      .put(`/storage/uploads/direct/${objectId}`)
      .set("Content-Type", "image/png")
      .send(Buffer.from("second"));

    expect(secondRes.status).toBe(429);
    expect(secondRes.body.code).toBe("upload_in_progress");
    expect(mockObjStorage.uploadObjectEntity).toHaveBeenCalledTimes(1);

    releaseFirstUpload();
    const firstRes = await firstRequest;
    expect(firstRes.status).toBe(204);
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /offices/me/media — upload claim validation
// ---------------------------------------------------------------------------

describe("POST /offices/me/media — upload claim security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects when no upload claim exists for the objectPath", async () => {
    // Office lookup succeeds.
    mockDb.select.mockReturnValueOnce(selectChain([MOCK_OFFICE]));
    // Claim lookup — no claim found.
    mockDb.select.mockReturnValueOnce(selectChain([]));

    const app = await makeOfficesApp(OFFICE_USER);
    const res = await request(app)
      .post("/offices/me/media")
      .send({ objectPath: "/objects/uploads/unknown-uuid", type: "video" });

    console.log("[TEST] status:", res.status, "body:", JSON.stringify(res.body));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("no_upload_claim");
  });

  it("rejects when the claim belongs to a different office", async () => {
    mockDb.select.mockReturnValueOnce(selectChain([MOCK_OFFICE]));
    // Claim with a different officeId.
    mockDb.select.mockReturnValueOnce(
      selectChain([{ ...VALID_CLAIM, officeId: 999 }]),
    );

    const app = await makeOfficesApp(OFFICE_USER);
    const res = await request(app)
      .post("/offices/me/media")
      .send({ objectPath: "/objects/uploads/test-uuid", type: "video" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("claim_office_mismatch");
  });

  it("rejects when claim category is not a media category", async () => {
    mockDb.select.mockReturnValueOnce(selectChain([MOCK_OFFICE]));
    // Claim with 'document' category — wrong for media endpoint.
    mockDb.select.mockReturnValueOnce(
      selectChain([{ ...VALID_CLAIM, category: "document" }]),
    );

    const app = await makeOfficesApp(OFFICE_USER);
    const res = await request(app)
      .post("/offices/me/media")
      .send({ objectPath: "/objects/uploads/test-uuid", type: "video" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("claim_category_mismatch");
  });

  it("rejects when the claim has expired", async () => {
    mockDb.select.mockReturnValueOnce(selectChain([MOCK_OFFICE]));
    mockDb.select.mockReturnValueOnce(selectChain([EXPIRED_CLAIM]));
    // Delete the expired claim.
    mockDb.delete.mockReturnValueOnce(deleteChain());

    const app = await makeOfficesApp(OFFICE_USER);
    const res = await request(app)
      .post("/offices/me/media")
      .send({ objectPath: "/objects/uploads/test-uuid", type: "video" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("claim_expired");
  });

  it("accepts a valid claim for a gallery_video upload (happy path)", async () => {
    // Office row
    mockDb.select.mockReturnValueOnce(selectChain([MOCK_OFFICE]));
    // Claim row (valid, gallery_video category)
    mockDb.select.mockReturnValueOnce(selectChain([VALID_CLAIM]));
    // Delete claim
    mockDb.delete.mockReturnValueOnce(deleteChain());
    // validateObjectMetadata HEAD check → video content-type
    mockObjStorage.getObjectEntityMetadata.mockResolvedValueOnce({
      contentType: "video/mp4",
      contentLength: 1024 * 1024, // 1 MB
    });
    // gallery count check (placement = decision_gallery)
    mockDb.select.mockReturnValueOnce(
      selectChain([{ galleryCount: 0 }]),
    );
    // sort order check
    mockDb.select.mockReturnValueOnce(selectChain([{ maxOrder: 0 }]));
    // DB insert for the media row
    const mediaRow = { id: 1, url: "/objects/uploads/test-uuid", type: "video", placement: "decision_gallery", status: "pending_review" };
    mockDb.insert.mockReturnValueOnce({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([mediaRow]),
      }),
    });

    const app = await makeOfficesApp(OFFICE_USER);
    const res = await request(app)
      .post("/offices/me/media")
      .send({ objectPath: "/objects/uploads/test-uuid", type: "video", placement: "decision_gallery" });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(1);
  });

  it("persists the processed 7:3 display path and variants for a gallery image", async () => {
    mockDb.select
      .mockReturnValueOnce(selectChain([MOCK_OFFICE]))
      .mockReturnValueOnce(selectChain([{ ...VALID_CLAIM, category: "gallery_image" }]))
      .mockReturnValueOnce(selectChain([{ galleryCount: 0 }]))
      .mockReturnValueOnce(selectChain([{ maxOrder: 0 }]));
    mockDb.delete.mockReturnValueOnce(deleteChain());
    mockObjStorage.getObjectEntityMetadata.mockResolvedValueOnce({
      contentType: "image/jpeg",
      contentLength: 1024,
    });

    const variants = {
      original: "/objects/uploads/test-uuid",
      display: "/objects/generated/decision-1400x600",
      thumbnail: "/objects/generated/decision-420x180",
    };
    mockProcessImage.mockResolvedValueOnce({ ok: true, variants });

    const values = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{
        id: 2,
        officeId: 42,
        url: variants.display,
        type: "image",
        placement: "decision_gallery",
        status: "pending_review",
        variants,
        sortOrder: 1,
      }]),
    });
    mockDb.insert.mockReturnValueOnce({ values });

    const app = await makeOfficesApp(OFFICE_USER);
    const res = await request(app)
      .post("/offices/me/media")
      .send({ objectPath: "/objects/uploads/test-uuid", type: "image" });

    expect(res.status).toBe(201);
    expect(mockProcessImage).toHaveBeenCalledWith(
      "/objects/uploads/test-uuid",
      "decision_gallery",
      expect.anything(),
      undefined,
    );
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      url: variants.display,
      variants,
      placement: "decision_gallery",
    }));
  });

  it("rejects Works videos before consuming their upload claim", async () => {
    mockDb.select.mockReturnValueOnce(selectChain([MOCK_OFFICE]));

    const app = await makeOfficesApp(OFFICE_USER);
    const res = await request(app)
      .post("/offices/me/media")
      .send({ objectPath: "/objects/uploads/test-uuid", type: "video", placement: "works" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("works_image_only");
    expect(mockDb.delete).not.toHaveBeenCalled();
    expect(mockProcessImage).not.toHaveBeenCalled();
  });

  it("requires the dedicated works_image claim category for Works", async () => {
    mockDb.select
      .mockReturnValueOnce(selectChain([MOCK_OFFICE]))
      .mockReturnValueOnce(selectChain([{ ...VALID_CLAIM, category: "gallery_image" }]));

    const app = await makeOfficesApp(OFFICE_USER);
    const res = await request(app)
      .post("/offices/me/media")
      .send({ objectPath: "/objects/uploads/test-uuid", type: "image", placement: "works" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("claim_category_mismatch");
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it("accepts a valid works_image claim and stores an approved Works image", async () => {
    const worksOffice = { ...MOCK_OFFICE, status: "draft" };
    const worksClaim = { ...VALID_CLAIM, category: "works_image" };
    mockDb.select
      .mockReturnValueOnce(selectChain([worksOffice]))
      .mockReturnValueOnce(selectChain([worksClaim]))
      .mockReturnValueOnce(selectChain([{ worksCount: 0 }]))
      .mockReturnValueOnce(selectChain([worksClaim]))
      .mockReturnValueOnce(selectChain([{ maxOrder: 0 }]));
    mockObjStorage.getObjectEntityMetadata
      .mockResolvedValueOnce({ contentType: "image/jpeg", contentLength: 1024 })
      .mockResolvedValueOnce({ contentType: "image/jpeg", contentLength: 1024 });
    mockDb.delete.mockReturnValueOnce(deleteChain());

    const variants = {
      original: "/objects/uploads/test-uuid",
      display: "/objects/generated/works-1200x900",
      thumbnail: "/objects/generated/works-480x360",
    };
    mockProcessImage.mockResolvedValueOnce({ ok: true, variants });
    const values = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{
        id: 3,
        officeId: 42,
        url: variants.display,
        type: "image",
        placement: "works",
        status: "approved",
        variants,
        sortOrder: 1,
      }]),
    });
    mockDb.insert.mockReturnValueOnce({ values });

    const app = await makeOfficesApp(OFFICE_USER);
    const res = await request(app)
      .post("/offices/me/media")
      .send({ objectPath: "/objects/uploads/test-uuid", type: "image", placement: "works" });

    expect(res.status).toBe(201);
    expect(mockProcessImage).toHaveBeenCalledWith(
      "/objects/uploads/test-uuid",
      "works",
      expect.anything(),
      undefined,
    );
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      url: variants.display,
      variants,
      placement: "works",
      status: "approved",
      sortOrder: 1,
    }));
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /offices/me/documents — claim category validation
// ---------------------------------------------------------------------------

describe("POST /offices/me/documents — upload claim security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a document registration with a media-category claim", async () => {
    mockDb.select.mockReturnValueOnce(selectChain([MOCK_OFFICE]));
    // Claim has category 'gallery_image' — wrong for document endpoint.
    mockDb.select.mockReturnValueOnce(
      selectChain([{ ...VALID_CLAIM, category: "gallery_image" }]),
    );

    const app = await makeOfficesApp(OFFICE_USER);
    const res = await request(app)
      .post("/offices/me/documents")
      .send({ objectPath: "/objects/uploads/test-uuid", documentType: "identity" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("claim_category_mismatch");
  });

  it("accepts a valid document claim and proceeds to storage validation", async () => {
    mockDb.select.mockReturnValueOnce(selectChain([MOCK_OFFICE]));
    // Valid document claim
    mockDb.select.mockReturnValueOnce(
      selectChain([{ ...VALID_CLAIM, category: "document" }]),
    );
    // Delete claim
    mockDb.delete.mockReturnValueOnce(deleteChain());
    // validateObjectMetadata HEAD check → PDF
    mockObjStorage.getObjectEntityMetadata.mockResolvedValueOnce({
      contentType: "application/pdf",
      contentLength: 500 * 1024,
    });
    // Duplicate check: no existing row
    mockDb.select.mockReturnValueOnce(selectChain([]));
    // verifyObjectReadable → true
    mockVerifyReadable.mockResolvedValueOnce(true);
    // DB insert
    const docRow = {
      id: 5,
      officeId: 42,
      documentType: "identity",
      objectPath: "/objects/uploads/test-uuid",
      status: "pending",
      reviewNote: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockDb.insert.mockReturnValueOnce({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([docRow]),
      }),
    });

    const app = await makeOfficesApp(OFFICE_USER);
    const res = await request(app)
      .post("/offices/me/documents")
      .send({ objectPath: "/objects/uploads/test-uuid", documentType: "identity" });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Tests: PUT /offices/me/marketing-video — claim category validation
// ---------------------------------------------------------------------------

describe("PUT /offices/me/marketing-video — upload claim security", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  async function registerMarketingVideo({
    office = { ...MOCK_OFFICE, providerType: "office" },
    clientDuration,
    verification,
  }: {
    office?: typeof MOCK_OFFICE & {
      providerType: "office" | "freelancer";
      marketingVideoUrl?: string | null;
    };
    clientDuration?: number;
    verification:
      | { ok: true; durationSeconds: number; storedDurationSeconds: number }
      | {
          ok: false;
          reason:
            | "video_too_long"
            | "invalid_video"
            | "duration_unavailable"
            | "storage_unavailable";
        };
  }) {
    const claim = { ...VALID_CLAIM, category: "marketing_video" };
    mockDb.select
      .mockReturnValueOnce(selectChain([office]))
      .mockReturnValueOnce(selectChain([claim]));
    mockObjStorage.getObjectEntityMetadata.mockResolvedValueOnce({
      contentType: "video/mp4",
      contentLength: 1024 * 1024,
    });
    mockDb.delete.mockReturnValueOnce(deleteChain());
    mockVerifyMarketingVideo.mockResolvedValueOnce(verification);

    const set = vi.fn();
    if (verification.ok) {
      set.mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ ...office }]),
        }),
      });
      mockDb.update.mockReturnValueOnce({ set });
    }

    const app = await makeOfficesApp(OFFICE_USER);
    const body: Record<string, unknown> = {
      objectPath: "/objects/uploads/test-uuid",
      mimeType: "video/mp4",
      size: 1024 * 1024,
    };
    if (clientDuration !== undefined) body.duration = clientDuration;

    const response = await request(app)
      .put("/offices/me/marketing-video")
      .send(body);
    return { response, set };
  }

  it("rejects a marketing-video registration with a wrong-category claim", async () => {
    mockDb.select.mockReturnValueOnce(selectChain([MOCK_OFFICE]));
    // Claim has category 'gallery_video' — not 'marketing_video'.
    mockDb.select.mockReturnValueOnce(
      selectChain([{ ...VALID_CLAIM, category: "gallery_video" }]),
    );

    const app = await makeOfficesApp(OFFICE_USER);
    const res = await request(app)
      .put("/offices/me/marketing-video")
      .send({
        objectPath: "/objects/uploads/test-uuid",
        mimeType: "video/mp4",
        size: 1024 * 1024,
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("claim_category_mismatch");
  });

  it.each([
    ["Office", "office" as const, 74],
    ["Freelancer", "freelancer" as const, 75],
  ])(
    "accepts a verified %s marketing video at the allowed boundary",
    async (_label, providerType, actualDuration) => {
      const { response, set } = await registerMarketingVideo({
        office: { ...MOCK_OFFICE, providerType },
        clientDuration: actualDuration,
        verification: {
          ok: true,
          durationSeconds: actualDuration,
          storedDurationSeconds: actualDuration,
        },
      });

      expect(response.status).toBe(200);
      expect(set).toHaveBeenCalledWith(
        expect.objectContaining({
          marketingVideoMimeType: "video/mp4",
          marketingVideoSize: 1024 * 1024,
          marketingVideoDuration: actualDuration,
        }),
      );
    },
  );

  it.each([
    ["client reports 60 seconds", 60],
    ["client omits duration", undefined],
    ["client reports exactly 75 seconds", 75],
  ])(
    "rejects an over-75-second actual file when %s",
    async (_label, clientDuration) => {
      const { response, set } = await registerMarketingVideo({
        clientDuration,
        verification: { ok: false, reason: "video_too_long" },
      });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("video_too_long");
      expect(set).not.toHaveBeenCalled();
    },
  );

  it("accepts the verified file when the client falsely reports more than 75 seconds", async () => {
    const { response, set } = await registerMarketingVideo({
      clientDuration: 76,
      verification: {
        ok: true,
        durationSeconds: 74,
        storedDurationSeconds: 74,
      },
    });

    expect(response.status).toBe(200);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ marketingVideoDuration: 74 }),
    );
  });

  it.each([
    ["a corrupt MP4", "invalid_video", "invalid_video"],
    ["a non-MP4 disguised as MP4", "invalid_video", "invalid_video"],
    [
      "an unavailable storage object",
      "storage_unavailable",
      "file_not_readable",
    ],
    [
      "an unprobeable duration",
      "duration_unavailable",
      "video_duration_unavailable",
    ],
  ])(
    "fails closed for %s",
    async (_label, reason, expectedCode) => {
      const { response, set } = await registerMarketingVideo({
        clientDuration: 60,
        verification: {
          ok: false,
          reason: reason as
            | "invalid_video"
            | "storage_unavailable"
            | "duration_unavailable",
        },
      });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe(expectedCode);
      expect(set).not.toHaveBeenCalled();
    },
  );
});

// ---------------------------------------------------------------------------
// Tests: PATCH /offices/me/quick-card-cover — claim category validation
// ---------------------------------------------------------------------------

describe("PATCH /offices/me/quick-card-cover — upload claim security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a quick-card-cover submission with a document-category claim", async () => {
    mockDb.select.mockReturnValueOnce(selectChain([MOCK_OFFICE]));
    mockDb.select.mockReturnValueOnce(
      selectChain([{ ...VALID_CLAIM, category: "document" }]),
    );

    const app = await makeOfficesApp(OFFICE_USER);
    const res = await request(app)
      .patch("/offices/me/quick-card-cover")
      .send({ objectPath: "/objects/uploads/test-uuid" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("claim_category_mismatch");
  });

  it("persists a replacement 25:9 medium and retires old variants after the update", async () => {
    const oldVariants = {
      original: "/objects/old/original",
      medium: "/objects/old/medium",
      thumbnail: "/objects/old/thumb",
    };
    const draftOffice = {
      ...MOCK_OFFICE,
      status: "draft",
      coverUrl: oldVariants.medium,
      coverVariants: oldVariants,
    };
    mockDb.select
      .mockReturnValueOnce(selectChain([draftOffice]))
      .mockReturnValueOnce(selectChain([{ ...VALID_CLAIM, category: "quick_card_cover" }]));
    mockDb.delete.mockReturnValueOnce(deleteChain());
    mockObjStorage.getObjectEntityMetadata.mockResolvedValueOnce({
      contentType: "image/jpeg",
      contentLength: 1024,
    });

    const newVariants = {
      original: "/objects/uploads/test-uuid",
      medium: "/objects/generated/quick-1200x432",
      thumbnail: "/objects/generated/quick-600x216",
    };
    mockProcessImage.mockResolvedValueOnce({ ok: true, variants: newVariants });

    const set = vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{
          ...draftOffice,
          coverUrl: newVariants.medium,
          coverVariants: newVariants,
        }]),
      }),
    });
    mockDb.update.mockReturnValueOnce({ set });

    const app = await makeOfficesApp(OFFICE_USER);
    const res = await request(app)
      .patch("/offices/me/quick-card-cover")
      .send({ objectPath: "/objects/uploads/test-uuid" });

    expect(res.status).toBe(200);
    expect(set).toHaveBeenCalledWith({
      coverUrl: newVariants.medium,
      coverVariants: newVariants,
    });
    expect(mockDeleteImageVariants).toHaveBeenCalledWith(
      oldVariants,
      expect.anything(),
      expect.anything(),
    );
    expect(set.mock.invocationCallOrder[0])
      .toBeLessThan(mockDeleteImageVariants.mock.invocationCallOrder[0]);
  });
});

describe("PATCH /offices/me — legacy coverUrl upload security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an unclaimed legacy cover path instead of staging it for review", async () => {
    mockDb.select.mockReturnValueOnce(selectChain([MOCK_OFFICE]));
    mockDb.select.mockReturnValueOnce(selectChain([]));

    const app = await makeOfficesApp(OFFICE_USER);
    const res = await request(app)
      .patch("/offices/me")
      .send({ coverUrl: "/objects/uploads/unclaimed-legacy-cover" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("no_upload_claim");
  });
});

// ---------------------------------------------------------------------------
// Tests: GET /storage/objects — private object authorization
// ---------------------------------------------------------------------------

describe("GET /storage/objects — private object authorization", () => {
  const TEST_PATH = "uploads/pending-media-uuid";
  const OBJECT_PATH = `/objects/${TEST_PATH}`;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows unauthenticated access to approved public media", async () => {
    // isApprovedPublicMedia → true
    mockDb.execute.mockResolvedValueOnce({ rows: [{ is_public: true }] });
    // Serve the object
    mockObjStorage.getObjectEntityFile.mockResolvedValueOnce({ bucket: "b", key: TEST_PATH });
    mockObjStorage.downloadObject.mockResolvedValueOnce(
      new Response("data", { status: 200, headers: { "Content-Type": "image/webp" } }),
    );

    const app = await makeStorageApp(null); // no session
    const res = await request(app).get(`/storage/objects/${TEST_PATH}`);

    expect(res.status).toBe(200);
  });

  it("requires authentication for private (non-approved) objects", async () => {
    // isApprovedPublicMedia → false
    mockDb.execute.mockResolvedValueOnce({ rows: [{ is_public: false }] });

    const app = await makeStorageApp(null); // no session
    const res = await request(app).get(`/storage/objects/${TEST_PATH}`);

    expect(res.status).toBe(401);
  });

  it("does not expose a draft office cover without a session", async () => {
    // isApprovedPublicMedia applies the active-office predicate and returns false.
    mockDb.execute.mockResolvedValueOnce({ rows: [{ is_public: false }] });

    const app = await makeStorageApp(null);
    const res = await request(app).get(`/storage/objects/${TEST_PATH}`);

    expect(res.status).toBe(401);
  });

  it("allows the owning office to fetch its own pending media", async () => {
    // isApprovedPublicMedia → false
    mockDb.execute.mockResolvedValueOnce({ rows: [{ is_public: false }] });
    // Unified private-object owner lookup finds office 42.
    mockDb.execute.mockResolvedValueOnce({ rows: [{ office_id: 42 }] });
    // Resolve user's office
    mockDb.select.mockReturnValueOnce(selectChain([{ id: 42 }]));
    // Serve the object
    mockObjStorage.getObjectEntityFile.mockResolvedValueOnce({ bucket: "b", key: TEST_PATH });
    mockObjStorage.downloadObject.mockResolvedValueOnce(
      new Response("data", { status: 200, headers: { "Content-Type": "image/webp" } }),
    );

    const app = await makeStorageApp(OFFICE_USER);
    const res = await request(app).get(`/storage/objects/${TEST_PATH}`);

    expect(res.status).toBe(200);
  });

  it("forbids a different office from fetching another office's pending media", async () => {
    // isApprovedPublicMedia → false
    mockDb.execute.mockResolvedValueOnce({ rows: [{ is_public: false }] });
    // Unified private-object owner lookup finds office 42.
    mockDb.execute.mockResolvedValueOnce({ rows: [{ office_id: 42 }] });
    // The requester's office is 99 (different)
    mockDb.select.mockReturnValueOnce(selectChain([{ id: 99 }]));

    const app = await makeStorageApp(OTHER_OFFICE_USER);
    const res = await request(app).get(`/storage/objects/${TEST_PATH}`);

    expect(res.status).toBe(403);
  });

  it("allows admin to access pending media without ownership check", async () => {
    // isApprovedPublicMedia → false
    mockDb.execute.mockResolvedValueOnce({ rows: [{ is_public: false }] });
    // The object must still be recognized as owned by an office.
    mockDb.execute.mockResolvedValueOnce({ rows: [{ office_id: 42 }] });
    // Serve the object directly
    mockObjStorage.getObjectEntityFile.mockResolvedValueOnce({ bucket: "b", key: TEST_PATH });
    mockObjStorage.downloadObject.mockResolvedValueOnce(
      new Response("data", { status: 200, headers: { "Content-Type": "image/webp" } }),
    );

    const app = await makeStorageApp(ADMIN_USER);
    const res = await request(app).get(`/storage/objects/${TEST_PATH}`);

    expect(res.status).toBe(200);
  });

  it("a user with no office row is forbidden from pending media", async () => {
    // isApprovedPublicMedia → false
    mockDb.execute.mockResolvedValueOnce({ rows: [{ is_public: false }] });
    // Unified private-object owner lookup finds office 42.
    mockDb.execute.mockResolvedValueOnce({ rows: [{ office_id: 42 }] });
    // The requester has no office row
    mockDb.select.mockReturnValueOnce(selectChain([]));

    const app = await makeStorageApp(OFFICE_USER);
    const res = await request(app).get(`/storage/objects/${TEST_PATH}`);

    expect(res.status).toBe(403);
  });

  it("forbids another office from reading an unregistered claimed upload", async () => {
    mockDb.execute.mockResolvedValueOnce({ rows: [{ is_public: false }] });
    // The active upload-claim lookup associates the path with office 42.
    mockDb.execute.mockResolvedValueOnce({ rows: [{ office_id: 42 }] });
    mockDb.select.mockReturnValueOnce(selectChain([{ id: 99 }]));

    const app = await makeStorageApp(OTHER_OFFICE_USER);
    const res = await request(app).get(`/storage/objects/${TEST_PATH}`);

    expect(res.status).toBe(403);
  });

  it("denies an authenticated user an unrecognized private path", async () => {
    mockDb.execute.mockResolvedValueOnce({ rows: [{ is_public: false }] });
    mockDb.execute.mockResolvedValueOnce({ rows: [] });

    const app = await makeStorageApp(OFFICE_USER);
    const res = await request(app).get(`/storage/objects/${TEST_PATH}`);

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Tests: validateObjectMetadata — content-type and size checks
// ---------------------------------------------------------------------------

describe("validateObjectMetadata — defense-in-depth content checks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a gallery_video upload if S3 object content-type is image/jpeg", async () => {
    // Office row
    mockDb.select.mockReturnValueOnce(selectChain([MOCK_OFFICE]));
    // Valid gallery_video claim
    mockDb.select.mockReturnValueOnce(selectChain([VALID_CLAIM]));
    // Delete claim
    mockDb.delete.mockReturnValueOnce(deleteChain());
    // validateObjectMetadata HEAD check returns wrong MIME
    mockObjStorage.getObjectEntityMetadata.mockResolvedValueOnce({
      contentType: "image/jpeg",
      contentLength: 1024,
    });

    const app = await makeOfficesApp(OFFICE_USER);
    const res = await request(app)
      .post("/offices/me/media")
      .send({ objectPath: "/objects/uploads/test-uuid", type: "video" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_file_type");
  });

  it("rejects a document upload if S3 object is a video (not PDF/image)", async () => {
    mockDb.select.mockReturnValueOnce(selectChain([MOCK_OFFICE]));
    mockDb.select.mockReturnValueOnce(
      selectChain([{ ...VALID_CLAIM, category: "document" }]),
    );
    mockDb.delete.mockReturnValueOnce(deleteChain());
    // Returns video content-type — not allowed for documents
    mockObjStorage.getObjectEntityMetadata.mockResolvedValueOnce({
      contentType: "video/mp4",
      contentLength: 2 * 1024 * 1024,
    });

    const app = await makeOfficesApp(OFFICE_USER);
    const res = await request(app)
      .post("/offices/me/documents")
      .send({ objectPath: "/objects/uploads/test-uuid", documentType: "identity" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_file_type");
  });

  it("rejects a document upload if the S3 object exceeds the 15 MB size limit", async () => {
    mockDb.select.mockReturnValueOnce(selectChain([MOCK_OFFICE]));
    mockDb.select.mockReturnValueOnce(
      selectChain([{ ...VALID_CLAIM, category: "document" }]),
    );
    mockDb.delete.mockReturnValueOnce(deleteChain());
    // Exceeds 15 MB limit
    mockObjStorage.getObjectEntityMetadata.mockResolvedValueOnce({
      contentType: "application/pdf",
      contentLength: 16 * 1024 * 1024,
    });

    const app = await makeOfficesApp(OFFICE_USER);
    const res = await request(app)
      .post("/offices/me/documents")
      .send({ objectPath: "/objects/uploads/test-uuid", documentType: "identity" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("file_too_large");
  });
});
