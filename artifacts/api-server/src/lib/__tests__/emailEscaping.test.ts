import { describe, expect, it } from "vitest";
import { buildSrNotificationEmail } from "../email";

describe("service-request notification email escaping", () => {
  it("renders service, office, price, and duration as text rather than HTML", () => {
    const html = buildSrNotificationEmail({
      locale: "en",
      notificationType: "sr_offer_sent",
      recipientRole: "customer",
      officeName: '<img src=x onerror="alert(1)">',
      serviceName: '<a href="https://attacker.example">Click here</a>',
      serviceRequestId: 42,
      price: '<strong>Free</strong>',
      executionDuration: '<script>alert(1)</script>',
    });

    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain(
      "&lt;a href=&quot;https://attacker.example&quot;&gt;Click here&lt;/a&gt;",
    );
    expect(html).toContain("&lt;strong&gt;Free&lt;/strong&gt;");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain('<img src=x onerror="alert(1)">');
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});