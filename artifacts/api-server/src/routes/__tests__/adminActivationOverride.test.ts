import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";

const {
  mockDb,
  mockTx,
  mockGetActivationBlockers,
  mockSerializeDetail,
  mockRecordAuditLog,
  state,
} = vi.hoisted(() => ({
  mockDb: {
    select: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
  mockTx: {
    select: vi.fn(),
    update: vi.fn(),
  },
  mockGetActivationBlockers: vi.fn(),
  mockSerializeDetail: vi.fn(),
  mockRecordAuditLog: vi.fn(),
  state: {
    office: null as Record<string, unknown> | null,
    updatePatch: null as Record<string, unknown> | null,
    returnNoUpdatedRows: false,
  },
}));

const table = { id: {}, userId: {}, status: {} };

vi.mock("@workspace/db", () => ({
  db: mockDb,
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
  officesTable: table,
  usersTable: table,
  favouritesTable: table,
  auditLogTable: table,
  contactEventsTable: table,
  videoCallRequestsTable: table,
  marketSupplyControlTable: table,
  marketSupplyCapHistoryTable: table,
  officeVerificationDocumentsTable: table,
  officeAdminNotesTable: table,
  officeMediaTable: table,
}));
vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  count: vi.fn(),
  eq: vi.fn(),
  desc: vi.fn(),
}));
vi.mock("../../lib/officeSerializer", () => ({
  serializeAdminOfficeSummary: vi.fn(),
  serializeAdminApplicationSummary: vi.fn(),
  serializeAdminApplicationDetail: mockSerializeDetail,
  serializeVerificationDocument: vi.fn(),
  getActivationBlockers: mockGetActivationBlockers,
  loadAdminNotesByOfficeId: vi.fn(),
}));
vi.mock("../../lib/auditLog", () => ({
  recordAuditLog: mockRecordAuditLog,
}));
vi.mock("../../middlewares/authMiddleware", () => ({
  requireRole:
    (...roles: string[]) =>
    (req: Request, res: Response, next: NextFunction) => {
      const role = req.header("x-test-role");
      if (!role) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }
      if (!roles.includes(role)) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      (req as any).session = {
        user: {
          id: 77,
          role,
          name: "Override Admin",
          email: "admin@example.test",
        },
      };
      next();
    },
}));
vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class {},
}));
vi.mock("../../lib/imageProcessor", () => ({
  deleteImageVariants: vi.fn(),
}));
vi.mock("../../lib/marketClassifier", () => ({
  classifyMarket: vi.fn(),
  computeCapRecommendation: vi.fn(),
}));
vi.mock("../../lib/marketRecompute", () => ({
  fetchAllMarketSignals: vi.fn(),
  runMarketRecompute: vi.fn(),
}));
vi.mock("../../lib/marketGate", () => ({
  checkMarketGateForOffice: vi.fn(),
  resolveMarket: vi.fn(),
  computeCapStatus: vi.fn(),
}));
vi.mock("../../lib/email", () => ({
  emailProvider: {},
}));
vi.mock("../../lib/supplySlotManager", () => ({
  allocateNewApproval: vi.fn(),
  processWaitlist: vi.fn(),
  countAllocatedSlotsForMarket: vi.fn(),
  releaseSlot: vi.fn(),
}));

function selectChain() {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockImplementation(async () =>
        state.office ? [state.office] : [],
      ),
    }),
  };
}

function updateChain() {
  return {
    set: vi.fn().mockImplementation((patch: Record<string, unknown>) => {
      state.updatePatch = patch;
      return {
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockImplementation(async () => [{
            ...state.office,
            ...patch,
          }].filter(() => !state.returnNoUpdatedRows)),
        }),
      };
    }),
  };
}

let app: express.Express;

beforeAll(async () => {
  const router = (await import("../admin")).default;
  app = express();
  app.use(express.json());
  app.use(router);
});

beforeEach(() => {
  vi.resetAllMocks();
  state.office = {
    id: 101,
    userId: 202,
    status: "approved",
    isVerified: false,
    emailVerifiedAt: null,
    phoneVerifiedAt: null,
    documents: [
      { documentType: "identity", status: "pending" },
      { documentType: "trade_license", status: "rejected" },
    ],
  };
  state.updatePatch = null;
  state.returnNoUpdatedRows = false;
  mockDb.select.mockImplementation(selectChain);
  mockDb.update.mockImplementation(updateChain);
  mockTx.select.mockImplementation(selectChain);
  mockTx.update.mockImplementation(updateChain);
  mockDb.transaction.mockImplementation(async (callback: (tx: typeof mockTx) => unknown) =>
    callback(mockTx),
  );
  mockSerializeDetail.mockImplementation(async (office) => ({
    ...office,
    activationBlockers: await mockGetActivationBlockers(office),
  }));
  mockRecordAuditLog.mockResolvedValue(undefined);
});

describe("admin office activation override", () => {
  it("keeps normal activation working when there are no blockers", async () => {
    mockGetActivationBlockers.mockResolvedValue([]);

    const response = await request(app)
      .post("/admin/applications/101/activate")
      .set("x-test-role", "admin");

    expect(response.status).toBe(200);
    expect(state.updatePatch).toMatchObject({
      status: "active",
      isVerified: true,
    });
    expect(mockRecordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "office.application.activate",
        targetId: 101,
      }),
      mockTx,
    );
  });

  it("keeps normal activation blocked when blockers exist", async () => {
    mockGetActivationBlockers.mockResolvedValue([
      "email_not_verified",
      "identity_document_not_approved",
    ]);

    const response = await request(app)
      .post("/admin/applications/101/activate")
      .set("x-test-role", "admin");

    expect(response.status).toBe(400);
    expect(response.body.blockers).toEqual([
      "email_not_verified",
      "identity_document_not_approved",
    ]);
    expect(state.updatePatch).toBeNull();
    expect(mockRecordAuditLog).not.toHaveBeenCalled();
  });

  it("does not let normal activation overwrite a concurrent status change", async () => {
    mockGetActivationBlockers.mockResolvedValue([]);
    state.returnNoUpdatedRows = true;

    const response = await request(app)
      .post("/admin/applications/101/activate")
      .set("x-test-role", "admin");

    expect(response.status).toBe(409);
    expect(mockRecordAuditLog).not.toHaveBeenCalled();
  });

  it("allows an authorized admin override and audits the exact blockers", async () => {
    const blockers = [
      "email_not_verified",
      "phone_not_verified",
      "identity_document_not_approved",
    ];
    mockGetActivationBlockers.mockResolvedValue(blockers);

    const response = await request(app)
      .post("/admin/applications/101/activate-override")
      .set("x-test-role", "admin")
      .send({ confirm: true, expectedBlockers: blockers });

    expect(response.status).toBe(200);
    expect(state.updatePatch).toEqual({
      status: "active",
      activatedAt: expect.any(Date),
      isVerified: true,
    });
    expect(state.updatePatch).not.toHaveProperty("emailVerifiedAt");
    expect(state.updatePatch).not.toHaveProperty("phoneVerifiedAt");
    expect(state.updatePatch).not.toHaveProperty("documents");
    expect(state.office?.emailVerifiedAt).toBeNull();
    expect(state.office?.phoneVerifiedAt).toBeNull();
    expect(state.office?.documents).toEqual([
      { documentType: "identity", status: "pending" },
      { documentType: "trade_license", status: "rejected" },
    ]);
    expect(mockRecordAuditLog).toHaveBeenCalledWith(
      {
        actor: expect.objectContaining({ id: 77, role: "admin" }),
        action: "office.application.activate_override",
        targetType: "office",
        targetId: 101,
        metadata: {
          activationMethod: "admin_override",
          overrideAt: expect.any(String),
          blockers,
          officeStatusBefore: "approved",
        },
      },
      mockTx,
    );
  });

  it("requires explicit confirmation", async () => {
    mockGetActivationBlockers.mockResolvedValue(["email_not_verified"]);

    const response = await request(app)
      .post("/admin/applications/101/activate-override")
      .set("x-test-role", "admin")
      .send({ confirm: false, expectedBlockers: ["email_not_verified"] });

    expect(response.status).toBe(400);
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("rejects non-admin callers before accessing office data", async () => {
    const response = await request(app)
      .post("/admin/applications/101/activate-override")
      .set("x-test-role", "office")
      .send({ confirm: true, expectedBlockers: ["email_not_verified"] });

    expect(response.status).toBe(403);
    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(mockRecordAuditLog).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated callers before accessing office data", async () => {
    const response = await request(app)
      .post("/admin/applications/101/activate-override")
      .send({
        confirm: true,
        expectedBlockers: ["email_not_verified"],
      });

    expect(response.status).toBe(401);
    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(mockRecordAuditLog).not.toHaveBeenCalled();
  });

  it("directs admins to normal activation when no blockers remain", async () => {
    mockGetActivationBlockers.mockResolvedValue([]);

    const response = await request(app)
      .post("/admin/applications/101/activate-override")
      .set("x-test-role", "admin")
      .send({ confirm: true, expectedBlockers: ["email_not_verified"] });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("use normal activation");
    expect(state.updatePatch).toBeNull();
  });

  it("rejects stale confirmation when blockers changed", async () => {
    mockGetActivationBlockers.mockResolvedValue([
      "email_not_verified",
      "phone_not_verified",
    ]);

    const response = await request(app)
      .post("/admin/applications/101/activate-override")
      .set("x-test-role", "admin")
      .send({
        confirm: true,
        expectedBlockers: ["email_not_verified"],
      });

    expect(response.status).toBe(409);
    expect(response.body.blockers).toEqual([
      "email_not_verified",
      "phone_not_verified",
    ]);
    expect(state.updatePatch).toBeNull();
    expect(mockRecordAuditLog).not.toHaveBeenCalled();
  });
});