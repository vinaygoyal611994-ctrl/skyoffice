/**
 * Hand-written React Query hooks for provider email/phone verification.
 * Blocker 8.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import type { UseQueryOptions } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";
export { customFetch };

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VerificationStatus {
  emailVerified: boolean;
  phoneVerified: boolean;
}

export type VerificationChannel = "email" | "phone";
export const verificationStatusQueryKey = ["/api/auth/verify/status"] as const;

// ── Hooks ─────────────────────────────────────────────────────────────────────

/**
 * Fetch the current email/phone verification status for the authenticated
 * office user. Returns { emailVerified, phoneVerified }.
 */
export function useVerificationStatus(
  options?: UseQueryOptions<VerificationStatus>,
) {
  return useQuery<VerificationStatus>({
    queryKey: verificationStatusQueryKey,
    queryFn: () =>
      customFetch<VerificationStatus>("/api/auth/verify/status", { responseType: "json" }),
    staleTime: 30_000,
    ...options,
  });
}

export async function sendVerificationCode(channel: VerificationChannel) {
  return customFetch<SendVerificationCodeResponse>(
    `/auth/verify/send-${channel}`,
    { method: "POST", responseType: "json" },
  );
}

export function useSendVerificationCode() {
  return useMutation({
    mutationFn: (channel: VerificationChannel) => sendVerificationCode(channel),
  });
}

export interface SendVerificationCodeResponse {
  alreadyVerified?: boolean;
  email?: string;
  phone?: string;
  message: string;
}

export function useConfirmVerificationCode() {
  return useMutation({
    mutationFn: ({ channel, code }: { channel: VerificationChannel; code: string }) =>
      confirmVerificationCode(channel, code),
  });
}

export async function confirmVerificationCode(
  channel: VerificationChannel,
  code: string,
) {
  return customFetch<ConfirmVerificationCodeResponse>(
    `/auth/verify/confirm-${channel}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
      responseType: "json",
    },
  );
}

export interface ConfirmVerificationCodeResponse {
  emailVerified?: boolean;
  phoneVerified?: boolean;
  message: string;
}
