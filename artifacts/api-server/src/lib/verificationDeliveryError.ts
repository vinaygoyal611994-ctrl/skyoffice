export type VerificationDeliveryChannel = "email" | "phone";
export type VerificationDeliveryReason =
  | "provider_not_configured"
  | "provider_rejected"
  | "provider_unreachable";

/**
 * Safe, typed delivery failure used by verification routes.
 * Provider response bodies and credentials must never be exposed to clients.
 */
export class VerificationDeliveryError extends Error {
  readonly channel: VerificationDeliveryChannel;
  readonly reason: VerificationDeliveryReason;

  constructor(
    channel: VerificationDeliveryChannel,
    reason: VerificationDeliveryReason,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "VerificationDeliveryError";
    this.channel = channel;
    this.reason = reason;
  }
}