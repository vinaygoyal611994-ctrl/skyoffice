/**
 * Payment Gateway Abstraction
 *
 * This module defines the PaymentGateway interface that isolates all
 * gateway-specific SDK calls and event type naming from business logic.
 * Business code in routes/payments.ts depends only on:
 *
 *   - PaymentGateway (interface)
 *   - NormalisedWebhookEvent (gateway-agnostic event shape)
 *   - CheckoutSessionParams / CheckoutSessionResult (neutral types)
 *
 * The StripeGateway class implements PaymentGateway using the Stripe SDK.
 * Swapping gateways = replacing StripeGateway, touching nothing else.
 *
 * Gateway-specific constants (Stripe event names, header names) are confined
 * to StripeGateway methods and the STRIPE_EVENT_MAP table. They appear nowhere
 * in the business logic of the route handlers.
 */

import type { ResolvedPlan } from "./paymentPlans";
import { logger } from "./logger";

// ── Neutral domain types ──────────────────────────────────────────────────────

export interface CheckoutSessionParams {
  officeId:       number;
  officeName:     string;
  plan:           ResolvedPlan;
  idempotencyKey: string;
  successUrl:     string;
  cancelUrl:      string;
  isRenewal:      boolean;
}

export interface CheckoutSessionResult {
  sessionId:  string;
  sessionUrl: string;
}

/**
 * Gateway-neutral event type.
 *
 * All gateway SDKs return events with different type strings. The adapter
 * maps them to this narrow set so the webhook handler has no knowledge of
 * Stripe-specific event names.
 *
 *   checkout.completed — payment confirmed; activate subscription
 *   payment.failed     — payment declined; mark transaction failed
 *   unknown            — any other event; handler ignores it
 */
export type NormalisedEventType =
  | "checkout.completed"
  | "payment.failed"
  | "unknown";

/**
 * Normalised webhook event — all fields extracted from the gateway-specific
 * event object. The webhook handler reads only this shape.
 */
export interface NormalisedWebhookEvent {
  /** Gateway's idempotency key for this event (e.g. Stripe evt_...) */
  id:               string;
  /** Neutral event type */
  type:             NormalisedEventType;
  /** Checkout session ID — populated for checkout.completed */
  sessionId:        string | null;
  /** Payment intent ID */
  paymentIntentId:  string | null;
  /** Amount in smallest currency unit (halalas for SAR) */
  amountTotal:      number | null;
  /** Currency code uppercase (e.g. "SAR") */
  currency:         string | null;
  /** Key-value metadata set when the session was created */
  metadata:         Record<string, string>;
  /** Failure message for payment.failed events */
  failureMessage:   string | null;
}

// ── PaymentGateway interface ──────────────────────────────────────────────────

export interface PaymentGateway {
  /**
   * Returns true if the gateway is fully configured and ready to create sessions.
   * Called before every checkout attempt; if false, the route returns 503.
   */
  isConfigured(): boolean;

  /**
   * Create a hosted checkout session.
   * Must throw if the gateway call fails — the caller handles the error.
   *
   * @param idempotencyKey  Application-level idempotency key passed to the
   *                        gateway so network retries return the same session.
   */
  createCheckoutSession(params: CheckoutSessionParams): Promise<CheckoutSessionResult>;

  /**
   * Verify the webhook signature and return a normalised event.
   * Must throw if the signature is invalid — callers return 400 on throw.
   *
   * @param rawBody   Raw Buffer from express.raw() middleware — must NOT be
   *                  parsed by express.json() first.
   * @param signature Gateway-specific signature header value.
   * @param secret    Webhook signing secret from environment.
   */
  constructWebhookEvent(
    rawBody:   Buffer,
    signature: string,
    secret:    string,
  ): NormalisedWebhookEvent;
}

// ── StripeGateway — current adapter ──────────────────────────────────────────

/**
 * Maps Stripe event type strings to the neutral NormalisedEventType.
 * Adding a new mapping here is all that's needed when Stripe introduces
 * new relevant event types.
 */
const STRIPE_EVENT_MAP: Record<string, NormalisedEventType> = {
  "checkout.session.completed":   "checkout.completed",
  "payment_intent.payment_failed": "payment.failed",
};

export class StripeGateway implements PaymentGateway {
  isConfigured(): boolean {
    return !!(process.env.STRIPE_SECRET_KEY?.length);
  }

  async createCheckoutSession(params: CheckoutSessionParams): Promise<CheckoutSessionResult> {
    const { getStripeClient } = await import("./stripeClient");
    const stripe = getStripeClient();

    logger.info(
      {
        officeId:      params.officeId,
        planId:        params.plan.planId,
        amountHalalas: params.plan.amountHalalas,
        currency:      params.plan.currency,
        isRenewal:     params.isRenewal,
      },
      "[payment:stripe] Creating Checkout session",
    );

    const session = await stripe.checkout.sessions.create(
      {
        mode:       "payment",
        line_items: [
          {
            price_data: {
              currency:     params.plan.currency.toLowerCase(),
              unit_amount:  params.plan.amountHalalas,
              product_data: {
                name:        params.plan.planName,
                description: params.plan.planNameAr,
              },
            },
            quantity: 1,
          },
        ],
        success_url: params.successUrl,
        cancel_url:  params.cancelUrl,
        metadata: {
          officeId:       String(params.officeId),
          planId:         String(params.plan.planId),
          amountHalalas:  String(params.plan.amountHalalas),
          currency:       params.plan.currency,
          idempotencyKey: params.idempotencyKey,
          renewalPath:    params.isRenewal ? "true" : "false",
        },
        payment_intent_data: {
          metadata: {
            officeId:       String(params.officeId),
            planId:         String(params.plan.planId),
            amountHalalas:  String(params.plan.amountHalalas),
            currency:       params.plan.currency,
            idempotencyKey: params.idempotencyKey,
            officeName:     params.officeName,
          },
        },
      },
      { idempotencyKey: params.idempotencyKey },
    );

    if (!session.url) {
      throw new Error(
        `Stripe session created but no URL returned (session: ${session.id})`,
      );
    }

    logger.info(
      { officeId: params.officeId, sessionId: session.id },
      "[payment:stripe] Checkout session created",
    );

    return { sessionId: session.id, sessionUrl: session.url };
  }

  constructWebhookEvent(
    rawBody:   Buffer,
    signature: string,
    secret:    string,
  ): NormalisedWebhookEvent {
    const { getStripeClient } = require("./stripeClient") as typeof import("./stripeClient");
    const stripe = getStripeClient();

    // Throws on bad/expired signature — caller returns 400
    const event = stripe.webhooks.constructEvent(rawBody, signature, secret);

    const normType: NormalisedEventType = STRIPE_EVENT_MAP[event.type] ?? "unknown";

    // ── Extract fields based on event type ───────────────────────────────────
    let sessionId:       string | null = null;
    let paymentIntentId: string | null = null;
    let amountTotal:     number | null = null;
    let currency:        string | null = null;
    let metadata:        Record<string, string> = {};
    let failureMessage:  string | null = null;

    if (normType === "checkout.completed") {
      const sess = event.data.object as import("stripe").Stripe.Checkout.Session;
      sessionId       = sess.id;
      paymentIntentId = typeof sess.payment_intent === "string" ? sess.payment_intent : null;
      amountTotal     = sess.amount_total ?? null;
      currency        = sess.currency?.toUpperCase() ?? null;
      metadata        = (sess.metadata ?? {}) as Record<string, string>;
    } else if (normType === "payment.failed") {
      const pi = event.data.object as import("stripe").Stripe.PaymentIntent;
      paymentIntentId = pi.id;
      failureMessage  = pi.last_payment_error?.message ?? "Payment declined";
      metadata        = (pi.metadata ?? {}) as Record<string, string>;
    }

    return {
      id:             event.id,
      type:           normType,
      sessionId,
      paymentIntentId,
      amountTotal,
      currency,
      metadata,
      failureMessage,
    };
  }
}

// ── Default gateway instance ──────────────────────────────────────────────────

/**
 * The active gateway. Import this in route handlers — never import StripeGateway
 * directly from business logic. In tests, mock this module's `getPaymentGateway`
 * export to inject a test double.
 */
let _gateway: PaymentGateway | null = null;

export function getPaymentGateway(): PaymentGateway {
  if (!_gateway) _gateway = new StripeGateway();
  return _gateway;
}

/** For testing only — inject a mock gateway. */
export function _setPaymentGateway(gw: PaymentGateway): void {
  _gateway = gw;
}
