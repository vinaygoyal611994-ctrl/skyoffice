import React from "react";
import { ContactVerificationBanner } from "./ContactVerificationBanner";

interface PhoneVerificationBannerProps {
  verified?: boolean;
  onVerified?: () => void | Promise<unknown>;
}

export function PhoneVerificationBanner({
  verified,
  onVerified = () => undefined,
}: PhoneVerificationBannerProps) {
  return (
    <ContactVerificationBanner
      channel="phone"
      verified={verified}
      onVerified={onVerified}
    />
  );
}