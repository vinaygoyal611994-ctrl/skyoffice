import { describe, expect, it } from "vitest";
import { verificationErrorKey } from "./verificationUi";

describe("verification UI error states", () => {
  it.each([
    ["invalid_code", "verify.error_invalid"],
    ["expired", "verify.error_expired"],
    ["attempts_exhausted", "verify.error_attempts"],
    ["no_token", "verify.error_no_code"],
    ["delivery_unavailable", "verify.error_delivery"],
  ])("maps %s to bilingual UI copy", (code, expected) => {
    expect(verificationErrorKey({ data: { code } })).toBe(expected);
  });

  it("uses a safe fallback for unexpected provider failures", () => {
    expect(verificationErrorKey(new Error("secret provider detail"))).toBe(
      "verify.error_generic",
    );
  });
});