import { afterEach, describe, expect, it, vi } from "vitest";

describe("OTP provider configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("fails closed in production when Twilio is not configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TWILIO_ACCOUNT_SID", "");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "");
    vi.stubEnv("TWILIO_FROM_PHONE_NUMBER", "");
    vi.stubEnv("TWILIO_MESSAGING_SERVICE_SID", "");

    const { createOtpProvider } = await import("../otpProvider");
    await expect(
      createOtpProvider().sendOtp("+966500000000", "123456"),
    ).rejects.toThrow("SMS verification is unavailable");
  });

  it("uses a safe local provider when Twilio is absent in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("TWILIO_ACCOUNT_SID", "");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "");
    vi.stubEnv("TWILIO_FROM_PHONE_NUMBER", "");
    vi.stubEnv("TWILIO_FROM_PHONE", "");
    vi.stubEnv("TWILIO_MESSAGING_SERVICE_SID", "");

    const { createOtpProvider } = await import("../otpProvider");
    await expect(
      createOtpProvider().sendOtp("+966500000000", "123456"),
    ).resolves.toBeUndefined();
  });

  it("uses Twilio and resolves only when its API accepts the message", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC_test");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "secret");
    vi.stubEnv("TWILIO_FROM_PHONE_NUMBER", "+15550000000");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("{}", { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { createOtpProvider } = await import("../otpProvider");
    await createOtpProvider().sendOtp("+966500000000", "123456");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(String(init.body)).toContain("To=%2B966500000000");
    expect(String(init.body)).toContain("From=%2B15550000000");
  });

  it("rejects when Twilio rejects the message", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC_test");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "secret");
    vi.stubEnv("TWILIO_MESSAGING_SERVICE_SID", "MG_test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("invalid destination", { status: 400 })),
    );

    const { createOtpProvider } = await import("../otpProvider");
    await expect(
      createOtpProvider().sendOtp("+966500000000", "123456"),
    ).rejects.toThrow("SMS provider rejected");
  });
});
