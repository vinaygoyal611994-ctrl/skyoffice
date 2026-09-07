import React from "react";
import { ContactVerificationBanner } from "./ContactVerificationBanner";

interface EmailVerificationBannerProps {
  verified?: boolean;
  onVerified?: () => void | Promise<unknown>;
}

export function EmailVerificationBanner({
  verified,
  onVerified = () => undefined,
}: EmailVerificationBannerProps) {
  return (
    <ContactVerificationBanner
      channel="email"
      verified={verified}
      onVerified={onVerified}
    />
  );
}