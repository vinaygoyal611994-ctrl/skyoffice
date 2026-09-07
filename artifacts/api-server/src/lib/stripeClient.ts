/**
 * Stripe client — lazily instantiated singleton.
 *
 * Uses STRIPE_SECRET_KEY environment variable. In test/sandbox environments
 * this should be a Stripe test-mode key (sk_test_...). The client is created
 * once and reused across requests.
 *
 * NEVER cache tokens or checkout sessions here — only the Stripe client itself
 * is cached. Each payment flow creates fresh Stripe resources.
 */

import Stripe from "stripe";
import { logger } from "./logger";

let _stripe: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (_stripe) return _stripe;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY environment variable is not set. " +
      "Set it to a Stripe test-mode key (sk_test_...) to enable payment processing.",
    );
  }

  _stripe = new Stripe(key, {
    apiVersion: "2026-07-29.dahlia",
    typescript: true,
  });

  logger.info("[stripe] Stripe client initialized");
  return _stripe;
}

export function isStripeConfigured(): boolean {
  return !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.length > 0);
}

export function getWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
  return secret;
}
