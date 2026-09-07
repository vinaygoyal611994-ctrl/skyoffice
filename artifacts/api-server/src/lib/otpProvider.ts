import { logger } from "./logger";
import { VerificationDeliveryError } from "./verificationDeliveryError";

/**
 * Swappable SMS OTP provider interface.
 *
 * Production uses Twilio when configured. Development deliberately uses a
 * local-only adapter so automated tests and local work never contact real
 * phone numbers.
 */
export interface OtpProvider {
  /** Send an OTP code to a phone number. */
  sendOtp(phone: string, code: string): Promise<void>;
}

export class DevelopmentOtpProvider implements OtpProvider {
  async sendOtp(phone: string, code: string): Promise<void> {
    logger.info(
      { phone: phone.replace(/\d(?=\d{4})/g, "*"), code },
      "[sms:dev] Verification code (development only — SMS not sent)",
    );
  }
}

export class UnconfiguredOtpProvider implements OtpProvider {
  async sendOtp(_phone: string, _code: string): Promise<void> {
    throw new VerificationDeliveryError(
      "phone",
      "provider_not_configured",
      "SMS verification is unavailable because the provider is not configured",
    );
  }
}

export class TwilioOtpProvider implements OtpProvider {
  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly sender: { fromPhone?: string; messagingServiceSid?: string },
  ) {}

  async sendOtp(phone: string, code: string): Promise<void> {
    const body = new URLSearchParams({
      To: phone,
      Body: `SkayOffice verification code: ${code}. It expires in 10 minutes.`,
    });

    if (this.sender.messagingServiceSid) {
      body.set("MessagingServiceSid", this.sender.messagingServiceSid);
    } else if (this.sender.fromPhone) {
      body.set("From", this.sender.fromPhone);
    }

    let response: Response;
    try {
      response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.accountSid)}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body,
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch (cause) {
      throw new VerificationDeliveryError(
        "phone",
        "provider_unreachable",
        "SMS provider could not be reached",
        { cause },
      );
    }

    if (!response.ok) {
      let providerCode: string | number | undefined;
      try {
        const payload = (await response.json()) as { code?: string | number };
        providerCode = payload.code;
      } catch {
        // Keep provider response bodies out of logs and client errors.
      }
      logger.error(
        { status: response.status, providerCode },
        "[sms] Twilio rejected verification message",
      );
      throw new VerificationDeliveryError(
        "phone",
        "provider_rejected",
        "SMS provider rejected the verification message",
      );
    }

    logger.info({ phone }, "[sms] Verification message accepted by Twilio");
  }
}

export function createOtpProvider(): OtpProvider {
  if (process.env.NODE_ENV !== "production") {
    logger.info("[sms] DevelopmentOtpProvider active");
    return new DevelopmentOtpProvider();
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromPhone =
    process.env.TWILIO_FROM_PHONE_NUMBER ?? process.env.TWILIO_FROM_PHONE;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

  if (!accountSid || !authToken || (!fromPhone && !messagingServiceSid)) {
    logger.warn(
      "[sms] Twilio is not configured — phone verification delivery is unavailable",
    );
    return new UnconfiguredOtpProvider();
  }

  logger.info("[sms] TwilioOtpProvider active");
  return new TwilioOtpProvider(accountSid, authToken, {
    fromPhone,
    messagingServiceSid,
  });
}

export const otpProvider: OtpProvider = createOtpProvider();
