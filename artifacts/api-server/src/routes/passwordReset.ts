import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { findUserByEmail, hashPassword } from "../lib/auth";
import { normalizeEmail } from "../lib/validation";
import { logger } from "../lib/logger";
import { recordAuditLog } from "../lib/auditLog";
import { clearLoginFailures } from "../lib/rateLimiter";
import { emailProvider } from "../lib/email";
import {
  invalidatePreviousTokens,
  createResetToken,
  lookupValidToken,
  lookupAnyToken,
  claimTokenAndUpdatePassword,
} from "../lib/passwordReset";
import { invalidateAllSessions } from "../lib/sessionInvalidate";
import {
  forgotPasswordIpLimiter,
  forgotPasswordEmailLimiter,
  resetConfirmIpLimiter,
} from "../lib/rateLimiter";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const ForgotPasswordBody = z.object({
  email: z.string().email().max(254).transform((v) => v.toLowerCase().trim()),
});

const ResetPasswordBody = z.object({
  token: z.string().min(1).max(200),
  newPassword: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password is too long")
    .regex(/[a-zA-Z]/, "Password must contain at least one letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the canonical frontend base URL for building reset links. */
function getFrontendUrl(): string {
  if (process.env.FRONTEND_URL) {
    return process.env.FRONTEND_URL.replace(/\/$/, "");
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "FRONTEND_URL is required in production to build password reset links",
    );
  }
  // Dev: REPLIT_DEV_DOMAIN if available, else localhost.
  // The ConsoleEmailProvider only LOGS this URL — it is never emailed in dev.
  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  }
  return "http://localhost:5173";
}

/** The generic response text shown regardless of whether the email exists. */
function genericForgotResponse() {
  return {
    message:
      "If an account exists for this email, a password reset link has been sent.\n" +
      "إذا كان هناك حساب مرتبط بهذا البريد، فسيتم إرسال رابط استعادة كلمة المرور.",
  };
}

// ---------------------------------------------------------------------------
// POST /auth/forgot-password
// ---------------------------------------------------------------------------

router.post(
  "/auth/forgot-password",
  forgotPasswordIpLimiter,
  forgotPasswordEmailLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = ForgotPasswordBody.safeParse(req.body);
    if (!parsed.success) {
      // Still return generic 200 — don't reveal validation details that
      // could help enumerate which emails are registered.
      res.status(200).json(genericForgotResponse());
      return;
    }

    const email = parsed.data.email;

    // The entire "real user" path is wrapped in a try/catch so that ANY
    // internal failure (DB error, email provider network blip, unexpected
    // exception) still produces the same generic 200 response.  This is
    // critical: an unguarded exception here would return 500 for existing
    // accounts while returning 200 for non-existing ones, leaking account
    // existence to an attacker.
    try {
      // Look up user silently — whether found or not, the response is always
      // the same generic message to prevent email enumeration.
      const user = await findUserByEmail(email);

      if (user) {
        // Determine user locale for email content — default to Arabic.
        // (We don't store per-user locale preferences yet, so we send bilingual.)
        const locale = "ar"; // both languages appear in the email template

        // Invalidate any previous unused tokens before issuing a new one.
        await invalidatePreviousTokens(user.id);

        // Create a new token — raw token goes to the user, hash goes to DB.
        const ip = req.ip ?? "unknown";
        const { rawToken, expiryMinutes } = await createResetToken({
          userId: user.id,
          role: user.role as "admin" | "office" | "customer",
          ip,
        });

        // Build the reset URL using the canonical frontend URL.
        const frontendUrl = getFrontendUrl();
        const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}`;

        // Send email (or log to console in dev).
        // emailProvider methods are themselves exception-safe (catch internally),
        // but this outer catch is the final safety net for any unforeseen throw.
        await emailProvider.sendPasswordResetEmail({
          to: email,
          locale,
          resetUrl,
          expiryMinutes,
        });

        // Audit: actor is null (unauthenticated); no role/account details in metadata.
        await recordAuditLog({
          actor: null,
          action: "auth.password_reset_requested",
          targetType: "user",
          targetId: user.id,
          metadata: { ipHash: Buffer.from(ip).toString("base64") },
        });
      }
      // If user not found: we do nothing extra. The response is identical.
    } catch (err) {
      // Log the error for operator visibility but do NOT propagate it.
      // The caller must always receive the same generic response regardless
      // of whether the account exists or not (enumeration prevention).
      logger.error({ err, email }, "[forgot-password] internal error — suppressed to preserve generic response");
    }

    res.status(200).json(genericForgotResponse());
  },
);

// ---------------------------------------------------------------------------
// POST /auth/reset-password
// ---------------------------------------------------------------------------

router.post(
  "/auth/reset-password",
  resetConfirmIpLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = ResetPasswordBody.safeParse(req.body);
    if (!parsed.success) {
      // Return structured validation errors for the client to display.
      const firstIssue = parsed.error.issues[0];
      res.status(400).json({
        error: firstIssue?.message ?? "Invalid request",
        code: "VALIDATION_ERROR",
      });
      return;
    }

    const { token: rawToken, newPassword } = parsed.data;

    // Check if the token is valid (unused + not expired).
    const validToken = await lookupValidToken(rawToken);

    if (!validToken) {
      // Distinguish between "expired" and "never existed / tampered".
      const anyToken = await lookupAnyToken(rawToken);

      if (anyToken) {
        // Token existed but is expired or already used.
        const isExpired =
          anyToken.usedAt === null && anyToken.expiresAt < new Date();

        await recordAuditLog({
          actor: null,
          action: isExpired
            ? "auth.password_reset_failed_expired"
            : "auth.password_reset_failed_used_token",
          targetType: "user",
          targetId: anyToken.userId,
        });

        res.status(410).json({
          error:
            isExpired
              ? "This password reset link has expired. Please request a new one.\n" +
                "انتهت صلاحية رابط إعادة تعيين كلمة المرور. يرجى طلب رابط جديد."
              : "This password reset link has already been used. Please request a new one.\n" +
                "تم استخدام هذا الرابط مسبقًا. يرجى طلب رابط جديد.",
          code: isExpired ? "TOKEN_EXPIRED" : "TOKEN_USED",
        });
        return;
      }

      // Token was never issued or has been tampered with.
      await recordAuditLog({
        actor: null,
        action: "auth.password_reset_failed_invalid_token",
        targetType: "user",
        targetId: undefined,
      });

      res.status(400).json({
        error:
          "This password reset link is invalid. Please request a new one.\n" +
          "رابط إعادة تعيين كلمة المرور غير صالح. يرجى طلب رابط جديد.",
        code: "TOKEN_INVALID",
      });
      return;
    }

    // --- Token is valid. Apply the password reset atomically. ---

    // Load the user to get the current role for audit.
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, validToken.userId));

    if (!user) {
      // Shouldn't happen (FK cascade), but handle defensively.
      res.status(400).json({ error: "Account not found.", code: "USER_NOT_FOUND" });
      return;
    }

    // Hash the new password with bcrypt (same SALT_ROUNDS as hashPassword).
    // Done outside the transaction: bcrypt is CPU-bound and slow; holding a
    // transaction open during it would unnecessarily tie up a DB connection.
    const newPasswordHash = await hashPassword(newPassword);

    // Atomically: lock the token row, verify it is still claimable, mark it
    // used, update the password, and invalidate all other reset tokens for
    // this user — all in a single serializable transaction.
    // If two concurrent requests race on the same token, the second one
    // receives claimed=false and we return 410 (token already used).
    const claimResult = await claimTokenAndUpdatePassword(
      validToken.id,
      user.id,
      newPasswordHash,
    );

    if (!claimResult.claimed) {
      // A concurrent request beat us — token was consumed between our
      // initial lookup and the atomic claim.  Enumeration-safe: same 410
      // response body as a previously-used token.
      await recordAuditLog({
        actor: null,
        action: "auth.password_reset_failed_used_token",
        targetType: "user",
        targetId: user.id,
      });
      res.status(410).json({
        error:
          "This password reset link has already been used. Please request a new one.\n" +
          "تم استخدام هذا الرابط مسبقًا. يرجى طلب رابط جديد.",
        code: "TOKEN_USED",
      });
      return;
    }

    // Kill all active sessions across all devices.
    await invalidateAllSessions(user.id);

    // Clear the in-memory login-failure counter so the account is not
    // still locked after a successful reset.
    clearLoginFailures(user.email);

    // Audit: successful reset — no password, token, or hash in metadata.
    await recordAuditLog({
      actor: null,
      action: "auth.password_reset_completed",
      targetType: "user",
      targetId: user.id,
      metadata: { role: user.role },
    });

    // Notify the user's email that their password was changed.
    // Best-effort — failure does not affect the response.
    emailProvider
      .sendPasswordChangedNotification({ to: user.email, locale: "ar" })
      .catch(() => undefined);

    res.status(200).json({
      message:
        "Your password has been reset successfully. Please log in with your new password.\n" +
        "تم إعادة تعيين كلمة مرورك بنجاح. يرجى تسجيل الدخول بكلمة المرور الجديدة.",
      role: user.role,
    });
  },
);

export default router;
