import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";

const {
  mockDb,
  mockIssueEmail,
  mockIssuePhone,
  mockConfirmEmail,
  mockConfirmPhone,
} = vi.hoisted(() => ({
  mockDb: { select: vi.fn() },
  mockIssueEmail: vi.fn(),
  mockIssuePhone: vi.fn(),
  mockConfirmEmail: vi.fn(),
  mockConfirmPhone: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: mockDb,
  usersTable: {
    id: {},
    email: {},
    phone: {},
    emailVerifiedAt: {},
    phoneVerifiedAt: {},
  },
}));
vi.mock("../../middlewares/authMiddleware", () => ({
  requireRole:
    () => (req: Request, _res: Response, next: NextFunction) => {
      (req as any).session = { user: { id: 9, role: "office" } };
      next();
    },
}));
vi.mock("../../lib/providerVerification", () => ({
  issueEmailVerificationToken: mockIssueEmail,
  issuePhoneVerificationToken: mockIssuePhone,
  confirmEmailVerification: mockConfirmEmail,
  confirmPhoneVerification: mockConfirmPhone,
  getVerificationStatus: vi.fn(),
}));
vi.mock("../../lib/auditLog", () => ({
  recordAuditLog: vi.fn().mockResolvedValue(undefined),
}));

let app: express.Express;

beforeAll(async () => {
  const router = (await import("../providerVerification")).default;
  app = express();
  app.use(express.json());
  app.use(router);
});

beforeEach(() => {
  vi.resetAllMocks();
  mockDb.select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([{
        email: "office@example.com",
        phone: "+966500000000",
        emailVerifiedAt: null,
        phoneVerifiedAt: null,
      }]),
    }),
  });
});

describe("provider verification delivery routes", () => {
  it("returns 503 and never claims success when email is not configured", async () => {
    const { VerificationDeliveryError } = await import("../../lib/verificationDeliveryError");
    mockIssueEmail.mockRejectedValue(
      new VerificationDeliveryError(
        "email",
        "provider_not_configured",
        "not configured",
      ),
    );

    const response = await request(app).post("/auth/verify/send-email");

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      code: "verification_provider_not_configured",
      channel: "email",
    });
    expect(response.body.message).toBeUndefined();
  });

  it("returns a sent response only after email delivery succeeds", async () => {
    mockIssueEmail.mockResolvedValue(undefined);

    const response = await request(app).post("/auth/verify/send-email");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      message: "Verification code sent",
      email: "office@example.com",
    });
  });

  it("returns 503 and never claims success when SMS delivery is unavailable", async () => {
    const { VerificationDeliveryError } = await import("../../lib/verificationDeliveryError");
    mockIssuePhone.mockRejectedValue(
      new VerificationDeliveryError(
        "phone",
        "provider_not_configured",
        "not configured",
      ),
    );

    const response = await request(app).post("/auth/verify/send-phone");

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      code: "verification_provider_not_configured",
      channel: "phone",
    });
  });

  it("confirms each channel through its own endpoint", async () => {
    mockConfirmEmail.mockResolvedValue({ ok: true });
    mockConfirmPhone.mockResolvedValue({ ok: true });

    const email = await request(app)
      .post("/auth/verify/confirm-email")
      .send({ code: "123456" });
    const phone = await request(app)
      .post("/auth/verify/confirm-phone")
      .send({ code: "654321" });

    expect(email.status).toBe(200);
    expect(email.body.emailVerified).toBe(true);
    expect(phone.status).toBe(200);
    expect(phone.body.phoneVerified).toBe(true);
  });
});