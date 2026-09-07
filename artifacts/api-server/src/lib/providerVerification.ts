/**
 * Provider Email/Phone Verification (Blocker 8)
 *
 * Issues and verifies time-limited 6-digit OTP codes that prove an office
 * account owns the email address or phone number they registered with.
 *
 * Flow:
 *  1. POST /auth/verify/send-email  — generates and sends a code (email)
 *  2. POST /auth/verify/confirm-email — verifies the code, sets email_verified_at
 *  3. POST /auth/verify/send-phone   — generates and sends a code (SMS/OTP)
 *  4. POST /auth/verify/confirm-phone — verifies the code, sets phone_verified_at
 *
 * Security:
 *  - Raw OTP is never stored; only SHA-256(otp) is in the DB.
 *  - Codes expire after 10 minutes.
 *  - A new token is persisted only after the delivery provider accepts it.
 *    Failed sends therefore do not leave an unusable token behind, and an
 *    already-delivered prior token remains usable if a resend fails.
 *  - Max 3 attempts per token enforced via attempt count + used_at check.
 */

import crypto from "crypto";
import { db, usersTable, providerVerificationTokensTable } from "@workspace/db";
import { and, eq, isNull, gt, sql } from "drizzle-orm";
import { emailProvider } from "./email";
import { otpProvider } from "./otpProvider";
import { logger } from "./logger";

/** TTL for OTP codes. */
const OTP_TTL_MINUTES = 10;

/** Length of the numeric OTP. */
const OTP_LENGTH = 6;
const MAX_VERIFICATION_ATTEMPTS = 3;
const MAX_SENDS_PER_HOUR = 5;

export class VerificationRateLimitError extends Error {
  override readonly name = "VerificationRateLimitError";
}

/** SHA-256 hash of a string value. */
function hashOtp(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/** Generate a random N-digit numeric OTP. */
function generateOtp(): string {
  const raw = crypto.randomInt(0, Math.pow(10, OTP_LENGTH));
  return raw.toString().padStart(OTP_LENGTH, "0");
}

// ── Send ──────────────────────────────────────────────────────────────────────

/**
 * Issue a new email verification OTP for `userId`.
 * Returns the raw OTP (to be passed to the email provider) but never stores it.
 * Invalidates any previous pending tokens for this (userId, 'email') pair.
 */
export async function issueEmailVerificationToken(
  userId: number,
  email: string,
): Promise<void> {
  const otp = generateOtp();
  const tokenHash = hashOtp(otp);
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

  await deliverAndPersistVerificationToken({
    userId,
    channel: "email",
    tokenHash,
    contact: email,
    expiresAt,
    deliver: () =>
      emailProvider.sendVerificationCode({
        to: email,
        locale: "ar",
        code: otp,
        expiryMinutes: OTP_TTL_MINUTES,
        channel: "email",
      }),
  });
}

/**
 * Issue a new phone verification OTP for `userId`.
 * Invalidates any previous pending tokens for this (userId, 'phone') pair.
 */
export async function issuePhoneVerificationToken(
  userId: number,
  phone: string,
): Promise<void> {
  const otp = generateOtp();
  const tokenHash = hashOtp(otp);
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

  await deliverAndPersistVerificationToken({
    userId,
    channel: "phone",
    tokenHash,
    contact: phone,
    expiresAt,
    deliver: () => otpProvider.sendOtp(phone, otp),
  });
}

async function deliverAndPersistVerificationToken(opts: {
  userId: number;
  channel: "email" | "phone";
  tokenHash: string;
  contact: string;
  expiresAt: Date;
  deliver: () => Promise<void>;
}): Promise<void> {
  const { userId, channel, tokenHash, contact, expiresAt, deliver } = opts;
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  await db.transaction(async (tx) => {
    // Serialize send/resend for this user and channel across every API instance.
    // This prevents two concurrent requests from racing their persistence order.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${userId}, ${channel === "email" ? 1 : 2})`,
    );

    const [usage] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(providerVerificationTokensTable)
      .where(
        and(
          eq(providerVerificationTokensTable.userId, userId),
          eq(providerVerificationTokensTable.channel, channel),
          gt(providerVerificationTokensTable.createdAt, oneHourAgo),
        ),
      );
    if ((usage?.count ?? 0) >= MAX_SENDS_PER_HOUR) {
      throw new VerificationRateLimitError(
        "Too many verification codes requested for this channel.",
      );
    }

    // Keep the advisory lock while the provider accepts delivery. If delivery
    // fails, no token mutation has occurred. A later successful resend retains
    // the historical row so the durable hourly quota remains enforceable.
    try {
      await deliver();
    } catch (err) {
      logger.warn({ err, userId, channel }, "[verify] OTP delivery failed");
      throw err;
    }

    await tx
      .update(providerVerificationTokensTable)
      .set({ usedAt: now })
      .where(
        and(
          eq(providerVerificationTokensTable.userId, userId),
          eq(providerVerificationTokensTable.channel, channel),
          isNull(providerVerificationTokensTable.usedAt),
        ),
      );

    await tx.insert(providerVerificationTokensTable).values({
      userId,
      channel,
      tokenHash,
      contact,
      expiresAt,
    });
  });
}

// ── Confirm ───────────────────────────────────────────────────────────────────

export type VerifyResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "invalid_code"
        | "expired"
        | "attempts_exhausted"
        | "already_verified"
        | "no_token";
    };

/**
 * Confirm an email OTP. Marks the token used and sets email_verified_at on the user.
 */
export async function confirmEmailVerification(
  userId: number,
  rawCode: string,
): Promise<VerifyResult> {
  return confirmVerification(userId, "email", rawCode, "emailVerifiedAt");
}

/**
 * Confirm a phone OTP. Marks the token used and sets phone_verified_at on the user.
 */
export async function confirmPhoneVerification(
  userId: number,
  rawCode: string,
): Promise<VerifyResult> {
  return confirmVerification(userId, "phone", rawCode, "phoneVerifiedAt");
}

async function confirmVerification(
  userId: number,
  channel: "email" | "phone",
  rawCode: string,
  userField: "emailVerifiedAt" | "phoneVerifiedAt",
): Promise<VerifyResult> {
  const tokenHash = hashOtp(rawCode.trim());
  const now = new Date();

  return db.transaction(async (tx) => {
    // This conditional UPDATE is the single-use claim: exactly one concurrent
    // caller can consume the valid, unexpired code and update verification.
    const [claimed] = await tx
      .update(providerVerificationTokensTable)
      .set({ usedAt: now })
      .where(
        and(
          eq(providerVerificationTokensTable.userId, userId),
          eq(providerVerificationTokensTable.channel, channel),
          eq(providerVerificationTokensTable.tokenHash, tokenHash),
          isNull(providerVerificationTokensTable.usedAt),
          gt(providerVerificationTokensTable.expiresAt, now),
          sql`${providerVerificationTokensTable.attemptCount} < ${MAX_VERIFICATION_ATTEMPTS}`,
        ),
      )
      .returning({ id: providerVerificationTokensTable.id });

    if (claimed) {
      await tx
        .update(usersTable)
        .set({ [userField]: now })
        .where(eq(usersTable.id, userId));
      logger.info({ userId, channel }, "[verify] Verification confirmed");
      return { ok: true };
    }

    // A wrong guess increments the one active token atomically. The third bad
    // guess consumes it, forcing a newly delivered code before another try.
    const [failedAttempt] = await tx
      .update(providerVerificationTokensTable)
      .set({
        attemptCount: sql`${providerVerificationTokensTable.attemptCount} + 1`,
        usedAt: sql`CASE WHEN ${providerVerificationTokensTable.attemptCount} + 1 >= ${MAX_VERIFICATION_ATTEMPTS} THEN ${now} ELSE NULL END`,
      })
      .where(
        and(
          eq(providerVerificationTokensTable.userId, userId),
          eq(providerVerificationTokensTable.channel, channel),
          isNull(providerVerificationTokensTable.usedAt),
          gt(providerVerificationTokensTable.expiresAt, now),
        ),
      )
      .returning({
        attemptCount: providerVerificationTokensTable.attemptCount,
        usedAt: providerVerificationTokensTable.usedAt,
      });

    if (failedAttempt) {
      return {
        ok: false,
        reason:
          failedAttempt.attemptCount >= MAX_VERIFICATION_ATTEMPTS
            ? "attempts_exhausted"
            : "invalid_code",
      };
    }

    const [latestToken] = await tx
      .select({
        expiresAt: providerVerificationTokensTable.expiresAt,
        usedAt: providerVerificationTokensTable.usedAt,
      })
      .from(providerVerificationTokensTable)
      .where(
        and(
          eq(providerVerificationTokensTable.userId, userId),
          eq(providerVerificationTokensTable.channel, channel),
        ),
      )
      .orderBy(sql`${providerVerificationTokensTable.createdAt} DESC`)
      .limit(1);

    if (!latestToken) return { ok: false, reason: "no_token" };
    if (latestToken.expiresAt <= now) return { ok: false, reason: "expired" };
    return { ok: false, reason: "attempts_exhausted" };
  });
}

// ── Status check ──────────────────────────────────────────────────────────────

export interface VerificationStatus {
  emailVerified: boolean;
  phoneVerified: boolean;
}

export async function getVerificationStatus(userId: number): Promise<VerificationStatus> {
  const [user] = await db
    .select({
      emailVerifiedAt: usersTable.emailVerifiedAt,
      phoneVerifiedAt: usersTable.phoneVerifiedAt,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  return {
    emailVerified: !!user?.emailVerifiedAt,
    phoneVerified: !!user?.phoneVerifiedAt,
  };
}
