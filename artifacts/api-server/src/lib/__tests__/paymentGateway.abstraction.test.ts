/**
 * Gateway Abstraction — Adapter Independence Tests
 *
 * Verifies that:
 *   1. PaymentGateway is an interface (structurally typed).
 *   2. A mock adapter satisfying the interface works without importing Stripe.
 *   3. The webhook handler uses NormalisedEventType, not Stripe event name strings.
 *   4. Business logic is decoupled: both checkout.completed and payment.failed
 *      are handled by type string comparison, not gateway SDK types.
 *   5. StripeGateway implements PaymentGateway (duck-typing check).
 *   6. getPaymentGateway() / _setPaymentGateway() injection works.
 *   7. NormalisedWebhookEvent carries all fields the webhook handler reads.
 */

import { describe, it, expect, vi } from "vitest";
import {
  type PaymentGateway,
  type NormalisedWebhookEvent,
  type CheckoutSessionParams,
  type CheckoutSessionResult,
  StripeGateway,
  getPaymentGateway,
  _setPaymentGateway,
} from "../paymentGateway";

// ── Minimal no-Stripe mock adapter ───────────────────────────────────────────

class MockGateway implements PaymentGateway {
  isConfigured(): boolean { return true; }

  async createCheckoutSession(params: CheckoutSessionParams): Promise<CheckoutSessionResult> {
    return {
      sessionId:  `mock_session_${params.officeId}`,
      sessionUrl: `https://mock.gateway.example/pay/${params.officeId}`,
    };
  }

  constructWebhookEvent(
    rawBody: Buffer,
    signature: string,
    _secret: string,
  ): NormalisedWebhookEvent {
    if (signature !== "valid_sig") throw new Error("Invalid signature");
    return {
      id:             "mock_evt_001",
      type:           "checkout.completed",
      sessionId:      "mock_session_7",
      paymentIntentId: "mock_pi_001",
      amountTotal:    20_000,
      currency:       "SAR",
      metadata:       { idempotencyKey: "7:1:2026-08", renewalPath: "false" },
      failureMessage: null,
    };
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("PaymentGateway interface — adapter independence", () => {
  it("MockGateway satisfies the PaymentGateway interface without Stripe imports", () => {
    const gw: PaymentGateway = new MockGateway();
    expect(gw.isConfigured()).toBe(true);
  });

  it("MockGateway.createCheckoutSession returns a gateway-agnostic result", async () => {
    const gw = new MockGateway();
    const result = await gw.createCheckoutSession({
      officeId:       7,
      officeName:     "Test",
      plan:           { planId: 1, planName: "Pro", planNameAr: "برو", providerType: "office", amountHalalas: 20_000, currency: "SAR" },
      idempotencyKey: "7:1:2026-08",
      successUrl:     "https://example.com/success",
      cancelUrl:      "https://example.com/cancel",
      isRenewal:      false,
    });
    expect(result.sessionId).toContain("mock_session_7");
    expect(result.sessionUrl).toContain("https://");
  });

  it("MockGateway.constructWebhookEvent returns NormalisedWebhookEvent with all required fields", () => {
    const gw = new MockGateway();
    const event = gw.constructWebhookEvent(Buffer.from("{}"), "valid_sig", "secret");

    // All fields the webhook handler reads
    expect(typeof event.id).toBe("string");
    expect(["checkout.completed", "payment.failed", "unknown"]).toContain(event.type);
    expect(event.sessionId).toBeDefined();
    expect(event.paymentIntentId).toBeDefined();
    expect(typeof event.amountTotal).toBe("number");
    expect(typeof event.currency).toBe("string");
    expect(typeof event.metadata).toBe("object");
    expect(event).toHaveProperty("failureMessage");
  });

  it("MockGateway.constructWebhookEvent throws on invalid signature", () => {
    const gw = new MockGateway();
    expect(() =>
      gw.constructWebhookEvent(Buffer.from("{}"), "bad_sig", "secret"),
    ).toThrow();
  });
});

describe("PaymentGateway — event type neutrality", () => {
  it("NormalisedEventType values are gateway-agnostic strings (not Stripe event names)", () => {
    // The allowed type values must not contain gateway-specific naming
    const allowedTypes: import("../paymentGateway").NormalisedEventType[] = [
      "checkout.completed",
      "payment.failed",
      "unknown",
    ];
    for (const t of allowedTypes) {
      expect(t).not.toContain("stripe");
      expect(t).not.toContain("payment_intent"); // Stripe uses underscores
      expect(t).not.toContain("session.completed"); // Stripe prefix
    }
  });

  it("checkout.completed maps correctly in MockGateway", () => {
    const gw = new MockGateway();
    const event = gw.constructWebhookEvent(Buffer.from("{}"), "valid_sig", "secret");
    expect(event.type).toBe("checkout.completed");
  });

  it("payment.failed event type is handled via NormalisedEventType in route handlers", () => {
    // Confirm the route handler string comparison uses neutral types
    // (we read the source to check the event.type comparison strings)
    const fs = require("fs");
    const routeSource: string = fs.readFileSync(
      require("path").join(__dirname, "../../routes/payments.ts"),
      "utf-8",
    );
    // Route should use neutral event names, not Stripe-specific
    expect(routeSource).toContain('"checkout.completed"');
    expect(routeSource).toContain('"payment.failed"');
    expect(routeSource).not.toContain('"checkout.session.completed"');
    expect(routeSource).not.toContain('"payment_intent.payment_failed"');
  });
});

describe("StripeGateway — interface conformance", () => {
  it("StripeGateway satisfies PaymentGateway interface (duck-type check)", () => {
    const gw = new StripeGateway();
    expect(typeof gw.isConfigured).toBe("function");
    expect(typeof gw.createCheckoutSession).toBe("function");
    expect(typeof gw.constructWebhookEvent).toBe("function");
  });

  it("StripeGateway.isConfigured() returns false when STRIPE_SECRET_KEY is unset", () => {
    const original = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    const gw = new StripeGateway();
    expect(gw.isConfigured()).toBe(false);
    process.env.STRIPE_SECRET_KEY = original;
  });
});

describe("getPaymentGateway / _setPaymentGateway injection", () => {
  it("_setPaymentGateway replaces the active gateway returned by getPaymentGateway", () => {
    const mock = new MockGateway();
    _setPaymentGateway(mock);
    expect(getPaymentGateway()).toBe(mock);

    // Reset to default (StripeGateway)
    _setPaymentGateway(new StripeGateway());
  });

  it("getPaymentGateway returns an object with all interface methods", () => {
    const gw = getPaymentGateway();
    expect(typeof gw.isConfigured).toBe("function");
    expect(typeof gw.createCheckoutSession).toBe("function");
    expect(typeof gw.constructWebhookEvent).toBe("function");
  });
});
