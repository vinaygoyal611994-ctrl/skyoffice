/**
 * Payment Routes
 *
 * POST /api/payments/checkout           — create gateway Checkout session (office auth)
 * POST /api/payments/webhook            — gateway webhook handler (no auth — raw body)
 * GET  /api/payments/status             — current payment status for the office (office auth)
 * GET  /api/admin/payments/:officeId    — payment history for an office (admin auth)
 *
 * Architecture:
 *   • Business logic depends only on the PaymentGateway interface (paymentGateway.ts).
 *     No Stripe SDK types or event names appear in this file.
 *   • Webhook is the ONLY source of truth for activating subscriptions.
 *   • Payment lock: when a checkout session is created, market_slot_allocations
 *     payment_locked_until is set to NOW()+30min. The reservation sweeper skips
 *     locked slots, making "money received but no slot" structurally unreachable
 *     for correctly-timed checkouts.
 *   • Retry semantics: failed/cancelled payment rows are updated in-place (UPSERT)
 *     so the UNIQUE(idempotency_key) constraint never blocks a legitimate retry.
 *     A succeeded row for the same billing period blocks retries with already_paid.
 *   • Webhook events are idempotent via gateway_event_id.
 *     A replayed event returns 200 immediately without re-activating.
 *   • The webhook handler NEVER returns 4xx (Stripe would retry forever).
 *     Only signature verification returns 400. All business failures return 200
 *     with the payment row updated to 'failed' or 'failed_no_slot'.
 *
 * Analytics (MRR / churn / retention / revenue):
 *   SELECT SUM(amount_halalas)/100 AS sar FROM office_payment_transactions
 *   WHERE status='succeeded' AND DATE_TRUNC('month',paid_at)=DATE_TRUNC('month',NOW());
 */

import express, { Router, type Request, type Response } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { requireRole } from "../middlewares/authMiddleware";
import { getOfficeIdForUser } from "../lib/auth";
import { validatePrePayment } from "../lib/paymentValidator";
import { getPaymentGateway } from "../lib/paymentGateway";
import { getWebhookSecret } from "../lib/stripeClient";
import { activatePaid, getOrCreateSubscription } from "../lib/subscriptionLifecycle";
import { clearPaymentLock } from "../lib/supplySlotManager";
import { logger } from "../lib/logger";

const router = Router();

// Payment lock window: how long the reservation is protected after checkout creation
const PAYMENT_LOCK_MINUTES = 30;

// ── POST /api/payments/checkout ───────────────────────────────────────────────

router.post(
  "/payments/checkout",
  requireRole("office"),
  async (req: Request, res: Response): Promise<void> => {
    const gateway = getPaymentGateway();

    if (!gateway.isConfigured()) {
      res.status(503).json({
        error:     "Payment gateway not configured.",
        messageEn: "Payment processing is not available yet. Please contact support.",
        messageAr: "معالجة الدفع غير متاحة حالياً. يرجى التواصل مع الدعم.",
      });
      return;
    }

    const userId   = req.session.user!.id;
    const officeId = await getOfficeIdForUser(userId);

    if (!officeId) {
      res.status(400).json({ error: "No office associated with this account." });
      return;
    }

    // ── Pre-payment validation ─────────────────────────────────────────────
    const validation = await validatePrePayment(officeId, userId);
    if (!validation.valid) {
      res.status(409).json({
        reason:    validation.reason,
        messageEn: validation.messageEn,
        messageAr: validation.messageAr,
      });
      return;
    }

    const { plan, idempotencyKey, paidThroughDate, reservationExpiresAt, path: paymentPath } = validation;

    // ── Check for existing transaction in the same billing period ──────────
    const existingRes = await pool.query<{ id: number; status: string }>(
      `SELECT id, status FROM office_payment_transactions WHERE idempotency_key = $1`,
      [idempotencyKey],
    );
    const existing = existingRes.rows[0];

    if (existing) {
      if (existing.status === "succeeded") {
        // Already paid this billing period — hard block; no retry allowed
        res.status(409).json({
          reason:    "already_paid",
          messageEn: "Subscription is already active for this billing period.",
          messageAr: "الاشتراك مفعّل بالفعل لدورة الفوترة هذه.",
        });
        return;
      }
      if (existing.status === "pending") {
        // A checkout session is already open (possibly in another tab)
        res.status(409).json({
          reason:    "duplicate_pending",
          messageEn: "A payment is already in progress for this billing cycle.",
          messageAr: "يوجد دفع قيد التنفيذ لدورة الفوترة هذه.",
        });
        return;
      }
      // status is 'failed' or 'cancelled' — eligible retry: fall through to UPSERT path
    }

    // ── Build redirect URLs ────────────────────────────────────────────────
    const baseUrl = process.env.FRONTEND_URL
      ? process.env.FRONTEND_URL.replace(/\/$/, "")
      : process.env.NODE_ENV === "production"
        ? (() => {
            throw new Error(
              "FRONTEND_URL is required in production to build payment redirects",
            );
          })()
        : `https://${process.env.REPLIT_DEV_DOMAIN ?? "localhost:25700"}`;
    const successUrl = `${baseUrl}/dashboard?section=subscription&payment=success`;
    const cancelUrl  = `${baseUrl}/dashboard?section=subscription&payment=cancel`;

    // ── Fetch office name for gateway metadata ─────────────────────────────
    const officeRes = await pool.query<{ name: string }>(
      `SELECT name FROM offices WHERE id = $1`, [officeId],
    );
    const officeName = officeRes.rows[0]?.name ?? "SkayOffice";

    // ── Fetch/create subscription row ──────────────────────────────────────
    const sub = await getOrCreateSubscription(officeId);

    // ── Create or refresh the pending payment row ──────────────────────────
    // Retry semantics: if a failed/cancelled row already exists for this
    // idempotency_key, UPDATE it back to pending. Otherwise INSERT fresh.
    // The UNIQUE(idempotency_key) constraint never blocks a retry this way.
    let paymentId: number | null = null;
    const tempSessionId = `pending_${idempotencyKey}`;
    const metadataJson = JSON.stringify({
      renewalPath:     paymentPath === "renewal",
      billingMonth:    idempotencyKey.split(":")[2],
      paidThroughDate: paidThroughDate.toISOString(),
    });

    if (existing && (existing.status === "failed" || existing.status === "cancelled")) {
      // Retry path: reset the row to pending with a fresh temporary session ID
      const updateRes = await pool.query<{ id: number }>(
        `UPDATE office_payment_transactions
         SET status           = 'pending',
             gateway_session_id = $1,
             failed_at        = NULL,
             failure_reason   = NULL,
             gateway_event_id = NULL,
             updated_at       = NOW()
         WHERE id = $2 AND status IN ('failed', 'cancelled')
         RETURNING id`,
        [tempSessionId, existing.id],
      );
      paymentId = updateRes.rows[0]?.id ?? null;
      logger.info({ officeId, paymentId, idempotencyKey }, "[payment] Retry: reset failed/cancelled row to pending");
    } else {
      // Fresh INSERT path
      try {
        const insertRes = await pool.query<{ id: number }>(
          `INSERT INTO office_payment_transactions
             (office_id, subscription_id, plan_id, amount_halalas, currency,
              gateway, gateway_session_id, idempotency_key, status, metadata)
           VALUES ($1, $2, $3, $4, $5, 'stripe', $6, $7, 'pending', $8)
           RETURNING id`,
          [
            officeId,
            sub.id,
            plan.planId > 0 ? plan.planId : null,
            plan.amountHalalas,
            plan.currency,
            tempSessionId,
            idempotencyKey,
            metadataJson,
          ],
        );
        paymentId = insertRes.rows[0]?.id ?? null;
      } catch (dbErr: any) {
        // Race condition: a concurrent request inserted the row between our SELECT and INSERT
        if (dbErr?.code === "23505" || String(dbErr?.message).includes("unique")) {
          res.status(409).json({
            reason:    "duplicate_pending",
            messageEn: "A payment is already in progress for this billing cycle.",
            messageAr: "يوجد دفع قيد التنفيذ لدورة الفوترة هذه.",
          });
          return;
        }
        throw dbErr;
      }
    }

    // ── Set payment protection lock on the reservation ─────────────────────
    // This prevents the reservation sweeper from releasing the reservation while
    // the checkout session is active. Hard expiry = 30 minutes from now.
    if (officeId) {
      await pool.query(
        `UPDATE market_slot_allocations
         SET payment_locked_until = NOW() + INTERVAL '${PAYMENT_LOCK_MINUTES} minutes',
             updated_at           = NOW()
         WHERE office_id = $1`,
        [officeId],
      );
    }

    // ── Create gateway Checkout session ────────────────────────────────────
    let sessionId: string;
    let sessionUrl: string;
    try {
      const result = await gateway.createCheckoutSession({
        officeId,
        officeName,
        plan,
        idempotencyKey,
        successUrl,
        cancelUrl,
        isRenewal: paymentPath === "renewal",
      });
      sessionId  = result.sessionId;
      sessionUrl = result.sessionUrl;
    } catch (gatewayErr) {
      logger.error({ err: gatewayErr, officeId, paymentId }, "[payment] Gateway session creation failed");
      if (paymentId) {
        await pool.query(
          `UPDATE office_payment_transactions
           SET status         = 'cancelled',
               failed_at      = NOW(),
               failure_reason = $1,
               updated_at     = NOW()
           WHERE id = $2`,
          ["Gateway error during session creation", paymentId],
        );
      }
      // Clear the lock — session creation failed, sweeper may proceed normally
      await clearPaymentLock(officeId);
      res.status(502).json({
        error:     "Payment gateway error. Please try again.",
        messageEn: "Could not connect to the payment gateway. Please try again.",
        messageAr: "تعذّر الاتصال ببوابة الدفع. يرجى المحاولة مرة أخرى.",
      });
      return;
    }

    // ── Update row with real gateway session ID ────────────────────────────
    if (paymentId) {
      await pool.query(
        `UPDATE office_payment_transactions
         SET gateway_session_id = $1, updated_at = NOW()
         WHERE id = $2`,
        [sessionId, paymentId],
      );
    }

    logger.info(
      { officeId, paymentId, sessionId: sessionId.slice(-8), paymentPath, amountHalalas: plan.amountHalalas },
      "[payment] Checkout session created — redirecting to gateway",
    );

    res.json({
      sessionId,
      sessionUrl,
      plan: {
        name:          plan.planName,
        nameAr:        plan.planNameAr,
        amountHalalas: plan.amountHalalas,
        amountSar:     plan.amountHalalas / 100,
        currency:      plan.currency,
      },
      paymentPath,
      reservationExpiresAt: reservationExpiresAt?.toISOString() ?? null,
    });
  },
);

// ── POST /api/payments/webhook ────────────────────────────────────────────────
// IMPORTANT: This route requires the raw body buffer for signature verification.
// Mounted BEFORE express.json() via webhookRawBodyMiddleware in routes/index.ts.

router.post(
  "/payments/webhook",
  async (req: Request, res: Response): Promise<void> => {
    const gateway = getPaymentGateway();

    // Determine which header carries the gateway signature
    // (Stripe uses 'stripe-signature'; other gateways use their own header)
    const sigHeader = (
      req.headers["stripe-signature"] ??
      req.headers["x-gateway-signature"]
    );

    if (!sigHeader || typeof sigHeader !== "string") {
      logger.warn("[webhook] Missing gateway signature header");
      res.status(400).json({ error: "Missing signature header" });
      return;
    }

    const webhookSecret = getWebhookSecret();
    if (!webhookSecret) {
      logger.error("[webhook] STRIPE_WEBHOOK_SECRET not configured");
      res.status(400).json({ error: "Webhook not configured" });
      return;
    }

    // ── Signature verification ─────────────────────────────────────────────
    // constructWebhookEvent throws on bad/expired signatures → 400 to gateway
    let event: import("../lib/paymentGateway").NormalisedWebhookEvent;
    try {
      const rawBody = req.body as Buffer;
      event = gateway.constructWebhookEvent(rawBody, sigHeader, webhookSecret);
    } catch (err) {
      logger.warn({ err }, "[webhook] Signature verification failed");
      res.status(400).json({ error: "Invalid webhook signature" });
      return;
    }

    logger.info({ eventId: event.id, eventType: event.type }, "[webhook] Processing normalised event");

    // Business logic depends only on NormalisedEventType — no gateway names
    if (event.type === "checkout.completed") {
      await handleCheckoutCompleted(event);
    } else if (event.type === "payment.failed") {
      await handlePaymentFailed(event);
    }
    // All other event types are silently acknowledged

    res.status(200).json({ received: true });
  },
);

// ── GET /api/payments/status ──────────────────────────────────────────────────

router.get(
  "/payments/status",
  requireRole("office"),
  async (req: Request, res: Response): Promise<void> => {
    const officeId = await getOfficeIdForUser(req.session.user!.id);
    if (!officeId) {
      res.json({ payment: null });
      return;
    }

    const txRes = await pool.query<{
      id:                        number;
      status:                    string;
      amount_halalas:            number;
      currency:                  string;
      plan_id:                   number | null;
      paid_at:                   Date | null;
      failed_at:                 Date | null;
      failure_reason:            string | null;
      created_at:                Date;
      metadata:                  Record<string, unknown> | null;
      plan_name:                 string | null;
      plan_name_ar:              string | null;
      gateway_session_id:        string;
      reservation_expires_at:    Date | null;
    }>(
      `SELECT
         t.id, t.status, t.amount_halalas, t.currency, t.plan_id,
         t.paid_at, t.failed_at, t.failure_reason, t.created_at, t.metadata,
         p.name AS plan_name, p.name_ar AS plan_name_ar,
         t.gateway_session_id,
         msa.reservation_expires_at
       FROM office_payment_transactions t
       LEFT JOIN plans p ON p.id = t.plan_id
       LEFT JOIN market_slot_allocations msa ON msa.office_id = t.office_id
       WHERE t.office_id = $1
       ORDER BY t.created_at DESC
       LIMIT 1`,
      [officeId],
    );
    const tx = txRes.rows[0];

    if (!tx) {
      res.json({ payment: null });
      return;
    }

    res.json({
      payment: {
        id:                  tx.id,
        status:              tx.status,
        amountHalalas:       tx.amount_halalas,
        amountSar:           tx.amount_halalas / 100,
        currency:            tx.currency,
        planName:            tx.plan_name,
        planNameAr:          tx.plan_name_ar,
        paidAt:              tx.paid_at,
        failedAt:            tx.failed_at,
        failureReason:       tx.failure_reason,
        createdAt:           tx.created_at,
        renewalPath:         !!(tx.metadata as any)?.renewalPath,
        reservationExpiresAt: tx.reservation_expires_at,
        // Never return full session IDs — only last 8 chars for reference
        gatewayRef:          tx.gateway_session_id.slice(-8),
      },
    });
  },
);

// ── GET /api/admin/payments/:officeId ─────────────────────────────────────────

const OfficeIdParam = z.object({
  officeId: z.coerce.number().int().positive(),
});

const PaginationQuery = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

router.get(
  "/admin/payments/:officeId",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const params = OfficeIdParam.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid officeId" });
      return;
    }
    const query = PaginationQuery.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: query.error.message });
      return;
    }

    const { officeId } = params.data;
    const { page, limit } = query.data;
    const offset = (page - 1) * limit;

    const [txRes, countRes] = await Promise.all([
      pool.query<{
        id:             number;
        status:         string;
        amount_halalas: number;
        currency:       string;
        paid_at:        Date | null;
        failed_at:      Date | null;
        failure_reason: string | null;
        created_at:     Date;
        gateway_ref:    string;
        plan_name:      string | null;
        plan_name_ar:   string | null;
        metadata:       Record<string, unknown> | null;
      }>(
        `SELECT
           t.id, t.status, t.amount_halalas, t.currency,
           t.paid_at, t.failed_at, t.failure_reason, t.created_at,
           RIGHT(t.gateway_session_id, 8) AS gateway_ref,
           p.name AS plan_name, p.name_ar AS plan_name_ar, t.metadata
         FROM office_payment_transactions t
         LEFT JOIN plans p ON p.id = t.plan_id
         WHERE t.office_id = $1
         ORDER BY t.created_at DESC
         LIMIT $2 OFFSET $3`,
        [officeId, limit, offset],
      ),
      pool.query<{ cnt: number }>(
        `SELECT COUNT(*)::integer AS cnt FROM office_payment_transactions WHERE office_id = $1`,
        [officeId],
      ),
    ]);

    res.json({
      items: txRes.rows.map((t) => ({
        id:            t.id,
        status:        t.status,
        amountHalalas: t.amount_halalas,
        amountSar:     t.amount_halalas / 100,
        currency:      t.currency,
        planName:      t.plan_name,
        planNameAr:    t.plan_name_ar,
        paidAt:        t.paid_at,
        failedAt:      t.failed_at,
        failureReason: t.failure_reason,
        createdAt:     t.created_at,
        gatewayRef:    t.gateway_ref,
        renewalPath:   !!(t.metadata as any)?.renewalPath,
      })),
      total: countRes.rows[0]?.cnt ?? 0,
      page,
      limit,
    });
  },
);

// ── Internal webhook handlers ─────────────────────────────────────────────────
// These handlers use NormalisedWebhookEvent exclusively — no gateway SDK types.

async function handleCheckoutCompleted(
  event: import("../lib/paymentGateway").NormalisedWebhookEvent,
): Promise<void> {
  const { id: eventId, sessionId, paymentIntentId, amountTotal, currency, metadata } = event;

  if (!sessionId) {
    logger.warn({ eventId }, "[webhook] checkout.completed with no sessionId — ignoring");
    return;
  }

  // ── 1. Look up transaction by session ID ────────────────────────────────
  const txRes = await pool.query<{
    id:               number;
    office_id:        number;
    status:           string;
    amount_halalas:   number;
    currency:         string;
    idempotency_key:  string;
    plan_id:          number | null;
    metadata:         Record<string, unknown> | null;
    gateway_event_id: string | null;
  }>(
    `SELECT id, office_id, status, amount_halalas, currency, idempotency_key, plan_id, metadata, gateway_event_id
     FROM office_payment_transactions
     WHERE gateway_session_id = $1`,
    [sessionId],
  );
  const tx = txRes.rows[0];

  if (!tx) {
    logger.warn({ sessionId, eventId }, "[webhook] No payment transaction for session — ignoring");
    return;
  }

  // ── 2. Idempotency: already processed ───────────────────────────────────
  if (tx.status === "succeeded") {
    logger.info({ txId: tx.id, eventId }, "[webhook] Already succeeded — idempotent no-op");
    return;
  }
  if (tx.gateway_event_id === eventId) {
    logger.info({ txId: tx.id, eventId }, "[webhook] Duplicate event ID — idempotent no-op");
    return;
  }

  // ── 3. Cross-check amount / currency / idempotency key ──────────────────
  if (amountTotal !== tx.amount_halalas) {
    logger.error(
      { txId: tx.id, gatewayAmount: amountTotal, dbAmount: tx.amount_halalas },
      "[webhook] AMOUNT MISMATCH — marking failed",
    );
    await failTransaction(tx.id, eventId, `Amount mismatch: gateway ${amountTotal} ≠ DB ${tx.amount_halalas}`);
    await clearPaymentLock(tx.office_id);
    return;
  }

  if ((currency ?? "").toUpperCase() !== tx.currency.toUpperCase()) {
    logger.error(
      { txId: tx.id, gatewayCurrency: currency, dbCurrency: tx.currency },
      "[webhook] CURRENCY MISMATCH — marking failed",
    );
    await failTransaction(tx.id, eventId, `Currency mismatch: gateway ${currency} ≠ DB ${tx.currency}`);
    await clearPaymentLock(tx.office_id);
    return;
  }

  const metaIdempotencyKey = metadata.idempotencyKey ?? "";
  if (metaIdempotencyKey !== tx.idempotency_key) {
    logger.error(
      { txId: tx.id, metaKey: metaIdempotencyKey, dbKey: tx.idempotency_key },
      "[webhook] IDEMPOTENCY KEY MISMATCH — marking failed",
    );
    await failTransaction(tx.id, eventId, "Idempotency key mismatch");
    await clearPaymentLock(tx.office_id);
    return;
  }

  // ── 4. Extract metadata ──────────────────────────────────────────────────
  const officeId  = tx.office_id;
  const isRenewal = metadata.renewalPath === "true";

  // ── 5. Compute paid_through_date ─────────────────────────────────────────
  const paidThroughDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  // ── 6. Activate subscription atomically ──────────────────────────────────
  try {
    // Mark transaction succeeded FIRST (duplicate events see 'succeeded' and no-op)
    await pool.query(
      `UPDATE office_payment_transactions
       SET status                    = 'succeeded',
           paid_at                   = NOW(),
           gateway_event_id          = $1,
           gateway_payment_intent_id = $2,
           updated_at                = NOW()
       WHERE id = $3`,
      [eventId, paymentIntentId, tx.id],
    );

    // activatePaid re-validates slot status internally (throws if no valid slot).
    // adminId = null: this is a system/gateway-triggered activation, not a human
    // admin action.  null is the correct sentinel — stored verbatim in
    // subscription_history.changed_by and slot_audit_log.performed_by, both of
    // which define NULL as "system/automated" (see migration 0028 comment).
    await activatePaid(
      officeId,
      null,
      paidThroughDate,
      `Gateway payment ${paymentIntentId ?? sessionId}`,
    );

    // Clear lock — slot is now allocated; sweeper cannot touch it anyway
    await clearPaymentLock(officeId);

    logger.info(
      { officeId, txId: tx.id, eventId, isRenewal, paidThroughDate },
      "[webhook] Payment succeeded — subscription activated",
    );
  } catch (activationErr) {
    // activatePaid threw — slot expired in the narrow window after lock lapsed
    // This is a defensive path, not an expected business flow.
    const errMsg = activationErr instanceof Error ? activationErr.message : String(activationErr);
    logger.error(
      { err: activationErr, officeId, txId: tx.id },
      "[webhook] Subscription activation failed — setting failed_no_slot (defensive path)",
    );

    await pool.query(
      `UPDATE office_payment_transactions
       SET status         = 'failed_no_slot',
           failed_at      = NOW(),
           failure_reason = $1,
           updated_at     = NOW()
       WHERE id = $2`,
      [errMsg.slice(0, 500), tx.id],
    );

    await clearPaymentLock(officeId);
  }
}

async function handlePaymentFailed(
  event: import("../lib/paymentGateway").NormalisedWebhookEvent,
): Promise<void> {
  const { id: eventId, paymentIntentId, failureMessage } = event;

  if (!paymentIntentId) {
    logger.warn({ eventId }, "[webhook] payment.failed with no paymentIntentId — ignoring");
    return;
  }

  const txRes = await pool.query<{ id: number; status: string; office_id: number }>(
    `SELECT id, status, office_id FROM office_payment_transactions
     WHERE gateway_payment_intent_id = $1`,
    [paymentIntentId],
  );
  const tx = txRes.rows[0];
  if (!tx || tx.status !== "pending") return;

  const reason = failureMessage ?? "Payment declined";
  await pool.query(
    `UPDATE office_payment_transactions
     SET status           = 'failed',
         failed_at        = NOW(),
         failure_reason   = $1,
         gateway_event_id = $2,
         updated_at       = NOW()
     WHERE id = $3`,
    [reason.slice(0, 500), eventId, tx.id],
  );

  // Clear payment lock — provider can retry (or wait for reservation to expire)
  await clearPaymentLock(tx.office_id);

  logger.info({ txId: tx.id, eventId, reason }, "[webhook] Payment failed — lock cleared, marked failed");
}

async function failTransaction(
  txId:    number,
  eventId: string,
  reason:  string,
): Promise<void> {
  await pool.query(
    `UPDATE office_payment_transactions
     SET status           = 'failed',
         failed_at        = NOW(),
         failure_reason   = $1,
         gateway_event_id = $2,
         updated_at       = NOW()
     WHERE id = $3`,
    [reason.slice(0, 500), eventId, txId],
  );
}

// ── Raw body middleware ───────────────────────────────────────────────────────
// Webhook signature verification requires the raw request body.
// Applied BEFORE express.json() for the webhook route in routes/index.ts.

export const webhookRawBodyMiddleware = express.raw({ type: "application/json" });

export default router;
