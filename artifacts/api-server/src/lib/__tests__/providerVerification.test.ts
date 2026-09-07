import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, mockTx, mockEmailProvider, mockOtpProvider } = vi.hoisted(() => ({
  mockDb: {
    transaction: vi.fn(),
    select: vi.fn(),
  },
  mockTx: {
    execute: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    select: vi.fn(),
  },
  mockEmailProvider: { sendVerificationCode: vi.fn() },
  mockOtpProvider: { sendOtp: vi.fn() },
}));

vi.mock("@workspace/db", () => ({
  db: mockDb,
  usersTable: { id: {}, emailVerifiedAt: {}, phoneVerifiedAt: {} },
  providerVerificationTokensTable: {
    id: {},
    userId: {},
    channel: {},
    tokenHash: {},
    expiresAt: {},
    usedAt: {},
    attemptCount: {},
    createdAt: {},
  },
}));

vi.mock("../email", () => ({ emailProvider: mockEmailProvider }));
vi.mock("../otpProvider", () => ({ otpProvider: mockOtpProvider }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

function updateChain(rows: unknown[]) {
  return {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(rows),
      }),
    }),
  };
}

describe("provider verification confirmation guards", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDb.transaction.mockImplementation(async (callback: (tx: typeof mockTx) => unknown) =>
      callback(mockTx),
    );
  });

  it("claims a valid code once before marking the user verified", async () => {
    mockTx.update
      .mockReturnValueOnce(updateChain([{ id: 17 }]))
      .mockReturnValueOnce(updateChain([]));

    const { confirmEmailVerification } = await import("../providerVerification");
    await expect(confirmEmailVerification(9, "123456")).resolves.toEqual({ ok: true });

    expect(mockTx.update).toHaveBeenCalledTimes(2);
  });

  it("persists failed guesses and invalidates a token at the third attempt", async () => {
    mockTx.update
      .mockReturnValueOnce(updateChain([]))
      .mockReturnValueOnce(updateChain([{ attemptCount: 3, usedAt: new Date() }]));

    const { confirmPhoneVerification } = await import("../providerVerification");
    await expect(confirmPhoneVerification(9, "000000")).resolves.toEqual({
      ok: false,
      reason: "attempts_exhausted",
    });

    expect(mockTx.update).toHaveBeenCalledTimes(2);
  });

  it("returns an ordinary invalid-code result before the attempt limit", async () => {
    mockTx.update
      .mockReturnValueOnce(updateChain([]))
      .mockReturnValueOnce(updateChain([{ attemptCount: 1, usedAt: null }]));

    const { confirmEmailVerification } = await import("../providerVerification");
    await expect(confirmEmailVerification(9, "000000")).resolves.toEqual({
      ok: false,
      reason: "invalid_code",
    });
  });
});

describe("provider verification delivery safety", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDb.transaction.mockImplementation(async (callback: (tx: typeof mockTx) => unknown) =>
      callback(mockTx),
    );
    mockTx.execute.mockResolvedValue(undefined);
    mockTx.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ count: 0 }]),
      }),
    });
    mockTx.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
    mockTx.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
  });

  it("persists an email token only after the email provider accepts delivery", async () => {
    const order: string[] = [];
    mockEmailProvider.sendVerificationCode.mockImplementation(async () => {
      order.push("delivered");
    });
    mockDb.transaction.mockImplementation(async (callback: (tx: typeof mockTx) => unknown) => {
      const result = await callback(mockTx);
      order.push("persisted");
      return result;
    });

    const { issueEmailVerificationToken } = await import("../providerVerification");
    await issueEmailVerificationToken(9, "provider@example.com");

    expect(order).toEqual(["delivered", "persisted"]);
    expect(mockTx.insert).toHaveBeenCalledTimes(1);
    expect(mockOtpProvider.sendOtp).not.toHaveBeenCalled();
  });

  it("does not mutate tokens when email delivery is rejected", async () => {
    mockEmailProvider.sendVerificationCode.mockRejectedValue(new Error("rejected"));

    const { issueEmailVerificationToken } = await import("../providerVerification");
    await expect(
      issueEmailVerificationToken(9, "provider@example.com"),
    ).rejects.toThrow("rejected");

    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(mockTx.update).not.toHaveBeenCalled();
    expect(mockTx.insert).not.toHaveBeenCalled();
  });

  it("persists a phone token only after Twilio accepts delivery", async () => {
    mockOtpProvider.sendOtp.mockResolvedValue(undefined);

    const { issuePhoneVerificationToken } = await import("../providerVerification");
    await issuePhoneVerificationToken(9, "+966500000000");

    expect(mockOtpProvider.sendOtp).toHaveBeenCalledTimes(1);
    expect(mockEmailProvider.sendVerificationCode).not.toHaveBeenCalled();
    expect(mockTx.insert).toHaveBeenCalledTimes(1);
  });

  it("does not mutate tokens when SMS delivery is rejected", async () => {
    mockOtpProvider.sendOtp.mockRejectedValue(new Error("rejected"));

    const { issuePhoneVerificationToken } = await import("../providerVerification");
    await expect(
      issuePhoneVerificationToken(9, "+966500000000"),
    ).rejects.toThrow("rejected");

    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(mockTx.update).not.toHaveBeenCalled();
    expect(mockTx.insert).not.toHaveBeenCalled();
  });

  it("enforces a durable hourly quota independently per channel", async () => {
    mockTx.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ count: 5 }]),
      }),
    });

    const { issueEmailVerificationToken, VerificationRateLimitError } =
      await import("../providerVerification");
    await expect(
      issueEmailVerificationToken(9, "provider@example.com"),
    ).rejects.toBeInstanceOf(VerificationRateLimitError);

    expect(mockEmailProvider.sendVerificationCode).not.toHaveBeenCalled();
    expect(mockOtpProvider.sendOtp).not.toHaveBeenCalled();
    expect(mockTx.execute).toHaveBeenCalledTimes(1);
  });
});