/**
 * Provider email/phone verification routes (Blocker 8).
 *
 * Routes:
 *  GET  /auth/verify/status         — returns { emailVerified, phoneVerified }
 *  POST /auth/verify/send-email     — issue/resend email OTP
 *  POST /auth/verify/confirm-email  — verify email OTP → sets email_verified_at
 *  POST /auth/verify/send-phone     — issue/resend phone OTP
 *  POST /auth/verify/confirm-phone  — verify phone OTP → sets phone_verified_at
 *
 * All routes require the "office" role — verification is a provider-only gate.
 * Customer email verification is out of scope for the pilot.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireRole } from "../middlewares/authMiddleware";
import {
  issueEmailVerificationToken,
  issuePhoneVerificationToken,
  confirmEmailVerification,
  confirmPhoneVerification,
  getVerificationStatus,
} from "../lib/providerVerification";
import { isValidPhone, normalizePhone } from "../lib/validation";
import { recordAuditLog } from "../lib/auditLog";
import { VerificationDeliveryError } from "../lib/verificationDeliveryError";

const router: IRouter = Router();

const ConfirmCodeBody = z.object({
  code: z.string().regex(/^\d{6}$/),
});

function deliveryUnavailable(res: Response, channel: "email" | "phone"): void {
  res.status(503).json({
    error: "Verification delivery is temporarily unavailable",
    code: "delivery_unavailable",
    channel,
  });
}

function handleDeliveryError(
  res: Response,
  channel: "email" | "phone",
  error: unknown,
): void {
  if (error instanceof VerificationDeliveryError) {
    res.status(503).json({
      error:
        error.reason === "provider_not_configured"
          ? "Verification delivery is temporarily unavailable because the provider is not configured"
          : "The verification code could not be delivered. Please try again later",
      code:
        error.reason === "provider_not_configured"
          ? "verification_provider_not_configured"
          : "verification_delivery_failed",
      channel: error.channel,
    });
    return;
  }
  if (
    error instanceof Error &&
    error.name === "VerificationRateLimitError"
  ) {
    res.status(429).json({
      error: "Too many verification codes requested. Please wait before trying again.",
      code: "rate_limited",
      channel,
    });
    return;
  }
  deliveryUnavailable(res, channel);
}

const verificationConfirmationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) =>
    `${req.session?.user?.id ?? "anonymous"}:${req.path}:${ipKeyGenerator(req.ip ?? "")}`,
  message: {
    error:
      "Too many verification attempts. Please wait before trying another code.",
  },
});

// ── GET /auth/verify/status ───────────────────────────────────────────────────

router.get(
  "/auth/verify/status",
  requireRole("office"),
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.session.user!.id;
    const status = await getVerificationStatus(userId);
    res.json(status);
  },
);

// ── POST /auth/verify/send-email ──────────────────────────────────────────────

router.post(
  "/auth/verify/send-email",
  requireRole("office"),
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.session.user!.id;

    // Re-read current email from DB (session carries only id+role).
    const [user] = await db
      .select({ email: usersTable.email, emailVerifiedAt: usersTable.emailVerifiedAt })
      .from(usersTable)
      .where(eq(usersTable.id, userId));

    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }

    // Idempotent: already verified — nothing to do.
    if (user.emailVerifiedAt) {
      res.json({ message: "Email already verified", alreadyVerified: true });
      return;
    }

    try {
      await issueEmailVerificationToken(userId, user.email);
    } catch (err) {
      req.log?.warn({ err, userId }, "Email verification delivery failed");
      handleDeliveryError(res, "email", err);
      return;
    }

    await recordAuditLog({
      actor: req.session.user!,
      action: "provider.email_verification_requested",
      targetType: "user",
      targetId: userId,
    });

    res.json({ message: "Verification code sent", email: user.email });
  },
);

// ── POST /auth/verify/confirm-email ──────────────────────────────────────────

router.post(
  "/auth/verify/confirm-email",
  requireRole("office"),
  verificationConfirmationLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = ConfirmCodeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Please provide a valid verification code" });
      return;
    }

    const userId = req.session.user!.id;
    const result = await confirmEmailVerification(userId, parsed.data.code);

    if (!result.ok) {
      const messages: Record<string, string> = {
        invalid_code: "Invalid verification code",
        expired:      "Verification code has expired — please request a new one",
        attempts_exhausted:
          "Too many incorrect codes — please request a new verification code",
        no_token:     "No verification code found — please request a new one",
      };
      res.status(400).json({
        error: messages[result.reason] ?? "Verification failed",
        code: result.reason,
      });
      return;
    }

    await recordAuditLog({
      actor: req.session.user!,
      action: "provider.email_verified",
      targetType: "user",
      targetId: userId,
    });

    res.json({ message: "Email verified successfully", emailVerified: true });
  },
);

// ── POST /auth/verify/send-phone ──────────────────────────────────────────────

router.post(
  "/auth/verify/send-phone",
  requireRole("office"),
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.session.user!.id;

    const [user] = await db
      .select({ phone: usersTable.phone, phoneVerifiedAt: usersTable.phoneVerifiedAt })
      .from(usersTable)
      .where(eq(usersTable.id, userId));

    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }

    if (!user.phone) {
      res.status(400).json({ error: "No phone number registered — please add a phone number first" });
      return;
    }

    if (!isValidPhone(user.phone)) {
      res.status(400).json({ error: "Invalid phone number on file" });
      return;
    }

    if (user.phoneVerifiedAt) {
      res.json({ message: "Phone already verified", alreadyVerified: true });
      return;
    }

    const normalizedPhone = normalizePhone(user.phone);
    try {
      await issuePhoneVerificationToken(userId, normalizedPhone);
    } catch (err) {
      req.log?.warn({ err, userId }, "Phone verification delivery failed");
      handleDeliveryError(res, "phone", err);
      return;
    }

    await recordAuditLog({
      actor: req.session.user!,
      action: "provider.phone_verification_requested",
      targetType: "user",
      targetId: userId,
    });

    res.json({ message: "Verification code sent", phone: normalizedPhone });
  },
);

// ── POST /auth/verify/confirm-phone ──────────────────────────────────────────

router.post(
  "/auth/verify/confirm-phone",
  requireRole("office"),
  verificationConfirmationLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = ConfirmCodeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Please provide a valid verification code" });
      return;
    }

    const userId = req.session.user!.id;
    const result = await confirmPhoneVerification(userId, parsed.data.code);

    if (!result.ok) {
      const messages: Record<string, string> = {
        invalid_code: "Invalid verification code",
        expired:      "Verification code has expired — please request a new one",
        attempts_exhausted:
          "Too many incorrect codes — please request a new verification code",
        no_token:     "No verification code found — please request a new one",
      };
      res.status(400).json({
        error: messages[result.reason] ?? "Verification failed",
        code: result.reason,
      });
      return;
    }

    await recordAuditLog({
      actor: req.session.user!,
      action: "provider.phone_verified",
      targetType: "user",
      targetId: userId,
    });

    res.json({ message: "Phone verified successfully", phoneVerified: true });
  },
);

export default router;
