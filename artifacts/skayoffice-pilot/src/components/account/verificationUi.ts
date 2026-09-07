export type VerificationUiStep =
  | "unsent"
  | "sending"
  | "code_sent"
  | "confirming"
  | "error"
  | "verified";

export interface VerificationUiState {
  step: VerificationUiStep;
  destination?: string;
  errorKey?: string;
  codeSent?: boolean;
}

export function verificationErrorKey(error: unknown): string {
  const data =
    error && typeof error === "object" && "data" in error
      ? (error as { data?: { code?: string } }).data
      : undefined;

  switch (data?.code) {
    case "invalid_code":
      return "verify.error_invalid";
    case "expired":
      return "verify.error_expired";
    case "attempts_exhausted":
      return "verify.error_attempts";
    case "no_token":
      return "verify.error_no_code";
    case "delivery_unavailable":
    case "verification_provider_not_configured":
    case "verification_delivery_failed":
      return "verify.error_delivery";
    default:
      return "verify.error_generic";
  }
}