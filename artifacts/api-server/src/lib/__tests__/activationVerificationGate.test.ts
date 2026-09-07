import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, resultQueue } = vi.hoisted(() => ({
  resultQueue: [] as unknown[][],
  mockDb: { select: vi.fn() },
}));

vi.mock("@workspace/db", () => ({
  db: mockDb,
  pool: { query: vi.fn() },
  officeServicesTable: { id: {}, officeId: {} },
  officeMediaTable: {},
  officeVerificationDocumentsTable: {
    officeId: {},
  },
  officeAdminNotesTable: {},
  usersTable: {
    id: {},
    emailVerifiedAt: {},
    phoneVerifiedAt: {},
  },
  serviceRequestsTable: {},
  serviceRequestReviewsTable: {},
}));
vi.mock("../objectStorage", () => ({ verifyObjectReadable: vi.fn() }));
vi.mock("../auditLog", () => ({ recordAuditLog: vi.fn() }));
vi.mock("../imageProcessor", () => ({ toPublicVariants: vi.fn() }));

function queueSelectResults(...rows: unknown[][]) {
  resultQueue.push(...rows);
  mockDb.select.mockImplementation(() => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockImplementation(async () => resultQueue.shift() ?? []),
    }),
  }));
}

const readyOffice = {
  id: 101,
  userId: 202,
  status: "approved",
  name: "Ready Office",
  shortDescription: "Ready",
  city: "Riyadh",
  category: "legal",
  whatsapp: "+966500000000",
  spokenLanguages: ["ar"],
  customLanguages: [],
};

const approvedDocuments = [
  { documentType: "identity", status: "approved" },
  { documentType: "trade_license", status: "approved" },
];

describe("office activation contact-verification gate", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resultQueue.length = 0;
  });

  it("keeps both blockers even when identity and trade-license documents are approved", async () => {
    queueSelectResults([{ id: 1 }], approvedDocuments, [{
      emailVerifiedAt: null,
      phoneVerifiedAt: null,
    }]);
    const { getActivationBlockers } = await import("../officeSerializer");

    const blockers = await getActivationBlockers(readyOffice as any);

    expect(blockers).toContain("email_not_verified");
    expect(blockers).toContain("phone_not_verified");
    expect(blockers).not.toContain("identity_document_not_approved");
    expect(blockers).not.toContain("trade_license_not_approved");
  });

  it("removes only the blocker for the channel that was actually verified", async () => {
    queueSelectResults([{ id: 1 }], approvedDocuments, [{
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: null,
    }]);
    const { getActivationBlockers } = await import("../officeSerializer");

    const blockers = await getActivationBlockers(readyOffice as any);

    expect(blockers).not.toContain("email_not_verified");
    expect(blockers).toContain("phone_not_verified");
  });

  it("allows the contact-verification gate only after both channels are verified", async () => {
    queueSelectResults([{ id: 1 }], approvedDocuments, [{
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: new Date(),
    }]);
    const { getActivationBlockers } = await import("../officeSerializer");

    const blockers = await getActivationBlockers(readyOffice as any);

    expect(blockers).not.toContain("email_not_verified");
    expect(blockers).not.toContain("phone_not_verified");
  });
});