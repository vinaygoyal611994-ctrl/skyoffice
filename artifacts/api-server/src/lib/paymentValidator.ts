/**
 * Payment Validator — Server-side pre-payment gate.
 *
 * validatePrePayment() must be called BEFORE creating a Stripe Checkout session.
 * It enforces every business rule that prevents an invalid payment from being
 * initiated, protecting the 3-guarantee invariant:
 *
 *   NO valid Supply Slot reservation = NO payment
 *   WRONG plan/price = NO payment
 *   NOT the office owner = NO payment
 *
 * The validator returns a typed union — callers should never proceed on a
 * { valid: false } result.
 *
 * Validation order (fail-fast):
 *   1. Office exists and requestingUserId is the owner
 *   2. commercial_state is 'active' (payment system live)
 *   3. providerType maps to a known plan with a price
 *   4. Slot status: reserved (>5 min remaining) OR allocated (renewal)
 *   5. For new reservations: market is not closed
 *   6. No duplicate pending payment with same idempotency key
 */

import { pool } from "@workspace/db";
import { getSystemConfigValue } from "./subscriptionLifecycle";
import { getSlotStatus, getMarketSlotSummary } from "./supplySlotManager";
import {
  getPlanForOffice,
  buildIdempotencyKey,
  nextBillingMonth,
  PLAN_PRICES,
  type ResolvedPlan,
} from "./paymentPlans";
import { logger } from "./logger";

// ── Types ─────────────────────────────────────────────────────────────────────

export type PaymentBlockReason =
  | "not_owner"
  | "commercial_not_active"
  | "unknown_plan"
  | "no_reservation"
  | "reservation_expired"
  | "reservation_expiring_soon"
  | "market_closed"
  | "duplicate_pending";

export type PaymentPath = "new_reservation" | "renewal";

export type PrePaymentValidation =
  | {
      valid: true;
      path:             PaymentPath;
      plan:             ResolvedPlan;
      idempotencyKey:   string;
      paidThroughDate:  Date;
      reservationExpiresAt: Date | null;
      marketKey:        string | null;
    }
  | {
      valid:     false;
      reason:    PaymentBlockReason;
      messageEn: string;
      messageAr: string;
    };

// ── Grace buffer ──────────────────────────────────────────────────────────────

/**
 * Minimum time remaining on a reservation before we allow checkout.
 * A provider whose reservation expires in < 5 minutes cannot safely complete
 * the Stripe checkout redirect round-trip before losing their slot.
 */
const GRACE_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

// ── validatePrePayment ────────────────────────────────────────────────────────

export async function validatePrePayment(
  officeId:          number,
  requestingUserId:  number,
): Promise<PrePaymentValidation> {

  // ── Step 1: Office exists and is owned by the requesting user ────────────
  const officeRes = await pool.query<{
    user_id:       number;
    provider_type: string;
    name:          string;
    status:        string;
  }>(
    `SELECT user_id, provider_type, name, status FROM offices WHERE id = $1`,
    [officeId],
  );
  const office = officeRes.rows[0];

  if (!office || office.user_id !== requestingUserId) {
    logger.warn({ officeId, requestingUserId }, "[paymentValidator] not_owner");
    return {
      valid:     false,
      reason:    "not_owner",
      messageEn: "You are not authorised to pay for this office.",
      messageAr: "غير مصرح لك بالدفع لهذا المكتب.",
    };
  }

  // ── Step 2: commercial_state must be 'active' ────────────────────────────
  const commercialState = await getSystemConfigValue("commercial_state", "disabled");
  if (commercialState !== "active") {
    logger.info({ officeId, commercialState }, "[paymentValidator] commercial_not_active");
    return {
      valid:     false,
      reason:    "commercial_not_active",
      messageEn: "The payment system is not yet active. Please check back later.",
      messageAr: "نظام الدفع غير مفعّل بعد. يرجى المحاولة لاحقاً.",
    };
  }

  // ── Step 3: Resolve plan for this provider type ──────────────────────────
  const providerType = office.provider_type ?? "office";
  if (!PLAN_PRICES[providerType]) {
    logger.warn({ officeId, providerType }, "[paymentValidator] unknown_plan");
    return {
      valid:     false,
      reason:    "unknown_plan",
      messageEn: "No subscription plan is configured for your provider type.",
      messageAr: "لا توجد خطة اشتراك لنوع مزودك.",
    };
  }

  const plan = await getPlanForOffice(officeId);
  if (!plan) {
    return {
      valid:     false,
      reason:    "unknown_plan",
      messageEn: "No active subscription plan found for your account.",
      messageAr: "لم يتم العثور على خطة اشتراك نشطة لحسابك.",
    };
  }

  // ── Step 4: Slot status ──────────────────────────────────────────────────
  const slotInfo = await getSlotStatus(officeId);
  const now = new Date();

  // Renewal path: office already holds an allocated slot
  if (slotInfo.slotStatus === "allocated") {
    const billingMonth     = nextBillingMonth();
    const idempotencyKey   = buildIdempotencyKey(officeId, plan.planId, billingMonth);
    const paidThroughDate  = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // Step 6: Duplicate check for renewal
    const dupCheck = await checkDuplicatePending(idempotencyKey);
    if (dupCheck) {
      return {
        valid:     false,
        reason:    "duplicate_pending",
        messageEn: "A payment is already in progress for this billing cycle.",
        messageAr: "يوجد دفع قيد التنفيذ لدورة الفوترة هذه.",
      };
    }

    return {
      valid:               true,
      path:                "renewal",
      plan,
      idempotencyKey,
      paidThroughDate,
      reservationExpiresAt: null,
      marketKey:           slotInfo.marketKey,
    };
  }

  // New reservation path: slot must be 'reserved' with enough time remaining
  if (slotInfo.slotStatus !== "reserved") {
    logger.info({ officeId, slotStatus: slotInfo.slotStatus }, "[paymentValidator] no_reservation");
    return {
      valid:     false,
      reason:    "no_reservation",
      messageEn: "You do not have an active slot reservation. Please check back — you will be notified when a slot becomes available.",
      messageAr: "ليس لديك حجز مقعد نشط. سيتم إشعارك عند توفر مقعد.",
    };
  }

  const expiresAt = slotInfo.reservationExpiresAt;
  if (!expiresAt) {
    return {
      valid:     false,
      reason:    "no_reservation",
      messageEn: "Reservation data is incomplete. Please contact support.",
      messageAr: "بيانات الحجز غير مكتملة. يرجى التواصل مع الدعم.",
    };
  }

  const msRemaining = expiresAt.getTime() - now.getTime();
  if (msRemaining <= 0) {
    logger.info({ officeId, expiresAt }, "[paymentValidator] reservation_expired");
    return {
      valid:     false,
      reason:    "reservation_expired",
      messageEn: "Your slot reservation has expired. You have been re-entered into the waitlist.",
      messageAr: "انتهت صلاحية حجز مقعدك. تم إعادة إدراجك في قائمة الانتظار.",
    };
  }

  if (msRemaining < GRACE_BUFFER_MS) {
    logger.info({ officeId, msRemaining }, "[paymentValidator] reservation_expiring_soon");
    return {
      valid:     false,
      reason:    "reservation_expiring_soon",
      messageEn: "Your reservation expires in less than 5 minutes — not enough time to complete checkout safely. Please wait for a new reservation.",
      messageAr: "ينتهي حجزك في أقل من 5 دقائق — الوقت غير كافٍ لإتمام الدفع. يرجى انتظار حجز جديد.",
    };
  }

  // ── Step 5: Market must not be closed ────────────────────────────────────
  if (slotInfo.marketKey) {
    const summary = await getMarketSlotSummary(slotInfo.marketKey);
    if (summary.isClosed) {
      logger.info({ officeId, marketKey: slotInfo.marketKey }, "[paymentValidator] market_closed");
      return {
        valid:     false,
        reason:    "market_closed",
        messageEn: "This market is currently closed to new payments. Your reservation is preserved.",
        messageAr: "هذا السوق مغلق حالياً أمام المدفوعات الجديدة. حجزك محفوظ.",
      };
    }
  }

  // ── Step 6: No duplicate pending for same billing cycle ──────────────────
  const billingMonth     = nextBillingMonth();
  const idempotencyKey   = buildIdempotencyKey(officeId, plan.planId, billingMonth);
  const paidThroughDate  = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const dupCheck = await checkDuplicatePending(idempotencyKey);
  if (dupCheck) {
    return {
      valid:     false,
      reason:    "duplicate_pending",
      messageEn: "A payment is already in progress for this billing cycle.",
      messageAr: "يوجد دفع قيد التنفيذ لدورة الفوترة هذه.",
    };
  }

  return {
    valid:               true,
    path:                "new_reservation",
    plan,
    idempotencyKey,
    paidThroughDate,
    reservationExpiresAt: expiresAt,
    marketKey:           slotInfo.marketKey,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns true if a pending payment row already exists for this idempotency key.
 * Used to prevent two concurrent browser tabs from both initiating checkout.
 */
async function checkDuplicatePending(idempotencyKey: string): Promise<boolean> {
  const res = await pool.query<{ cnt: number }>(
    `SELECT COUNT(*)::integer AS cnt
     FROM office_payment_transactions
     WHERE idempotency_key = $1 AND status = 'pending'`,
    [idempotencyKey],
  );
  return (res.rows[0]?.cnt ?? 0) > 0;
}
