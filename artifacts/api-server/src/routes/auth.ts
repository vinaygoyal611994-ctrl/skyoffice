import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db, usersTable, officesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  RegisterCustomerBody,
  RegisterOfficeBody,
  LoginBody,
  GetCurrentUserResponse,
} from "@workspace/api-zod";
import {
  hashPassword,
  verifyPassword,
  findUserByEmail,
  toAuthUser,
} from "../lib/auth";
import { generateUniqueOfficeSlug } from "../lib/slug";
import {
  isValidEmail,
  isValidPhone,
  normalizeEmail,
  normalizePhone,
} from "../lib/validation";
import { recordAuditLog } from "../lib/auditLog";
import { requireAuth, requireRole } from "../middlewares/authMiddleware";
import { invalidateAllSessions } from "../lib/sessionInvalidate";
import {
  loginIpLimiter,
  registerIpLimiter,
  checkAccountLockout,
  recordFailedLogin,
  clearLoginFailures,
  lockoutMessage,
  invalidCredentialsMessage,
  changePasswordLimiter,
} from "../lib/rateLimiter";

const router: IRouter = Router();

/** Persists the current session before responding, so a client that
 * immediately reuses `req.sessionID` as its bearer token can't race the
 * write to the session store. */
function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

/**
 * HIGH-07: Session Rotation — issues a new session ID after authentication.
 *
 * express-session's regenerate() destroys the current session and creates a
 * fresh one with a new ID before the user data is written. This eliminates
 * the session-fixation attack vector: any session ID that existed before login
 * becomes invalid immediately, so an adversary who knew it cannot reuse it.
 *
 * The bearer-token shim in app.ts means the client always receives the new
 * session ID in the login/register response body, so this is transparent to
 * the frontend — it simply stores whatever sessionToken the server returns.
 */
function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

/** Returns true if a user with this normalized phone already exists. */
async function phoneAlreadyRegistered(phone: string): Promise<boolean> {
  const normalized = normalizePhone(phone);
  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.phone, normalized));
  return !!existing;
}

/**
 * CRIT-01: Returns true when a Postgres error signals a unique-constraint
 * violation (code 23505). Used to convert DB-level race-condition errors
 * (two concurrent registrations with the same email/phone slipping past the
 * pre-checks) into a 409 HTTP response rather than an opaque 500.
 *
 * drizzle-orm@0.45.x wraps the original pg DatabaseError in its own
 * _DrizzleQueryError class. The pg error code is therefore on `.cause.code`
 * rather than the top-level error. We check both locations so this function
 * works whether Drizzle re-throws directly (future versions) or wraps.
 */
function isDuplicateKeyError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as Record<string, unknown>;
  // Direct pg DatabaseError — code lives at the top level
  if (e.code === "23505") return true;
  // Drizzle-wrapped _DrizzleQueryError — code lives on the nested .cause
  const cause = e.cause;
  if (typeof cause === "object" && cause !== null) {
    if ((cause as Record<string, unknown>).code === "23505") return true;
  }
  return false;
}

router.post(
  "/auth/register/customer",
  registerIpLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = RegisterCustomerBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    if (!parsed.data.termsAccepted) {
      res.status(400).json({
        error: "You must agree to the Terms of Use and Privacy Policy to register",
      });
      return;
    }
    if (!isValidEmail(parsed.data.email)) {
      res.status(400).json({ error: "Please provide a valid email address" });
      return;
    }
    if (parsed.data.phone && !isValidPhone(parsed.data.phone)) {
      res.status(400).json({ error: "Please provide a valid phone number" });
      return;
    }

    const email = normalizeEmail(parsed.data.email);
    const existing = await findUserByEmail(email);
    if (existing) {
      res.status(409).json({ error: "Email already registered" });
      return;
    }
    const normalizedPhone = parsed.data.phone
      ? normalizePhone(parsed.data.phone)
      : null;
    if (normalizedPhone && (await phoneAlreadyRegistered(normalizedPhone))) {
      res.status(409).json({ error: "Phone number already registered" });
      return;
    }

    const passwordHash = await hashPassword(parsed.data.password);
    const consentNow = new Date();

    // CRIT-01: Wrap every DB write for this registration in a single
    // transaction. If the user insert or the audit-log insert fails, the
    // entire operation rolls back atomically — no orphaned user rows.
    let user: typeof usersTable.$inferSelect;
    try {
      user = await db.transaction(async (tx) => {
        const [newUser] = await tx
          .insert(usersTable)
          .values({
            role: "customer",
            name: parsed.data.name,
            email,
            phone: normalizedPhone,
            passwordHash,
            termsAcceptedAt: consentNow,
            privacyAcceptedAt: consentNow,
            acceptedTermsVersion: "1.0",
            acceptedPrivacyVersion: "1.0",
          })
          .returning();

        await recordAuditLog(
          {
            // Actor data is taken directly from the new row — req.session is
            // not yet set at this point (session rotation happens after commit).
            actor: { id: newUser.id, role: "customer", isInternal: newUser.isInternal ?? false },
            action: "customer.register",
            targetType: "user",
            targetId: newUser.id,
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tx as any,
        );

        return newUser;
      });
    } catch (err) {
      // A concurrent registration can race past the pre-check above and then
      // hit Postgres's unique constraint on email or phone. Return 409 so the
      // client gets the same response as the synchronous duplicate check.
      if (isDuplicateKeyError(err)) {
        res.status(409).json({ error: "Email already registered" });
        return;
      }
      throw err;
    }

    // HIGH-07: Regenerate the session ID after the transaction commits.
    // Session mutation is not a DB concern and must not be inside the
    // transaction — a failed session regeneration must not roll back the
    // committed user row.
    await regenerateSession(req);
    req.session.user = { id: user.id, role: "customer", isInternal: user.isInternal ?? false };
    req.session.loginAt = Date.now();
    req.session.lastSeenAt = Date.now();

    await saveSession(req);
    res.status(201).json({
      ...GetCurrentUserResponse.parse(await toAuthUser(user)),
      sessionToken: req.sessionID,
    });
  },
);

router.post(
  "/auth/register/office",
  registerIpLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = RegisterOfficeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    if (!isValidEmail(parsed.data.email)) {
      res.status(400).json({ error: "Please provide a valid email address" });
      return;
    }
    if (!isValidPhone(parsed.data.whatsapp)) {
      res
        .status(400)
        .json({ error: "Please provide a valid WhatsApp number" });
      return;
    }
    if (!parsed.data.termsAccepted) {
      res.status(400).json({
        error: "You must agree to the Terms & Privacy Policy to register",
      });
      return;
    }

    const email = normalizeEmail(parsed.data.email);
    const whatsapp = normalizePhone(parsed.data.whatsapp);
    const existing = await findUserByEmail(email);
    if (existing) {
      res.status(409).json({ error: "Email already registered" });
      return;
    }
    if (await phoneAlreadyRegistered(whatsapp)) {
      res.status(409).json({ error: "Phone number already registered" });
      return;
    }

    const passwordHash = await hashPassword(parsed.data.password);

    // CRIT-01: Wrap ALL DB writes for this registration in a single
    // transaction — user creation, office creation, and both audit-log
    // entries. A failure at any step rolls back completely; there are no
    // orphaned user rows or user rows without a corresponding office.
    let user: typeof usersTable.$inferSelect;
    let office: typeof officesTable.$inferSelect;
    try {
      [user, office] = await db.transaction(async (tx) => {
        const consentNow = new Date();
        const [newUser] = await tx
          .insert(usersTable)
          .values({
            role: "office",
            name: parsed.data.officeName,
            email,
            phone: whatsapp,
            passwordHash,
            termsAcceptedAt: consentNow,
            privacyAcceptedAt: consentNow,
            acceptedTermsVersion: "1.0",
            acceptedPrivacyVersion: "1.0",
          })
          .returning();

        // Run the slug uniqueness check inside the same transaction so it
        // sees the exact same snapshot and races can't produce duplicate slugs.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const slug = await generateUniqueOfficeSlug(parsed.data.officeName, undefined, tx as any);

        const [newOffice] = await tx.insert(officesTable).values({
          userId: newUser.id,
          name: parsed.data.officeName,
          slug,
          category: parsed.data.category,
          city: parsed.data.city,
          whatsapp,
          email,
          isOnline: true,
          isVerified: false,
          isDemo: false,
          termsAcceptedAt: new Date(),
          // New offices start as a draft application — they are invisible to the
          // public until they complete onboarding and an admin activates them.
          status: "draft",
          providerType: parsed.data.providerType,
        }).returning();

        // Audit logs are inside the transaction so they roll back together
        // with the user and office rows if anything else in the callback fails.
        await recordAuditLog(
          {
            actor: { id: newUser.id, role: "office", isInternal: false },
            action: "office.register",
            targetType: "user",
            targetId: newUser.id,
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tx as any,
        );
        await recordAuditLog(
          {
            actor: { id: newUser.id, role: "office", isInternal: false },
            action: "office.provider_type_selected",
            targetType: "office",
            targetId: newOffice.id,
            metadata: { providerType: parsed.data.providerType },
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tx as any,
        );

        return [newUser, newOffice] as const;
      });
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        res.status(409).json({ error: "Email already registered" });
        return;
      }
      throw err;
    }

    // HIGH-07: Regenerate the session ID after the transaction commits.
    await regenerateSession(req);
    req.session.user = { id: user.id, role: "office", isInternal: user.isInternal ?? false };
    req.session.loginAt = Date.now();
    req.session.lastSeenAt = Date.now();

    await saveSession(req);
    res.status(201).json({
      ...GetCurrentUserResponse.parse(await toAuthUser(user)),
      sessionToken: req.sessionID,
    });
  },
);

router.post(
  "/auth/login",
  loginIpLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = LoginBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const email = normalizeEmail(parsed.data.email);

    // Account-level lockout runs in addition to the per-IP limiter above,
    // so credential-stuffing spread across many IPs against one account is
    // still caught. We don't yet know the account's role at this point, so
    // this first check uses whatever threshold was recorded the last time
    // this email failed (recordFailedLogin re-evaluates it with the real
    // role once the user is found below).
    const preLockout = checkAccountLockout(email);
    if (preLockout.locked) {
      res.status(429).json({ error: "ACCOUNT_LOCKED" });
      return;
    }

    const user = await findUserByEmail(email);
    if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
      const lockout = recordFailedLogin(email, user?.role as "admin" | "office" | "customer" | undefined);
      if (lockout.locked) {
        res.status(429).json({ error: "ACCOUNT_LOCKED" });
        return;
      }
      res.status(401).json({ error: "INVALID_CREDENTIALS" });
      return;
    }

    // A deactivated account cannot log in at all. A suspended account can
    // still log in and browse — it is only blocked from creating new contact
    // events / video-call requests (enforced in requireActiveCustomer).
    if (user.status === "deactivated") {
      res.status(403).json({ error: "ACCOUNT_DEACTIVATED" });
      return;
    }

    clearLoginFailures(email);

    // HIGH-07: Regenerate the session ID before writing user data. This
    // issues a fresh, unpredictable session ID and destroys any previous
    // session for this client — eliminating the session-fixation attack surface.
    await regenerateSession(req);
    req.session.user = { id: user.id, role: user.role as "office" | "customer" | "admin", isInternal: user.isInternal ?? false };
    req.session.loginAt = Date.now();
    req.session.lastSeenAt = Date.now();
    await recordAuditLog({
      actor: req.session.user,
      action: "auth.login",
      targetType: "user",
      targetId: user.id,
    });

    // Autoscale strips this app's Set-Cookie header before it reaches the
    // browser (see app.ts), so cookie-based sessions never arrive client-side
    // in production. The client instead carries the session id itself and
    // resends it as `Authorization: Bearer <sessionToken>` on every request;
    // returning it here (in the body, not a cookie) is what makes that
    // possible. We explicitly wait for the session row to be persisted
    // before responding so a client that immediately uses the token can't
    // race the write.
    await saveSession(req);
    res.json({
      ...GetCurrentUserResponse.parse(await toAuthUser(user)),
      sessionToken: req.sessionID,
    });
  },
);

function bilingualDeactivatedMessage(): string {
  return "تم إلغاء تفعيل هذا الحساب. يرجى التواصل مع الدعم.\nThis account has been deactivated. Please contact support.";
}

router.post("/auth/logout", (req: Request, res: Response): void => {
  req.session.destroy(() => {
    res.sendStatus(204);
  });
});

/**
 * HIGH-07: Logout from all devices.
 *
 * Deletes every session row for the authenticated user from the Postgres
 * session store — the equivalent of "sign out everywhere". The current
 * request's session is included in the sweep.
 *
 * Returns 204 on success. If the caller is not authenticated the session
 * is simply destroyed (no-op from a security standpoint).
 */
router.post(
  "/auth/logout-all",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.session.user!.id;

    // Delete every session row for this user from the store, then explicitly
    // destroy the current in-memory session so express-session's rolling-save
    // cannot re-insert the just-deleted row before this response is written.
    await invalidateAllSessions(userId);
    req.session.destroy(() => {
      res.sendStatus(204);
    });
  },
);

router.get(
  "/auth/me",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const sessionUser = req.session.user!;
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, sessionUser.id));

    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    res.json(GetCurrentUserResponse.parse(await toAuthUser(user)));
  },
);

// ---------------------------------------------------------------------------
// POST /auth/change-password
//
// Allows an authenticated admin to change their own password by supplying
// the current password (verified server-side with bcrypt), a new password
// that meets strength requirements, and its confirmation.
//
// On success: all sessions for this user are invalidated, the current
// in-memory session is destroyed, and the client must re-authenticate.
// Responds 204 (no body) so no credential material is ever returned.
// ---------------------------------------------------------------------------

const ChangePasswordBody = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password is too long")
    .regex(/[a-zA-Z]/, "Password must contain at least one letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
  confirmPassword: z.string().min(1, "Confirmation is required"),
});

router.post(
  "/auth/change-password",
  requireAuth,
  changePasswordLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = ChangePasswordBody.safeParse(req.body);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      res.status(400).json({
        error: firstIssue?.message ?? "Invalid request",
        code: "VALIDATION_ERROR",
      });
      return;
    }

    const { currentPassword, newPassword, confirmPassword } = parsed.data;

    // Confirm the two new-password fields match before touching the DB.
    if (newPassword !== confirmPassword) {
      res.status(400).json({
        error: "Passwords do not match",
        code: "PASSWORD_MISMATCH",
      });
      return;
    }

    const userId = req.session.user!.id;

    // Re-read the full user row — the session only carries id + role,
    // not the passwordHash we need for bcrypt comparison.
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId));

    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // Verify the current password against the stored bcrypt hash.
    const currentPasswordValid = await verifyPassword(currentPassword, user.passwordHash);
    if (!currentPasswordValid) {
      // Audit the failed attempt (no password/hash in metadata).
      await recordAuditLog({
        actor: req.session.user,
        action: "auth.change_password_failed_wrong_current",
        targetType: "user",
        targetId: userId,
      });
      res.status(401).json({
        error: "Current password is incorrect",
        code: "WRONG_CURRENT_PASSWORD",
      });
      return;
    }

    // Hash the new password using the same bcrypt config as the rest of the app.
    const newPasswordHash = await hashPassword(newPassword);

    // Persist the new hash — only this user's row is touched.
    await db
      .update(usersTable)
      .set({ passwordHash: newPasswordHash })
      .where(eq(usersTable.id, userId));

    // Kill every active session for this user across all devices.
    await invalidateAllSessions(userId);

    // Audit the successful change — role is the only metadata; no hash/password.
    await recordAuditLog({
      actor: req.session.user,
      action: "auth.password_changed",
      targetType: "user",
      targetId: userId,
      metadata: { role: user.role },
    });

    // Destroy the current in-memory session so rolling-save cannot
    // re-insert the just-deleted row before the response is written.
    req.session.destroy(() => {
      res.sendStatus(204);
    });
  },
);

// ---------------------------------------------------------------------------
// PATCH /auth/me  — update own name and/or phone (all roles)
// ---------------------------------------------------------------------------
const UpdateMeBody = z.object({
  name:  z.string().min(1).max(100).optional(),
  phone: z.string().optional(),
});

router.patch(
  "/auth/me",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = UpdateMeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
      return;
    }

    const { name, phone } = parsed.data;
    const userId = req.session.user!.id;

    const updates: Record<string, unknown> = {};

    if (name !== undefined) {
      updates.name = name.trim();
    }

    if (phone !== undefined) {
      if (phone === '') {
        updates.phone = null;
      } else {
        if (!isValidPhone(phone)) {
          res.status(400).json({ error: "Please provide a valid phone number" });
          return;
        }
        const normalized = normalizePhone(phone);
        // Check if phone is taken by another user
        const existing = await db.select({ id: usersTable.id }).from(usersTable)
          .where(eq(usersTable.phone, normalized));
        if (existing.length > 0 && existing[0].id !== userId) {
          res.status(409).json({ error: "This phone number is already in use" });
          return;
        }
        updates.phone = normalized;
      }
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "Nothing to update" });
      return;
    }

    await db.update(usersTable).set(updates).where(eq(usersTable.id, userId));

    const [updated] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    res.json(GetCurrentUserResponse.parse(await toAuthUser(updated)));
  },
);

export default router;
