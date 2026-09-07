import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VerificationDeliveryError } from "../verificationDeliveryError";

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../healthTracker", () => ({
  recordEmailAttempt: vi.fn(),
}));

const originalEnv = { ...process.env };

describe("verification delivery providers", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("fails closed for production email verification without Resend", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
    const { createEmailProvider } = await import("../email");
    const provider = createEmailProvider();

    await expect(
      provider.sendVerificationCode({
        to: "office@example.com",
        locale: "en",
        code: "123456",
        expiryMinutes: 10,
        channel: "email",
      }),
    ).rejects.toMatchObject({
      name: "VerificationDeliveryError",
      channel: "email",
      reason: "provider_not_configured",
    });
  });

  it("propagates Resend rejection for verification while preserving reset anti-enumeration behavior", async () => {
    process.env.NODE_ENV = "production";
    process.env.RESEND_API_KEY = "test-key";
    process.env.RESEND_FROM_EMAIL = "SkayOffice <verify@example.com>";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "rejected" }), { status: 400 }),
      ),
    );
    const { createEmailProvider } = await import("../email");
    const provider = createEmailProvider();

    await expect(
      provider.sendVerificationCode({
        to: "office@example.com",
        locale: "en",
        code: "123456",
        expiryMinutes: 10,
        channel: "email",
      }),
    ).rejects.toMatchObject({
      name: "VerificationDeliveryError",
      channel: "email",
      reason: "provider_rejected",
    });

    await expect(
      provider.sendPasswordResetEmail({
        to: "office@example.com",
        locale: "en",
        resetUrl: "https://example.com/reset",
        expiryMinutes: 10,
      }),
    ).resolves.toBeUndefined();
  });

  it("fails closed for production SMS verification without Twilio", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_FROM_PHONE;
    delete process.env.TWILIO_MESSAGING_SERVICE_SID;
    const { createOtpProvider } = await import("../otpProvider");
    const provider = createOtpProvider();

    await expect(
      provider.sendOtp("+966500000000", "123456"),
    ).rejects.toMatchObject({
      name: "VerificationDeliveryError",
      channel: "phone",
      reason: "provider_not_configured",
    });
  });

  it("sends an E.164 SMS through Twilio when configured", async () => {
    process.env.NODE_ENV = "production";
    process.env.TWILIO_ACCOUNT_SID = "AC_test";
    process.env.TWILIO_AUTH_TOKEN = "test-token";
    process.env.TWILIO_FROM_PHONE = "+15550000000";
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const { createOtpProvider } = await import("../otpProvider");
    const provider = createOtpProvider();

    await provider.sendOtp("+966500000000", "123456");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/Accounts/AC_test/Messages.json");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).has("authorization")).toBe(true);
    const body = init.body as URLSearchParams;
    expect(body.get("To")).toBe("+966500000000");
    expect(body.get("From")).toBe("+15550000000");
    expect(body.get("Body")).toContain("123456");
  });
});