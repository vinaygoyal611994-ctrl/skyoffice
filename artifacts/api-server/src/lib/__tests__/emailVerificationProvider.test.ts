import { afterEach, describe, expect, it, vi } from "vitest";

const verificationMessage = {
  to: "provider@example.com",
  locale: "en" as const,
  code: "123456",
  expiryMinutes: 10,
  channel: "email" as const,
};

describe("email verification provider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("fails closed in production when Resend is not configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("RESEND_FROM_EMAIL", "");

    const { createEmailProvider } = await import("../email");
    await expect(
      createEmailProvider().sendVerificationCode(verificationMessage),
    ).rejects.toThrow("Email verification is unavailable");
  });

  it("uses Resend in development when credentials are configured", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("RESEND_API_KEY", "test_key");
    vi.stubEnv("RESEND_FROM_EMAIL", "SkayOffice <verify@example.com>");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "email_1" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { createEmailProvider } = await import("../email");
    await createEmailProvider().sendVerificationCode(verificationMessage);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(String(init.body)).toContain("provider@example.com");
  });

  it("rejects when Resend does not accept the delivery request", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", "test_key");
    vi.stubEnv("RESEND_FROM_EMAIL", "SkayOffice <verify@example.com>");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("rejected", { status: 422 })),
    );

    const { createEmailProvider } = await import("../email");
    await expect(
      createEmailProvider().sendVerificationCode(verificationMessage),
    ).rejects.toThrow("Email provider rejected");
  });
});