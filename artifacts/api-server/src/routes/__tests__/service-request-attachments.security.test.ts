import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import {
  hasValidServiceRequestAttachmentSignature,
  safeAttachmentFileName,
} from "../../lib/serviceRequestAttachments";

const { mockDb, mockTx, mockStorage, mockOfficeId } = vi.hoisted(() => ({
  mockDb: {
    select: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
  },
  mockTx: {
    select: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
    execute: vi.fn(),
  },
  mockStorage: {
    getObjectEntityUploadURL: vi.fn(),
    normalizeObjectEntityPath: vi.fn(),
    getObjectEntityMetadata: vi.fn(),
    getObjectEntityFile: vi.fn(),
    downloadObjectBuffer: vi.fn(),
    downloadObject: vi.fn(),
    saveObjectEntity: vi.fn(),
    deleteObjectEntity: vi.fn(),
  },
  mockOfficeId: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: mockDb,
  pool: undefined,
  officesTable: { id: {}, userId: {} },
  usersTable: { id: {} },
  auditLogTable: {},
  serviceRequestsTable: { id: {}, customerId: {}, officeId: {}, status: {} },
  serviceRequestReviewsTable: {},
  serviceRequestAttachmentsTable: {
    id: {}, requestId: {}, uploaderUserId: {}, uploaderRole: {}, objectPath: {},
    fileName: {}, contentType: {}, fileSize: {}, createdAt: {},
  },
  serviceRequestAttachmentReservationsTable: {
    id: {}, requestId: {}, uploaderUserId: {}, uploaderRole: {}, objectPath: {},
    fileName: {}, contentType: {}, fileSize: {}, expiresAt: {},
  },
}));

vi.mock("../../lib/auth", () => ({ getOfficeIdForUser: mockOfficeId }));
vi.mock("../../lib/serviceRequestNotificationOutbox", () => ({
  enqueueServiceRequestNotifications: vi.fn(),
}));
vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class MockObjectStorageService {
    getObjectEntityUploadURL(options?: unknown) { return mockStorage.getObjectEntityUploadURL(options); }
    normalizeObjectEntityPath(path: string) { return mockStorage.normalizeObjectEntityPath(path); }
    getObjectEntityMetadata(path: string) { return mockStorage.getObjectEntityMetadata(path); }
    getObjectEntityFile(path: string) { return mockStorage.getObjectEntityFile(path); }
    downloadObjectBuffer(file: unknown, max: number) { return mockStorage.downloadObjectBuffer(file, max); }
    downloadObject(file: unknown) { return mockStorage.downloadObject(file); }
    saveObjectEntity(bytes: Buffer, contentType: string, suffix?: string) {
      return mockStorage.saveObjectEntity(bytes, contentType, suffix);
    }
    deleteObjectEntity(path: string) { return mockStorage.deleteObjectEntity(path); }
  },
  ObjectNotFoundError: class ObjectNotFoundError extends Error {},
}));

function selectChain(rows: unknown[]) {
  const promise = Promise.resolve(rows);
  const chain: Record<string, unknown> = {
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
  for (const name of ["from", "where", "innerJoin", "leftJoin", "orderBy", "limit"]) {
    chain[name] = vi.fn().mockReturnValue(chain);
  }
  return chain;
}

function insertChain(rows: unknown[] = []) {
  return {
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue(rows),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve),
    }),
  };
}

function deleteChain(rows: unknown[] = []) {
  return {
    where: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue(rows),
    }),
  };
}

const customerA = {
  id: 1, role: "customer" as const, name: "Customer A", email: "a@example.com",
  status: "active" as const, statusReason: null, officeId: null, createdAt: new Date(), phone: null,
};
const customerB = { ...customerA, id: 2, name: "Customer B", email: "b@example.com" };
const officeA = { ...customerA, id: 10, role: "office" as const, name: "Office A", email: "office@example.com", officeId: 100 };
const officeB = { ...officeA, id: 11, name: "Office B", email: "office-b@example.com", officeId: 101 };

const serviceRequest = {
  id: 42, customerId: 1, officeId: 100, serviceName: "Translation",
  description: "Translate a document", price: null, executionDuration: null,
  status: "submitted", officeCompletedAt: null, customerConfirmedAt: null,
  createdAt: new Date(), updatedAt: new Date(),
};
const reservation = {
  id: 8, requestId: 42, uploaderUserId: 10, uploaderRole: "office" as const,
  objectPath: "/objects/uploads/request-attachment", fileName: "evidence.pdf",
  contentType: "application/pdf" as const, fileSize: 8, expiresAt: new Date(Date.now() + 60_000),
  createdAt: new Date(),
};

async function makeApp(user: typeof customerA | typeof customerB | typeof officeA | typeof officeB | null) {
  const { default: router } = await import("../serviceRequests");
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    Object.defineProperty(req, "session", { value: { user }, configurable: true });
    Object.defineProperty(req, "log", {
      value: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
      configurable: true,
    });
    next();
  });
  app.use("/api", router);
  app.use((_err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: "Internal server error" });
  });
  return app;
}

let anonApp: express.Express;
let customerAApp: express.Express;
let customerBApp: express.Express;
let officeAApp: express.Express;
let officeBApp: express.Express;

beforeAll(async () => {
  [anonApp, customerAApp, customerBApp, officeAApp, officeBApp] = await Promise.all([
    makeApp(null), makeApp(customerA), makeApp(customerB), makeApp(officeA), makeApp(officeB),
  ]);
});

beforeEach(() => {
  vi.resetAllMocks();
  mockOfficeId.mockImplementation((id: number) => Promise.resolve(id === 10 ? 100 : id === 11 ? 101 : null));
  mockDb.transaction.mockImplementation(async (callback: (tx: typeof mockTx) => unknown) => callback(mockTx));
  mockStorage.getObjectEntityUploadURL.mockResolvedValue("https://storage.test/private/uploads/request-attachment");
  mockStorage.normalizeObjectEntityPath.mockReturnValue("/objects/uploads/request-attachment");
  mockStorage.saveObjectEntity.mockResolvedValue("/objects/uploads/verified-attachment");
  mockStorage.deleteObjectEntity.mockResolvedValue(undefined);
  mockTx.execute.mockResolvedValue({ rows: [] });
});

describe("service-request attachment file verification", () => {
  it("accepts JPG, PNG, and PDF signatures only", () => {
    expect(hasValidServiceRequestAttachmentSignature("image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(hasValidServiceRequestAttachmentSignature("image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    expect(hasValidServiceRequestAttachmentSignature("application/pdf", Buffer.from("%PDF-1.7"))).toBe(true);
    expect(hasValidServiceRequestAttachmentSignature("application/pdf", Buffer.from("not a PDF"))).toBe(false);
    expect(hasValidServiceRequestAttachmentSignature("image/jpeg", Buffer.from("not an image"))).toBe(false);
  });

  it("removes path components and unsafe characters from stored display names", () => {
    expect(safeAttachmentFileName("../../invoice<>.pdf")).toBe("invoice__.pdf");
  });
});

describe("service-request attachment access and reservations", () => {
  it("rejects anonymous upload URL requests", async () => {
    const res = await request(anonApp)
      .post("/api/service-requests/42/attachments/request-url")
      .send({ name: "evidence.pdf", size: 8, contentType: "application/pdf" });
    expect(res.status).toBe(401);
  });

  it("hides another customer's attachment list (IDOR)", async () => {
    mockDb.select.mockReturnValueOnce(selectChain([serviceRequest]));
    const res = await request(customerBApp).get("/api/service-requests/42/attachments");
    expect(res.status).toBe(404);
  });

  it("hides another office's attachment list (cross-office IDOR)", async () => {
    mockDb.select.mockReturnValueOnce(selectChain([serviceRequest]));
    const res = await request(officeBApp).get("/api/service-requests/42/attachments");
    expect(res.status).toBe(404);
  });

  it("allows only the office to reserve an upload while a request is submitted", async () => {
    mockDb.select.mockReturnValueOnce(selectChain([serviceRequest]));
    const customerRes = await request(customerAApp)
      .post("/api/service-requests/42/attachments/request-url")
      .send({ name: "evidence.pdf", size: 8, contentType: "application/pdf" });
    expect(customerRes.status).toBe(409);

    mockDb.select.mockReturnValueOnce(selectChain([serviceRequest]));
    mockTx.select
      .mockReturnValueOnce(selectChain([{ fileCount: 0, totalSize: 0 }]))
      .mockReturnValueOnce(selectChain([{ fileCount: 0, totalSize: 0 }]));
    mockTx.insert.mockReturnValueOnce({ values: vi.fn().mockResolvedValue(undefined) });
    const officeRes = await request(officeAApp)
      .post("/api/service-requests/42/attachments/request-url")
      .send({ name: "evidence.pdf", size: 8, contentType: "application/pdf" });
    expect(officeRes.status).toBe(201);
    expect(officeRes.body.objectPath).toBe("/objects/uploads/request-attachment");
    expect(mockTx.execute).toHaveBeenCalledTimes(1);
    expect(mockStorage.getObjectEntityUploadURL).toHaveBeenCalledWith({
      contentType: "application/pdf",
      contentLength: 8,
      expiresIn: 300,
    });
  });

  it("enforces the total attachment count before issuing a URL", async () => {
    mockDb.select.mockReturnValueOnce(selectChain([serviceRequest]));
    mockTx.select
      .mockReturnValueOnce(selectChain([{ fileCount: 5, totalSize: 100 }]))
      .mockReturnValueOnce(selectChain([{ fileCount: 0, totalSize: 0 }]));
    const res = await request(officeAApp)
      .post("/api/service-requests/42/attachments/request-url")
      .send({ name: "evidence.pdf", size: 8, contentType: "application/pdf" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("attachment_limit_reached");
  });

  it("registers a signature-verified upload once and consumes its reservation", async () => {
    mockDb.select
      .mockReturnValueOnce(selectChain([serviceRequest]))
      .mockReturnValueOnce(selectChain([reservation]));
    mockStorage.getObjectEntityMetadata.mockResolvedValue({ contentType: "application/pdf", contentLength: 8 });
    mockStorage.getObjectEntityFile.mockResolvedValue({ bucket: "private", key: "uploads/request-attachment" });
    mockStorage.downloadObjectBuffer.mockResolvedValue(Buffer.from("%PDF-1.7"));
    mockTx.delete.mockReturnValueOnce(deleteChain([reservation]));
    mockTx.insert.mockReturnValueOnce(insertChain([{
      ...reservation, id: 9, objectPath: "/objects/uploads/verified-attachment", createdAt: new Date(),
    }]));
    mockDb.insert.mockReturnValueOnce({ values: vi.fn().mockResolvedValue(undefined) });

    const res = await request(officeAApp)
      .post("/api/service-requests/42/attachments")
      .send({ objectPath: reservation.objectPath });
    expect(res.status).toBe(201);
    expect(res.body).not.toHaveProperty("objectPath");
    expect(mockTx.delete).toHaveBeenCalledTimes(1);
    expect(mockStorage.saveObjectEntity).toHaveBeenCalledWith(
      Buffer.from("%PDF-1.7"),
      "application/pdf",
      "service-request-attachment",
    );
    expect(mockStorage.deleteObjectEntity).toHaveBeenCalledWith(reservation.objectPath);
  });

  it("rejects MIME and magic-byte spoofing before a record is written", async () => {
    mockDb.select
      .mockReturnValueOnce(selectChain([serviceRequest]))
      .mockReturnValueOnce(selectChain([reservation]));
    mockStorage.getObjectEntityMetadata.mockResolvedValue({ contentType: "application/pdf", contentLength: 8 });
    mockStorage.getObjectEntityFile.mockResolvedValue({});
    mockStorage.downloadObjectBuffer.mockResolvedValue(Buffer.from("not a PDF"));

    const res = await request(officeAApp)
      .post("/api/service-requests/42/attachments")
      .send({ objectPath: reservation.objectPath });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("attachment_verification_failed");
    expect(mockTx.delete).not.toHaveBeenCalled();
  });

  it("rejects expired and replayed reservations", async () => {
    mockDb.select
      .mockReturnValueOnce(selectChain([serviceRequest]))
      .mockReturnValueOnce(selectChain([{ ...reservation, expiresAt: new Date(Date.now() - 1) }]));
    mockDb.delete.mockReturnValueOnce({ where: vi.fn().mockResolvedValue(undefined) });
    const expired = await request(officeAApp)
      .post("/api/service-requests/42/attachments")
      .send({ objectPath: reservation.objectPath });
    expect(expired.status).toBe(409);

    mockDb.select
      .mockReturnValueOnce(selectChain([serviceRequest]))
      .mockReturnValueOnce(selectChain([reservation]));
    mockStorage.getObjectEntityMetadata.mockResolvedValue({ contentType: "application/pdf", contentLength: 8 });
    mockStorage.getObjectEntityFile.mockResolvedValue({});
    mockStorage.downloadObjectBuffer.mockResolvedValue(Buffer.from("%PDF-1.7"));
    mockTx.delete.mockReturnValueOnce(deleteChain([]));
    const replay = await request(officeAApp)
      .post("/api/service-requests/42/attachments")
      .send({ objectPath: reservation.objectPath });
    expect(replay.status).toBe(409);
    expect(replay.body.code).toBe("attachment_reservation_invalid");
    expect(mockStorage.deleteObjectEntity).toHaveBeenCalledWith(
      "/objects/uploads/verified-attachment",
    );
  });
});