import { logger } from "./logger";
import { recordEmailAttempt } from "./healthTracker";
import { VerificationDeliveryError } from "./verificationDeliveryError";

/**
 * Email provider abstraction.
 *
 * Pattern mirrors otpProvider.ts — callers only ever interact with the
 * `emailProvider` export; swapping providers requires no call-site changes.
 *
 * PRODUCTION:  Set RESEND_API_KEY and RESEND_FROM_EMAIL in secrets.
 *              Set FRONTEND_URL to https://skayoffice.com
 *              The ResendEmailProvider sends real transactional email.
 *
 * DEVELOPMENT: Leave those vars unset.
 *              The ConsoleEmailProvider logs the reset URL to stdout so
 *              developers can test the full flow without real email delivery.
 *              The raw token never appears in a log line — only the full URL
 *              (which already contains it) is logged, and only in dev.
 *
 * NEVER log the raw token separately; the URL is logged only in dev mode.
 */
export type MediaPlacement =
  | "quick_card_cover"
  | "gallery"
  | "decision_card_cover"
  | "works";

export interface EmailProvider {
  sendPasswordResetEmail(opts: {
    to: string;
    locale: "ar" | "en";
    resetUrl: string;
    expiryMinutes: number;
  }): Promise<void>;

  sendPasswordChangedNotification(opts: {
    to: string;
    locale: "ar" | "en";
  }): Promise<void>;

  sendMediaApprovedEmail(opts: {
    to: string;
    locale: "ar" | "en";
    placement: MediaPlacement;
    officeName: string;
  }): Promise<void>;

  sendMediaRejectedEmail(opts: {
    to: string;
    locale: "ar" | "en";
    placement: MediaPlacement;
    officeName: string;
    reason?: string;
  }): Promise<void>;

  sendSubscriptionExpiryReminder(opts: {
    to: string;
    locale: "ar" | "en";
    officeName: string;
    officeNameAr: string;
    daysLeft: number;
    expiresAt: Date;
    subscriptionType: "trial" | "paid";
  }): Promise<void>;

  sendCommercialActivationNotice(opts: {
    to: string;
    locale: "ar" | "en";
    officeName: string;
    officeNameAr: string;
    scheduledAt: Date;
    planName: string;
    planNameAr: string;
    monthlyPrice: number;   // smallest currency unit (halalas/cents)
    currency: string;
    trialDays: number;
  }): Promise<void>;

  /**
   * Notify an office that they have been selected from the waitlist and
   * have a 3-hour exclusive window to complete activation.
   * No payment link is included — this is purely an availability notice.
   */
  sendSlotReservationNotice(opts: {
    to: string;
    locale: "ar" | "en";
    officeName: string;
    officeNameAr: string;
    expiresAt: Date;        // UTC — when the 3-hour window closes
    marketKey: string;      // "country|city|category" — for context
  }): Promise<void>;

  /**
   * Send an OTP verification code for email or phone channel.
   * Blocker 8: provider email/phone verification gate.
   */
  sendVerificationCode(opts: {
    to: string;
    locale: "ar" | "en";
    code: string;
    expiryMinutes: number;
    channel: "email" | "phone";
  }): Promise<void>;

  /**
   * Notify a party about a service-request lifecycle status change.
   * Blocker 9: durable service-request lifecycle notifications.
   */
  sendServiceRequestNotification(opts: {
    to: string;
    locale: "ar" | "en";
    notificationType: string;
    recipientRole: "customer" | "office";
    officeName: string;
    serviceName: string;
    serviceRequestId: number;
    price?: string | null;
    executionDuration?: string | null;
  }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Console provider — development only
// ---------------------------------------------------------------------------
export class ConsoleEmailProvider implements EmailProvider {
  async sendPasswordResetEmail(opts: {
    to: string;
    locale: "ar" | "en";
    resetUrl: string;
    expiryMinutes: number;
  }): Promise<void> {
    // Only log in development. In production this provider is not used, but
    // as a belt-and-suspenders guard we suppress the URL log in prod.
    if (process.env.NODE_ENV === "production") {
      logger.warn(
        { to: opts.to },
        "[email] ConsoleEmailProvider used in production — RESEND_API_KEY or RESEND_FROM_EMAIL is missing. Reset email NOT sent.",
      );
      return;
    }
    logger.info(
      {
        to: opts.to,
        expiryMinutes: opts.expiryMinutes,
        // DEV ONLY: print the full reset URL so developers can test the flow.
        // This line must never appear in production logs.
        resetUrl: opts.resetUrl,
      },
      "[email:dev] Password reset URL (development only — not sent by email)",
    );
  }

  async sendPasswordChangedNotification(opts: {
    to: string;
    locale: "ar" | "en";
  }): Promise<void> {
    if (process.env.NODE_ENV === "production") return;
    logger.info(
      { to: opts.to },
      "[email:dev] Password changed notification (development only)",
    );
  }

  async sendMediaApprovedEmail(opts: {
    to: string;
    locale: "ar" | "en";
    placement: MediaPlacement;
    officeName: string;
  }): Promise<void> {
    if (process.env.NODE_ENV === "production") {
      logger.warn(
        { to: opts.to },
        "[email] ConsoleEmailProvider used in production — media approval email NOT sent.",
      );
      return;
    }
    logger.info(
      { to: opts.to, placement: opts.placement, officeName: opts.officeName },
      "[email:dev] Media approved notification (development only)",
    );
  }

  async sendMediaRejectedEmail(opts: {
    to: string;
    locale: "ar" | "en";
    placement: MediaPlacement;
    officeName: string;
    reason?: string;
  }): Promise<void> {
    if (process.env.NODE_ENV === "production") {
      logger.warn(
        { to: opts.to },
        "[email] ConsoleEmailProvider used in production — media rejection email NOT sent.",
      );
      return;
    }
    logger.info(
      {
        to: opts.to,
        placement: opts.placement,
        officeName: opts.officeName,
        reason: opts.reason,
      },
      "[email:dev] Media rejected notification (development only)",
    );
  }

  async sendSubscriptionExpiryReminder(opts: {
    to: string;
    locale: "ar" | "en";
    officeName: string;
    officeNameAr: string;
    daysLeft: number;
    expiresAt: Date;
    subscriptionType: "trial" | "paid";
  }): Promise<void> {
    if (process.env.NODE_ENV === "production") {
      logger.warn(
        { to: opts.to },
        "[email] ConsoleEmailProvider used in production — subscription expiry reminder NOT sent.",
      );
      return;
    }
    logger.info(
      {
        to:               opts.to,
        officeName:       opts.officeName,
        daysLeft:         opts.daysLeft,
        expiresAt:        opts.expiresAt.toISOString(),
        subscriptionType: opts.subscriptionType,
      },
      "[email:dev] Subscription expiry reminder (development only — not sent)",
    );
  }

  async sendCommercialActivationNotice(opts: {
    to: string;
    locale: "ar" | "en";
    officeName: string;
    officeNameAr: string;
    scheduledAt: Date;
    planName: string;
    planNameAr: string;
    monthlyPrice: number;
    currency: string;
    trialDays: number;
  }): Promise<void> {
    if (process.env.NODE_ENV === "production") {
      logger.warn(
        { to: opts.to },
        "[email] ConsoleEmailProvider used in production — commercial activation notice NOT sent.",
      );
      return;
    }
    logger.info(
      {
        to:           opts.to,
        officeName:   opts.officeName,
        scheduledAt:  opts.scheduledAt.toISOString(),
        planName:     opts.planName,
        monthlyPrice: opts.monthlyPrice,
        trialDays:    opts.trialDays,
      },
      "[email:dev] Commercial activation notice (development only — not sent)",
    );
  }

  async sendSlotReservationNotice(opts: {
    to: string;
    locale: "ar" | "en";
    officeName: string;
    officeNameAr: string;
    expiresAt: Date;
    marketKey: string;
  }): Promise<void> {
    if (process.env.NODE_ENV === "production") {
      logger.warn(
        { to: opts.to },
        "[email] ConsoleEmailProvider used in production — slot reservation notice NOT sent.",
      );
      return;
    }
    logger.info(
      {
        to:        opts.to,
        officeName: opts.officeName,
        expiresAt: opts.expiresAt.toISOString(),
        marketKey: opts.marketKey,
      },
      "[email:dev] Slot reservation notice (development only — not sent)",
    );
  }

  async sendVerificationCode(opts: {
    to: string;
    locale: "ar" | "en";
    code: string;
    expiryMinutes: number;
    channel: "email" | "phone";
  }): Promise<void> {
    if (process.env.NODE_ENV === "production") {
      logger.warn(
        { to: opts.to, channel: opts.channel },
        "[email] ConsoleEmailProvider used in production — verification code NOT sent.",
      );
      throw new VerificationDeliveryError(
        "email",
        "provider_not_configured",
        "Email verification is unavailable because the provider is not configured",
      );
    }
    logger.info(
      { to: opts.to, channel: opts.channel, code: opts.code, expiryMinutes: opts.expiryMinutes },
      "[email:dev] Verification code (development only — not sent by email/SMS)",
    );
  }

  async sendServiceRequestNotification(opts: {
    to: string;
    locale: "ar" | "en";
    notificationType: string;
    recipientRole: "customer" | "office";
    officeName: string;
    serviceName: string;
    serviceRequestId: number;
    price?: string | null;
    executionDuration?: string | null;
  }): Promise<void> {
    if (process.env.NODE_ENV === "production") {
      logger.warn(
        { to: opts.to, notificationType: opts.notificationType },
        "[email] ConsoleEmailProvider used in production — service request notification NOT sent.",
      );
      return;
    }
    logger.info(
      {
        to:               opts.to,
        notificationType: opts.notificationType,
        recipientRole:    opts.recipientRole,
        serviceName:      opts.serviceName,
        serviceRequestId: opts.serviceRequestId,
      },
      "[email:dev] Service request notification (development only — not sent)",
    );
  }
}

// ---------------------------------------------------------------------------
// Resend provider — production
// ---------------------------------------------------------------------------
export class ResendEmailProvider implements EmailProvider {
  private readonly apiKey: string;
  private readonly from: string;

  constructor(apiKey: string, from: string) {
    this.apiKey = apiKey;
    this.from = from;
  }

  async sendPasswordResetEmail(opts: {
    to: string;
    locale: "ar" | "en";
    resetUrl: string;
    expiryMinutes: number;
  }): Promise<void> {
    const { to, locale, resetUrl, expiryMinutes } = opts;
    const isAr = locale === "ar";

    const subject = isAr
      ? "إعادة تعيين كلمة المرور — SkayOffice"
      : "Reset your SkayOffice password";

    const html = buildResetEmail({ locale, resetUrl, expiryMinutes });

    await this.send({ to, subject, html });
  }

  async sendPasswordChangedNotification(opts: {
    to: string;
    locale: "ar" | "en";
  }): Promise<void> {
    const { to, locale } = opts;
    const isAr = locale === "ar";

    const subject = isAr
      ? "تم تغيير كلمة مرورك — SkayOffice"
      : "Your SkayOffice password was changed";

    const html = buildChangedEmail({ locale });

    await this.send({ to, subject, html });
  }

  async sendMediaApprovedEmail(opts: {
    to: string;
    locale: "ar" | "en";
    placement: MediaPlacement;
    officeName: string;
  }): Promise<void> {
    const { to, locale, placement, officeName } = opts;
    const isAr = locale === "ar";

    const subject = isAr
      ? `تمت الموافقة على وسائطك — SkayOffice`
      : `Your media has been approved — SkayOffice`;

    const html = buildMediaApprovedEmail({ locale, placement, officeName });

    await this.send({ to, subject, html });
  }

  async sendMediaRejectedEmail(opts: {
    to: string;
    locale: "ar" | "en";
    placement: MediaPlacement;
    officeName: string;
    reason?: string;
  }): Promise<void> {
    const { to, locale, placement, officeName, reason } = opts;
    const isAr = locale === "ar";

    const subject = isAr
      ? `تم رفض وسائطك — SkayOffice`
      : `Your media was not approved — SkayOffice`;

    const html = buildMediaRejectedEmail({ locale, placement, officeName, reason });

    await this.send({ to, subject, html });
  }

  async sendSubscriptionExpiryReminder(opts: {
    to: string;
    locale: "ar" | "en";
    officeName: string;
    officeNameAr: string;
    daysLeft: number;
    expiresAt: Date;
    subscriptionType: "trial" | "paid";
  }): Promise<void> {
    const { to, locale, daysLeft, expiresAt, subscriptionType } = opts;
    const isAr = locale === "ar";
    const name = isAr ? opts.officeNameAr : opts.officeName;

    const subLabel = subscriptionType === "trial"
      ? (isAr ? "التجريبية" : "trial")
      : (isAr ? "المدفوعة" : "paid");

    const subject = isAr
      ? (daysLeft === 0
          ? `انتهت صلاحية اشتراكك ${subLabel} — SkayOffice`
          : `اشتراكك ${subLabel} سينتهي خلال ${daysLeft} ${daysLeft === 1 ? "يوم" : "أيام"} — SkayOffice`)
      : (daysLeft === 0
          ? `Your ${subLabel} subscription has expired — SkayOffice`
          : `Your ${subLabel} subscription expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"} — SkayOffice`);

    const expiryFormatted = expiresAt.toLocaleDateString(isAr ? "ar-SA" : "en-GB", {
      year: "numeric", month: "long", day: "numeric",
    });

    const html = buildSubscriptionExpiryReminderEmail({
      locale,
      officeName: name,
      daysLeft,
      expiresAt: expiryFormatted,
      subscriptionType,
    });

    await this.send({ to, subject, html });
  }

  async sendCommercialActivationNotice(opts: {
    to: string;
    locale: "ar" | "en";
    officeName: string;
    officeNameAr: string;
    scheduledAt: Date;
    planName: string;
    planNameAr: string;
    monthlyPrice: number;
    currency: string;
    trialDays: number;
  }): Promise<void> {
    const { to, locale, scheduledAt, monthlyPrice, currency, trialDays } = opts;
    const isAr = locale === "ar";
    const name = isAr ? opts.officeNameAr : opts.officeName;
    const planLabel = isAr ? opts.planNameAr : opts.planName;
    const priceFormatted = `${(monthlyPrice / 100).toLocaleString(isAr ? "ar-SA" : "en-GB", { minimumFractionDigits: 0 })} ${currency}`;
    const dateFormatted = scheduledAt.toLocaleDateString(isAr ? "ar-SA" : "en-GB", {
      year: "numeric", month: "long", day: "numeric",
    });

    const subject = isAr
      ? `SkayOffice: تفعيل الاشتراك قادم — ${dateFormatted}`
      : `SkayOffice: Subscription activation coming — ${dateFormatted}`;

    const html = buildCommercialActivationEmail({
      locale, officeName: name, planName: planLabel,
      priceFormatted, dateFormatted, trialDays,
    });

    await this.send({ to, subject, html });
  }

  async sendSlotReservationNotice(opts: {
    to: string;
    locale: "ar" | "en";
    officeName: string;
    officeNameAr: string;
    expiresAt: Date;
    marketKey: string;
  }): Promise<void> {
    const { to, locale, expiresAt, marketKey } = opts;
    const isAr = locale === "ar";
    const name = isAr ? (opts.officeNameAr || opts.officeName) : opts.officeName;

    const expiryFormatted = expiresAt.toLocaleTimeString(isAr ? "ar-SA" : "en-GB", {
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
    const dateFormatted = expiresAt.toLocaleDateString(isAr ? "ar-SA" : "en-GB", {
      year: "numeric", month: "long", day: "numeric",
    });

    const subject = isAr
      ? `SkayOffice: مقعدك في السوق متاح — لديك 3 ساعات للتفعيل`
      : `SkayOffice: Your market slot is available — 3 hours to activate`;

    const html = buildSlotReservationNoticeEmail({ locale, officeName: name, expiresAt, expiryFormatted, dateFormatted, marketKey });
    await this.send({ to, subject, html });
  }

  async sendVerificationCode(opts: {
    to: string;
    locale: "ar" | "en";
    code: string;
    expiryMinutes: number;
    channel: "email" | "phone";
  }): Promise<void> {
    const { to, locale, code, expiryMinutes, channel } = opts;
    const isAr = locale === "ar";
    const subject = isAr ? "رمز التحقق — SkayOffice" : "Your verification code — SkayOffice";
    const html = buildVerificationCodeEmail({ locale, code, expiryMinutes, channel });
    await this.send({ to, subject, html }, { propagateFailure: true });
  }

  async sendServiceRequestNotification(opts: {
    to: string;
    locale: "ar" | "en";
    notificationType: string;
    recipientRole: "customer" | "office";
    officeName: string;
    serviceName: string;
    serviceRequestId: number;
    price?: string | null;
    executionDuration?: string | null;
  }): Promise<void> {
    const { to, locale } = opts;
    const isAr = locale === "ar";
    const subject = buildSrNotificationSubject(opts.notificationType, isAr, opts.officeName);
    const html = buildSrNotificationEmail(opts);
    await this.send({ to, subject, html });
  }

  private async send(opts: {
    to: string;
    subject: string;
    html: string;
  }, behavior: { propagateFailure?: boolean } = {}): Promise<void> {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.from,
          to: [opts.to],
          subject: opts.subject,
          html: opts.html,
        }),
      });

      if (!response.ok) {
        await response.arrayBuffer();
        logger.error(
          { status: response.status },
          "[email] Resend API error — email not delivered",
        );
        recordEmailAttempt(false, `Resend API returned ${response.status}`);
        if (behavior.propagateFailure) {
          throw new VerificationDeliveryError(
            "email",
            "provider_rejected",
            "Email provider rejected the verification message",
          );
        }
      } else {
        logger.info({ to: opts.to }, "[email] Transactional email accepted by Resend");
        recordEmailAttempt(true);
      }
    } catch (err) {
      if (err instanceof VerificationDeliveryError) throw err;
      // Network failure, DNS error, timeout, or any other fetch-level exception.
      // Log internally and swallow — a delivery failure must never propagate to
      // the route handler, where it would cause a differential 500 response that
      // leaks account existence to an attacker.
      logger.error(
        { err, to: opts.to },
        "[email] Resend network error — email not delivered (exception swallowed)",
      );
      recordEmailAttempt(false, "Network error reaching email provider");
      if (behavior.propagateFailure) {
        throw new VerificationDeliveryError(
          "email",
          "provider_unreachable",
          "Email provider could not be reached",
          { cause: err },
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// HTML email templates
// ---------------------------------------------------------------------------

function buildResetEmail(opts: {
  locale: "ar" | "en";
  resetUrl: string;
  expiryMinutes: number;
}): string {
  const { locale, resetUrl, expiryMinutes } = opts;
  const isAr = locale === "ar";
  const dir = isAr ? "rtl" : "ltr";

  return `<!DOCTYPE html>
<html lang="${locale}" dir="${dir}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${isAr ? "إعادة تعيين كلمة المرور" : "Reset your password"}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:${isAr ? "'Segoe UI',Tahoma,Arial,sans-serif" : "Helvetica,Arial,sans-serif"};direction:${dir};">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 0;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
        <!-- Header -->
        <tr>
          <td style="background:#0f4c81;padding:28px 36px;text-align:center;">
            <span style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">SkayOffice</span>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:36px 36px 28px;">
            <h1 style="margin:0 0 12px;font-size:20px;color:#1a1a1a;font-weight:600;">
              ${isAr ? "إعادة تعيين كلمة المرور" : "Reset your password"}
            </h1>
            <p style="margin:0 0 20px;color:#444;font-size:15px;line-height:1.6;">
              ${isAr
                ? "تلقّينا طلبًا لإعادة تعيين كلمة المرور لحسابك على SkayOffice. اضغط على الزر أدناه لاختيار كلمة مرور جديدة."
                : "We received a request to reset the password for your SkayOffice account. Click the button below to choose a new password."
              }
            </p>
            <!-- CTA Button -->
            <table cellpadding="0" cellspacing="0" style="margin:28px 0;">
              <tr>
                <td style="border-radius:8px;background:#0f4c81;">
                  <a href="${resetUrl}" target="_blank"
                     style="display:inline-block;padding:14px 32px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;border-radius:8px;">
                    ${isAr ? "تعيين كلمة مرور جديدة" : "Set a new password"}
                  </a>
                </td>
              </tr>
            </table>
            <!-- Expiry notice -->
            <p style="margin:0 0 20px;color:#666;font-size:13px;line-height:1.5;">
              ${isAr
                ? `⏱ هذا الرابط صالح لمدة <strong>${expiryMinutes} دقيقة</strong> فقط وسيتوقف عن العمل بعد استخدامه مرة واحدة.`
                : `⏱ This link is valid for <strong>${expiryMinutes} minutes</strong> and can only be used once.`
              }
            </p>
            <!-- Fallback URL -->
            <p style="margin:0 0 24px;color:#888;font-size:12px;line-height:1.5;word-break:break-all;">
              ${isAr ? "إذا لم يعمل الزر، انسخ هذا الرابط في المتصفح:" : "If the button doesn't work, copy this link into your browser:"}
              <br/><a href="${resetUrl}" style="color:#0f4c81;">${resetUrl}</a>
            </p>
            <!-- Security notice -->
            <table cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td style="background:#fff8e1;border:1px solid #ffe082;border-radius:8px;padding:14px 18px;">
                  <p style="margin:0;color:#6d4c00;font-size:13px;line-height:1.5;">
                    🔒 ${isAr
                      ? "إذا لم تطلب إعادة تعيين كلمة المرور، يمكنك تجاهل هذا البريد بأمان — لن يتغير أي شيء في حسابك."
                      : "If you didn't request a password reset, you can safely ignore this email — nothing will change in your account."
                    }
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f9f9f9;padding:20px 36px;text-align:center;border-top:1px solid #eee;">
            <p style="margin:0;color:#aaa;font-size:12px;">
              ${isAr ? "هذا البريد أُرسل تلقائيًا من SkayOffice. يرجى عدم الرد عليه." : "This email was sent automatically by SkayOffice. Please do not reply."}
            </p>
            <p style="margin:6px 0 0;color:#bbb;font-size:11px;">© ${new Date().getFullYear()} SkayOffice</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildChangedEmail(opts: { locale: "ar" | "en" }): string {
  const { locale } = opts;
  const isAr = locale === "ar";
  const dir = isAr ? "rtl" : "ltr";

  return `<!DOCTYPE html>
<html lang="${locale}" dir="${dir}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${isAr ? "تم تغيير كلمة المرور" : "Password changed"}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:${isAr ? "'Segoe UI',Tahoma,Arial,sans-serif" : "Helvetica,Arial,sans-serif"};direction:${dir};">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 0;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
        <tr>
          <td style="background:#0f4c81;padding:28px 36px;text-align:center;">
            <span style="color:#ffffff;font-size:22px;font-weight:700;">SkayOffice</span>
          </td>
        </tr>
        <tr>
          <td style="padding:36px;">
            <h1 style="margin:0 0 16px;font-size:20px;color:#1a1a1a;font-weight:600;">
              ✅ ${isAr ? "تم تغيير كلمة مرورك" : "Your password has been changed"}
            </h1>
            <p style="margin:0 0 20px;color:#444;font-size:15px;line-height:1.6;">
              ${isAr
                ? "تم تغيير كلمة المرور لحسابك على SkayOffice بنجاح."
                : "The password for your SkayOffice account has been successfully changed."
              }
            </p>
            <table cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td style="background:#ffeaea;border:1px solid #ffb3b3;border-radius:8px;padding:14px 18px;">
                  <p style="margin:0;color:#7a0000;font-size:13px;line-height:1.5;">
                    🚨 ${isAr
                      ? "إذا لم تُجرِ هذا التغيير، يرجى التواصل مع الدعم فورًا على info@skayoffice.com"
                      : "If you didn't make this change, please contact support immediately at info@skayoffice.com"
                    }
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:#f9f9f9;padding:20px 36px;text-align:center;border-top:1px solid #eee;">
            <p style="margin:0;color:#aaa;font-size:12px;">
              © ${new Date().getFullYear()} SkayOffice
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Media notification templates
// ---------------------------------------------------------------------------

function placementLabel(placement: MediaPlacement, isAr: boolean): string {
  if (placement === "quick_card_cover") {
    return isAr ? "غلاف البطاقة السريعة" : "Quick Card Cover";
  }
  if (placement === "decision_card_cover") {
    return isAr ? "غلاف بطاقة القرار" : "Decision Card Cover";
  }
  if (placement === "works") {
    return isAr ? "صورة الأعمال" : "Works Image";
  }
  return isAr ? "صورة المعرض" : "Gallery Image";
}

function emailShell(opts: {
  locale: "ar" | "en";
  title: string;
  body: string;
}): string {
  const { locale, title, body } = opts;
  const isAr = locale === "ar";
  const dir = isAr ? "rtl" : "ltr";

  return `<!DOCTYPE html>
<html lang="${locale}" dir="${dir}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:${isAr ? "'Segoe UI',Tahoma,Arial,sans-serif" : "Helvetica,Arial,sans-serif"};direction:${dir};">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 0;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
        <tr>
          <td style="background:#0f4c81;padding:28px 36px;text-align:center;">
            <span style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">SkayOffice</span>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 36px 28px;">
            ${body}
          </td>
        </tr>
        <tr>
          <td style="background:#f9f9f9;padding:20px 36px;text-align:center;border-top:1px solid #eee;">
            <p style="margin:0;color:#aaa;font-size:12px;">
              ${isAr ? "هذا البريد أُرسل تلقائيًا من SkayOffice. يرجى عدم الرد عليه." : "This email was sent automatically by SkayOffice. Please do not reply."}
            </p>
            <p style="margin:6px 0 0;color:#bbb;font-size:11px;">© ${new Date().getFullYear()} SkayOffice</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildMediaApprovedEmail(opts: {
  locale: "ar" | "en";
  placement: MediaPlacement;
  officeName: string;
}): string {
  const { locale, placement, officeName } = opts;
  const isAr = locale === "ar";
  const label = placementLabel(placement, isAr);
  const title = isAr ? "تمت الموافقة على وسائطك" : "Your media has been approved";

  const body = `
    <h1 style="margin:0 0 12px;font-size:20px;color:#1a1a1a;font-weight:600;">
      ✅ ${isAr ? "تمت الموافقة على وسائطك" : "Your media has been approved"}
    </h1>
    <p style="margin:0 0 16px;color:#444;font-size:15px;line-height:1.6;">
      ${isAr
        ? `مرحباً، تمت الموافقة على الوسائط التي رفعتها لـ<strong>${label}</strong> في مكتبك <strong>${officeName}</strong> وهي الآن ظاهرة للعملاء.`
        : `Your uploaded <strong>${label}</strong> for <strong>${officeName}</strong> has been reviewed and approved. It is now visible to customers.`
      }
    </p>
    <table cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td style="background:#e8f5e9;border:1px solid #a5d6a7;border-radius:8px;padding:14px 18px;">
          <p style="margin:0;color:#1b5e20;font-size:13px;line-height:1.5;">
            🎉 ${isAr
              ? "يمكنك الاطلاع على مظهر مكتبك من خلال لوحة التحكم."
              : "You can preview your office listing from your dashboard."
            }
          </p>
        </td>
      </tr>
    </table>`;

  return emailShell({ locale, title, body });
}

function buildMediaRejectedEmail(opts: {
  locale: "ar" | "en";
  placement: MediaPlacement;
  officeName: string;
  reason?: string;
}): string {
  const { locale, placement, officeName, reason } = opts;
  const isAr = locale === "ar";
  const label = placementLabel(placement, isAr);
  const title = isAr ? "لم تتم الموافقة على وسائطك" : "Your media was not approved";

  const reasonBlock = reason
    ? `
    <table cellpadding="0" cellspacing="0" width="100%" style="margin-top:16px;">
      <tr>
        <td style="background:#fff8e1;border:1px solid #ffe082;border-radius:8px;padding:14px 18px;">
          <p style="margin:0 0 6px;color:#6d4c00;font-size:13px;font-weight:600;">
            ${isAr ? "سبب الرفض:" : "Reason:"}
          </p>
          <p style="margin:0;color:#6d4c00;font-size:13px;line-height:1.5;">${reason}</p>
        </td>
      </tr>
    </table>`
    : "";

  const body = `
    <h1 style="margin:0 0 12px;font-size:20px;color:#1a1a1a;font-weight:600;">
      ❌ ${isAr ? "لم تتم الموافقة على وسائطك" : "Your media was not approved"}
    </h1>
    <p style="margin:0 0 16px;color:#444;font-size:15px;line-height:1.6;">
      ${isAr
        ? `للأسف، لم تتم الموافقة على الوسائط التي رفعتها لـ<strong>${label}</strong> في مكتبك <strong>${officeName}</strong>.`
        : `Unfortunately, your uploaded <strong>${label}</strong> for <strong>${officeName}</strong> was not approved.`
      }
    </p>
    ${reasonBlock}
    <p style="margin:16px 0 0;color:#666;font-size:13px;line-height:1.5;">
      ${isAr
        ? "يمكنك رفع وسائط جديدة من لوحة التحكم. إذا كان لديك أي استفسار، تواصل معنا على info@skayoffice.com"
        : "You may upload new media from your dashboard. If you have any questions, contact us at info@skayoffice.com"
      }
    </p>`;

  return emailShell({ locale, title, body });
}

function buildSubscriptionExpiryReminderEmail(opts: {
  locale: "ar" | "en";
  officeName: string;
  daysLeft: number;
  expiresAt: string;
  subscriptionType: "trial" | "paid";
}): string {
  const { locale, officeName, daysLeft, expiresAt, subscriptionType } = opts;
  const isAr = locale === "ar";
  const dir  = isAr ? "rtl" : "ltr";

  const subLabel = subscriptionType === "trial"
    ? (isAr ? "الاشتراك التجريبي" : "trial subscription")
    : (isAr ? "الاشتراك المدفوع" : "paid subscription");

  const isExpired = daysLeft === 0;

  const title = isExpired
    ? (isAr ? `انتهى ${subLabel} الخاص بك` : `Your ${subLabel} has expired`)
    : (isAr
        ? `${subLabel} الخاص بك سينتهي قريباً`
        : `Your ${subLabel} is expiring soon`);

  const urgencyColor = daysLeft === 0 ? "#ef4444" : daysLeft <= 1 ? "#f97316" : "#f59e0b";
  const urgencyBg    = daysLeft === 0 ? "#fef2f2" : daysLeft <= 1 ? "#fff7ed" : "#fffbeb";

  const body = `
    <h1 style="margin:0 0 12px;font-size:20px;color:#1a1a1a;font-weight:600;">
      ${isExpired ? "⚠️" : "⏰"} ${title}
    </h1>
    <p style="margin:0 0 16px;color:#444;font-size:15px;line-height:1.6;">
      ${isAr
        ? `عزيزنا صاحب المكتب <strong>${officeName}</strong>,`
        : `Dear <strong>${officeName}</strong>,`}
    </p>
    <table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 20px;">
      <tr>
        <td style="background:${urgencyBg};border:1px solid ${urgencyColor};border-radius:8px;padding:16px 20px;">
          <p style="margin:0;color:${urgencyColor};font-size:15px;font-weight:600;line-height:1.5;">
            ${isExpired
              ? (isAr
                  ? `انتهت صلاحية ${subLabel} الخاص بك. مكتبك مخفي حالياً عن العملاء.`
                  : `Your ${subLabel} has ended. Your office is currently hidden from customers.`)
              : (isAr
                  ? `متبقٍّ <strong>${daysLeft} ${daysLeft === 1 ? "يوم" : "أيام"}</strong> على انتهاء ${subLabel}. تاريخ الانتهاء: <strong>${expiresAt}</strong>`
                  : `<strong>${daysLeft} day${daysLeft === 1 ? "" : "s"}</strong> remaining. Expires: <strong>${expiresAt}</strong>`)
            }
          </p>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 16px;color:#444;font-size:14px;line-height:1.6;">
      ${isExpired
        ? (isAr
            ? "لإعادة تفعيل مكتبك وظهوره مجدداً على المنصة، يرجى التواصل مع فريق SkayOffice."
            : "To reactivate your office and restore its listing, please contact the SkayOffice team.")
        : (isAr
            ? "لتجنب توقف مكتبك وضمان استمرار ظهوره، يرجى التواصل مع فريق SkayOffice قبل انتهاء الاشتراك."
            : "To avoid any service interruption and keep your listing active, please contact the SkayOffice team before your subscription ends.")
      }
    </p>
    <p style="margin:0;color:#888;font-size:13px;">
      ${isAr ? "للتواصل:" : "Contact us:"} <a href="mailto:info@skayoffice.com" style="color:#0f4c81;">info@skayoffice.com</a>
    </p>`;

  return emailShell({ locale, title, body });
}

// ---------------------------------------------------------------------------
// Commercial activation notice email template
// ---------------------------------------------------------------------------
function buildCommercialActivationEmail(opts: {
  locale: "ar" | "en";
  officeName: string;
  planName: string;
  priceFormatted: string;
  dateFormatted: string;
  trialDays: number;
}): string {
  const { locale, officeName, planName, priceFormatted, dateFormatted, trialDays } = opts;
  const isAr = locale === "ar";

  const title = isAr
    ? `إشعار: تفعيل الاشتراك في SkayOffice`
    : `Notice: SkayOffice subscription activation`;

  const body = `
    <h1 style="margin:0 0 12px;font-size:20px;color:#1a1a1a;font-weight:600;">
      🚀 ${title}
    </h1>
    <p style="margin:0 0 16px;color:#444;font-size:15px;line-height:1.6;">
      ${isAr
        ? `عزيزنا صاحب المكتب <strong>${officeName}</strong>,`
        : `Dear <strong>${officeName}</strong>,`}
    </p>
    <table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 20px;">
      <tr>
        <td style="background:#eff6ff;border:1px solid #3b82f6;border-radius:8px;padding:16px 20px;">
          <p style="margin:0;color:#1d4ed8;font-size:15px;font-weight:600;line-height:1.5;">
            ${isAr
              ? `منصة SkayOffice ستبدأ تطبيق الاشتراكات بتاريخ <strong>${dateFormatted}</strong>`
              : `SkayOffice will begin subscription billing starting <strong>${dateFormatted}</strong>`}
          </p>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 12px;color:#444;font-size:14px;line-height:1.6;">
      ${isAr
        ? `ستحصل على فترة تجريبية مجانية لمدة <strong>${trialDays} يوماً</strong> قبل أن تبدأ أي رسوم.`
        : `You will receive a free trial period of <strong>${trialDays} days</strong> before any charges apply.`}
    </p>
    <table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 20px;border-collapse:collapse;">
      <tr style="background:#f9fafb;">
        <td style="padding:10px 14px;border:1px solid #e5e7eb;font-size:13px;color:#666;">
          ${isAr ? "الخطة" : "Plan"}
        </td>
        <td style="padding:10px 14px;border:1px solid #e5e7eb;font-size:14px;font-weight:600;color:#1a1a1a;">
          ${planName}
        </td>
      </tr>
      <tr>
        <td style="padding:10px 14px;border:1px solid #e5e7eb;font-size:13px;color:#666;">
          ${isAr ? "السعر الشهري" : "Monthly Price"}
        </td>
        <td style="padding:10px 14px;border:1px solid #e5e7eb;font-size:14px;font-weight:600;color:#1a1a1a;">
          ${priceFormatted}
        </td>
      </tr>
      <tr style="background:#f9fafb;">
        <td style="padding:10px 14px;border:1px solid #e5e7eb;font-size:13px;color:#666;">
          ${isAr ? "المدة التجريبية" : "Trial Period"}
        </td>
        <td style="padding:10px 14px;border:1px solid #e5e7eb;font-size:14px;font-weight:600;color:#22c55e;">
          ${isAr ? `${trialDays} يوماً مجاناً` : `${trialDays} days free`}
        </td>
      </tr>
    </table>
    <p style="margin:0 0 12px;color:#444;font-size:14px;line-height:1.6;">
      ${isAr
        ? "جميع بياناتك وسجل عملائك وروابط QR والتقييمات محفوظة تماماً."
        : "All your data, customer history, QR codes, and reviews are fully preserved."}
    </p>
    <p style="margin:0;color:#888;font-size:13px;">
      ${isAr ? "لأي استفسار:" : "For questions:"} <a href="mailto:info@skayoffice.com" style="color:#0f4c81;">info@skayoffice.com</a>
    </p>`;

  return emailShell({ locale, title, body });
}

// ---------------------------------------------------------------------------
// Slot Reservation Notice
// ---------------------------------------------------------------------------

function buildSlotReservationNoticeEmail(opts: {
  locale: "ar" | "en";
  officeName: string;
  expiresAt: Date;
  expiryFormatted: string;
  dateFormatted: string;
  marketKey: string;
}): string {
  const { locale, officeName, expiryFormatted, dateFormatted } = opts;
  const isAr = locale === "ar";
  const dir = isAr ? "rtl" : "ltr";

  const title = isAr
    ? "مقعدك في السوق متاح الآن"
    : "Your market slot is now available";

  return `<!DOCTYPE html>
<html lang="${locale}" dir="${dir}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:${isAr ? "'Segoe UI',Tahoma,Arial,sans-serif" : "Helvetica,Arial,sans-serif"};direction:${dir};">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 0;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
        <!-- Header -->
        <tr>
          <td style="background:#0f4c81;padding:28px 36px;text-align:center;">
            <span style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">SkayOffice</span>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:36px 36px 28px;">
            <h1 style="margin:0 0 12px;font-size:20px;color:#1a1a1a;font-weight:600;">
              ${isAr ? `مرحباً ${officeName}،` : `Hello ${officeName},`}
            </h1>
            <p style="margin:0 0 20px;color:#444;font-size:15px;line-height:1.6;">
              ${isAr
                ? "يسعدنا إبلاغكم بأنه قد تم حجز مقعد في السوق لمكتبكم على منصة SkayOffice. لديكم <strong>نافذة حصرية مدتها 3 ساعات</strong> لإتمام التفعيل والظهور على المنصة."
                : "Great news — a market slot has been reserved for your office on SkayOffice. You have an <strong>exclusive 3-hour window</strong> to complete activation and appear on the platform."
              }
            </p>
            <!-- Expiry notice -->
            <table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;">
              <tr>
                <td style="background:#fff3cd;border:1px solid #ffc107;border-radius:8px;padding:16px 20px;">
                  <p style="margin:0;color:#664d03;font-size:14px;line-height:1.6;font-weight:600;">
                    ⏰ ${isAr
                      ? `ينتهي الحجز في الساعة <strong>${expiryFormatted}</strong> بتاريخ <strong>${dateFormatted}</strong>`
                      : `Reservation expires at <strong>${expiryFormatted}</strong> on <strong>${dateFormatted}</strong>`
                    }
                  </p>
                  <p style="margin:8px 0 0;color:#664d03;font-size:13px;line-height:1.5;">
                    ${isAr
                      ? "إذا انتهت المهلة دون اتخاذ أي إجراء، سيتم تحرير المقعد وإتاحته لمزود آخر."
                      : "If the window passes without action, the slot will be released to the next eligible provider."
                    }
                  </p>
                </td>
              </tr>
            </table>
            <!-- Action instructions -->
            <p style="margin:0 0 20px;color:#444;font-size:15px;line-height:1.6;">
              ${isAr
                ? "لإتمام التفعيل، يرجى تسجيل الدخول إلى لوحة تحكم مكتبكم واتباع خطوات التفعيل المطلوبة."
                : "To complete activation, please log in to your office dashboard and follow the required activation steps."
              }
            </p>
            <!-- Info box -->
            <table cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td style="background:#e8f5e9;border:1px solid #a5d6a7;border-radius:8px;padding:14px 18px;">
                  <p style="margin:0;color:#1b5e20;font-size:13px;line-height:1.5;">
                    ✅ ${isAr
                      ? "هذا الحجز مخصص لمكتبكم حصراً ولا يُشارك مع أي طرف آخر خلال نافذة الـ 3 ساعات."
                      : "This reservation is exclusively held for your office and is not shared with any other provider during the 3-hour window."
                    }
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f9f9f9;border-top:1px solid #eee;padding:20px 36px;text-align:center;">
            <p style="margin:0;color:#999;font-size:12px;line-height:1.5;">
              ${isAr
                ? "هذه رسالة آلية من SkayOffice. إذا كنت تعتقد أنك تلقّيت هذه الرسالة بالخطأ، يرجى تجاهلها."
                : "This is an automated message from SkayOffice. If you believe you received this in error, please disregard it."
              }
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Blocker 8: Verification code email template
// ---------------------------------------------------------------------------

function buildVerificationCodeEmail(opts: {
  locale: "ar" | "en";
  code: string;
  expiryMinutes: number;
  channel: "email" | "phone";
}): string {
  const { locale, code, expiryMinutes } = opts;
  const isAr = locale === "ar";

  const title = isAr ? "رمز التحقق" : "Your Verification Code";
  const body = `
    <h1 style="margin:0 0 16px;font-size:20px;color:#1a1a1a;font-weight:600;">
      🔐 ${isAr ? "رمز التحقق" : "Verification Code"}
    </h1>
    <p style="margin:0 0 20px;color:#444;font-size:15px;line-height:1.6;">
      ${isAr
        ? "استخدم الرمز التالي للتحقق من حسابك على SkayOffice:"
        : "Use the following code to verify your SkayOffice account:"
      }
    </p>
    <div style="text-align:center;margin:28px 0;">
      <span style="display:inline-block;padding:18px 40px;background:#f0f4ff;border:2px solid #0f4c81;border-radius:12px;font-size:36px;font-weight:700;letter-spacing:8px;color:#0f4c81;">
        ${code}
      </span>
    </div>
    <p style="margin:0 0 20px;color:#666;font-size:13px;line-height:1.5;text-align:center;">
      ${isAr
        ? `⏱ هذا الرمز صالح لمدة <strong>${expiryMinutes} دقائق</strong> فقط.`
        : `⏱ This code is valid for <strong>${expiryMinutes} minutes</strong>.`
      }
    </p>
    <table cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td style="background:#fff8e1;border:1px solid #ffe082;border-radius:8px;padding:14px 18px;">
          <p style="margin:0;color:#6d4c00;font-size:13px;line-height:1.5;">
            🔒 ${isAr
              ? "إذا لم تطلب هذا الرمز، يمكنك تجاهل هذا البريد بأمان."
              : "If you didn't request this code, you can safely ignore this email."
            }
          </p>
        </td>
      </tr>
    </table>`;

  return emailShell({ locale, title, body });
}

// ---------------------------------------------------------------------------
// Blocker 9: Service-request notification email templates
// ---------------------------------------------------------------------------

function buildSrNotificationSubject(notificationType: string, isAr: boolean, officeName: string): string {
  const subjects: Record<string, { ar: string; en: string }> = {
    sr_submitted:                  { ar: "SkayOffice: طلب خدمة جديد", en: "SkayOffice: New service request received" },
    sr_offer_sent:                 { ar: `SkayOffice: ${officeName} أرسل لك عرضاً`, en: `SkayOffice: ${officeName} sent you an offer` },
    sr_offer_accepted:             { ar: "SkayOffice: العميل قبل عرضك", en: "SkayOffice: Your offer has been accepted" },
    sr_offer_rejected:             { ar: "SkayOffice: العميل رفض عرضك", en: "SkayOffice: Your offer was declined" },
    sr_rejected:                   { ar: "SkayOffice: تم رفض طلبك", en: "SkayOffice: Your request was declined" },
    sr_completed_awaiting_confirm: { ar: "SkayOffice: يرجى تأكيد إتمام الخدمة", en: "SkayOffice: Please confirm service completion" },
    sr_confirmed_completed:        { ar: "SkayOffice: العميل أكد إتمام الخدمة", en: "SkayOffice: Customer confirmed completion" },
    sr_not_completed:              { ar: "SkayOffice: العميل أفاد بعدم إتمام الخدمة", en: "SkayOffice: Customer flagged service as not completed" },
  };
  const entry = subjects[notificationType];
  if (!entry) return isAr ? "إشعار SkayOffice" : "SkayOffice Notification";
  return isAr ? entry.ar : entry.en;
}

/** Escapes untrusted text before it is interpolated into a template-authored HTML email. */
function escapeHtmlText(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

export function buildSrNotificationEmail(opts: {
  locale: "ar" | "en";
  notificationType: string;
  recipientRole: "customer" | "office";
  officeName: string;
  serviceName: string;
  serviceRequestId: number;
  price?: string | null;
  executionDuration?: string | null;
}): string {
  const { locale, notificationType, serviceRequestId } = opts;
  const officeName = escapeHtmlText(opts.officeName);
  const serviceName = escapeHtmlText(opts.serviceName);
  const price = opts.price ? escapeHtmlText(opts.price) : null;
  const executionDuration = opts.executionDuration
    ? escapeHtmlText(opts.executionDuration)
    : null;
  const isAr = locale === "ar";

  const bodyTexts: Record<string, { ar: string; en: string }> = {
    sr_submitted: {
      ar: `لديك طلب خدمة جديد من عميل. الخدمة المطلوبة: <strong>${serviceName}</strong>. سجّل دخولك لمراجعة الطلب وإرسال عرض.`,
      en: `You have a new service request. Service requested: <strong>${serviceName}</strong>. Log in to review and send an offer.`,
    },
    sr_offer_sent: {
      ar: `أرسل مكتب <strong>${officeName}</strong> عرضاً لطلبك: <strong>${serviceName}</strong>${price ? `. السعر: <strong>${price}</strong>` : ""}${executionDuration ? ` | المدة: <strong>${executionDuration}</strong>` : ""}. سجّل دخولك لقبول أو رفض العرض.`,
      en: `Office <strong>${officeName}</strong> sent an offer for your request: <strong>${serviceName}</strong>${price ? `. Price: <strong>${price}</strong>` : ""}${executionDuration ? ` | Duration: <strong>${executionDuration}</strong>` : ""}. Log in to accept or decline.`,
    },
    sr_offer_accepted: {
      ar: `قبل العميل عرضك للخدمة: <strong>${serviceName}</strong>. يمكنك الآن البدء في تنفيذ الخدمة.`,
      en: `The customer accepted your offer for: <strong>${serviceName}</strong>. You can now proceed with the service.`,
    },
    sr_offer_rejected: {
      ar: `رفض العميل عرضك للخدمة: <strong>${serviceName}</strong>.`,
      en: `The customer declined your offer for: <strong>${serviceName}</strong>.`,
    },
    sr_rejected: {
      ar: `للأسف، رفض مكتب <strong>${officeName}</strong> طلبك: <strong>${serviceName}</strong>.`,
      en: `Unfortunately, office <strong>${officeName}</strong> declined your request: <strong>${serviceName}</strong>.`,
    },
    sr_completed_awaiting_confirm: {
      ar: `أبلغ مكتب <strong>${officeName}</strong> عن إتمام الخدمة: <strong>${serviceName}</strong>. سجّل دخولك لتأكيد الإتمام أو الإبلاغ عن مشكلة.`,
      en: `Office <strong>${officeName}</strong> marked your service as complete: <strong>${serviceName}</strong>. Log in to confirm or flag an issue.`,
    },
    sr_confirmed_completed: {
      ar: `أكد العميل إتمام الخدمة: <strong>${serviceName}</strong>. شكراً على خدمتك!`,
      en: `The customer confirmed completion of: <strong>${serviceName}</strong>. Thank you for your service!`,
    },
    sr_not_completed: {
      ar: `أفاد العميل بعدم إتمام الخدمة: <strong>${serviceName}</strong>. سجّل دخولك لمراجعة الموقف.`,
      en: `The customer flagged the service as not completed: <strong>${serviceName}</strong>. Log in to review.`,
    },
  };

  const text = bodyTexts[notificationType];
  const bodyText = text ? (isAr ? text.ar : text.en) : (isAr ? "لديك إشعار جديد" : "You have a new notification");

  const title = isAr ? "إشعار طلب خدمة" : "Service Request Notification";
  const srLabel = isAr ? `طلب #${serviceRequestId}` : `Request #${serviceRequestId}`;

  const body = `
    <h1 style="margin:0 0 12px;font-size:18px;color:#1a1a1a;font-weight:600;">
      📋 ${title}
    </h1>
    <p style="margin:0 0 4px;color:#888;font-size:12px;">${srLabel}</p>
    <p style="margin:8px 0 24px;color:#444;font-size:15px;line-height:1.7;">
      ${bodyText}
    </p>`;

  return emailShell({ locale, title, body });
}

// ---------------------------------------------------------------------------
// Factory — select provider at startup
// ---------------------------------------------------------------------------
export function createEmailProvider(): EmailProvider {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;

  // Allow controlled development delivery when credentials are explicitly
  // supplied; otherwise development remains local-only.
  if (apiKey && from) {
    logger.info("[email] ResendEmailProvider active");
    return new ResendEmailProvider(apiKey, from);
  }

  if (process.env.NODE_ENV === "production") {
    logger.warn(
      "[email] RESEND_API_KEY or RESEND_FROM_EMAIL not set — password reset emails will NOT be delivered in production. Set both secrets to enable email delivery.",
    );
    return new ConsoleEmailProvider();
  }

  logger.info("[email] ConsoleEmailProvider active (development mode)");
  return new ConsoleEmailProvider();
}

export const emailProvider: EmailProvider = createEmailProvider();
