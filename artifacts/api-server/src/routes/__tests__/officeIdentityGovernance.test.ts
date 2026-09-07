import { describe, expect, it } from "vitest";
import { RegisterOfficeBody, UpdateMyOfficeBody } from "@workspace/api-zod";

const validRegistration = {
  officeName: "Current Office",
  category: "development",
  email: "current@example.com",
  whatsapp: "+966500000000",
  password: "secret1",
  city: "Riyadh",
  termsAccepted: true,
  providerType: "office",
};

describe("office identity governance contracts", () => {
  it("accepts current categories for registration and profile correction", () => {
    expect(RegisterOfficeBody.safeParse(validRegistration).success).toBe(true);
    expect(UpdateMyOfficeBody.safeParse({ category: "development" }).success).toBe(true);
  });

  it("rejects obsolete other for new registration", () => {
    expect(RegisterOfficeBody.safeParse({ ...validRegistration, category: "other" }).success).toBe(false);
  });

  it("rejects obsolete and invalid categories on direct profile API calls", () => {
    expect(UpdateMyOfficeBody.safeParse({ category: "other" }).success).toBe(false);
    expect(UpdateMyOfficeBody.safeParse({ category: "made_up" }).success).toBe(false);
  });

  it("keeps office names required at the contract boundary", () => {
    expect(UpdateMyOfficeBody.safeParse({ name: "" }).success).toBe(false);
    expect(UpdateMyOfficeBody.safeParse({ name: "New approved identity" }).success).toBe(true);
  });

  it("accepts an optional Arabic name and an explicit null fallback", () => {
    expect(UpdateMyOfficeBody.safeParse({ nameAr: "مكتب سكاي أوفيس" }).success).toBe(true);
    expect(UpdateMyOfficeBody.safeParse({ nameAr: null }).success).toBe(true);
  });
});