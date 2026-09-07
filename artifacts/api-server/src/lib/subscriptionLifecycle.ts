/**
 * Subscription Lifecycle — Core state machine for SkayOffice subscription management.
 *
 * Design principles:
 *   • Every state transition writes an immutable subscription_history row.
 *   • The office and all its data (transactions, reviews, QR/links, analytics)
 *     are NEVER deleted due to subscription state.
 *   • is_subscription_hidden on the offices table is the ONLY visibility flag;
 *     offices.status is NOT touched by any subscription operation.
 *   • supply_cap and supply_gate columns are NOT touched.
 *   • Trial duration comes from system_config; never hardcoded.
 *
 * Valid state transitions:
 *   free         → trial, active_paid
 *   trial        → expiring, expired, active_paid, cancelled
 *   active_paid  → expiring, cancelled
 *   expiring     → active_paid (renewed), expired, cancelled
 *   expired      → active_paid (reactivated), hidden_due_to_nonpayment, cancelled
 *   hidden       → active_paid (reactivated), cancelled
 *   cancelled    → active_paid (reactivated)
 *
 * Sweeper-driven transitions (automated, changedBy = null):
 *   active_paid/trial → expiring                   (when expiresAt within warning window)
 *   expiring/active_paid/trial → expired            (when expiresAt in the past)
 *   expired → hidden_due_to_nonpayment             (after grace period)
 */

import { db, pool } from "@workspace/db";
import {
  officesTable,
  officeSubscriptionsTable,
  subscriptionHistoryTable,
  subscriptionNotificationsTable,
  systemConfigTable,
  type OfficeSubscription,
  type SubscriptionState,
  type SubscriptionNotificationType,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { logger } from "./logger";
import { emailProvider } from "./email";
import {
  releaseSlot,
  cancelSlot,
  processWaitlist,
  getSlotStatus,
  convertReservationToAllocation,
} from "./supplySlotManager";

// ── System config helpers ──────────────────────────────────────────────────────

/**
 * Read a single system_config value. Returns defaultValue if the key is not set.
 * Values are always stored as text; callers parse as needed.
 */
export async function getSystemConfigValue(
  key: string,
  defaultValue: string,
): Promise<string> {
  const [row] = await db
    .select({ value: systemConfigTable.value })
    .from(systemConfigTable)
    .where(eq(systemConfigTable.key, key));
  return row?.value ?? defaultValue;
}

export async function setSystemConfigValue(
  key: string,
  value: string,
  adminId: number,
  description?: string,
): Promise<void> {
  await db
    .insert(systemConfigTable)
    .values({ key, value, description: description ?? null, updatedBy: adminId })
    .onConflictDoUpdate({
      target: systemConfigTable.key,
      set: {
        value,
        updatedAt: new Date(),
        updatedBy: adminId,
        ...(description ? { description } : {}),
      },
    });
}

// ── History recording ─────────────────────────────────────────────────────────

interface HistoryEntry {
  officeId:       number;
  subscriptionId: number | null;
  fromState:      SubscriptionState | null;
  toState:        SubscriptionState;
  reason?:        string | null;
  changedBy?:     number | null;  // null = system/sweeper
  metadata?:      Record<string, unknown> | null;
  tx?:            typeof db | null; // optional transaction context
}

async function recordHistory(entry: HistoryEntry): Promise<void> {
  const writer = (entry.tx ?? db) as typeof db;
  await writer.insert(subscriptionHistoryTable).values({
    officeId:       entry.officeId,
    subscriptionId: entry.subscriptionId,
    fromState:      entry.fromState,
    toState:        entry.toState,
    reason:         entry.reason ?? null,
    changedBy:      entry.changedBy ?? null,
    metadata:       entry.metadata ?? null,
  });
}

// ── Get / create subscription row ─────────────────────────────────────────────

/**
 * Fetch the current subscription for an office.
 * Returns null if no subscription exists yet.
 */
export async function getSubscription(
  officeId: number,
): Promise<OfficeSubscription | null> {
  const [row] = await db
    .select()
    .from(officeSubscriptionsTable)
    .where(eq(officeSubscriptionsTable.officeId, officeId));
  return row ?? null;
}

/**
 * Fetch or create a 'free' subscription for an office.
 * Safe to call multiple times — idempotent.
 */
export async function getOrCreateSubscription(
  officeId: number,
): Promise<OfficeSubscription> {
  const existing = await getSubscription(officeId);
  if (existing) return existing;

  const [created] = await db
    .insert(officeSubscriptionsTable)
    .values({ officeId, state: "free" })
    .onConflictDoUpdate({
      target: officeSubscriptionsTable.officeId,
      set: { updatedAt: new Date() },
    })
    .returning();

  await recordHistory({
    officeId,
    subscriptionId: created!.id,
    fromState:      null,
    toState:        "free",
    reason:         "Initial subscription created",
    changedBy:      null,
  });

  return created!;
}

// ── State transitions ──────────────────────────────────────────────────────────

/**
 * Start a trial for an office.
 * Allowed from: free (and only free — never re-start a trial that is already running).
 * trialDays defaults to the system_config 'trial_duration_days' value.
 */
export async function startTrial(
  officeId: number,
  adminId: number,
  trialDaysOverride?: number,
): Promise<OfficeSubscription> {
  const sub = await getOrCreateSubscription(officeId);

  if (sub.state !== "free") {
    throw new SubscriptionLifecycleError(
      `Cannot start trial: office ${officeId} is in state '${sub.state}', not 'free'.`,
      "INVALID_TRANSITION",
    );
  }

  const trialDays = trialDaysOverride
    ?? parseInt(await getSystemConfigValue("trial_duration_days", "14"), 10);

  const now         = new Date();
  const trialEndsAt = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);

  const [updated] = await db
    .update(officeSubscriptionsTable)
    .set({
      state:             "trial",
      trialStartedAt:    now,
      trialEndsAt,
      expiresAt:         trialEndsAt,
      notifiedReminders: sql`'{}'::text[]`, // reset reminders for new period
      updatedAt:         now,
    })
    .where(eq(officeSubscriptionsTable.officeId, officeId))
    .returning();

  await recordHistory({
    officeId,
    subscriptionId: sub.id,
    fromState:      "free",
    toState:        "trial",
    reason:         `Trial started: ${trialDays} days`,
    changedBy:      adminId,
    metadata:       { trialDays, trialStartedAt: now.toISOString(), trialEndsAt: trialEndsAt.toISOString() },
  });

  logger.info({ officeId, adminId, trialDays, trialEndsAt }, "[subscription] Trial started");
  return updated!;
}

// ── activatePaid state-transition constants ────────────────────────────────────

/**
 * Source states from which activatePaid() may be called directly.
 *
 * These are the "live" states — new activations, trial conversions, and renewals.
 * Terminated states (expired / hidden_due_to_nonpayment / cancelled) require the
 * reactivate() function, which records explicit admin intent before delegating here.
 */
const ACTIVATE_PAID_ALLOWED_STATES: ReadonlyArray<SubscriptionState> = [
  "free",        // initial paid activation (skipping trial)
  "trial",       // converting an active trial to paid
  "active_paid", // renewal: already paid, extending the period
  "expiring",    // renewal in the expiry-reminder window
] as const;

/**
 * Core paid-activation logic shared by activatePaid() and reactivate().
 *
 * Precondition: the caller has already validated that `sub.state` is an
 * acceptable source state for this activation path.  This function does NOT
 * re-check the source state — it trusts the caller.
 *
 * Contains the slot gate, atomic DB transaction, history write,
 * and post-commit slot action.
 *
 * @param adminId  The human admin who triggered the activation, or `null` when
 *                 the activation is system/gateway-driven (e.g. a Stripe webhook).
 *                 `null` is stored as-is in subscription_history.changed_by and
 *                 slot_audit_log.performed_by — both columns allow NULL and the
 *                 schema documents it as the correct value for automated actions.
 */
async function activatePaidCore(
  officeId: number,
  adminId: number | null,
  paidThroughDate: Date,
  sub: OfficeSubscription,
  notes?: string,
): Promise<OfficeSubscription> {
  const fromState = sub.state;

  // ── Slot gate: verify BEFORE subscription transaction ─────────────────────
  // Fail fast with no DB side-effects if no valid slot exists.
  const slotInfo = await getSlotStatus(officeId);
  const now      = new Date();

  type SlotAction = "convert_reservation" | "renewal" | "not_required";
  let slotAction: SlotAction;

  if (!slotInfo.slotStatus || slotInfo.slotStatus === "not_required") {
    slotAction = "not_required";
  } else if (slotInfo.slotStatus === "allocated") {
    slotAction = "renewal";
  } else if (
    slotInfo.slotStatus === "reserved" &&
    slotInfo.reservationExpiresAt &&
    slotInfo.reservationExpiresAt > now
  ) {
    slotAction = "convert_reservation";
  } else {
    // No valid slot — payment must be blocked upstream
    const details = `slotStatus=${slotInfo.slotStatus}, reservationExpiresAt=${slotInfo.reservationExpiresAt?.toISOString() ?? "none"}`;
    logger.error({ officeId, adminId, details }, "[subscription] activatePaid BLOCKED — no valid slot reservation");
    throw new Error(
      `Payment activation blocked for office ${officeId}: no valid slot reservation (${details}). ` +
      "Call checkPrePaymentCapacity() before initiating payment to obtain a reservation.",
    );
  }

  // Update subscription row atomically
  const client = await pool.connect();
  let updated: OfficeSubscription;
  try {
    await client.query("BEGIN");
    const res = await client.query<OfficeSubscription>(
      `UPDATE office_subscriptions
       SET state               = 'active_paid',
           paid_through_date   = $1,
           expires_at          = $1,
           notified_reminders  = '{}',
           hidden_at           = NULL,
           cancelled_at        = NULL,
           cancel_reason       = NULL,
           notes               = COALESCE($2, notes),
           updated_at          = $3
       WHERE office_id = $4
       RETURNING *`,
      [paidThroughDate, notes ?? null, now, officeId],
    );
    updated = res.rows[0]!;
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  await recordHistory({
    officeId,
    subscriptionId: sub.id,
    fromState:      fromState as SubscriptionState,
    toState:        "active_paid",
    reason:         fromState === "free" ? "Initial paid activation" : "Paid subscription activated",
    changedBy:      adminId,
    metadata:       { paidThroughDate: paidThroughDate.toISOString() },
  });

  // ── Slot transition (post-commit) ─────────────────────────────────────────
  switch (slotAction) {
    case "not_required":
      // Uncapped market — restore public visibility
      await db
        .update(officesTable)
        .set({ isSubscriptionHidden: false })
        .where(eq(officesTable.id, officeId));
      logger.info({ officeId }, "[subscription] activatePaid: not_required market — cleared is_subscription_hidden");
      break;

    case "renewal":
      // Office already holds an allocated slot; visibility unchanged
      logger.info({ officeId }, "[subscription] activatePaid: renewal — slot unchanged");
      break;

    case "convert_reservation":
      // Convert 3-hour reservation to permanent allocation (visible on success)
      try {
        await convertReservationToAllocation(officeId, adminId);
        logger.info({ officeId }, "[subscription] activatePaid: reservation converted to allocation");
      } catch (convertErr) {
        // Reservation may have expired in the narrow window between slot gate check
        // and this post-commit call.  The subscription is already committed to
        // active_paid and the payment is confirmed — we MUST NOT silently continue.
        //
        // Set slot_sync_needed_at so the slot-sync recovery sweeper detects this
        // office on its next run (every 15 min) and retries conversion.  If the
        // reservation is still valid the sweeper fixes it automatically.  If the
        // window has elapsed, the office surfaces in Platform Health as "needs admin".
        try {
          await pool.query(
            `UPDATE office_subscriptions
             SET slot_sync_needed_at = NOW()
             WHERE office_id = $1`,
            [officeId],
          );
        } catch (flagErr) {
          // Flag write failed too — log both errors.  The Platform Health
          // slotSync section uses a direct COUNT query that will still surface
          // any active_paid office without an allocated slot, providing a
          // secondary detection path even without the flag.
          logger.error(
            { err: flagErr, officeId },
            "[subscription] activatePaid: CRITICAL — failed to write slot_sync_needed_at flag after conversion failure",
          );
        }
        logger.error(
          { err: convertErr, officeId },
          "[subscription] activatePaid: CRITICAL — convertReservationToAllocation failed after subscription committed; slot_sync_needed_at set for recovery sweeper",
        );
      }
      break;
  }

  logger.info({ officeId, adminId, paidThroughDate, fromState, slotAction }, "[subscription] Paid subscription activated");
  return updated!;
}

/**
 * Activate a paid subscription — for new activations, trial conversions, and renewals.
 *
 * Allowed source states:
 *   free        → initial paid activation (skipping trial)
 *   trial       → converting an active trial to paid
 *   active_paid → renewal (already paid, extending the period) — idempotent
 *   expiring    → renewal in the expiry-reminder window
 *
 * To reactivate from a terminated state (expired / hidden_due_to_nonpayment / cancelled)
 * use reactivate() instead.  That function validates the reactivation source states and
 * ensures the appropriate admin intent is recorded before proceeding.
 *
 * SLOT GATE: eliminates 'active_paid + slot_status=waiting' permanently.
 * Payment activation requires one of:
 *   (a) A valid (unexpired) slot reservation  → convert reservation to allocation
 *   (b) Office already holds an allocated slot → renewal; no slot change needed
 *   (c) Office is in an uncapped market        → clear is_subscription_hidden directly
 *
 * @param adminId  The human admin performing the activation, or `null` for
 *                 system/gateway-triggered activations (e.g. Stripe webhooks).
 *                 `null` is stored verbatim in history and audit log — it is the
 *                 correct sentinel for automated actions, not a missing value.
 *
 * THROWS SubscriptionLifecycleError(INVALID_TRANSITION) if called from a disallowed state.
 * THROWS Error if the slot gate fails (no valid reservation / allocation).
 */
export async function activatePaid(
  officeId: number,
  adminId: number | null,
  paidThroughDate: Date,
  notes?: string,
): Promise<OfficeSubscription> {
  const sub = await getOrCreateSubscription(officeId);

  if (!(ACTIVATE_PAID_ALLOWED_STATES as readonly string[]).includes(sub.state)) {
    throw new SubscriptionLifecycleError(
      `Cannot call activatePaid() on office ${officeId}: current state is '${sub.state}'. ` +
      `Allowed states: [${ACTIVATE_PAID_ALLOWED_STATES.join(", ")}]. ` +
      `Use reactivate() for expired, hidden_due_to_nonpayment, or cancelled subscriptions.`,
      "INVALID_TRANSITION",
    );
  }

  return activatePaidCore(officeId, adminId, paidThroughDate, sub, notes);
}

/**
 * Transition to 'expiring' state (sweeper-driven).
 * Allowed from: active_paid, trial.
 */
export async function markExpiring(officeId: number): Promise<void> {
  const sub = await getSubscription(officeId);
  if (!sub) return;
  if (!["active_paid", "trial"].includes(sub.state)) return;

  const [updated] = await db
    .update(officeSubscriptionsTable)
    .set({ state: "expiring", updatedAt: new Date() })
    .where(eq(officeSubscriptionsTable.officeId, officeId))
    .returning();

  if (!updated) return;

  await recordHistory({
    officeId,
    subscriptionId: sub.id,
    fromState:      sub.state as SubscriptionState,
    toState:        "expiring",
    reason:         "Approaching expiry — reminder window started",
    changedBy:      null, // sweeper
    metadata:       { expiresAt: sub.expiresAt?.toISOString() },
  });
}

/**
 * Expire a subscription (sweeper-driven or admin-forced).
 * Allowed from: trial, active_paid, expiring.
 * The office remains visible (grace period not yet over).
 */
export async function expireSubscription(
  officeId: number,
  adminId?: number | null,
): Promise<void> {
  const sub = await getSubscription(officeId);
  if (!sub) return;

  const allowedFromStates: SubscriptionState[] = ["trial", "active_paid", "expiring"];
  if (!allowedFromStates.includes(sub.state as SubscriptionState)) return;

  const now = new Date();
  const [updated] = await db
    .update(officeSubscriptionsTable)
    .set({ state: "expired", updatedAt: now })
    .where(eq(officeSubscriptionsTable.officeId, officeId))
    .returning();

  if (!updated) return;

  await recordHistory({
    officeId,
    subscriptionId: sub.id,
    fromState:      sub.state as SubscriptionState,
    toState:        "expired",
    reason:         adminId ? "Manually expired by admin" : "Subscription expired",
    changedBy:      adminId ?? null,
    metadata:       { expiredAt: now.toISOString() },
  });

  logger.info({ officeId, adminId }, "[subscription] Subscription expired");
}

/**
 * Hide office from public discovery due to non-payment (sweeper-driven).
 * Allowed from: expired.
 * Sets offices.is_subscription_hidden = true atomically.
 * The office record, data, and history are fully preserved.
 */
export async function hideForNonPayment(officeId: number): Promise<void> {
  const sub = await getSubscription(officeId);
  if (!sub || sub.state !== "expired") return;

  const now = new Date();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `UPDATE office_subscriptions
       SET state    = 'hidden_due_to_nonpayment',
           hidden_at = $1,
           updated_at = $1
       WHERE office_id = $2`,
      [now, officeId],
    );

    await client.query(
      `UPDATE offices
       SET is_subscription_hidden = true
       WHERE id = $1`,
      [officeId],
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  await recordHistory({
    officeId,
    subscriptionId: sub.id,
    fromState:      "expired",
    toState:        "hidden_due_to_nonpayment",
    reason:         "Hidden from public discovery — subscription expired beyond grace period",
    changedBy:      null, // sweeper
    metadata:       { hiddenAt: now.toISOString() },
  });

  logger.info({ officeId }, "[subscription] Office hidden due to non-payment");

  // Release the supply slot and promote the next waiting provider.
  // Done AFTER the transaction commits so slot audit log is always consistent.
  try {
    const marketKey = await releaseSlot(officeId, "non_payment", null);
    if (marketKey) {
      await processWaitlist(marketKey);
    }
  } catch (slotErr) {
    // Slot release failure must not undo the hide — log and continue.
    logger.error({ slotErr, officeId }, "[subscription] Slot release failed after hideForNonPayment");
  }
}

/**
 * Cancel a subscription (admin or owner action).
 * Allowed from any state.
 */
export async function cancelSubscription(
  officeId: number,
  adminId: number,
  reason?: string,
): Promise<void> {
  const sub = await getOrCreateSubscription(officeId);
  const fromState = sub.state as SubscriptionState;
  const now = new Date();

  await db
    .update(officeSubscriptionsTable)
    .set({
      state:        "cancelled",
      cancelledAt:  now,
      cancelledBy:  adminId,
      cancelReason: reason ?? null,
      updatedAt:    now,
    })
    .where(eq(officeSubscriptionsTable.officeId, officeId));

  await recordHistory({
    officeId,
    subscriptionId: sub.id,
    fromState,
    toState:  "cancelled",
    reason:   reason ?? "Subscription cancelled",
    changedBy: adminId,
    metadata: { cancelledAt: now.toISOString() },
  });

  // Hide the office BEFORE releasing its slot.
  // A cancelled office must never remain publicly visible. We hide it here so
  // that even if the slot release or waitlist promotion fails, the cancelled
  // provider cannot appear in the public listing.
  // (If the hide fails we still log and proceed — a visible-but-cancelled office
  // is a worse outcome than a hidden-but-subscription-cancelled one.)
  try {
    await db
      .update(officesTable)
      .set({ isSubscriptionHidden: true })
      .where(eq(officesTable.id, officeId));
  } catch (hideErr) {
    logger.error({ officeId, adminId, err: hideErr }, "[subscription] cancelSubscription: failed to hide office (slot release will still proceed)");
  }

  // Release the office's market slot so a waiting provider can be promoted.
  // A cancelled office must not continue consuming market capacity (if it held
  // an allocated slot) nor remain on the waitlist (if it was waiting).
  // We use cancelSlot() which delegates to releaseSlot() with a cancellation
  // reason, then process the waitlist so the next waiting office can be promoted.
  try {
    const marketKey = await cancelSlot(officeId, adminId);
    if (marketKey) {
      await processWaitlist(marketKey);
    }
    logger.info({ officeId, adminId }, "[subscription] Slot released on cancellation");
  } catch (slotErr) {
    // Slot release is best-effort: log the error but do not roll back the
    // subscription cancellation or the hide. The slot state can be corrected by
    // an admin via the force-allocate / manual release routes without data loss.
    logger.error({ officeId, adminId, err: slotErr }, "[subscription] cancelSubscription: failed to release slot (subscription cancellation still committed)");
  }

  logger.info({ officeId, adminId, reason }, "[subscription] Subscription cancelled");
}

/**
 * Reactivate from expired / hidden_due_to_nonpayment / cancelled → active_paid.
 *
 * Validates that the subscription is in a terminated state before delegating to
 * activatePaidCore().  For ongoing subscriptions (free / trial / active_paid /
 * expiring) use activatePaid() instead — it enforces those source states.
 *
 * The slot gate still applies: a valid reservation or allocated slot must exist
 * (or the market must be uncapped) before the transition is committed.
 *
 * THROWS SubscriptionLifecycleError(INVALID_TRANSITION) if called from a live state.
 */
export async function reactivate(
  officeId: number,
  adminId: number,
  paidThroughDate: Date,
  notes?: string,
): Promise<OfficeSubscription> {
  const sub = await getSubscription(officeId);
  const allowedFromStates: ReadonlyArray<SubscriptionState> = [
    "expired",
    "hidden_due_to_nonpayment",
    "cancelled",
  ] as const;

  if (sub && !(allowedFromStates as readonly string[]).includes(sub.state)) {
    throw new SubscriptionLifecycleError(
      `Cannot reactivate: office ${officeId} is in state '${sub.state}'. ` +
      `Use activatePaid() for renewal. Allowed reactivation states: [${allowedFromStates.join(", ")}].`,
      "INVALID_TRANSITION",
    );
  }

  // If no subscription row exists, getOrCreateSubscription will create a free one.
  const resolvedSub = sub ?? (await getOrCreateSubscription(officeId));
  return activatePaidCore(officeId, adminId, paidThroughDate, resolvedSub, notes);
}

// ── Notification helpers ───────────────────────────────────────────────────────

export interface NotificationResult {
  type:   SubscriptionNotificationType;
  sent:   boolean;
  reason: string;
}

/**
 * Check which expiry reminders need to be sent for an office and send them.
 * Deduplication: skips any type already recorded in subscription_notifications
 * for the same (office_id, notification_type, period_expires_at) triple.
 *
 * Reminder schedule (relative to expires_at):
 *   expiry_7d — when 7 days remain
 *   expiry_3d — when 3 days remain
 *   expiry_1d — when 1 day remains
 *   expiry_day — on expiry day (0 days)
 */
export async function checkAndSendReminders(
  office: { id: number; email: string; name: string; nameAr?: string | null },
  subscription: OfficeSubscription,
): Promise<NotificationResult[]> {
  if (!subscription.expiresAt) return [];
  if (!["trial", "active_paid", "expiring"].includes(subscription.state)) return [];

  const now        = new Date();
  const expiresAt  = subscription.expiresAt;
  const daysLeft   = Math.ceil((expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

  // Map days-remaining to notification type
  const remindersToCheck: Array<{ type: SubscriptionNotificationType; triggerWhenDaysLeft: number }> = [
    { type: "expiry_7d",  triggerWhenDaysLeft: 7 },
    { type: "expiry_3d",  triggerWhenDaysLeft: 3 },
    { type: "expiry_1d",  triggerWhenDaysLeft: 1 },
    { type: "expiry_day", triggerWhenDaysLeft: 0 },
  ];

  const results: NotificationResult[] = [];

  for (const reminder of remindersToCheck) {
    // Only fire if we've entered the window (daysLeft <= trigger)
    if (daysLeft > reminder.triggerWhenDaysLeft) continue;

    // Dedup check: try to insert the sentinel row
    try {
      await db.insert(subscriptionNotificationsTable).values({
        officeId:         office.id,
        notificationType: reminder.type,
        periodExpiresAt:  expiresAt,
        metadata: {
          daysLeft,
          officeName: office.name,
          sentAt:     now.toISOString(),
        },
      });
    } catch (err: unknown) {
      // Unique constraint violation = already sent
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes("unique") || errMsg.includes("duplicate") || errMsg.includes("23505")) {
        results.push({ type: reminder.type, sent: false, reason: "Already sent (dedup)" });
        continue;
      }
      throw err;
    }

    // Send the email reminder
    try {
      await sendExpiryReminderEmail(office, subscription, reminder.type, daysLeft);
      results.push({ type: reminder.type, sent: true, reason: `Sent (${daysLeft} days remaining)` });
      logger.info(
        { officeId: office.id, type: reminder.type, daysLeft },
        "[subscription] Expiry reminder sent",
      );
    } catch (emailErr) {
      logger.error(
        { err: emailErr, officeId: office.id, type: reminder.type },
        "[subscription] Failed to send expiry reminder",
      );
      results.push({ type: reminder.type, sent: false, reason: `Email delivery failed` });
    }
  }

  return results;
}

async function sendExpiryReminderEmail(
  office: { id: number; email: string; name: string; nameAr?: string | null },
  subscription: OfficeSubscription,
  type: SubscriptionNotificationType,
  daysLeft: number,
): Promise<void> {
  await emailProvider.sendSubscriptionExpiryReminder({
    to:           office.email,
    locale:       "ar",  // offices default to Arabic
    officeName:   office.name,
    officeNameAr: office.nameAr ?? office.name,
    daysLeft,
    expiresAt:    subscription.expiresAt!,
    subscriptionType: subscription.paidThroughDate ? "paid" : "trial",
  });
}

// ── Growth metrics ─────────────────────────────────────────────────────────────

export interface SubscriptionCounts {
  free:                    number;
  trial:                   number;
  activePaid:              number;
  expiring:                number;
  expired:                 number;
  hiddenDueToNonPayment:   number;
  cancelled:               number;
  total:                   number;  // all except free
}

export interface GrowthMetrics {
  period:            { start: string; end: string };
  previousPeriod:    { start: string; end: string };
  currentCounts:     SubscriptionCounts;
  // Period activity
  newSubscriptions:  number;   // started trial or paid for first time in period
  renewals:          number;   // activated_paid from expiring/expired in period
  churn:             number;   // cancelled + hidden_due_to_nonpayment in period
  netGrowth:         number;   // new + renewals - churn
  // Rates
  growthPct:         number | null;  // ((current active - prev active) / prev active) * 100
  retentionRate:     number | null;  // renewals / (renewals + churn) * 100
  momChange:         number;         // current active - previous active count
}

export async function computeGrowthMetrics(
  periodStart: Date,
  periodEnd:   Date,
  prevStart:   Date,
  prevEnd:     Date,
): Promise<GrowthMetrics> {
  // Current counts from office_subscriptions (live snapshot)
  const countsRes = await pool.query<{
    state: string; cnt: number;
  }>(
    `SELECT state, COUNT(*)::integer AS cnt
     FROM office_subscriptions
     GROUP BY state`,
  );

  const counts: SubscriptionCounts = {
    free: 0, trial: 0, activePaid: 0, expiring: 0,
    expired: 0, hiddenDueToNonPayment: 0, cancelled: 0, total: 0,
  };
  for (const row of countsRes.rows) {
    switch (row.state) {
      case "free":                    counts.free                 = row.cnt; break;
      case "trial":                   counts.trial                = row.cnt; break;
      case "active_paid":             counts.activePaid           = row.cnt; break;
      case "expiring":                counts.expiring             = row.cnt; break;
      case "expired":                 counts.expired              = row.cnt; break;
      case "hidden_due_to_nonpayment":counts.hiddenDueToNonPayment= row.cnt; break;
      case "cancelled":               counts.cancelled            = row.cnt; break;
    }
  }
  counts.total = counts.trial + counts.activePaid + counts.expiring;

  // Period activity from subscription_history
  const periodRes = await pool.query<{
    to_state: string;
    from_state: string | null;
    cnt: number;
  }>(
    `SELECT to_state, from_state, COUNT(*)::integer AS cnt
     FROM subscription_history
     WHERE created_at >= $1 AND created_at < $2
     GROUP BY to_state, from_state`,
    [periodStart, periodEnd],
  );

  let newSubscriptions = 0;
  let renewals         = 0;
  let churn            = 0;

  for (const row of periodRes.rows) {
    const isNewTrial   = row.to_state === "trial"       && (row.from_state === "free" || row.from_state === null);
    const isNewPaid    = row.to_state === "active_paid" && (row.from_state === "free" || row.from_state === null);
    const isRenewal    = row.to_state === "active_paid" && row.from_state !== null
                         && !["free"].includes(row.from_state ?? "");
    const isCancelled  = row.to_state === "cancelled";
    const isHidden     = row.to_state === "hidden_due_to_nonpayment";

    if (isNewTrial || isNewPaid) newSubscriptions += row.cnt;
    else if (isRenewal)          renewals         += row.cnt;
    if (isCancelled || isHidden) churn            += row.cnt;
  }

  const netGrowth = newSubscriptions + renewals - churn;

  // Previous period active count for growth%/MoM
  const prevRes = await pool.query<{ cnt: number }>(
    `SELECT COUNT(*)::integer AS cnt
     FROM subscription_history
     WHERE to_state IN ('trial', 'active_paid', 'expiring')
       AND created_at >= $1 AND created_at < $2`,
    [prevStart, prevEnd],
  );
  const prevActive = prevRes.rows[0]?.cnt ?? 0;
  const currActive = counts.total;

  const growthPct = prevActive > 0
    ? Math.round(((currActive - prevActive) / prevActive) * 1000) / 10
    : null;

  const retentionRate = renewals + churn > 0
    ? Math.round((renewals / (renewals + churn)) * 1000) / 10
    : null;

  const momChange = currActive - prevActive;

  return {
    period:         { start: periodStart.toISOString(), end: periodEnd.toISOString() },
    previousPeriod: { start: prevStart.toISOString(),   end: prevEnd.toISOString() },
    currentCounts:  counts,
    newSubscriptions,
    renewals,
    churn,
    netGrowth,
    growthPct,
    retentionRate,
    momChange,
  };
}

// ── Error types ───────────────────────────────────────────────────────────────

export class SubscriptionLifecycleError extends Error {
  constructor(
    message: string,
    public readonly code: "INVALID_TRANSITION" | "NOT_FOUND" | "ALREADY_EXISTS",
  ) {
    super(message);
    this.name = "SubscriptionLifecycleError";
  }
}
