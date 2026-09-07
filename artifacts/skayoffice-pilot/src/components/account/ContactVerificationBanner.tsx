import React, { useState } from "react";
import { Mail, Phone, CheckCircle2, Loader2 } from "lucide-react";
import {
  confirmVerificationCode,
  sendVerificationCode,
  type VerificationChannel,
} from "@workspace/api-client-react";
import { useI18n } from "@/lib/i18n";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  verificationErrorKey,
  type VerificationUiState,
} from "./verificationUi";

interface ContactVerificationBannerProps {
  channel: VerificationChannel;
  verified?: boolean;
  onVerified: () => void | Promise<unknown>;
}

export function ContactVerificationBanner({
  channel,
  verified = false,
  onVerified,
}: ContactVerificationBannerProps) {
  const { t } = useI18n();
  const [state, setState] = useState<VerificationUiState>(
    verified ? { step: "verified" } : { step: "unsent" },
  );
  const [code, setCode] = useState("");
  const Icon = channel === "email" ? Mail : Phone;
  const isVerified = verified || state.step === "verified";
  const isSending = state.step === "sending";
  const isConfirming = state.step === "confirming";
  const codeSent =
    state.step === "code_sent" ||
    (state.step === "error" && state.codeSent === true);

  const handleSend = async () => {
    setState({ step: "sending" });
    try {
      const response = await sendVerificationCode(channel);
      if (response.alreadyVerified) {
        setState({ step: "verified" });
        void Promise.resolve(onVerified()).catch(() => undefined);
        return;
      }
      setCode("");
      setState({
        step: "code_sent",
        destination:
          channel === "email" ? response.email : response.phone,
      });
    } catch (error) {
      setState({
        step: "error",
        errorKey: verificationErrorKey(error),
        codeSent,
      });
    }
  };

  const handleConfirm = async () => {
    if (!/^\d{6}$/.test(code)) return;
    setState((current) => ({ ...current, step: "confirming" }));
    try {
      await confirmVerificationCode(channel, code);
      setState({ step: "verified" });
      void Promise.resolve(onVerified()).catch(() => undefined);
    } catch (error) {
      setState((current) => ({
        ...current,
        step: "error",
        errorKey: verificationErrorKey(error),
        codeSent: true,
      }));
    }
  };

  if (isVerified) {
    return (
      <Alert
        className="border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-800"
        aria-live="polite"
      >
        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        <AlertTitle className="text-emerald-700 dark:text-emerald-400">
          {t(channel === "email" ? "verify.verified" : "verify.verified_phone")}
        </AlertTitle>
      </Alert>
    );
  }

  return (
    <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
      <Icon className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <AlertTitle className="text-amber-800 dark:text-amber-300">
          {t(channel === "email" ? "verify.email_banner_title" : "verify.phone_banner_title")}
        </AlertTitle>
        <AlertDescription className="text-amber-700 dark:text-amber-400 mt-1 text-sm">
          {t(channel === "email" ? "verify.email_banner_desc" : "verify.phone_banner_desc")}
        </AlertDescription>

        {state.errorKey && (
          <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
            {t(state.errorKey as any)}
          </p>
        )}

        {!codeSent ? (
          <Button
            size="sm"
            variant="outline"
            className="mt-3 border-amber-400 text-amber-800 hover:bg-amber-100 dark:text-amber-300 dark:border-amber-700 dark:hover:bg-amber-900/30"
            onClick={handleSend}
            disabled={isSending}
          >
            {isSending && <Loader2 className="h-3.5 w-3.5 me-2 animate-spin" />}
            {isSending ? t("verify.sending") : t("verify.send_code")}
          </Button>
        ) : (
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <Input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-label={t("verify.code_placeholder")}
              maxLength={6}
              placeholder={t("verify.code_placeholder")}
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
              className="w-40 text-center tracking-widest font-mono text-base h-9 border-amber-300"
              disabled={isConfirming}
            />
            <Button
              size="sm"
              onClick={handleConfirm}
              disabled={isConfirming || code.length !== 6}
            >
              {isConfirming && <Loader2 className="h-3.5 w-3.5 me-2 animate-spin" />}
              {t("verify.confirm")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-amber-700 text-xs"
              onClick={handleSend}
              disabled={isSending || isConfirming}
            >
              {t("verify.resend_code")}
            </Button>
          </div>
        )}

        {state.step === "code_sent" && (
          <p className="text-xs text-amber-600 dark:text-amber-500 mt-2" aria-live="polite">
            {t(channel === "email" ? "verify.code_sent" : "verify.phone_code_sent")}
            {state.destination && ` (${state.destination})`}
          </p>
        )}
      </div>
    </Alert>
  );
}